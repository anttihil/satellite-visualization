import assert from "node:assert/strict";
import { test } from "node:test";
import { StereographicViewport } from "../src/stereographic.ts";

const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test("range changes depth but not satellite angular placement", () => {
  const viewport = new StereographicViewport({ width: 1600, height: 900, fovy: 75, far: 2000 });
  const near = viewport.project([100, 100, 50]);
  const far = viewport.project([1000, 1000, 500]);
  close(near[0], far[0]);
  close(near[1], far[1]);
  assert.ok(near[2] < far[2]);
});

test("CPU projection round trips through pixel and radial depth after camera rotation", () => {
  for (const [width, height] of [[1600, 900], [390, 844], [3440, 1440]]) {
    const viewport = new StereographicViewport({ width, height, bearing: 35, pitch: -30, fovy: 75, far: 2000 });
    const point = [100, 150, 90];
    for (const topLeft of [true, false]) {
      const recovered = viewport.unproject(viewport.project(point, { topLeft }), { topLeft });
      recovered.forEach((v, i) => close(v, point[i]));
    }
  }
});

test("off-axis radial depth still recovers distance beyond the forward hemisphere", () => {
  const viewport = new StereographicViewport({ width: 3440, height: 1440, far: 2000 });
  for (const angle of [75, 100]) {
    const point = [100 * Math.sin(angle * Math.PI / 180), 100 * Math.cos(angle * Math.PI / 180), 0];
    const recovered = viewport.unproject(viewport.project(point));
    recovered.forEach((v, i) => close(v, point[i]));
  }
});

test("75 degree vertical coverage and stereographic side-angle mapping", () => {
  const viewport = new StereographicViewport({ width: 390, height: 844, fovy: 75 });
  close(viewport.project([0, Math.cos(37.5 * Math.PI / 180), Math.sin(37.5 * Math.PI / 180)])[1], 0);
  const side = viewport.project([Math.sin(Math.PI / 3), Math.cos(Math.PI / 3), 0]);
  close(side[0] - viewport.width / 2, 2 * viewport.focalLength * Math.tan(Math.PI / 6));
});

test("extreme aspect ratios cap corner coverage and exclude rear/hidden positions", () => {
  const viewport = new StereographicViewport({ width: 7680, height: 720, fovy: 75 });
  const corner = viewport.unproject([0, 0, 0.1]);
  const angle = Math.acos(corner[1] / Math.hypot(...corner));
  close(angle, 100 * Math.PI / 180);
  assert.ok(viewport.project([0, -100, 0])[2] > 1);
  assert.ok(viewport.project([0, 100, -10000])[2] > 1);
  assert.ok(viewport.project([0, 0, 0])[2] > 1);
});
