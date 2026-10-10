import { FirstPersonView, FirstPersonViewport, LayerExtension, project, type Layer } from "@deck.gl/core";
import { HIDDEN } from "./consts.ts";

const MAX_ANGLE = 120 * Math.PI / 180;
const MAX_CORNER_ANGLE = 100 * Math.PI / 180;
export const MIN_POINT_RADIUS = 1.25;
export const MAX_POINT_RADIUS = 6;

// Cap corner coverage on extreme aspect ratios, keeping the rear pole outside
// the screen and leaving a margin for clipping connected reference geometry.
export function stereographicFocalLength(width: number, height: number, fovy: number) {
  return Math.max(
    height / (4 * Math.tan(fovy * Math.PI / 720)),
    Math.hypot(width, height) / (4 * Math.tan(MAX_CORNER_ANGLE / 2)),
  );
}

function transform(matrix: number[], p: number[], w: number): number[] {
  return [0, 1, 2].map((i) => matrix[i] * p[0] + matrix[i + 4] * p[1] +
    matrix[i + 8] * (p[2] ?? 0) + matrix[i + 12] * w);
}

export class StereographicViewport extends FirstPersonViewport {
  focalLength: number;
  skyFar: number;

  constructor(props: ConstructorParameters<typeof FirstPersonViewport>[0]) {
    super(props);
    this.focalLength = stereographicFocalLength(this.width, this.height, props.fovy ?? 75);
    this.skyFar = props.far ?? 2000;
  }

  project(xyz: number[], { topLeft = true }: { topLeft?: boolean } = {}): number[] {
    const p = transform(this.viewMatrix, xyz, 1);
    const range = Math.hypot(...p);
    const denominator = Math.max(range - p[2], range * 0.0001, 0.0001);
    const x = this.width / 2 + 2 * this.focalLength * p[0] / denominator;
    const y = this.height / 2 + (topLeft ? -1 : 1) * 2 * this.focalLength * p[1] / denominator;
    const angularExcess = Math.cos(MAX_ANGLE) + p[2] / Math.max(range, 0.0001);
    const depth = angularExcess > 0 ? 1 + angularExcess : range / this.skyFar;
    return [x, y, xyz[2] === HIDDEN || range < 0.0001 ? 2 : depth];
  }

  unproject(xyz: number[], { topLeft = true, targetZ }: { topLeft?: boolean; targetZ?: number } = {}): number[] {
    const qx = (xyz[0] - this.width / 2) / (2 * this.focalLength);
    const qy = (xyz[1] - this.height / 2) * (topLeft ? -1 : 1) / (2 * this.focalLength);
    const s = qx * qx + qy * qy;
    const ray = transform(this.viewMatrixInverse, [2 * qx / (1 + s), 2 * qy / (1 + s), (s - 1) / (1 + s)], 0);
    const eye = this.cameraPosition;
    const range = Number.isFinite(xyz[2]) ? xyz[2] * this.skyFar :
      Number.isFinite(targetZ) && Math.abs(ray[2]) > 1e-10 ? (targetZ! - eye[2]) / ray[2] : 1;
    return ray.map((v, i) => eye[i] + v * range);
  }
}

export class StereographicView extends FirstPersonView {
  getViewportType() {
    return StereographicViewport;
  }
}

type SkyUniforms = { viewMatrix: number[]; scale: number[]; far: number };

const skyModule = {
  name: "sky",
  dependencies: [project],
  uniformTypes: { viewMatrix: "mat4x4<f32>", scale: "vec2<f32>", far: "f32" },
  getUniforms: (props: SkyUniforms) => props,
  vs: `
layout(std140) uniform skyUniforms {
  mat4 viewMatrix;
  vec2 scale;
  float far;
} sky;

vec4 sky_common_position_to_clipspace(vec4 position) {
  vec3 p = (sky.viewMatrix * position).xyz;
  float range = length(p);
  // Zero-filled slots have no direction until the worker's first update.
  if (range < 0.0001) return vec4(0.0, 0.0, 2.0, 1.0);
  // WebGL camera Z is negative forward. Homogeneous W retains the
  // denominator for correctly clipping and extruding connected primitives.
  float w = max(range - p.z, range * 0.0001);
  float radialDepth = 2.0 * range / sky.far - 1.0;
  float angularExcess = ${Math.cos(MAX_ANGLE)} + p.z / range;
  float depth = angularExcess > 0.0 ? 1.0 + 2.0 * angularExcess : radialDepth;
  return vec4(sky.scale * p.xy, depth * w, w);
}

vec4 sky_position_to_clipspace(vec3 position, vec3 low, vec3 offset, out vec4 commonPosition) {
  commonPosition = vec4(project_position(position, low) + offset, 1.0);
  vec4 clip = sky_common_position_to_clipspace(commonPosition);
  if (position.z == ${HIDDEN.toFixed(1)}) clip.z = 2.0 * clip.w;
  return clip;
}
vec4 sky_position_to_clipspace(vec3 position, vec3 low, vec3 offset) {
  vec4 commonPosition;
  return sky_position_to_clipspace(position, low, offset, commonPosition);
}
`,
};

// Replace only calls in a layer's vertex shader, leaving Deck's stock project
// module intact for coordinate conversion, lighting, and pixel-size helpers.
export function skyVertexShader(vs: string): string {
  return vs.replaceAll("project_position_to_clipspace", "sky_position_to_clipspace")
    .replaceAll("project_common_position_to_clipspace", "sky_common_position_to_clipspace");
}

export class StereographicExtension extends LayerExtension {
  static extensionName = "StereographicExtension";

  getShaders() {
    return { modules: [skyModule] };
  }

  draw(this: Layer) {
    const viewport = this.context.viewport as StereographicViewport;
    for (const model of this.getModels()) {
      model.shaderInputs.setProps({ sky: {
        viewMatrix: viewport.viewMatrix,
        scale: [4 * viewport.focalLength / viewport.width, 4 * viewport.focalLength / viewport.height],
        far: viewport.skyFar,
      } });
    }
  }
}
