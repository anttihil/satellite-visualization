import { useEffect, useRef, useState } from "react";

import { Deck, FirstPersonView } from "@deck.gl/core";
import { PolygonLayer, PointCloudLayer, PathLayer, TextLayer } from "@deck.gl/layers";
import "@deck.gl/widgets/stylesheet.css";
import { _StatsWidget as StatsWidget } from "@deck.gl/widgets";

import { externalDataStore, locationStore, type Trajectory } from "./externalDataStore";
import { CompassLabelExtension, compass, groundBands, groundDirections, horizon, sunElevation } from "./earthReference";
import {
  CONTROLLER,
  FAR,
  HEADER_REV_INDEX,
  INITIAL_FOVY,
  INITIAL_VIEWSTATE,
  MAX_FOVY,
  MIN_FOVY,
  POINT_SIZE,
  STRIDE_FLOATS,
  WHEEL_LINE_PIXELS,
  ZOOM_SPEED,
} from "./consts";
import { SatelliteDetails } from "./SatelliteDetails";
import { SettingsMenu } from "./SettingsMenu";
import { OrbitLayer, orbitSegments, type OrbitSegment } from "./OrbitLayer";

export function SkyView() {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [selectedSatelliteIndex, setSelectedSatelliteIndex] = useState(-1);

  useEffect(() => {
    let fovy = INITIAL_FOVY;
    let hoveredIndex = -1;
    let selectedIndex = -1;
    let touchInput = window.matchMedia("(hover: none)").matches;
    let lastTrajectories: Trajectory[] | null = null;
    let segments: OrbitSegment[] = [];
    let pitch = INITIAL_VIEWSTATE.pitch ?? 0;
    let solarElevation = sunElevation(new Date(), locationStore.location);
    const updateDaylight = () => {
      solarElevation = sunElevation(new Date(), locationStore.location);
    };
    updateDaylight();
    const updateTrajectories = () => {
      externalDataStore.setTrajectoryIndices(
        [hoveredIndex, selectedIndex].filter((index) => index >= 0),
      );
      deck.setProps({ layers: createLayers() });
    };
    const selectSatellite = (index: number) => {
      selectedIndex = index;
      if (touchInput) hoveredIndex = -1;
      setSelectedSatelliteIndex(selectedIndex);
      updateTrajectories();
    };
    function createLayers() {
      const daylightAmount = Math.max(0, Math.min(1, (solarElevation + 6) / 12));
      const twilightAmount = Math.max(0, 1 - Math.abs(solarElevation + 6) / 12);
      const rim: [number, number, number] = [
        45 + daylightAmount * 20 + twilightAmount * 45,
        87 + daylightAmount * 25,
        92 + daylightAmount * 50 + twilightAmount * 15,
      ];
      const backgroundLayers = [
        new PolygonLayer<(typeof groundBands)[number]>({
          id: "earth-ground",
          data: groundBands,
          stroked: false,
          getPolygon: (d) => d.polygon,
          coordinateSystem: "cartesian",
          getFillColor: (d) => d.glow
            ? [...rim, Math.round(42 * d.brightness)]
            : [
              5 + daylightAmount * 5 + d.brightness * (10 + twilightAmount * 8),
              12 + daylightAmount * 8 + d.brightness * 22,
              15 + daylightAmount * 12 + d.brightness * (23 + daylightAmount * 10),
              255,
            ],
          parameters: { depthWriteEnabled: false, depthCompare: "always" },
          updateTriggers: { getFillColor: solarElevation },
        }),
        new PathLayer({
          id: "ground-directions",
          data: groundDirections.filter((d) => d.cardinal || pitch > 40),
          coordinateSystem: "cartesian",
          getPath: (d) => d.path,
          getColor: [75, 121, 128, 48],
          getWidth: 1,
          widthUnits: "pixels",
          billboard: true,
          parameters: { depthWriteEnabled: false },
        }),
        new PathLayer({
          id: "horizon",
          data: [{ path: horizon }],
          coordinateSystem: "cartesian",
          getPath: (d) => d.path,
          getColor: [...rim, 180],
          getWidth: 1.2,
          widthUnits: "pixels",
          billboard: true,
          parameters: { depthWriteEnabled: false },
        }),
        new PathLayer<(typeof compass)[number]>({
          id: "compass-ticks",
          data: compass.filter((d) => d.cardinal || fovy < 55 || d.degrees % 30 === 0),
          coordinateSystem: "cartesian",
          getPath: (d) => d.path,
          getColor: (d) => d.degrees === 0 ? [126, 211, 209, 200] : [112, 153, 160, 140],
          getWidth: 1,
          widthUnits: "pixels",
          billboard: true,
          parameters: { depthWriteEnabled: false },
        }),
        new TextLayer<(typeof compass)[number]>({
          id: "compass-labels",
          data: compass.filter((d) => d.cardinal || (fovy < 35 && d.degrees % 30 === 0) || fovy < 15),
          coordinateSystem: "cartesian",
          getPosition: (d) => d.position,
          getText: (d) => d.text,
          getSize: (d) => d.cardinal ? 15 : 11,
          getColor: (d) => d.degrees === 0 ? [126, 211, 209, 255] : [155, 180, 187, 230],
          fontFamily: "monospace",
          characterSet: "auto",
          extensions: [new CompassLabelExtension()],
          billboard: true,
          parameters: { depthWriteEnabled: false },
        }),
      ];
      const { positions, satIds, trajectories } = externalDataStore;
      if (!positions || !satIds.length) {
        return backgroundLayers;
      }
      // Orbit geometry changes only when the worker returns a new pass, not on
      // every shared-memory satellite-position update.
      if (trajectories !== lastTrajectories) {
        lastTrajectories = trajectories;
        segments = orbitSegments(trajectories);
      }
      return [
        ...backgroundLayers,
        new OrbitLayer({
          id: "satellite-trajectories",
          data: segments,
          coordinateSystem: "cartesian",
          getSourcePosition: (d) => d.source,
          getTargetPosition: (d) => d.target,
          getColor: (d) =>
            d.index === selectedIndex ? [255, 190, 60, 220] : [80, 210, 255, 220],
          getWidth: 2,
          widthUnits: "pixels",
          pickable: false,
          parameters: { depthWriteEnabled: false, depthCompare: "always" },
          updateTriggers: { getColor: selectedIndex },
        }),
        new PointCloudLayer({
          id: "satellites",
          coordinateSystem: "cartesian",
          pickable: true,
          // A fresh descriptor uploads changed shared memory without copying the typed array.
          data: {
            length: satIds.length,
            attributes: {
              getPosition: { value: positions, size: STRIDE_FLOATS },
            },
          },
          // Deck's automatic picking highlight also reacts to touch, independently
          // of onHover. Keep it tied to genuine mouse hover so it cannot mask selection.
          autoHighlight: false,
          highlightedObjectIndex: hoveredIndex,
          highlightColor: [100, 255, 140, 255],
          getColor: (_, { index }) =>
            index === selectedIndex ? [80, 210, 255, 255] : [255, 255, 255, 255],
          updateTriggers: { getColor: selectedIndex },
          // The shader adds pointSize before the perspective divide, so a point already
          // shrinks with distance but ignores the field of view. Scale it by hand.
          pointSize: POINT_SIZE * (-(fovy / 25) + 4),
        }),
      ];
    }

    const deck = new Deck({
      parent: container.current,
      canvas: canvas.current,
      views: new FirstPersonView({ far: FAR, fovy }),
      initialViewState: INITIAL_VIEWSTATE,
      controller: CONTROLLER,
      layers: createLayers(),
      onViewStateChange: ({ viewState }) => {
        const nextPitch = (viewState as typeof INITIAL_VIEWSTATE).pitch ?? 0;
        if ((pitch > 40) !== (nextPitch > 40)) {
          pitch = nextPitch;
          deck.setProps({ layers: createLayers() });
        }
      },
      widgets: import.meta.env.DEV ? [new StatsWidget({ type: "deck", placement: "bottom-left" })] : [],
      pickingRadius: 25,
      onHover: (info, event) => {
        if (touchInput || event.pointerType === "touch" || window.matchMedia("(hover: none)").matches) return;
        const index =
          info.picked && info.layer?.id === "satellites" ? info.index : -1;
        if (index === hoveredIndex) return;
        hoveredIndex = index;
        updateTrajectories();
      },
      onClick: (info, event) => {
        // Keep Deck's tap gesture as a selection path alongside the native fallback.
        // Either path must select the satellite and request its trajectory.
        if (event.pointerType === "touch") touchInput = true;
        selectSatellite(info.picked && info.layer?.id === "satellites" ? info.index : -1);
      },
      getTooltip: (info) => {
        if (touchInput || window.matchMedia("(hover: none)").matches) return null;
        if (!info.picked || info.layer?.id !== "satellites") return null;
        const meta = externalDataStore.omm[info.index];

        return meta.OBJECT_NAME;
      },
    });
    const skyCanvas = canvas.current!;
    let touch: { id: number; x: number; y: number; moved: boolean } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      touchInput = event.pointerType === "touch";
      if (event.pointerType !== "touch") return;
      if (hoveredIndex !== -1) {
        hoveredIndex = -1;
        updateTrajectories();
      }
      if (!event.isPrimary) {
        touch = null;
        return;
      }
      touch = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    };
    const onPointerMove = (event: PointerEvent) => {
      touchInput = event.pointerType === "touch";
      if (touch?.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > 10) {
        touch.moved = true;
      }
    };
    const onPointerUp = (event: PointerEvent) => {
      if (touch?.id !== event.pointerId) return;
      const tapped = !touch.moved &&
        Math.hypot(event.clientX - touch.x, event.clientY - touch.y) <= 10;
      touch = null;
      if (!tapped) return;
      const bounds = skyCanvas.getBoundingClientRect();
      const info = deck.pickObject({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
        radius: 25,
        layerIds: ["satellites"],
      });
      touchInput = true;
      selectSatellite(info?.picked ? info.index : -1);
    };
    const onPointerCancel = () => { touch = null; };
    // Observe native input before Deck's gesture handlers process it.
    skyCanvas.addEventListener("pointerdown", onPointerDown, true);
    skyCanvas.addEventListener("pointermove", onPointerMove, true);
    skyCanvas.addEventListener("pointerup", onPointerUp, true);
    skyCanvas.addEventListener("pointercancel", onPointerCancel, true);
    const refreshDaylight = () => {
      updateDaylight();
      deck.setProps({ layers: createLayers() });
    };
    const unsubscribeLocation = locationStore.subscribe(refreshDaylight);
    const daylightInterval = window.setInterval(refreshDaylight, 60_000);

    // Optical zoom: narrow the field of view instead of moving the camera.
    const onWheel = (event: WheelEvent) => {
      if (event.target instanceof Element && event.target.closest(".location, .settings, .settings-toggle")) return;
      const delta =
        event.deltaMode === 0 ? event.deltaY : event.deltaY * WHEEL_LINE_PIXELS;
      fovy = Math.min(
        Math.max(fovy * Math.exp(delta * ZOOM_SPEED), MIN_FOVY),
        MAX_FOVY,
      );
      deck.setProps({
        views: new FirstPersonView({ far: FAR, fovy }),
        layers: createLayers(),
      });
    };
    window.addEventListener("wheel", onWheel, { passive: true });

    // Shared-memory revisions update Deck directly, without React state or scheduling.
    let rafId = 0;
    let lastRev = -1;
    let lastPositions = externalDataStore.positions;
    let lastSatIds = externalDataStore.satIds;
    let lastTrajectoryRevision = -1;
    const render = () => {
      const { headerInts, positions, satIds, trajectoryRevision } = externalDataStore;
      const rev = headerInts ? Atomics.load(headerInts, HEADER_REV_INDEX) : -1;
      if (satIds !== lastSatIds) {
        hoveredIndex = -1;
        selectedIndex = -1;
        setSelectedSatelliteIndex(-1);
      }

      // Metadata can arrive after the revision for the worker's first full sweep.
      if (
        rev !== lastRev || positions !== lastPositions || satIds !== lastSatIds ||
        trajectoryRevision !== lastTrajectoryRevision
      ) {
        lastRev = rev;
        lastPositions = positions;
        lastSatIds = satIds;
        lastTrajectoryRevision = trajectoryRevision;
        deck.setProps({ layers: createLayers() });
      }

      rafId = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(rafId);
      unsubscribeLocation();
      window.clearInterval(daylightInterval);
      window.removeEventListener("wheel", onWheel);
      skyCanvas.removeEventListener("pointerdown", onPointerDown, true);
      skyCanvas.removeEventListener("pointermove", onPointerMove, true);
      skyCanvas.removeEventListener("pointerup", onPointerUp, true);
      skyCanvas.removeEventListener("pointercancel", onPointerCancel, true);
      externalDataStore.setTrajectoryIndices([]);
      deck.finalize();
    };
  }, []);

  return (
    <div ref={container} className="sky">
      <canvas ref={canvas} />
      <SettingsMenu />
      {selectedSatelliteIndex >= 0 && <SatelliteDetails selectedIndex={selectedSatelliteIndex} />}
    </div>
  );
}
