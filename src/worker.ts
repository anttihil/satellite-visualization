import {
  CHUNKS,
  FRAME_BUDGET_MS,
  HEADER_BYTES,
  HEADER_INTS,
  HEADER_REV_INDEX,
  BYTES_PER_FLOAT,
  HIDDEN,
  LATITUDE,
  LONGITUDE,
  OBS_ALTITUDE_KM,
  RANGE_SCALE,
  STRIDE_FLOATS,
  TRAJECTORY_STEP_MS,
  TRAJECTORY_LIMIT_MS,
  TRAJECTORY_REFRESH_MS,
} from "./consts";
import type { ObserverLocation, Trajectory } from "./externalDataStore";
import { loadSatellites, loadSatelliteMetadata, type SatelliteSnapshot } from "./omm";
import {
  json2satrec,
  propagate,
  eciToEcf,
  gstime,
  degreesToRadians,
  type SatRec,
  ecfToLookAngles,
} from "satellite.js";

const WORKER_ID = Math.random().toString(10).slice(2, 10);



let satRecs: SatRec[] = [];
let headerIntView!: Int32Array;
let positionsView!: Float32Array;
let trajectoryIndices: number[] = [];
let trajectoryRequestId = 0;
let lastTrajectoryTime = 0;
let dataVersion = "";
let refreshing = false;
let chunk = 0;

let observerGd: ObserverLocation = {
  latitude: degreesToRadians(LATITUDE),
  longitude: degreesToRadians(LONGITUDE),
  height: OBS_ALTITUDE_KM,
};

function calculateTrajectory(index: number, now: number): Trajectory {
  const sat = satRecs[index];
  const positionAt = (time: number): [number, number, number] | null => {
    const date = new Date(time);
    const eci = propagate(sat, date);
    if (!eci) return null;
    const look = ecfToLookAngles(observerGd, eciToEcf(eci.position, gstime(date)));
    const range = look.rangeSat / RANGE_SCALE;
    const horizontal = range * Math.cos(look.elevation);
    return [
      horizontal * Math.sin(look.azimuth),
      horizontal * Math.cos(look.azimuth),
      range * Math.sin(look.elevation),
    ];
  };
  const current = positionAt(now);
  if (!current || current[2] <= 0) return { index, path: [] };

  const path: Trajectory["path"] = [];
  for (const direction of [-1, 1]) {
    const points: Trajectory["path"] = [];
    let previousTime = now;
    for (
      let offset = TRAJECTORY_STEP_MS;
      offset <= TRAJECTORY_LIMIT_MS;
      offset += TRAJECTORY_STEP_MS
    ) {
      let time = now + direction * offset;
      const point = positionAt(time);
      if (!point) break;
      if (point[2] <= 0) {
        // Bisect the final sample interval to end the pass at the horizon.
        let visibleTime = previousTime;
        for (let step = 0; step < 12; step++) {
          const middleTime = (visibleTime + time) / 2;
          const middle = positionAt(middleTime);
          if (!middle) break;
          if (middle[2] > 0) visibleTime = middleTime;
          else time = middleTime;
        }
        const horizon = positionAt(visibleTime);
        if (horizon) points.push(horizon);
        break;
      }
      points.push(point);
      previousTime = time;
    }
    if (direction === -1) path.push(...points.reverse(), current);
    else path.push(...points);
  }
  return { index, path };
}

function updateTrajectories() {
  lastTrajectoryTime = Date.now();
  postMessage({
    message: "trajectories",
    requestId: trajectoryRequestId,
    trajectories: trajectoryIndices.filter((index) => index < satRecs.length).map((index) =>
      calculateTrajectory(index, lastTrajectoryTime),
    ),
  });
}

