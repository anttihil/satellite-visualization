import { useEffect, useRef } from "react";

import { Deck, FirstPersonView } from "@deck.gl/core";
import { PolygonLayer, PointCloudLayer } from "@deck.gl/layers";
import "@deck.gl/widgets/stylesheet.css";
import { _StatsWidget as StatsWidget } from "@deck.gl/widgets";

import { externalDataStore } from "./externalDataStore";
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
      const { positions, satIds, omm } = externalDataStore;
      if (!positions || !satIds.length) {
        return backgroundLayers;
      }
      return [
        ...backgroundLayers,
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
          onClick: (info) => {
            if (!info.picked) return;
            console.log("satellite", omm[info.index].OBJECT_NAME);
          },
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
      getTooltip: (info) => {
        if (!info.picked) return null;
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
    const render = () => {
      const { headerInts, positions, satIds } = externalDataStore;
      const rev = headerInts ? Atomics.load(headerInts, HEADER_REV_INDEX) : -1;

      // Metadata can arrive after the revision for the worker's first full sweep.
      if (rev !== lastRev || positions !== lastPositions || satIds !== lastSatIds) {
        lastRev = rev;
        lastPositions = positions;
        lastSatIds = satIds;
        deck.setProps({ layers: createLayers() });
      }

      rafId = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("wheel", onWheel);
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
