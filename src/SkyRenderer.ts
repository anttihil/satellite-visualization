import {
  BufferAttribute, BufferGeometry, Camera, DoubleSide, DynamicDrawUsage,
  InstancedBufferAttribute, InstancedBufferGeometry, Mesh, Points, Scene,
  ShaderMaterial, Vector2, WebGLRenderer,
} from "three";
import { FAR, HIDDEN, POINT_SIZE, STRIDE_FLOATS } from "./consts";
import { compass, groundBands, groundDirections, horizon } from "./earthReference";
import type { Trajectory } from "./externalDataStore";
import { MAX_POINT_RADIUS, MIN_POINT_RADIUS, skyProjectionShader, StereographicViewport } from "./stereographic";

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
    pixelRatio: { value: 1 },
    selected: { value: -1 },
    hovered: { value: -1 },
  };
  private satellites: Points;
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
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(0), STRIDE_FLOATS));
    this.satellites = new Points(geometry, this.material(`
      attribute float satelliteIndex;
      uniform float pointRadius, pixelRatio, selected, hovered;
      varying vec4 vColor;
      void main() {
        gl_Position = skyProject(position);
        float radius = clamp(pointRadius / max(length(position), 0.0001), ${MIN_POINT_RADIUS.toFixed(2)}, ${MAX_POINT_RADIUS.toFixed(2)});
        gl_PointSize = radius * 2.0 * pixelRatio;
        vColor = satelliteIndex == hovered ? vec4(0.392, 1.0, 0.549, 1.0) :
          satelliteIndex == selected ? vec4(0.314, 0.824, 1.0, 1.0) : vec4(1.0);
      }
    `, `
      varying vec4 vColor;
      void main() {
        float distanceFromCenter = length(gl_PointCoord - 0.5) * 2.0;
        if (distanceFromCenter > 1.0) discard;
        gl_FragColor = vec4(vColor.rgb, vColor.a * (1.0 - smoothstep(0.8, 1.0, distanceFromCenter)));
      }
    `));
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
    this.uniforms.pixelRatio.value = pixelRatio;
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
      this.satellites.geometry.dispose();
      const geometry = new BufferGeometry();
      // Keep the worker's shared array as the attribute backing store. Revisions
      // upload it directly; no per-satellite objects or React updates are needed.
      geometry.setAttribute("position", new BufferAttribute(positions ?? new Float32Array(0), STRIDE_FLOATS).setUsage(DynamicDrawUsage));
      geometry.setAttribute("satelliteIndex", new BufferAttribute(Float32Array.from({ length: count }, (_, i) => i), 1));
      geometry.setDrawRange(0, count);
      this.satellites.geometry = geometry;
    }
    this.satellites.geometry.getAttribute("position").needsUpdate = true;
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
      const markerRadius = Math.max(MIN_POINT_RADIUS, Math.min(MAX_POINT_RADIUS, this.uniforms.pointRadius.value / range));
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
