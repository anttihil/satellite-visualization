import {
  CHUNKS,
  FRAME_BUDGET_MS,
  HEADER_BYTES,
  HEADER_INTS,
  HEADER_REV_INDEX,
  HIDDEN,
  LATITUDE,
  LONGITUDE,
  OBS_ALTITUDE_KM,
  RANGE_SCALE,
  STRIDE_FLOATS,
} from "./consts";
import type { ObserverLocation } from "./externalDataStore";
import { loadSatellites } from "./omm";
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

let observerGd: ObserverLocation = {
  latitude: degreesToRadians(LATITUDE),
  longitude: degreesToRadians(LONGITUDE),
  height: OBS_ALTITUDE_KM,
};

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

let intervalId: NodeJS.Timeout | null = null;

onmessage = async (ev) => {
  const msg = ev.data;

  switch (msg.message) {
    case "start": {
      headerIntView = new Int32Array(msg.sab, 0, HEADER_INTS);
      positionsView = new Float32Array(msg.sab, HEADER_BYTES);

      const ommData = await loadSatellites();
      satRecs = ommData.map((item) => json2satrec(item));

      // One full sweep first, so no slot is left at its initial zero.
      writeSlots(0, satRecs.length);

      postMessage({
        id: WORKER_ID,
        message: "started",
        satIds: satRecs.map((sat) => sat.satnum),
        omm: ommData
      });

      const sliceSize = Math.ceil(satRecs.length / CHUNKS);
      let chunk = 0;

      intervalId = setInterval(() => {
        const from = chunk * sliceSize;
        writeSlots(from, Math.min(from + sliceSize, satRecs.length));
        chunk = (chunk + 1) % CHUNKS;
      }, FRAME_BUDGET_MS);

      break;
    }

    case "location": {
      observerGd = msg.data as ObserverLocation;
      console.log(`long: ${observerGd.longitude} lat: ${observerGd.latitude}`)
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
