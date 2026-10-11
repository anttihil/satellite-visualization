import { BoxGeometry, BufferAttribute, InstancedBufferGeometry } from "three";

// A shared low-poly model: metal bus, two solar wings, and a small antenna.
// All satellites reuse these vertices in a single instanced draw call.
export const MIN_MODEL_RADIUS = 4;
export const MAX_MODEL_RADIUS = 16;
export const MODEL_SIZE_SCALE = 2.5;

export function satelliteGeometry() {
  const positions: number[] = [], normals: number[] = [], panels: number[] = [];
  const box = (size: number[], center: number[], panel = false) => {
    const indexed = new BoxGeometry(size[0], size[1], size[2]);
    const geometry = indexed.toNonIndexed();
    const position = geometry.getAttribute("position"), normal = geometry.getAttribute("normal");
    for (let i = 0; i < position.count; i++) {
      positions.push(position.getX(i) + center[0], position.getY(i) + center[1], position.getZ(i) + center[2]);
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      panels.push(panel ? 1 : 0);
    }
    geometry.dispose();
    indexed.dispose();
  };
  box([0.52, 0.6, 0.5], [0, 0, 0]);
  box([1.4, 0.06, 0.06], [0, 0, 0]);
  for (const side of [-1, 1]) box([0.65, 0.5, 0.06], [side * 0.67, 0, 0], true);
  box([0.04, 0.28, 0.04], [0, 0.44, 0]);
  box([0.22, 0.05, 0.16], [0, 0.6, 0]);
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute("panel", new BufferAttribute(new Float32Array(panels), 1));
  geometry.instanceCount = 0;
  return geometry;
}
