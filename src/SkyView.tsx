import { useEffect, useRef, useState } from "react";

import { Deck, FirstPersonView } from "@deck.gl/core";
import { PolygonLayer, PointCloudLayer, PathLayer, TextLayer } from "@deck.gl/layers";
import "@deck.gl/widgets/stylesheet.css";
import { _StatsWidget as StatsWidget } from "@deck.gl/widgets";

import { externalDataStore, locationStore, type Trajectory } from "./externalDataStore";
import { CompassLabelExtension, compass, groundBands, groundDirections, horizon, referencePosition, sunElevation, type Position } from "./earthReference";
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
import { ObserverLocationBox } from "./ObserverLocationBox";

export function SkyView() {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [selectedSatelliteIndex, setSelectedSatelliteIndex] = useState(-1);
  const [daylight, setDaylight] = useState("Night");

  useEffect(() => {
    let fovy = INITIAL_FOVY;
    let hoveredIndex = -1;
    let selectedIndex = -1;
    let pitch = INITIAL_VIEWSTATE.pitch ?? 0;
    let solarElevation = sunElevation(new Date(), locationStore.location);
    const updateDaylight = () => {
      solarElevation = sunElevation(new Date(), locationStore.location);
      setDaylight(solarElevation >= 0 ? "Daylight" : solarElevation >= -18 ? "Twilight" : "Night");
    };
    updateDaylight();
    const updateTrajectories = () => {
      externalDataStore.setTrajectoryIndices(
        [hoveredIndex, selectedIndex].filter((index) => index >= 0),
      );
      deck.setProps({ layers: createLayers() });
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
      const offset = selectedIndex * STRIDE_FLOATS;
      const selectedVisible = selectedIndex >= 0 && positions[offset + 2] > 0;
      const azimuth = selectedVisible ? Math.atan2(positions[offset], positions[offset + 1]) : 0;
      const elevation = selectedVisible ? Math.atan2(positions[offset + 2], Math.hypot(positions[offset], positions[offset + 1])) : 0;
      const guide: { path: Position[] }[] = selectedVisible ? [{
        path: Array.from({ length: 65 }, (_, i) => referencePosition(azimuth, elevation * i / 64)),
      }, {
        path: [referencePosition(azimuth, -0.8 * Math.PI / 180), referencePosition(azimuth, 0.8 * Math.PI / 180)],
      }] : [];
      return [
        ...backgroundLayers,
        new PathLayer({
          id: "selected-horizon-guide",
          data: guide,
          coordinateSystem: "cartesian",
          getPath: (d) => d.path,
          getColor: (_d, { index }) => index === 0 ? [255, 190, 60, 65] : [255, 190, 60, 240],
          getWidth: (_d, { index }) => index === 0 ? 1 : 3,
          widthUnits: "pixels",
          billboard: true,
          parameters: { depthWriteEnabled: false },
        }),
        new PathLayer<Trajectory>({
          id: "satellite-trajectories",
          data: trajectories,
          coordinateSystem: "cartesian",
          getPath: (d) => d.path,
          getColor: (d) =>
            d.index === selectedIndex ? [255, 190, 60, 220] : [80, 210, 255, 220],
          getWidth: 2,
          widthUnits: "pixels",
          billboard: true,
          jointRounded: true,
          capRounded: true,
          pickable: false,
          parameters: { depthWriteEnabled: false },
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
          autoHighlight: true,
          highlightColor: [120, 1, 120, 255],
          getColor: [255, 255, 255, 255],
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
      widgets: [new StatsWidget({ type: "deck" })],
      pickingRadius: 25,
      onHover: (info) => {
        const index =
          info.picked && info.layer?.id === "satellites" ? info.index : -1;
        if (index === hoveredIndex) return;
        hoveredIndex = index;
        updateTrajectories();
      },
      onClick: (info) => {
        selectedIndex =
          info.picked && info.layer?.id === "satellites" ? info.index : -1;
        setSelectedSatelliteIndex(selectedIndex);
        updateTrajectories();
      },
      getTooltip: (info) => {
        if (!info.picked || info.layer?.id !== "satellites") return null;
        const meta = externalDataStore.omm[info.index];

        return meta.OBJECT_NAME;
      },
    });
    const refreshDaylight = () => {
      updateDaylight();
      deck.setProps({ layers: createLayers() });
    };
    const unsubscribeLocation = locationStore.subscribe(refreshDaylight);
    const daylightInterval = window.setInterval(refreshDaylight, 60_000);

    // Optical zoom: narrow the field of view instead of moving the camera.
    const onWheel = (event: WheelEvent) => {
      if (event.target instanceof Element && event.target.closest(".location")) return;
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
      externalDataStore.setTrajectoryIndices([]);
      deck.finalize();
    };
  }, []);

  return (
    <div ref={container} className="sky">
      <canvas ref={canvas} />
      <div className="sky-reference" aria-label="Sky reference">
        <span>{daylight}</span>
        <span>Horizon 0° · N / E / S / W</span>
      </div>
      <ObserverLocationBox
        key={selectedSatelliteIndex}
        selectedIndex={selectedSatelliteIndex}
      />
    </div>
  );
}
