// Layout per satellite: 4 floats (16 bytes)
// [0] = satnum (ID)
// [1] = east (km)
// [2] = north (km)
// [3] = up (km)
export const STRIDE_FLOATS = 4;
export const BYTES_PER_FLOAT = 4;
export const STRIDE_BYTES = STRIDE_FLOATS * BYTES_PER_FLOAT;

// Header segment (first 64 bytes for cache line alignment):
// Int32View[0] = writeRevisionCounter (incremented atomically on write)
// Int32View[1] = visibleCount (number of active satellites in buffer)
export const HEADER_BYTES = 64;
export const HEADER_INTS = HEADER_BYTES / 4;
export const HEADER_REV_INDEX = 0;
export const HEADER_COUNT_INDEX = 1;

// satellite calculations, the first three will become parameters set by user
export const LATITUDE = 0;
export const LONGITUDE = 0;
export const OBS_ALTITUDE_KM = 0.1;
export const TARGET_FPS = 60;
export const FRAME_BUDGET_MS = Math.floor(1000 / TARGET_FPS);
export const RANGE_SCALE = 10;
