import {
  BufferAttribute, BufferGeometry, Camera, DoubleSide, DynamicDrawUsage,
  InstancedBufferAttribute, InstancedBufferGeometry, Mesh, Scene,
  ShaderMaterial, Vector2, WebGLRenderer,
} from "three";
import { FAR, HIDDEN, POINT_SIZE, STRIDE_FLOATS } from "./consts";
import { compass, groundBands, groundDirections, horizon } from "./earthReference";
import type { Trajectory } from "./externalDataStore";
import { skyProjectionShader, StereographicViewport } from "./stereographic";
import { MAX_MODEL_RADIUS, MIN_MODEL_RADIUS, MODEL_SIZE_SCALE, satelliteGeometry } from "./satelliteModel";

type Segment = { source: number[]; target: number[]; color: number[]; width: number };
const fragmentShader = `
varying vec4 vColor;
void main() { gl_FragColor = vColor; }
`;

export class SkyRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new Camera();
  viewport: StereographicViewport;
  private uniforms = {
    skyView: { value: new StereographicViewport({ width: 1, height: 1 }).viewMatrix },
    skyScale: { value: new Vector2() },
    skyFar: { value: FAR },
    viewportSize: { value: new Vector2() },
    daylight: { value: 0 },
    twilight: { value: 0 },
    pointRadius: { value: POINT_SIZE },
    selected: { value: -1 },
    hovered: { value: -1 },
  };
  private satellites: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private lines: Mesh;
  private ground: Mesh;
  private labels: HTMLSpanElement[];
  private labelContainer: HTMLDivElement;
  private positions: Float32Array | null = null;
  private count = 0;
  private trajectories: Trajectory[] = [];
  private selected = -1;
  private fovy = 75;
  private pitch = 0;
  private referenceKey = "";

  constructor(canvas: HTMLCanvasElement, container: HTMLElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.viewport = new StereographicViewport({ width: 1, height: 1 });
    const geometry = satelliteGeometry();
    geometry.setAttribute("satellitePosition", new InstancedBufferAttribute(new Float32Array(0), STRIDE_FLOATS));
    geometry.setAttribute("satelliteIndex", new InstancedBufferAttribute(new Float32Array(0), 1));
    this.satellites = new Mesh(geometry, this.material(`
      attribute vec3 satellitePosition;
      attribute float satelliteIndex, panel;
      uniform float pointRadius, selected, hovered;
      uniform vec2 viewportSize;
      varying vec3 vNormal, vLocalPosition;
      varying float vPanel;
      varying vec4 vColor;
      mat3 modelRotation() {
        float roll = sin(satelliteIndex * 2.39996) * 0.7;
        mat3 rx = mat3(1.0, 0.0, 0.0, 0.0, 0.8525, 0.5227, 0.0, -0.5227, 0.8525);
        mat3 ry = mat3(0.9004, 0.0, 0.4350, 0.0, 1.0, 0.0, -0.4350, 0.0, 0.9004);
        mat3 rz = mat3(cos(roll), sin(roll), 0.0, -sin(roll), cos(roll), 0.0, 0.0, 0.0, 1.0);
        return rz * ry * rx;
      }
      void main() {
        gl_Position = skyProject(satellitePosition);
        float radius = clamp(pointRadius * ${MODEL_SIZE_SCALE.toFixed(2)} / max(length(satellitePosition), 0.0001), ${MIN_MODEL_RADIUS.toFixed(2)}, ${MAX_MODEL_RADIUS.toFixed(2)});
        mat3 rotation = modelRotation();
        vec3 vertex = rotation * position;
        gl_Position.xy += vertex.xy * radius * 2.0 / viewportSize * gl_Position.w;
        // Local depth makes the bus and wings occlude correctly, without
        // changing clipping for hidden satellites or the sky projection.
        if (abs(gl_Position.z) < gl_Position.w) gl_Position.z -= vertex.z * 0.0001 * gl_Position.w;
        vNormal = rotation * normal;
        vLocalPosition = position;
        vPanel = panel;
        vColor = satelliteIndex == hovered ? vec4(0.392, 1.0, 0.549, 1.0) :
          satelliteIndex == selected ? vec4(0.314, 0.824, 1.0, 1.0) : vec4(1.0);
      }
    `, `
      varying vec3 vNormal, vLocalPosition;
      varying float vPanel;
      varying vec4 vColor;
      void main() {
        float light = 0.48 + 0.52 * max(dot(normalize(vNormal), normalize(vec3(-0.4, 0.7, 1.0))), 0.0);
        vec3 color = vec3(0.86, 0.89, 0.94);
        if (vPanel > 0.5) {
          vec2 cell = abs(fract((vLocalPosition.xy + vec2(0.995, 0.25)) * vec2(12.3, 8.0)) - 0.5);
          float grid = smoothstep(0.41, 0.48, max(cell.x, cell.y));
          color = mix(vec3(0.12, 0.36, 0.68), vec3(0.52, 0.72, 0.88), grid);
        }
        color = mix(color, vColor.rgb, vColor.g > 0.95 && vColor.r < 0.5 ? 0.7 : vColor.r < 0.5 ? 0.6 : 0.0);
        gl_FragColor = vec4(color * light, 1.0);
      }
    `));
    this.satellites.material.depthTest = true;
    this.satellites.material.depthWrite = true;
    this.satellites.frustumCulled = false;
    this.satellites.renderOrder = 3;

    const groundGeometry = new BufferGeometry();
    const vertices: number[] = [];
    const bands: number[] = [];
    for (const band of groundBands) {
      for (const i of [0, 1, 2, 0, 2, 3]) {
        vertices.push(...band.polygon[i]);
        bands.push(band.brightness, band.glow ? 1 : 0);
      }
    }
    groundGeometry.setAttribute("position", new BufferAttribute(new Float32Array(vertices), 3));
    groundGeometry.setAttribute("band", new BufferAttribute(new Float32Array(bands), 2));
    this.ground = new Mesh(groundGeometry, this.material(`
      attribute vec2 band;
      uniform float daylight, twilight;
      varying vec4 vColor;
      void main() {
        vec3 rim = vec3(45.0 + daylight * 20.0 + twilight * 45.0, 87.0 + daylight * 25.0,
          92.0 + daylight * 50.0 + twilight * 15.0);
        vec3 base = vec3(5.0 + daylight * 5.0 + band.x * (10.0 + twilight * 8.0),
          12.0 + daylight * 8.0 + band.x * 22.0,
          15.0 + daylight * 12.0 + band.x * (23.0 + daylight * 10.0));
        vColor = band.y > 0.5 ? vec4(rim / 255.0, 42.0 * band.x / 255.0) : vec4(base / 255.0, 1.0);
        gl_Position = skyProject(position);
      }
    `));
    this.ground.frustumCulled = false;
    this.lines = new Mesh(new InstancedBufferGeometry(), this.material(`
      attribute vec3 source, target;
      attribute vec4 segmentColor;
      attribute float segmentWidth;
      uniform vec2 viewportSize;
      varying vec4 vColor;
      void main() {
        vColor = segmentColor;
        vec4 a = skyProject(source), b = skyProject(target);
        float da = a.w - a.z, db = b.w - b.z;
        if (da <= 0.0 && db <= 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
        if (da < 0.0 || db < 0.0) {
          vec4 intersection = mix(a, b, da / (da - db));
          if (da < 0.0) a = intersection; else b = intersection;
        }
        vec2 direction = (b.xy / b.w - a.xy / a.w) * viewportSize;
        float len = length(direction);
        if (len < 0.000001) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
        vec2 normal = vec2(-direction.y, direction.x) / len;
        gl_Position = mix(a, b, position.x);
        gl_Position.xy += normal * position.y * segmentWidth / viewportSize * gl_Position.w;
      }
    `));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 2;
    this.scene.add(this.ground, this.lines, this.satellites);
    this.labelContainer = document.createElement("div");
    this.labelContainer.className = "sky-compass";
    this.labelContainer.setAttribute("aria-hidden", "true");
    this.labels = compass.map((item) => {
      const label = document.createElement("span");
      label.textContent = item.text;
      label.style.fontSize = item.cardinal ? "15px" : "11px";
      label.style.color = item.degrees === 0 ? "#7ed3d1" : "#9bb4bb";
      this.labelContainer.append(label);
      return label;
    });
    container.append(this.labelContainer);
  }

  private material(vertexShader: string, fragment = fragmentShader) {
    return new ShaderMaterial({
      uniforms: this.uniforms, vertexShader: skyProjectionShader + vertexShader,
      fragmentShader: fragment, transparent: true, depthTest: false, depthWrite: false, side: DoubleSide,
    });
  }

  setView(bearing: number, pitch: number, fovy: number) {
    const { clientWidth: width, clientHeight: height } = this.renderer.domElement;
    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    const size = this.renderer.getSize(new Vector2());
    if (size.x !== width || size.y !== height || this.renderer.getPixelRatio() !== pixelRatio) {
      this.renderer.setPixelRatio(pixelRatio);
      this.renderer.setSize(width, height, false);
    }
    this.viewport = new StereographicViewport({ width, height, bearing, pitch, fovy, far: FAR });
    this.uniforms.skyView.value.copy(this.viewport.viewMatrix);
    this.uniforms.skyScale.value.set(4 * this.viewport.focalLength / width, 4 * this.viewport.focalLength / height);
    this.uniforms.viewportSize.value.set(width, height);
    this.uniforms.pointRadius.value = POINT_SIZE * (4 - fovy / 25);
    this.fovy = fovy;
    this.pitch = pitch;
    const key = `${pitch > 40}:${fovy < 55}:${fovy < 35}:${fovy < 15}`;
    if (key !== this.referenceKey) {
      this.referenceKey = key;
      this.updateLines();
    }
    compass.forEach((item, i) => {
      const [x, y, depth] = this.viewport.project(item.position);
      const visible = (item.cardinal || (fovy < 35 && item.degrees % 30 === 0) || fovy < 15) &&
        depth <= 1 && x >= -20 && x <= width + 20 && y >= -20 && y <= height + 20;
      this.labels[i].hidden = !visible;
      if (visible) this.labels[i].style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    });
  }

  setDaylight(elevation: number) {
    this.uniforms.daylight.value = Math.max(0, Math.min(1, (elevation + 6) / 12));
    this.uniforms.twilight.value = Math.max(0, 1 - Math.abs(elevation + 6) / 12);
    this.updateLines();
  }

  setPositions(positions: Float32Array | null, count: number) {
    if (positions !== this.positions || count !== this.count) {
      this.positions = positions;
      this.count = count;
      const geometry = this.satellites.geometry;
      // Keep the worker's shared array as the attribute backing store. Revisions
      // upload it directly; no per-satellite objects or React updates are needed.
      // Dispose the old GPU buffers before replacing instance attributes.
      geometry.dispose();
      geometry.setAttribute("satellitePosition", new InstancedBufferAttribute(positions ?? new Float32Array(0), STRIDE_FLOATS).setUsage(DynamicDrawUsage));
      geometry.setAttribute("satelliteIndex", new InstancedBufferAttribute(Float32Array.from({ length: count }, (_, i) => i), 1));
      geometry.instanceCount = positions ? count : 0;
    }
    this.satellites.geometry.getAttribute("satellitePosition").needsUpdate = true;
  }

  setHighlight(hovered: number, selected: number) {
    this.uniforms.hovered.value = hovered;
    this.uniforms.selected.value = selected;
    if (this.selected !== selected) {
      this.selected = selected;
      this.updateLines();
    }
  }

  setTrajectories(trajectories: Trajectory[]) {
    this.trajectories = trajectories;
    this.updateLines();
  }

  private updateLines() {
    const segments: Segment[] = [];
    const path = (points: number[][], color: number[], width: number) => {
      for (let i = 1; i < points.length; i++) segments.push({ source: points[i - 1], target: points[i], color, width });
    };
    const day = this.uniforms.daylight.value, twilight = this.uniforms.twilight.value;
    path(horizon, [45 + day * 20 + twilight * 45, 87 + day * 25, 92 + day * 50 + twilight * 15, 180], 1.2);
    groundDirections.filter((d) => d.cardinal || this.pitch > 40).forEach((d) => path(d.path, [75, 121, 128, 48], 1));
    compass.filter((d) => d.cardinal || this.fovy < 55 || d.degrees % 30 === 0).forEach((d) =>
      path(d.path, d.degrees === 0 ? [126, 211, 209, 200] : [112, 153, 160, 140], 1));
    this.trajectories.forEach((d) => path(d.path, d.index === this.selected ? [255, 190, 60, 220] : [80, 210, 255, 220], 2));
    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
    geometry.setAttribute("source", new InstancedBufferAttribute(new Float32Array(segments.flatMap((s) => s.source)), 3));
    geometry.setAttribute("target", new InstancedBufferAttribute(new Float32Array(segments.flatMap((s) => s.target)), 3));
    geometry.setAttribute("segmentColor", new InstancedBufferAttribute(new Float32Array(segments.flatMap((s) => s.color.map((c) => c / 255))), 4));
    geometry.setAttribute("segmentWidth", new InstancedBufferAttribute(new Float32Array(segments.map((s) => s.width)), 1));
    geometry.instanceCount = segments.length;
    this.lines.geometry.dispose();
    this.lines.geometry = geometry;
  }

  pick(x: number, y: number, radius = 25): number {
    if (!this.positions) return -1;
    const m = this.viewport.viewMatrix.elements;
    let closest = Infinity, picked = -1;
    // A screen-space hit test matches the non-perspective shader and includes
    // the marker radius, even beyond the camera's forward hemisphere.
    for (let i = 0; i < this.count; i++) {
      const offset = i * STRIDE_FLOATS;
      const east = this.positions[offset], north = this.positions[offset + 1], up = this.positions[offset + 2];
      if (up === HIDDEN) continue;
      const range = Math.hypot(east, north, up);
      const z = m[2] * east + m[6] * north + m[10] * up;
      if (range < 0.0001 || range > FAR || z / range > 0.5) continue;
      const scale = 2 * this.viewport.focalLength / Math.max(range - z, range * 0.0001);
      const px = this.viewport.width / 2 + scale * (m[0] * east + m[4] * north + m[8] * up);
      const py = this.viewport.height / 2 - scale * (m[1] * east + m[5] * north + m[9] * up);
      if (px < 0 || py < 0 || px > this.viewport.width || py > this.viewport.height) continue;
      const distance = Math.hypot(px - x, py - y);
      const markerRadius = Math.max(MIN_MODEL_RADIUS, Math.min(MAX_MODEL_RADIUS, this.uniforms.pointRadius.value * MODEL_SIZE_SCALE / range));
      if (distance <= radius + markerRadius && distance < closest) {
        closest = distance;
        picked = i;
      }
    }
    return picked;
  }

  render() { this.renderer.render(this.scene, this.camera); }

  dispose() {
    for (const object of [this.ground, this.lines, this.satellites]) {
      object.geometry.dispose();
      (object.material as ShaderMaterial).dispose();
    }
    this.labelContainer.remove();
    this.renderer.dispose();
  }
}
