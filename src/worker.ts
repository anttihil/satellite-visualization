import {
  FRAME_BUDGET_MS,
  LATITUDE,
  LONGITUDE,
  OBS_ALTITUDE_KM,
  RANGE_SCALE,
} from "./consts";
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

const observerGd = {
  latitude: degreesToRadians(LATITUDE),
  longitude: degreesToRadians(LONGITUDE),
  height: OBS_ALTITUDE_KM,
};

let satRecs: SatRec[] = [];

function calculateENUPositions(satRecs: SatRec[]) {
  const now = new Date();
  const gmst = gstime(now);

  performance.mark("calc-start");
  const enus = satRecs
    .map((sat) => propagate(sat, now))
    .filter((prop) => {
      return prop !== null;
    })
    .map((prop) => eciToEcf(prop.position, gmst))
    .map((ecf) => ecfToLookAngles(observerGd, ecf))
    .map((look) => {
      const scaledRange = look.rangeSat / RANGE_SCALE;

      return [
        scaledRange * Math.cos(look.elevation) * Math.sin(look.azimuth),
        scaledRange * Math.cos(look.elevation) * Math.cos(look.azimuth),
        scaledRange * Math.sin(look.elevation),
      ];
    });
  performance.mark("calc-end");
  performance.measure("enu-calc", "calc-start", "calc-end");
  return enus;
}

let intervalId: NodeJS.Timeout | null = null;

onmessage = async (ev) => {
  const msg = ev.data;

  switch (msg) {
    case "start": {
      const ommData = await loadSatellites();
      satRecs = ommData.map((item) => json2satrec(item));

      postMessage({
        id: WORKER_ID,
        message: "started",
      });

      intervalId = setInterval(() => {
        postMessage({
          id: WORKER_ID,
          message: "data",
          positions: calculateENUPositions(satRecs),
        });
      }, FRAME_BUDGET_MS);

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
