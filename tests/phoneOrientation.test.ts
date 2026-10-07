import assert from "node:assert/strict";
import { test } from "node:test";
import { angleDifference, phoneDirection } from "../src/phoneOrientation.ts";

function reading(alpha: number, beta: number, gamma: number, absolute = true) {
  return { alpha, beta, gamma, absolute } as DeviceOrientationEvent;
}

function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 0.0001, `${actual} should equal ${expected}`);
}

test("rear-camera pointing direction uses compass azimuth and Deck pitch", () => {
  const north = phoneDirection(reading(0, 90, 0))!;
  close(north.bearing, 0);
  close(north.pitch, 0);
  const east = phoneDirection(reading(270, 120, 0))!;
  close(east.bearing, 90);
  close(east.pitch, -30);
  assert.equal(east.absolute, true);
});

test("landscape poses retain rear-camera direction", () => {
  close(phoneDirection(reading(90, 0, -90))!.bearing, 0);
  close(phoneDirection(reading(270, 0, 90))!.bearing, 0);
  close(phoneDirection(reading(90, 0, -90))!.pitch, 0);
});

test("pitch is clamped at vertical poles and incomplete readings are ignored", () => {
  close(phoneDirection(reading(0, 180, 0))!.pitch, -89);
  close(phoneDirection(reading(0, 0, 0))!.pitch, 89);
  assert.equal(phoneDirection({ alpha: 0, beta: null, gamma: 0 } as DeviceOrientationEvent), null);
  assert.equal(phoneDirection(reading(NaN, 90, 0)), null);
  assert.equal(phoneDirection(reading(0, 90, 0, false))!.absolute, false);
});

test("iOS compass heading overrides relative alpha", () => {
  const direction = phoneDirection({ ...reading(25, 90, 0, false), webkitCompassHeading: 90, webkitCompassAccuracy: 5 })!;
  close(direction.bearing, 90);
  assert.equal(direction.absolute, true);
});

test("heading interpolation crosses north by the shortest path", () => {
  close(angleDifference(1, 359), 2);
  close(angleDifference(359, 1), -2);
  close(angleDifference(-719, 359), 2);
});
