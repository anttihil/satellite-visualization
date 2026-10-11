import assert from "node:assert/strict";
import { test } from "node:test";
import { celestialBodies } from "../src/celestialBodies.ts";

const radians = Math.PI / 180;

test("Sun and Moon align above Dallas during the April 2024 solar eclipse", () => {
  const { sun, moon } = celestialBodies(new Date("2024-04-08T18:42:00Z"), {
    latitude: 32.78 * radians, longitude: -96.8 * radians, height: 0.13,
  });
  assert.ok(sun.direction.angleTo(moon.direction) < 0.3 * radians);
  assert.ok(Math.asin(sun.direction.z) / radians > 60);
  assert.ok(moon.illumination.dot(moon.direction) > 0.99, "new moon faces away from sunlight");
  for (const body of [sun, moon]) {
    assert.ok(Math.abs(body.direction.length() - 1) < 1e-10);
    assert.ok(body.angularRadius / radians > 0.24 && body.angularRadius / radians < 0.29);
  }
});

test("full Moon is opposite the Sun and its visible face is illuminated", () => {
  const { sun, moon } = celestialBodies(new Date("2024-03-25T07:00:00Z"), {
    latitude: 0, longitude: 0, height: 0,
  });
  assert.ok(sun.direction.angleTo(moon.direction) > 177 * radians);
  assert.ok(moon.illumination.dot(moon.direction) < -0.99);
});

test("observer longitude changes the local sky and time carries the Sun below the horizon", () => {
  const noon = celestialBodies(new Date("2024-03-20T12:00:00Z"), { latitude: 0, longitude: 0, height: 0 });
  const midnight = celestialBodies(new Date("2024-03-21T00:00:00Z"), { latitude: 0, longitude: 0, height: 0 });
  const opposite = celestialBodies(new Date("2024-03-20T12:00:00Z"), { latitude: 0, longitude: Math.PI, height: 0 });
  assert.ok(noon.sun.direction.z > 0.99);
  assert.ok(midnight.sun.direction.z < -0.99);
  assert.ok(opposite.sun.direction.z < -0.99);
});
