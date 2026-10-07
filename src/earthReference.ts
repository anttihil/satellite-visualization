import { gstime } from "satellite.js";
import { LayerExtension } from "@deck.gl/core";
import type { ObserverLocation } from "./externalDataStore";

export type Position = [number, number, number];
export const REFERENCE_RADIUS = 1500;

export class CompassLabelExtension extends LayerExtension {
  getShaders() {
    // Deck's billboard text offsets need the perspective divisor in a first-person view.
    return { inject: { "vs:DECKGL_FILTER_SIZE": "size *= gl_Position.w;" } };
  }
}

export function referencePosition(azimuth: number, elevation: number): Position {
  const horizontal = REFERENCE_RADIUS * Math.cos(elevation);
  return [
    horizontal * Math.sin(azimuth),
    horizontal * Math.cos(azimuth),
    REFERENCE_RADIUS * Math.sin(elevation),
  ];
}

export const groundBands: { polygon: Position[]; brightness: number; glow: boolean }[] = [];
// Angular bands meet exactly at zero elevation, independent of the field of view.
for (const glow of [false, true]) {
  const count = glow ? 24 : 90;
  for (let band = 0; band < count; band++) {
    const low = glow ? band * 2 / count : -90 + band;
    const high = glow ? (band + 1) * 2 / count : low + 1;
    for (let segment = 0; segment < 128; segment++) {
      const a = segment * 2 * Math.PI / 128;
      const b = (segment + 1) * 2 * Math.PI / 128;
      groundBands.push({
        polygon: [
          referencePosition(a, low * Math.PI / 180),
          referencePosition(b, low * Math.PI / 180),
          referencePosition(b, high * Math.PI / 180),
          referencePosition(a, high * Math.PI / 180),
        ],
        brightness: glow ? (1 - (band + 0.5) / count) ** 2 : Math.exp((low + 0.5) / 15),
        glow,
      });
    }
  }
}

export const horizon = Array.from({ length: 257 }, (_, i) =>
  referencePosition(i * 2 * Math.PI / 256, 0),
);

export const compass = Array.from({ length: 24 }, (_, i) => {
  const degrees = i * 15;
  const azimuth = degrees * Math.PI / 180;
  const cardinal = i % 6 === 0;
  return {
    degrees,
    cardinal,
    text: cardinal ? ["N", "E", "S", "W"][i / 6] : `${degrees}°`,
    position: referencePosition(azimuth, -2.5 * Math.PI / 180),
    path: [referencePosition(azimuth, 0), referencePosition(azimuth, (cardinal ? -1.2 : -0.6) * Math.PI / 180)],
  };
});

export const groundDirections = [0, 45, 90, 135, 180, 225, 270, 315].map((degrees) => ({
  cardinal: degrees % 90 === 0,
  path: Array.from({ length: 90 }, (_, i) =>
    referencePosition(degrees * Math.PI / 180, (-89 + i) * Math.PI / 180),
  ),
}));

export function sunElevation(date: Date, observer: ObserverLocation): number {
  // Low-precision solar coordinates are sufficient for the colour palette.
  const days = date.getTime() / 86400000 + 2440587.5 - 2451545;
  const radians = Math.PI / 180;
  const meanLongitude = (280.46 + 0.9856474 * days) * radians;
  const anomaly = (357.528 + 0.9856003 * days) * radians;
  const longitude = meanLongitude + (1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * radians;
  const obliquity = (23.439 - 0.0000004 * days) * radians;
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(longitude), Math.cos(longitude));
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(longitude));
  const hourAngle = gstime(date) + observer.longitude - rightAscension;
  return Math.asin(
    Math.sin(observer.latitude) * Math.sin(declination) +
    Math.cos(observer.latitude) * Math.cos(declination) * Math.cos(hourAngle),
  ) / radians;
}
