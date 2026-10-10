import { PathLayer, PointCloudLayer, SolidPolygonLayer, _MultiIconLayer } from "@deck.gl/layers";
import { MAX_POINT_RADIUS, MIN_POINT_RADIUS, skyVertexShader } from "./stereographic";

export class SkyPathLayer<DataT = unknown> extends PathLayer<DataT> {
  static layerName = "SkyPathLayer";
  getShaders() {
    const shaders = super.getShaders();
    return { ...shaders, vs: skyVertexShader(shaders.vs) };
  }
}

export class SkyGroundLayer<DataT = unknown> extends SolidPolygonLayer<DataT> {
  static layerName = "SkyGroundLayer";
  getShaders(type: string) {
    const shaders = super.getShaders(type);
    return { ...shaders, vs: skyVertexShader(shaders.vs) };
  }
}

export class SkyLabelLayer<DataT = unknown> extends _MultiIconLayer<DataT> {
  static layerName = "SkyLabelLayer";
  getShaders() {
    const shaders = super.getShaders();
    return {
      ...shaders,
      vs: skyVertexShader(shaders.vs).replace(
        "project_pixel_size_to_clipspace(offset.xy)",
        "project_pixel_size_to_clipspace(offset.xy) * gl_Position.w",
      ),
    };
  }
}

export class SkySatelliteLayer<DataT = unknown> extends PointCloudLayer<DataT> {
  static layerName = "SkySatelliteLayer";
  getShaders() {
    const shaders = super.getShaders();
    return {
      ...shaders,
      vs: skyVertexShader(shaders.vs)
        .replace("DECKGL_FILTER_SIZE(offset, geometry);", `
          // Preserve range, but remove perspective's off-axis size inflation.
          float range = max(length(instancePositions - project.cameraPosition), 0.0001);
          float radius = clamp(pointCloud.radiusPixels / range, ${MIN_POINT_RADIUS.toFixed(2)}, ${MAX_POINT_RADIUS.toFixed(2)});
          offset *= radius / max(pointCloud.radiusPixels, 0.0001);
          DECKGL_FILTER_SIZE(offset, geometry);`)
        .replace("project_pixel_size_to_clipspace(offset.xy)",
          "project_pixel_size_to_clipspace(offset.xy) * gl_Position.w"),
    };
  }
}
