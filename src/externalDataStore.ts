import {
  HEADER_BYTES,
  HEADER_INTS,
  LATITUDE,
  LONGITUDE,
  OBS_ALTITUDE_KM,
} from "./consts";

import { degreesToRadians, type OMMJsonObject } from "satellite.js";
import { satelliteDataStatus } from "./satelliteDataStatus";
import { locationSettings } from "./locationSettings";

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
const satelliteListeners = new Set<() => void>();
const EARTH_RADIUS_KM = 6371;
const LOCATION_MOVEMENT_KM = 0.1;
const ALTITUDE_MOVEMENT_KM = 0.1;
export const locationStore = {
  location: (!locationSettings.getSnapshot().automatic ? locationSettings.getSnapshot().manual : null) ?? {
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

  setManualLocation: (location: ObserverLocation) => {
    if (locationSettings.getSnapshot().automatic) return;
    locationSettings.update({ manual: location });
    locationStore.setLocation(location, true);
  },
  setLocation: (location: ObserverLocation, exact = false) => {
    const current = locationStore.location;
    const haversine =
      Math.sin((location.latitude - current.latitude) / 2) ** 2 +
      Math.cos(current.latitude) * Math.cos(location.latitude) *
      Math.sin((location.longitude - current.longitude) / 2) ** 2;
    const distance = 2 * EARTH_RADIUS_KM *
      Math.asin(Math.sqrt(Math.min(1, haversine)));
    const moved = exact || distance >= LOCATION_MOVEMENT_KM;
    const altitudeChanged =
      exact || Math.abs(location.height - current.height) >= ALTITUDE_MOVEMENT_KM;
    if (!moved && !altitudeChanged) return;

    locationStore.location = {
      longitude: moved ? location.longitude : current.longitude,
      latitude: moved ? location.latitude : current.latitude,
      height: altitudeChanged ? location.height : current.height,
    };
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
  getSnapshot: () => externalDataStore.omm,
  subscribe: (listener: () => void) => {
    satelliteListeners.add(listener);
    return () => { satelliteListeners.delete(listener); };
  },
  buffer: null as SharedArrayBuffer | null,
  headerInts: null as Int32Array | null,
  positions: null as Float32Array | null,
  // Index-aligned with the slots in `positions`, so a picked index maps to an ID.
  satIds: [] as string[],
  worker: null as Worker | null,
  locationInterval: null as number | null,
  locationUnsubscribe: null as (() => void) | null,
  locationGeneration: 0,
  dataInterval: null as number | null,
  visibilityListener: null as (() => void) | null,
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
          this.buffer = d.sab;
          this.headerInts = new Int32Array(d.sab, 0, HEADER_INTS);
          this.positions = new Float32Array(d.sab, HEADER_BYTES);
          this.satIds = d.satIds;
          this.omm = d.omm;
          satelliteListeners.forEach((listener) => listener());
          this.trajectoryIndices = [];
          this.trajectories = [];
          this.trajectoryRequestId++;
          this.trajectoryRevision++;
          satelliteDataStatus.update({ fetchedAt: d.fetchedAt, count: d.satIds.length, error: null });
          console.info(`worker ${d.id} started, ${d.satIds.length} satellites`);
          break;
        }
        case "data-status": {
          satelliteDataStatus.update({
            error: d.error,
            ...(d.fetchedAt ? { fetchedAt: d.fetchedAt } : {}),
            ...(typeof d.refreshSuspended === "boolean" ? { refreshSuspended: d.refreshSuspended } : {}),
          });
          break;
        }
      }
    };

    worker.postMessage({ message: "start" });
    worker.postMessage({ message: "location", data: locationStore.location });

    let automatic: boolean | undefined;
    const syncLocationMode = () => {
      const enabled = locationSettings.getSnapshot().automatic;
      if (enabled === automatic) return;
      automatic = enabled;
      const generation = ++this.locationGeneration;
      if (this.locationInterval !== null) window.clearInterval(this.locationInterval);
      this.locationInterval = null;
      if (!enabled) {
        locationSettings.update({ manual: locationStore.location, status: "Using a manual location." });
        return;
      }
      locationSettings.update({ status: "Finding your location…" });
      if (!navigator.geolocation) {
        locationSettings.update({ status: "Device location is unavailable. Turn off device location to choose manually." });
        return;
      }
      const updateLocation = () => navigator.geolocation.getCurrentPosition(
        (location) => {
          // Pending requests cannot be canceled; ignore fixes from an old mode or worker.
          if (this.worker !== worker || this.locationGeneration !== generation) return;

          locationStore.setLocation({
            longitude: degreesToRadians(location.coords.longitude),
            latitude: degreesToRadians(location.coords.latitude),
            height: location.coords.altitude === null
              ? locationStore.location.height
              : location.coords.altitude / 1000,
          });
          locationSettings.update({ status: "Location updates automatically." });
        },
        (error) => {
          if (this.worker !== worker || this.locationGeneration !== generation) return;
          locationSettings.update({ status: error.code === 1
            ? "Location access was denied. Allow it in browser settings, or turn off device location to choose manually."
            : "Could not find your location. Keeping the current position; turn off device location to choose manually." });
        },
        { maximumAge: 0, timeout: 10_000 },
      );
      updateLocation();
      this.locationInterval = window.setInterval(updateLocation, 60_000);
    };
    this.locationUnsubscribe = locationSettings.subscribe(syncLocationMode);
    syncLocationMode();
    const refreshData = () => {
      if (document.visibilityState === "visible") worker.postMessage({ message: "refresh" });
    };
    this.dataInterval = window.setInterval(refreshData, 15 * 60 * 1000);
    this.visibilityListener = refreshData;
    document.addEventListener("visibilitychange", refreshData);
  },

  destroy() {
    this.locationGeneration++;
    this.locationUnsubscribe?.();
    this.locationUnsubscribe = null;
    if (this.dataInterval !== null) window.clearInterval(this.dataInterval);
    this.dataInterval = null;
    if (this.visibilityListener) document.removeEventListener("visibilitychange", this.visibilityListener);
    this.visibilityListener = null;
    if (this.locationInterval !== null) {
      window.clearInterval(this.locationInterval);
      this.locationInterval = null;
    }
    this.worker?.terminate();
    this.worker = null;
    this.buffer = null;
    this.headerInts = null;
    this.positions = null;
    this.satIds = [];
    this.omm = [];
    satelliteListeners.forEach((listener) => listener());
    this.trajectoryIndices = [];
    this.trajectories = [];
    this.trajectoryRequestId++;
    this.trajectoryRevision++;
  },
};
