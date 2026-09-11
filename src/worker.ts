import { loadSatellites } from "./omm";
import {
  json2satrec,
  propagate,
  eciToEcf,
  gstime,
  degreesToRadians,
  type SatRec,
  ecfToLookAngles,
  type PositionAndVelocity,
  type EcfVec3,
  type LookAngles
} from "satellite.js"

const LATITUDE = 34.065235;
const LONGITUDE = -118.306915;
const OBS_ALTITUDE_KM = 0.1;
const FIXED_RANGE = 100;
const TARGET_FPS = 60;
const INTERVAL_MS = Math.floor(1000/TARGET_FPS)
const WORKER_ID = Math.random().toString(10).slice(2, 10)

const observerGd = {
  latitude: degreesToRadians(LATITUDE),
  longitude: degreesToRadians(LONGITUDE),
  height: OBS_ALTITUDE_KM
}

let satRecs: SatRec[] = [];


function calculateENUPositions(satRecs: SatRec[]) {
    const now = new Date();
    const gmst = gstime(now)
    
    return satRecs
    .map((sat) => propagate(sat, now))
    .filter(prop => {
      return prop !== null
    })
    .map(prop=> eciToEcf(prop.position, gmst ))
    .map(ecf => ecfToLookAngles(observerGd,ecf))
    .map(look => {
      return [
        FIXED_RANGE * Math.cos(look.elevation) * Math.sin(look.azimuth),
        FIXED_RANGE * Math.cos(look.elevation) * Math.cos(look.azimuth),
        FIXED_RANGE * Math.sin(look.elevation) 
      ]
    })
  }

let intervalId: NodeJS.Timeout | null = null

onmessage = async (ev)=> {
  const msg = ev.data;

  switch (msg) {
    case "start": {
        const ommData = await loadSatellites();
        satRecs = ommData.map(item => json2satrec(item))

        postMessage({
          id: WORKER_ID,
          message: "started"
        })

        intervalId = setInterval( ()=> {
        postMessage({
          id: WORKER_ID,
          message: "data", 
          positions: calculateENUPositions(satRecs)})
        }, INTERVAL_MS)

        break;
    }

    case "end": {
      if (intervalId) {
        clearInterval(intervalId)
      }
      postMessage({
        id: WORKER_ID,
        message:"ended"
      })

      break;
    }
  }
}
