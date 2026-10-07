import { LineLayer } from "@deck.gl/layers";
import type { Trajectory } from "./externalDataStore";

export type OrbitSegment = {
  index: number;
  source: Trajectory["path"][number];
  target: Trajectory["path"][number];
};

export function orbitSegments(trajectories: Trajectory[]): OrbitSegment[] {
  return trajectories.flatMap(({ index, path }) =>
    path.slice(1).map((target, i) => ({ index, source: path[i], target })),
  );
}

// A minimal billboard segment shader: no path joins, rounded-cap discards, or
// neighboring-position attributes. LineLayer's stock extrusion is not suitable
// for this perspective view: its pixel offset is added without multiplying by w.
const vertexShader = `#version 300 es
#define SHADER_NAME orbit-layer-vertex-shader
in vec3 positions;
in vec3 instanceSourcePositions;
in vec3 instanceTargetPositions;
in vec3 instanceSourcePositions64Low;
in vec3 instanceTargetPositions64Low;
in vec4 instanceColors;
in float instanceWidths;
out vec4 vColor;
out vec2 uv;

void main(void) {
  geometry.worldPosition = instanceSourcePositions;
  geometry.worldPositionAlt = instanceTargetPositions;
  geometry.pickingColor = picking_getPickingColorFromInstanceID();
  uv = positions.xy;
  geometry.uv = uv;
  vColor = vec4(instanceColors.rgb, instanceColors.a * layer.opacity);
  DECKGL_FILTER_COLOR(vColor, geometry);

  vec4 sourceCommon;
  vec4 targetCommon;
  vec4 source = project_position_to_clipspace(
    instanceSourcePositions, instanceSourcePositions64Low, vec3(0.0), sourceCommon);
  vec4 target = project_position_to_clipspace(
    instanceTargetPositions, instanceTargetPositions64Low, vec3(0.0), targetCommon);

  // Clip before the perspective divide. A pass can extend behind the camera;
  // dividing those endpoints by w would flip or explode the strip's direction.
  float sourceDistance = source.z + source.w;
  float targetDistance = target.z + target.w;
  if (sourceDistance <= 0.0 && targetDistance <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  if (sourceDistance < 0.0 || targetDistance < 0.0) {
    float t = sourceDistance / (sourceDistance - targetDistance);
    vec4 intersection = mix(source, target, t);
    if (sourceDistance < 0.0) source = intersection;
    else target = intersection;
  }

  vec2 direction = (target.xy / target.w - source.xy / source.w) * project.viewportSize;
  float segmentLength = length(direction);
  if (segmentLength < 0.000001) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 normal = vec2(-direction.y, direction.x) / segmentLength;
  float widthPixels = clamp(
    project_size_to_pixel(instanceWidths * line.widthScale, line.widthUnits),
    line.widthMinPixels, line.widthMaxPixels);
  vec3 offset = vec3(normal * positions.y * widthPixels * 0.5, 0.0);
  DECKGL_FILTER_SIZE(offset, geometry);
  geometry.position = mix(sourceCommon, targetCommon, positions.x);
  gl_Position = mix(source, target, positions.x);
  gl_Position.xy += project_pixel_size_to_clipspace(offset.xy) * gl_Position.w;
  DECKGL_FILTER_GL_POSITION(gl_Position, geometry);
}
`;

export class OrbitLayer extends LineLayer<OrbitSegment> {
  static layerName = "OrbitLayer";

  getShaders() {
    return { ...super.getShaders(), vs: vertexShader };
  }
}
