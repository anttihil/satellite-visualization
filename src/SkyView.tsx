import { useEffect, useRef } from "react";

import { Deck, FirstPersonView } from "@deck.gl/core";
import { PolygonLayer, PointCloudLayer, PathLayer } from "@deck.gl/layers";
import "@deck.gl/widgets/stylesheet.css";
import { _StatsWidget as StatsWidget } from "@deck.gl/widgets";

import { externalDataStore, type Trajectory } from "./externalDataStore";
import {
  CONTROLLER,
  DISK_DATA,
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

  useEffect(() => {
    let fovy = INITIAL_FOVY;
    let hoveredIndex = -1;
    let selectedIndex = -1;
    const updateTrajectories = () => {
      externalDataStore.setTrajectoryIndices(
        [hoveredIndex, selectedIndex].filter((index) => index >= 0),
      );
      deck.setProps({ layers: createLayers() });
    };
    const backgroundLayers = [
      new PolygonLayer({
        id: "disk",
        data: [DISK_DATA],
        getPolygon: (d) => d,
        coordinateSystem: "cartesian",
        getFillColor: [14, 44, 42],
        parameters: {
          depthCompare: "less-equal",
          depthWriteEnabled: true,
        },
      }),
    ];

    function createLayers() {
      const { positions, satIds, trajectories } = externalDataStore;
      if (!positions || !satIds.length) {
        return backgroundLayers;
      }
      return [
        ...backgroundLayers,
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
        updateTrajectories();
      },
      getTooltip: (info) => {
        if (!info.picked || info.layer?.id !== "satellites") return null;
        const meta = externalDataStore.omm[info.index];

        return meta.OBJECT_NAME;
      },
    });

    // Optical zoom: narrow the field of view instead of moving the camera.
    const onWheel = (event: WheelEvent) => {
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
      window.removeEventListener("wheel", onWheel);
      externalDataStore.setTrajectoryIndices([]);
      deck.finalize();
    };
  }, []);

  return (
    <div ref={container} className="sky">
      <canvas ref={canvas} />
      <ObserverLocationBox />
    </div>
  );
}
