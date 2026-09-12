// Layout: one fixed slot per satellite, 3 floats (12 bytes) each.
// [0] = east (km)
// [1] = north (km)
// [2] = up (km)
// The slot index identifies the satellite, so no ID is stored.
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
