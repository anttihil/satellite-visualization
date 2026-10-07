import type { OMMJsonObject } from "satellite.js";
import { validateSatellites, type SatelliteMetadata } from "../shared/satellite-data";

export type SatelliteSnapshot = {
  data: OMMJsonObject[];
  version: string;
  fetchedAt: string | null;
};

export async function loadSatelliteMetadata(): Promise<(SatelliteMetadata & { refreshSuspended: boolean }) | null> {
  if (import.meta.env.DEV) return null;
  const res = await fetch("/api/satellites/meta", { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Failed to check satellite updates: ${res.status}`);
  return res.json();
}

export async function loadSatellites(bundled = import.meta.env.DEV): Promise<SatelliteSnapshot> {
  const res = await fetch(bundled ? "/active_satellites.json" : "/api/satellites", { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Failed to load OMM data: ${res.status}`);
  return {
    data: validateSatellites(await res.json()),
    version: bundled ? "bundled" : res.headers.get("X-Data-Version") ?? "unknown",
    fetchedAt: res.headers.get("X-Data-Fetched-At"),
  };
}
