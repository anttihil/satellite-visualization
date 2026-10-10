import { Matrix4, Vector3 } from "three";
import { HIDDEN } from "./consts.ts";

const MAX_ANGLE = 120 * Math.PI / 180;
const MAX_CORNER_ANGLE = 100 * Math.PI / 180;
export const MIN_POINT_RADIUS = 1.25;
export const MAX_POINT_RADIUS = 6;

export function stereographicFocalLength(width: number, height: number, fovy: number) {
  return Math.max(
    height / (4 * Math.tan(fovy * Math.PI / 720)),
    Math.hypot(width, height) / (4 * Math.tan(MAX_CORNER_ANGLE / 2)),
  );
}

// East/north/up coordinates, with negative pitch looking above the horizon.
// The same matrix and projection are used by GPU rendering and CPU picking.
export class StereographicViewport {
  width: number;
  height: number;
  focalLength: number;
  skyFar: number;
  viewMatrix: Matrix4;
  viewMatrixInverse: Matrix4;

  constructor({ width, height, bearing = 0, pitch = 0, fovy = 75, far = 2000 }:
    { width: number; height: number; bearing?: number; pitch?: number; fovy?: number; far?: number }) {
    this.width = width;
    this.height = height;
    this.focalLength = stereographicFocalLength(width, height, fovy);
    this.skyFar = far;
    const b = bearing * Math.PI / 180;
    const p = pitch * Math.PI / 180;
    this.viewMatrix = new Matrix4().set(
      Math.cos(b), -Math.sin(b), 0, 0,
      Math.sin(b) * Math.sin(p), Math.cos(b) * Math.sin(p), Math.cos(p), 0,
      -Math.sin(b) * Math.cos(p), -Math.cos(b) * Math.cos(p), Math.sin(p), 0,
      0, 0, 0, 1,
    );
    this.viewMatrixInverse = this.viewMatrix.clone().invert();
  }

  project(xyz: ArrayLike<number>, { topLeft = true }: { topLeft?: boolean } = {}): number[] {
    const p = new Vector3(xyz[0], xyz[1], xyz[2] ?? 0).applyMatrix4(this.viewMatrix);
    const range = p.length();
    const denominator = Math.max(range - p.z, range * 0.0001, 0.0001);
    const angularExcess = Math.cos(MAX_ANGLE) + p.z / Math.max(range, 0.0001);
    const depth = angularExcess > 0 ? 1 + angularExcess : range / this.skyFar;
    return [
      this.width / 2 + 2 * this.focalLength * p.x / denominator,
      this.height / 2 + (topLeft ? -1 : 1) * 2 * this.focalLength * p.y / denominator,
      xyz[2] === HIDDEN || range < 0.0001 ? 2 : depth,
    ];
  }

  unproject(xyz: number[], { topLeft = true, targetZ }: { topLeft?: boolean; targetZ?: number } = {}): number[] {
    const qx = (xyz[0] - this.width / 2) / (2 * this.focalLength);
    const qy = (xyz[1] - this.height / 2) * (topLeft ? -1 : 1) / (2 * this.focalLength);
    const s = qx * qx + qy * qy;
    const ray = new Vector3(2 * qx / (1 + s), 2 * qy / (1 + s), (s - 1) / (1 + s))
      .applyMatrix4(this.viewMatrixInverse);
    const range = Number.isFinite(xyz[2]) ? xyz[2] * this.skyFar :
      Number.isFinite(targetZ) && Math.abs(ray.z) > 1e-10 ? targetZ! / ray.z : 1;
    return ray.multiplyScalar(range).toArray();
  }
}

export const skyProjectionShader = `
uniform mat4 skyView;
uniform vec2 skyScale;
uniform float skyFar;
vec4 skyProject(vec3 position) {
  vec3 p = (skyView * vec4(position, 1.0)).xyz;
  float range = length(p);
  if (range < 0.0001) return vec4(0.0, 0.0, 2.0, 1.0);
  float w = max(range - p.z, range * 0.0001);
  float excess = ${Math.cos(MAX_ANGLE)} + p.z / range;
  float depth = excess > 0.0 ? 1.0 + 2.0 * excess : 2.0 * range / skyFar - 1.0;
  if (position.z == ${HIDDEN.toFixed(1)}) depth = 2.0;
  return vec4(skyScale * p.xy, depth * w, w);
}
`;
