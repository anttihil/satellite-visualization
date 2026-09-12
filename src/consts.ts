// Layout: one fixed slot per satellite, 3 floats (12 bytes) each.
// [0] = east (km)
// [1] = north (km)
// [2] = up (km)
// The slot index identifies the satellite, so no ID is stored.

import type { FirstPersonViewState } from "@deck.gl/core";

// up === HIDDEN means the satellite is below the horizon.
export const STRIDE_FLOATS = 3;
export const BYTES_PER_FLOAT = 4;
export const MAX_SATS = 20000;

// Below the ground disk and past the far plane, so hidden satellites clip away.
export const HIDDEN = -10000;

// Header segment (first 64 bytes for cache line alignment):
// Int32View[0] = writeRevisionCounter (incremented atomically on write)
export const HEADER_BYTES = 64;
export const HEADER_INTS = HEADER_BYTES / 4;
export const HEADER_REV_INDEX = 0;

// satellite calculations, the first three will become parameters set by user
export const LATITUDE = 0;
export const LONGITUDE = 0;
export const OBS_ALTITUDE_KM = 0.1;
export const TARGET_FPS = 60;
export const FRAME_BUDGET_MS = Math.floor(1000 / TARGET_FPS);
export const RANGE_SCALE = 10;

// Propagating all satellites costs ~14 ms, which does not fit a 16 ms frame.
// Each frame refreshes one slice instead, so every satellite updates every
// CHUNKS frames. Stale slots keep their last position.
export const CHUNKS = 8;

// The worker measures azimuth and elevation from the observer, so the camera must
// sit on that point. An offset eye shifts near satellites more than far ones: two
// units of height move a satellite at range 40 by 2.9 degrees, one at range 400 by
// 0.28 degrees.
// At exactly +/-90 the view direction meets the up vector and the picture collapses
// sideways, so the pitch stops one degree short of the zenith.
export const INITIAL_VIEWSTATE: FirstPersonViewState = {
  position: [0, 0, 0],
  pitch: -20,
  minPitch: -89,
  maxPitch: 89,
};

// Below the eye, so the ground still covers the lower half of the sky.
const DISK_HEIGHT = -1;

export const FAR = 2000;
export const INITIAL_FOVY = 75;
export const MIN_FOVY = 2;
// The projection is rectilinear, so it stretches the edges of the frame by 1/cos(angle
// from the axis) or more. At 75 degrees the top edge stretches 1.55x, at 100 it is 2.32x.
export const MAX_FOVY = INITIAL_FOVY;
// Firefox reports wheel deltas in lines, Chrome in pixels. One notch is 3 lines or 100 pixels.
export const WHEEL_LINE_PIXELS = 40;
export const ZOOM_SPEED = 0.0015;
export const POINT_SIZE = 150;

// Look around only. Scroll, drag-pan and the keyboard all move the camera position.
export const CONTROLLER = {
  dragMode: "rotate" as const,
  dragPan: false,
  scrollZoom: false,
  doubleClickZoom: false,
  touchZoom: false,
  keyboard: false,
  inertia: 300,
};

// creates the Earth "disk" under the observer
function createDiskData() {
  const diskData = [];
  const radius = 120;
  const segments = 128;
  for (let i = 0; i < segments; i++) {
    const theta = (2 * Math.PI * i) / segments;
    const x = radius * Math.sin(theta);
    const y = radius * Math.cos(theta);
    diskData.push([x, y, DISK_HEIGHT]);
  }
  return diskData;
}
export const DISK_DATA = createDiskData();