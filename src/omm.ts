import type { OMMJsonObject } from "satellite.js";

export async function loadSatellites(): Promise<OMMJsonObject[]> {
  const res = await fetch("/active_satellites.json");
  if (!res.ok) throw new Error(`Failed to load OMM data: ${res.status}`);
  return (await res.json()) as OMMJsonObject[];
}
