import { useEffect, useState, useSyncExternalStore } from "react";
import { satelliteDataStatus } from "./satelliteDataStatus";

export function SatelliteDataStatus() {
  const status = useSyncExternalStore(satelliteDataStatus.subscribe, satelliteDataStatus.getSnapshot);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const overdue = status.fetchedAt && now - Date.parse(status.fetchedAt) > 4 * 60 * 60 * 1000;
  return (
    <section className="data-status" aria-label="Satellite data status">
      <h2>Satellite data</h2>
      <p>{status.count ? `${status.count.toLocaleString()} satellites · CelesTrak` : "Loading satellite data…"}</p>
      {status.fetchedAt ? (
        <p>Fetched {new Date(status.fetchedAt).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC")}</p>
      ) : status.count ? <p>Bundled data · download time unknown</p> : null}
      {status.error || status.refreshSuspended || overdue ? (
        <p className="data-status-warning">
          {status.error ? "Updates unavailable" : status.refreshSuspended ? "Source updates paused" : "Data refresh overdue"}
          {status.count ? " · using last available data" : ""}
        </p>
      ) : null}
    </section>
  );
}