function writeSlots(from: number, to: number) {
  const now = new Date();
  const gmst = gstime(now);

  for (let i = from; i < to; i++) {
    const offset = i * STRIDE_FLOATS;

    const eci = propagate(satRecs[i], now);
    if (!eci) {
      positionsView[offset + 2] = HIDDEN;
      continue;
    }

    const look = ecfToLookAngles(observerGd, eciToEcf(eci.position, gmst));
    if (look.elevation <= 0) {
      positionsView[offset + 2] = HIDDEN;
      continue;
    }
    const scaledRange = look.rangeSat / RANGE_SCALE;
    const cosElev = scaledRange * Math.cos(look.elevation);
    positionsView[offset] = cosElev * Math.sin(look.azimuth); // East (km)
    positionsView[offset + 1] = cosElev * Math.cos(look.azimuth); // North (km)
    positionsView[offset + 2] = scaledRange * Math.sin(look.elevation); // Up (km)
  }

  Atomics.add(headerIntView, HEADER_REV_INDEX, 1);
}

let intervalId: ReturnType<typeof setInterval> | null = null;

function applySnapshot(snapshot: SatelliteSnapshot) {
  const records = snapshot.data.map((item) => json2satrec(item));
  if (intervalId) clearInterval(intervalId);
  // Build a complete new buffer before publishing it together with its metadata.
  // The main thread continues rendering the old snapshot until this message arrives.
  const buffer = new SharedArrayBuffer(HEADER_BYTES + records.length * STRIDE_FLOATS * BYTES_PER_FLOAT);
  headerIntView = new Int32Array(buffer, 0, HEADER_INTS);
  positionsView = new Float32Array(buffer, HEADER_BYTES);
  satRecs = records;
  dataVersion = snapshot.version;
  trajectoryIndices = [];
  chunk = 0;
  writeSlots(0, satRecs.length);
  postMessage({
    id: WORKER_ID,
    message: "started",
    sab: buffer,
    satIds: satRecs.map((sat) => sat.satnum),
    omm: snapshot.data,
    fetchedAt: snapshot.fetchedAt,
  });
  const sliceSize = Math.ceil(satRecs.length / CHUNKS);
  intervalId = setInterval(() => {
    const from = chunk * sliceSize;
    writeSlots(from, Math.min(from + sliceSize, satRecs.length));
    chunk = (chunk + 1) % CHUNKS;
    if (trajectoryIndices.length && Date.now() - lastTrajectoryTime >= TRAJECTORY_REFRESH_MS) updateTrajectories();
  }, FRAME_BUDGET_MS);
}

async function refreshData() {
  if (refreshing) return;
  refreshing = true;
  try {
    const metadata = await loadSatelliteMetadata();
    if (!dataVersion || (metadata && metadata.version !== dataVersion)) {
      applySnapshot(await loadSatellites());
    }
    // Update even when the contents are unchanged but a later fetch succeeded.
    postMessage({ message: "data-status", error: null, ...(metadata ? { refreshSuspended: metadata.refreshSuspended, ...(metadata.version === dataVersion ? { fetchedAt: metadata.fetchedAt } : {}) } : {}) });
  } catch (error) {
    if (!satRecs.length) {
      try { applySnapshot(await loadSatellites(true)); }
      catch { /* Report the initial error below if even the bundled copy fails. */ }
    }
    postMessage({ message: "data-status", error: error instanceof Error ? error.message : String(error) });
  } finally {
    refreshing = false;
  }
}

onmessage = async (ev) => {
  const msg = ev.data;

  switch (msg.message) {
    case "start": {
      await refreshData();
      break;
    }
    case "refresh": {
      await refreshData();
      break;
    }

    case "location": {
      observerGd = msg.data as ObserverLocation;
      console.log(`long: ${observerGd.longitude} lat: ${observerGd.latitude}`)
      break; 
    }

    case "trajectories": {
      trajectoryIndices = msg.indices;
      trajectoryRequestId = msg.requestId;
      if (satRecs.length) updateTrajectories();
      break;
    }

    case "end": {
      if (intervalId) {
        clearInterval(intervalId);
      }
      postMessage({
        id: WORKER_ID,
        message: "ended",
      });

      break;
    }
  }
};
