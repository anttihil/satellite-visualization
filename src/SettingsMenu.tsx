import { useRef, useState, useSyncExternalStore } from "react";
import { radiansToDegrees } from "satellite.js";
import { locationStore } from "./externalDataStore";
import { SatelliteDataStatus } from "./SatelliteDataStatus";

export function SettingsMenu() {
  const observer = useSyncExternalStore(locationStore.subscribe, locationStore.getSnapshot);
  const panel = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="settings-toggle"
        aria-label="Open settings"
        aria-controls="settings-panel"
        aria-expanded={open}
        onClick={() => {
          panel.current?.showModal();
          setOpen(true);
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>
      <dialog
        ref={panel}
        id="settings-panel"
        className="settings"
        aria-labelledby="settings-title"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          event.stopPropagation();
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom) {
            panel.current?.close();
          }
        }}
      >
        <header className="settings-header">
          <h1 id="settings-title">Settings</h1>
          <button className="settings-close" aria-label="Close settings" onClick={() => panel.current?.close()}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="m6 6 12 12M6 18 18 6" />
            </svg>
          </button>
        </header>
        <div className="settings-content">
          <section aria-label="Observer location">
            <h2>Observer location</h2>
            <p>Longitude: {radiansToDegrees(observer.longitude).toFixed(3)}°</p>
            <p>Latitude: {radiansToDegrees(observer.latitude).toFixed(3)}°</p>
          </section>
          <SatelliteDataStatus />
        </div>
      </dialog>
    </>
  );
}
