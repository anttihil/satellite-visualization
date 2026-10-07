import type { OMMJsonObject } from "satellite.js";

export type SatelliteMetadata = {
  version: string;
  fetchedAt: string;
  count: number | null;
};

export function validateSatellites(value: unknown): OMMJsonObject[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Expected a non-empty OMM array");
  }
  const ids = new Set<number>();
  for (const item of value) {
    if (!item || typeof item !== "object") throw new Error("Invalid OMM record");
    const id = Number(item.NORAD_CAT_ID);
    const numericFields = ["MEAN_MOTION", "ECCENTRICITY", "INCLINATION", "RA_OF_ASC_NODE", "ARG_OF_PERICENTER", "MEAN_ANOMALY", "BSTAR", "MEAN_MOTION_DOT", "MEAN_MOTION_DDOT"];
    if (
      !Number.isInteger(id) || id <= 0 || ids.has(id) ||
      typeof item.OBJECT_NAME !== "string" ||
      typeof item.EPOCH !== "string" || !Number.isFinite(Date.parse(`${item.EPOCH.replace(/Z$/, "")}Z`)) ||
      numericFields.some((field) => item[field] === undefined || item[field] === null || item[field] === "" || !Number.isFinite(Number(item[field]))) ||
      Number(item.MEAN_MOTION) <= 0 || Number(item.ECCENTRICITY) < 0 || Number(item.ECCENTRICITY) >= 1
    ) {
      throw new Error(`Invalid OMM record for satellite ${id}`);
    }
    ids.add(id);
  }
  return value as OMMJsonObject[];
}
