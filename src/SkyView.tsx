import { useEffect, useRef, useState } from "react";
import { externalDataStore, locationStore } from "./externalDataStore";
import { celestialBodies } from "./celestialBodies";
import { HEADER_REV_INDEX, INITIAL_FOVY, INITIAL_VIEWSTATE, MAX_FOVY, MIN_FOVY, WHEEL_LINE_PIXELS, ZOOM_SPEED } from "./consts";
import { SatelliteDetails } from "./SatelliteDetails";
import { SettingsMenu } from "./SettingsMenu";
import { PhoneOrientation, angleDifference, type OrientationStatus } from "./phoneOrientation";
import { OrientationButton } from "./OrientationButton";
import { SkyRenderer } from "./SkyRenderer";

export function SkyView() {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [selectedSatelliteIndex, setSelectedSatelliteIndex] = useState(-1);
  const [orientationEnabled, setOrientationEnabled] = useState(true);
  const [orientationStatus, setOrientationStatus] = useState<OrientationStatus>({ mode: "waiting", absolute: false });
  const orientation = useRef<PhoneOrientation | null>(null);

  useEffect(() => {
    const skyCanvas = canvas.current!;
    const sky = new SkyRenderer(skyCanvas, container.current!);
    let fovy = INITIAL_FOVY;
    const camera = { bearing: INITIAL_VIEWSTATE.bearing, pitch: INITIAL_VIEWSTATE.pitch };
    let hoveredIndex = -1;
    let selectedIndex = -1;
    let touchInput = window.matchMedia("(hover: none)").matches;
    const tooltip = document.createElement("div");
    tooltip.className = "sky-tooltip";
    tooltip.hidden = true;
    container.current!.append(tooltip);
    const updateHighlight = () => {
      sky.setHighlight(hoveredIndex, selectedIndex);
      externalDataStore.setTrajectoryIndices([hoveredIndex, selectedIndex].filter((index) => index >= 0));
    };
    const selectSatellite = (index: number) => {
      selectedIndex = index;
      if (touchInput) hoveredIndex = -1;
      setSelectedSatelliteIndex(index);
      updateHighlight();
    };
    const sensor = new PhoneOrientation(setOrientationStatus, () => camera);
    orientation.current = sensor;
    const refreshDaylight = () => sky.setCelestialBodies(celestialBodies(new Date(), locationStore.location));
    refreshDaylight();
    const unsubscribeLocation = locationStore.subscribe(refreshDaylight);
    const daylightInterval = window.setInterval(refreshDaylight, 10_000);
    const pointers = new Map<number, { x: number; y: number; startX: number; startY: number; moved: boolean }>();
    let pinchDistance = 0;
    let velocity = { bearing: 0, pitch: 0 };
    let lastMove = 0;
    const clearHover = () => {
      tooltip.hidden = true;
      if (hoveredIndex !== -1) {
        hoveredIndex = -1;
        updateHighlight();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      touchInput = event.pointerType === "touch";
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false });
      skyCanvas.setPointerCapture(event.pointerId);
      velocity = { bearing: 0, pitch: 0 };
      lastMove = performance.now();
      if (touchInput) clearHover();
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
        pointers.forEach((p) => { p.moved = true; });
      }
    };
    const onPointerMove = (event: PointerEvent) => {
      touchInput = event.pointerType === "touch";
      const pointer = pointers.get(event.pointerId);
      if (pointer) {
        const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        if (Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) > 5) pointer.moved = true;
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          const distance = Math.hypot(a.x - b.x, a.y - b.y);
          if (distance > 0 && pinchDistance > 0) fovy = Math.max(MIN_FOVY, Math.min(MAX_FOVY, fovy * pinchDistance / distance));
          pinchDistance = distance;
        } else if (pointer.moved && (dx || dy)) {
          sensor.manual(true);
          const scale = 180 / (Math.PI * sky.viewport.focalLength);
          camera.bearing -= dx * scale;
          camera.pitch = Math.max(-89, Math.min(89, camera.pitch + dy * scale));
          const elapsed = Math.max(performance.now() - lastMove, 8);
          velocity = { bearing: -dx * scale / elapsed, pitch: dy * scale / elapsed };
          lastMove = performance.now();
          clearHover();
        }
        return;
      }
      if (touchInput || window.matchMedia("(hover: none)").matches) return;
      const bounds = skyCanvas.getBoundingClientRect();
      const index = sky.pick(event.clientX - bounds.left, event.clientY - bounds.top);
      if (index !== hoveredIndex) {
        hoveredIndex = index;
        updateHighlight();
      }
      tooltip.hidden = index < 0;
      tooltip.textContent = externalDataStore.omm[index]?.OBJECT_NAME ?? "";
      tooltip.style.left = `${Math.min(event.clientX + 12, bounds.width - tooltip.offsetWidth - 8)}px`;
      tooltip.style.top = `${Math.min(event.clientY + 12, bounds.height - tooltip.offsetHeight - 8)}px`;
    };
    const onPointerUp = (event: PointerEvent) => {
      const pointer = pointers.get(event.pointerId);
      pointers.delete(event.pointerId);
      if (skyCanvas.hasPointerCapture(event.pointerId)) skyCanvas.releasePointerCapture(event.pointerId);
      if (!pointer) return;
      if (!pointer.moved && Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) <= 10) {
        const bounds = skyCanvas.getBoundingClientRect();
        selectSatellite(sky.pick(event.clientX - bounds.left, event.clientY - bounds.top));
      }
      if (!pointers.size) {
        if (pointer.moved) sensor.manual(false);
        if (performance.now() - lastMove > 100) velocity = { bearing: 0, pitch: 0 };
      }
    };
    const onPointerCancel = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      velocity = { bearing: 0, pitch: 0 };
      if (!pointers.size) sensor.manual(false);
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaMode === 0 ? event.deltaY : event.deltaY * WHEEL_LINE_PIXELS;
      fovy = Math.max(MIN_FOVY, Math.min(MAX_FOVY, fovy * Math.exp(delta * ZOOM_SPEED)));
    };
    skyCanvas.addEventListener("pointerdown", onPointerDown);
    skyCanvas.addEventListener("pointermove", onPointerMove);
    skyCanvas.addEventListener("pointerup", onPointerUp);
    skyCanvas.addEventListener("pointercancel", onPointerCancel);
    skyCanvas.addEventListener("pointerleave", clearHover);
    skyCanvas.addEventListener("wheel", onWheel, { passive: false });

    let rafId = 0;
    let lastRev = -1;
    let lastPositions = externalDataStore.positions;
    let lastSatIds = externalDataStore.satIds;
    let lastTrajectoryRevision = -1;
    let lastFrame = performance.now();
    const render = () => {
      const now = performance.now();
      const elapsed = Math.min(now - lastFrame, 100);
      const direction = sensor.direction();
      if (direction) {
        const blend = 1 - Math.exp(-elapsed / 80);
        camera.bearing += angleDifference(direction.bearing, camera.bearing) * blend;
        camera.pitch += (direction.pitch - camera.pitch) * blend;
        velocity = { bearing: 0, pitch: 0 };
      } else if (!pointers.size) {
        const decay = Math.exp(-elapsed / 100);
        camera.bearing += velocity.bearing * 100 * (1 - decay);
        camera.pitch = Math.max(-89, Math.min(89, camera.pitch + velocity.pitch * 100 * (1 - decay)));
        velocity.bearing *= decay;
        velocity.pitch *= decay;
      }
      lastFrame = now;
      sky.setView(camera.bearing, camera.pitch, fovy);
      const { headerInts, positions, satIds, trajectoryRevision, trajectories } = externalDataStore;
      const rev = headerInts ? Atomics.load(headerInts, HEADER_REV_INDEX) : -1;
      if (satIds !== lastSatIds) {
        hoveredIndex = selectedIndex = -1;
        tooltip.hidden = true;
        setSelectedSatelliteIndex(-1);
        updateHighlight();
      }
      if (rev !== lastRev || positions !== lastPositions || satIds !== lastSatIds) {
        sky.setPositions(positions, satIds.length);
        lastRev = rev;
        lastPositions = positions;
        lastSatIds = satIds;
      }
      if (trajectoryRevision !== lastTrajectoryRevision) {
        sky.setTrajectories(trajectories);
        lastTrajectoryRevision = trajectoryRevision;
      }
      sky.render();
      rafId = requestAnimationFrame(render);
    };
    render();

    return () => {
      sensor.dispose();
      orientation.current = null;
      cancelAnimationFrame(rafId);
      unsubscribeLocation();
      window.clearInterval(daylightInterval);
      skyCanvas.removeEventListener("pointerdown", onPointerDown);
      skyCanvas.removeEventListener("pointermove", onPointerMove);
      skyCanvas.removeEventListener("pointerup", onPointerUp);
      skyCanvas.removeEventListener("pointercancel", onPointerCancel);
      skyCanvas.removeEventListener("pointerleave", clearHover);
      skyCanvas.removeEventListener("wheel", onWheel);
      externalDataStore.setTrajectoryIndices([]);
      tooltip.remove();
      sky.dispose();
    };
  }, []);

  return (
    <div ref={container} className="sky">
      <canvas ref={canvas} aria-label="Interactive sky with satellites, the Sun and the Moon. Drag to look around, scroll or pinch to zoom, and select a satellite for details." />
      <SettingsMenu orientationEnabled={orientationEnabled} orientationStatus={orientationStatus} onOrientationChange={(enabled) => {
        setOrientationEnabled(enabled);
        orientation.current?.setEnabled(enabled);
      }} />
      <OrientationButton status={orientationStatus} onClick={() => orientation.current?.resume()} />
      {selectedSatelliteIndex >= 0 && <SatelliteDetails selectedIndex={selectedSatelliteIndex} />}
    </div>
  );
}
