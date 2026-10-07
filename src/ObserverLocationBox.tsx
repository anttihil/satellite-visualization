import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  ecfToLookAngles,
  eciToEcf,
  eciToGeodetic,
  gstime,
  json2satrec,
  propagate,
  radiansToDegrees,
} from "satellite.js";
import { externalDataStore, locationStore } from "./externalDataStore";

export function ObserverLocationBox({ selectedIndex }: { selectedIndex: number }) {
  const observer = useSyncExternalStore(
    locationStore.subscribe,
    locationStore.getSnapshot,
  );
  const [now, setNow] = useState(() => Date.now());
  const metadata = externalDataStore.omm[selectedIndex];
  const satrec = useMemo(() => metadata ? json2satrec(metadata) : null, [metadata]);

  useEffect(() => {
    if (selectedIndex < 0) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [selectedIndex]);

  const date = new Date(now);
  const position = satrec ? propagate(satrec, date)?.position : undefined;
  const gmst = gstime(date);
  const look = position ? ecfToLookAngles(observer, eciToEcf(position, gmst)) : null;
  const altitude = position ? eciToGeodetic(position, gmst).height : null;
  // The OMM epoch is UTC, but the source omits the timezone suffix.
  const epoch = metadata ? new Date(`${metadata.EPOCH}Z`) : null;

  return (
    <details
      className="location"
      open={!window.matchMedia("(max-width: 600px), (max-height: 500px)").matches}
      onClick={(event) => event.stopPropagation()}
    >
      <summary>{metadata ? metadata.OBJECT_NAME : "Observer & satellite details"}</summary>
      <div className="location-content">
        <p>Long: {radiansToDegrees(observer.longitude).toFixed(3)}°</p>
        <p>Lat: {radiansToDegrees(observer.latitude).toFixed(3)}°</p>
        <section className="satellite-details" aria-label="Selected satellite">
          <h2>Selected satellite</h2>
          {metadata && epoch ? (
            <>
              <p className="satellite-name">{metadata.OBJECT_NAME}</p>
              <dl>
                <dt>NORAD ID</dt><dd>{metadata.NORAD_CAT_ID}</dd>
                <dt>Designator</dt><dd>{metadata.OBJECT_ID}</dd>
                {look && altitude !== null ? (
                  <>
                    <dt>Azimuth</dt><dd>{radiansToDegrees(look.azimuth).toFixed(1)}°</dd>
                    <dt>Elevation</dt><dd>{radiansToDegrees(look.elevation).toFixed(1)}°</dd>
                    <dt>Distance</dt><dd>{look.rangeSat.toFixed(1)} km</dd>
                    <dt>Altitude</dt><dd>{altitude.toFixed(1)} km</dd>
                  </>
                ) : <><dt>Position</dt><dd>Unavailable</dd></>}
                <dt>Orbital period</dt><dd>{(1440 / Number(metadata.MEAN_MOTION)).toFixed(1)} min</dd>
                <dt>Inclination</dt><dd>{Number(metadata.INCLINATION).toFixed(1)}°</dd>
                <dt>Orbit data time</dt><dd>{epoch.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC")}</dd>
                <dt>Orbit data age</dt><dd>{((now - epoch.getTime()) / 86_400_000).toFixed(1)} days</dd>
              </dl>
            </>
          ) : <p>Select a satellite to see its details.</p>}
        </section>
      </div>
    </details>
  );
}
