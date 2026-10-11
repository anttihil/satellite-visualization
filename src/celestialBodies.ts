import { gstime } from "satellite.js";
import { Vector3 } from "three";
import type { ObserverLocation } from "./externalDataStore";

const RAD = Math.PI / 180;
const AU_KM = 149597870.7;
const EARTH_RADIUS_KM = 6378.137;

export type CelestialBody = {
  direction: Vector3;
  angularRadius: number;
  illumination: Vector3;
};

// Low-precision orbital elements with the main lunar perturbations. All
// distances are kilometres; the final directions include observer parallax.
export function celestialBodies(date: Date, observer: ObserverLocation) {
  const days = date.getTime() / 86400000 - 10956;
  const obliquity = (23.4393 - 3.563e-7 * days) * RAD;
  const solarPerihelion = (282.9404 + 4.70935e-5 * days) * RAD;
  const solarAnomaly = (356.047 + 0.9856002585 * days) * RAD;
  const solarEccentricity = 0.016709 - 1.151e-9 * days;
  const orbit = (anomaly: number, eccentricity: number) => {
    let eccentricAnomaly = anomaly % (2 * Math.PI);
    for (let i = 0; i < 5; i++) {
      eccentricAnomaly -= (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - anomaly % (2 * Math.PI)) /
        (1 - eccentricity * Math.cos(eccentricAnomaly));
    }
    const x = Math.cos(eccentricAnomaly) - eccentricity;
    const y = Math.sqrt(1 - eccentricity ** 2) * Math.sin(eccentricAnomaly);
    return { anomaly: Math.atan2(y, x), radius: Math.hypot(x, y) };
  };
  const solarOrbit = orbit(solarAnomaly, solarEccentricity);
  const solarLongitude = solarOrbit.anomaly + solarPerihelion;
  const sun = new Vector3(Math.cos(solarLongitude), Math.sin(solarLongitude), 0)
    .multiplyScalar(solarOrbit.radius * AU_KM);

  const node = (125.1228 - 0.0529538083 * days) * RAD;
  const inclination = 5.1454 * RAD;
  const perihelion = (318.0634 + 0.1643573223 * days) * RAD;
  const anomaly = (115.3654 + 13.0649929509 * days) * RAD;
  const lunarOrbit = orbit(anomaly, 0.0549);
  const longitudeInOrbit = lunarOrbit.anomaly + perihelion;
  const moon = new Vector3(
    Math.cos(node) * Math.cos(longitudeInOrbit) - Math.sin(node) * Math.sin(longitudeInOrbit) * Math.cos(inclination),
    Math.sin(node) * Math.cos(longitudeInOrbit) + Math.cos(node) * Math.sin(longitudeInOrbit) * Math.cos(inclination),
    Math.sin(longitudeInOrbit) * Math.sin(inclination),
  );
  const elongation = anomaly + perihelion + node - solarAnomaly - solarPerihelion;
  const latitudeArgument = anomaly + perihelion;
  const longitude = Math.atan2(moon.y, moon.x) + RAD * (
    -1.274 * Math.sin(anomaly - 2 * elongation) + 0.658 * Math.sin(2 * elongation) - 0.186 * Math.sin(solarAnomaly) -
    0.059 * Math.sin(2 * anomaly - 2 * elongation) - 0.057 * Math.sin(anomaly - 2 * elongation + solarAnomaly) +
    0.053 * Math.sin(anomaly + 2 * elongation) + 0.046 * Math.sin(2 * elongation - solarAnomaly) +
    0.041 * Math.sin(anomaly - solarAnomaly) - 0.035 * Math.sin(elongation) - 0.031 * Math.sin(anomaly + solarAnomaly) -
    0.015 * Math.sin(2 * latitudeArgument - 2 * elongation) + 0.011 * Math.sin(anomaly - 4 * elongation)
  );
  const latitude = Math.asin(moon.z) + RAD * (
    -0.173 * Math.sin(latitudeArgument - 2 * elongation) - 0.055 * Math.sin(anomaly - latitudeArgument - 2 * elongation) -
    0.046 * Math.sin(anomaly + latitudeArgument - 2 * elongation) + 0.033 * Math.sin(latitudeArgument + 2 * elongation) +
    0.017 * Math.sin(2 * anomaly + latitudeArgument)
  );
  const distance = (60.2666 * lunarOrbit.radius - 0.58 * Math.cos(anomaly - 2 * elongation) - 0.46 * Math.cos(2 * elongation)) * EARTH_RADIUS_KM;
  moon.set(Math.cos(latitude) * Math.cos(longitude), Math.cos(latitude) * Math.sin(longitude), Math.sin(latitude))
    .multiplyScalar(distance);

  const sidereal = gstime(date) + observer.longitude;
  const east = new Vector3(-Math.sin(sidereal), Math.cos(sidereal), 0);
  const north = new Vector3(-Math.sin(observer.latitude) * Math.cos(sidereal), -Math.sin(observer.latitude) * Math.sin(sidereal), Math.cos(observer.latitude));
  const up = new Vector3(Math.cos(observer.latitude) * Math.cos(sidereal), Math.cos(observer.latitude) * Math.sin(sidereal), Math.sin(observer.latitude));
  const flattening = 1 / 298.257223563;
  const e2 = flattening * (2 - flattening);
  const n = EARTH_RADIUS_KM / Math.sqrt(1 - e2 * Math.sin(observer.latitude) ** 2);
  const observerPosition = new Vector3(
    (n + observer.height) * Math.cos(observer.latitude) * Math.cos(sidereal),
    (n + observer.height) * Math.cos(observer.latitude) * Math.sin(sidereal),
    (n * (1 - e2) + observer.height) * Math.sin(observer.latitude),
  );
  const local = (v: Vector3) => new Vector3(v.dot(east), v.dot(north), v.dot(up));
  sun.applyAxisAngle(new Vector3(1, 0, 0), obliquity);
  moon.applyAxisAngle(new Vector3(1, 0, 0), obliquity);
  const body = (position: Vector3, radius: number): CelestialBody => {
    const relative = position.clone().sub(observerPosition);
    return {
      direction: local(relative).normalize(),
      angularRadius: Math.asin(radius / relative.length()),
      illumination: local(sun.clone().sub(position)).normalize(),
    };
  };
  return { sun: body(sun, 695700), moon: body(moon, 1737.4) };
}
