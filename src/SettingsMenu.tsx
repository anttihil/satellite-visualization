import { useRef, useState, useSyncExternalStore } from "react";
import { radiansToDegrees } from "satellite.js";
import { locationStore } from "./externalDataStore";
import { SatelliteDataStatus } from "./SatelliteDataStatus";
import type { OrientationStatus } from "./phoneOrientation";
import { locationSettings } from "./locationSettings";
import { LocationPicker } from "./LocationPicker";

export function SettingsMenu({ orientationEnabled, orientationStatus, onOrientationChange }: {
  orientationEnabled: boolean;
  orientationStatus: OrientationStatus;
  onOrientationChange: (enabled: boolean) => void;
}) {
  const observer = useSyncExternalStore(locationStore.subscribe, locationStore.getSnapshot);
  const locationPreferences = useSyncExternalStore(locationSettings.subscribe, locationSettings.getSnapshot);
  const [choosingLocation, setChoosingLocation] = useState(false);
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
          <section className="orientation-settings" aria-label="Phone orientation">
            <h2>View direction</h2>
            <label><input type="checkbox" checked={orientationEnabled} onChange={(event) => onOrientationChange(event.target.checked)} /> Use phone orientation</label>
            <p role="status">{orientationStatus.mode === "disabled" ? "Phone orientation is off." :
              orientationStatus.mode === "permission" ? "Tap the navigation button to allow motion access." :
              orientationStatus.mode === "denied" ? "Motion access was denied. Allow it in browser settings, then try again." :
              orientationStatus.mode === "unavailable" ? "No orientation readings. Use a phone with motion sensors over HTTPS." :
              orientationStatus.mode === "waiting" ? "Waiting for sensor readings…" :
              `${orientationStatus.absolute ? "Compass-aligned" : "Relative"} orientation. Drag to look around manually. Phone tracking resumes after 3 seconds of inactivity; tap the crosshair to return sooner.`}</p>
          </section>
          <section className="observer-settings" aria-label="Observer location">
            <h2>Observer location</h2>
            <label className="location-auto-toggle"><input type="checkbox" role="switch" checked={locationPreferences.automatic}
              onChange={(event) => locationSettings.update({ automatic: event.target.checked })} /> Use device location</label>
            <p role="status">{locationPreferences.status}</p>
            <p>Longitude: {radiansToDegrees(observer.longitude).toFixed(3)}°</p>
            <p>Latitude: {radiansToDegrees(observer.latitude).toFixed(3)}°</p>
            <button className="location-action" disabled={locationPreferences.automatic}
              aria-describedby={locationPreferences.automatic ? "manual-location-help" : undefined}
              onClick={() => setChoosingLocation(true)}>Choose location…</button>
            {locationPreferences.automatic && <p id="manual-location-help">Turn off device location to choose manually.</p>}
          </section>
          <SatelliteDataStatus />
        </div>
      </dialog>
      {choosingLocation && <LocationPicker observer={observer} onClose={() => setChoosingLocation(false)} />}
    </>
  );
}
