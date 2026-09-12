import {
  BYTES_PER_FLOAT,
  HEADER_BYTES,
  HEADER_INTS,
  MAX_SATS,
  STRIDE_FLOATS,
} from "./consts";

import { degreesToRadians, type OMMJsonObject } from "satellite.js";

export type ObserverLocation = {
  longitude: number,
  latitude: number,
  height: number
}


const listeners = new Set()
export const locationStore = {
  location: {
    longitude: 0,
    latitude: 0,
    height: 100,
  } as ObserverLocation,
  // Snapshot getter: Returns the current object reference
  getSnapshot: () => locationStore.location,

  // Subscribe function: React will provide a callback to trigger on updates
  subscribe: (listener:any) => {
    listeners.add(listener);
    return () => listeners.delete(listener); // Cleanup when unmounted
  },

  // State updater: Updates object and notifies listeners
  setLocation: (location: ObserverLocation) => {
    // Immutable update: create a new reference so React detects the change
    locationStore.location = { ...locationStore.location, ...location };
    listeners.forEach((listener: any) => listener());
  }
};

export const externalDataStore = {
  omm: [] as OMMJsonObject[],
  buffer: null as SharedArrayBuffer | null,
  headerInts: null as Int32Array | null,
  positions: null as Float32Array | null,
  // Index-aligned with the slots in `positions`, so a picked index maps to an ID.
  satIds: [] as string[],
  worker: null as Worker | null,
  init() {
    if (this.worker) this.destroy();

    this.promptLocation()

    const totalBytes =
      HEADER_BYTES + MAX_SATS * STRIDE_FLOATS * BYTES_PER_FLOAT;

    this.buffer = new SharedArrayBuffer(totalBytes);
    this.headerInts = new Int32Array(this.buffer, 0, HEADER_INTS);
    this.positions = new Float32Array(this.buffer, HEADER_BYTES);

    this.worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });

    this.worker.onmessage = (ev) => {
      const d = ev.data;
      switch (d.message) {
        case "started": {
          externalDataStore.satIds = d.satIds;
          externalDataStore.omm = d.omm;
          console.info(`worker ${d.id} started, ${d.satIds.length} satellites`);
          break;
        }
        case "ended": {
          console.info(`worker ${d.id} ended`);
          this.worker?.terminate();
          break;
        }
      }
    };

    this.worker.postMessage({ message: "start", sab: this.buffer });
  },

  promptLocation() {
    navigator.geolocation.getCurrentPosition(
      (location) => {
        locationStore.setLocation({
          longitude: degreesToRadians(location.coords.longitude),
          latitude: degreesToRadians(location.coords.latitude),
          height: (location.coords.altitude ?? 100) / 1000
        })
        if (this.worker){
          this.worker.postMessage({message: 'location', data: locationStore.location})
        }
      }
    )
  },

  destroy() {
    if (this.worker) {
      this.worker.postMessage({ message: "end" });
    }
    this.positions = null;
    this.satIds = [];
  },
};
