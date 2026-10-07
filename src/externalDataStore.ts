import {
  BYTES_PER_FLOAT,
  HEADER_BYTES,
  HEADER_INTS,
  LATITUDE,
  LONGITUDE,
  MAX_SATS,
  OBS_ALTITUDE_KM,
  STRIDE_FLOATS,
} from "./consts";

import { degreesToRadians, type OMMJsonObject } from "satellite.js";

export type ObserverLocation = {
  longitude: number;
  latitude: number;
  height: number;
};

export type Trajectory = {
  index: number;
  path: [number, number, number][];
};

const listeners = new Set<() => void>();
export const locationStore = {
  location: {
    longitude: degreesToRadians(LONGITUDE),
    latitude: degreesToRadians(LATITUDE),
    height: OBS_ALTITUDE_KM,
  } as ObserverLocation,
  getSnapshot: () => locationStore.location,

  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  setLocation: (location: ObserverLocation) => {
    locationStore.location = { ...location };
    externalDataStore.worker?.postMessage({
      message: "location", data: locationStore.location,
    });
    externalDataStore.trajectories = [];
    externalDataStore.requestTrajectories();
    listeners.forEach((listener) => listener());
  },
};

export const externalDataStore = {
  omm: [] as OMMJsonObject[],
  buffer: null as SharedArrayBuffer | null,
  headerInts: null as Int32Array | null,
  positions: null as Float32Array | null,
  // Index-aligned with the slots in `positions`, so a picked index maps to an ID.
  satIds: [] as string[],
  worker: null as Worker | null,
  trajectoryIndices: [] as number[],
  trajectories: [] as Trajectory[],
  trajectoryRevision: 0,
  trajectoryRequestId: 0,
  setTrajectoryIndices(indices: number[]) {
    const next = [...new Set(indices)].sort((a, b) => a - b);
    if (next.join(",") === this.trajectoryIndices.join(",")) return;
    this.trajectoryIndices = next;
    this.trajectories = this.trajectories.filter((item) =>
      next.includes(item.index),
    );
    this.requestTrajectories();
  },
  requestTrajectories() {
    this.trajectoryRequestId++;
    this.trajectoryRevision++;
    this.worker?.postMessage({
      message: "trajectories",
      indices: this.trajectoryIndices,
      requestId: this.trajectoryRequestId,
    });
  },
  init() {
    if (this.worker) this.destroy();

    const totalBytes =
      HEADER_BYTES + MAX_SATS * STRIDE_FLOATS * BYTES_PER_FLOAT;

    this.buffer = new SharedArrayBuffer(totalBytes);
    this.headerInts = new Int32Array(this.buffer, 0, HEADER_INTS);
    this.positions = new Float32Array(this.buffer, HEADER_BYTES);

    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker = worker;

    worker.onmessage = (ev) => {
      if (this.worker !== worker) return;

      const d = ev.data;
      switch (d.message) {
        case "trajectories": {
          if (d.requestId !== this.trajectoryRequestId) break;
          this.trajectories = d.trajectories;
          this.trajectoryRevision++;
          break;
        }
        case "started": {
          this.satIds = d.satIds;
          this.omm = d.omm;
          console.info(`worker ${d.id} started, ${d.satIds.length} satellites`);
          break;
        }
      }
    };

    worker.postMessage({ message: "start", sab: this.buffer });
    worker.postMessage({ message: "location", data: locationStore.location });

    navigator.geolocation.getCurrentPosition(
      (location) => {
        // Geolocation requests cannot be canceled when an effect is cleaned up.
        if (this.worker !== worker) return;

        locationStore.setLocation({
          longitude: degreesToRadians(location.coords.longitude),
          latitude: degreesToRadians(location.coords.latitude),
          height: (location.coords.altitude ?? 100) / 1000,
        });
      },
    );
  },

  destroy() {
    this.worker?.terminate();
    this.worker = null;
    this.buffer = null;
    this.headerInts = null;
    this.positions = null;
    this.satIds = [];
    this.omm = [];
    this.trajectoryIndices = [];
    this.trajectories = [];
    this.trajectoryRequestId++;
    this.trajectoryRevision++;
  },
};
