import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { degreesToRadians, radiansToDegrees } from "satellite.js";
import { locationStore, type ObserverLocation } from "./externalDataStore";
import { locationSettings } from "./locationSettings";

export function LocationPicker({ observer, onClose }: { observer: ObserverLocation; onClose: () => void }) {
  const [initialObserver] = useState(observer);
  const dialog = useRef<HTMLDialogElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const [latitude, setLatitude] = useState(radiansToDegrees(observer.latitude).toFixed(6));
  const [longitude, setLongitude] = useState(radiansToDegrees(observer.longitude).toFixed(6));
  const [tileError, setTileError] = useState(false);
  const lat = latitude.trim() === "" ? NaN : Number(latitude);
  const lon = longitude.trim() === "" ? NaN : Number(longitude);
  const valid = Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lon) && Math.abs(lon) <= 180;

  useEffect(() => {
    const panel = dialog.current!;
    panel.showModal();
    const instance = L.map(container.current!, { minZoom: 0, maxZoom: 18, worldCopyJump: true });
    map.current = instance;
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
      crossOrigin: true,
    }).on("tileerror", () => setTileError(true)).addTo(instance);
    instance.fitWorld();
    const position: L.LatLngTuple = [radiansToDegrees(initialObserver.latitude), radiansToDegrees(initialObserver.longitude)];
    L.circleMarker(position, { radius: 7, color: "#fff", fillColor: "#526d84", fillOpacity: 1, weight: 2 })
      .bindTooltip("Current location").addTo(instance);
    marker.current = L.marker(position, {
      icon: L.divIcon({ className: "location-map-pin", html: '<span aria-hidden="true"></span>', iconSize: [24, 24], iconAnchor: [12, 12] }),
      keyboard: false,
    }).addTo(instance);
    instance.on("click", (event: L.LeafletMouseEvent) => {
      setLatitude(Math.max(-90, Math.min(90, event.latlng.lat)).toFixed(6));
      setLongitude(event.latlng.wrap().lng.toFixed(6));
    });
    const resize = new ResizeObserver(() => instance.invalidateSize());
    resize.observe(container.current!);
    return () => {
      resize.disconnect();
      instance.remove();
      map.current = null;
      marker.current = null;
      panel.close();
    };
  }, [initialObserver]);

  useEffect(() => {
    if (!valid || !map.current || !marker.current) return;
    marker.current.setLatLng([lat, lon]);
    if (!map.current.getBounds().contains([lat, lon])) map.current.panTo([lat, lon]);
  }, [lat, lon, valid]);

  return (
    <dialog ref={dialog} className="location-picker" aria-labelledby="location-picker-title" onClose={() => { if (!dialog.current?.open) onClose(); }}>
      <header className="settings-header">
        <h1 id="location-picker-title">Choose observer location</h1>
        <button className="settings-close" aria-label="Close location picker" onClick={() => dialog.current?.close()}>×</button>
      </header>
      <p className="location-picker-help">Click or tap the map to select a location. Drag to pan and use + / − to zoom, or enter coordinates below.</p>
      <div ref={container} className="location-map" role="region" aria-label="World map location picker" />
      <div className="location-map-legend"><span className="current-location-key" /> Current location <span className="selected-location-key" /> Selection</div>
      {tileError && <p role="status">Map tiles could not load. You can still enter coordinates below.</p>}
      <form onSubmit={(event) => {
        event.preventDefault();
        if (!valid || locationSettings.getSnapshot().automatic) return;
        locationStore.setManualLocation({ latitude: degreesToRadians(lat), longitude: degreesToRadians(lon), height: 0 });
        dialog.current?.close();
      }}>
        <div className="location-coordinates">
          <label>Latitude (°)<input type="number" min="-90" max="90" step="any" required value={latitude} onChange={(event) => setLatitude(event.target.value)} /></label>
          <label>Longitude (°)<input type="number" min="-180" max="180" step="any" required value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label>
        </div>
        <p className="location-picker-help">Latitude: −90 to 90°. Longitude: −180 to 180°. Manual locations use sea-level elevation.</p>
        <footer className="location-picker-actions">
          <button type="button" className="location-action" onClick={() => dialog.current?.close()}>Cancel</button>
          <button type="submit" className="location-action location-action-primary" disabled={!valid}>Use this location</button>
        </footer>
      </form>
    </dialog>
  );
}
