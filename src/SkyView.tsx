import { useEffect, useRef } from "react";

import {
  Deck,
  FirstPersonView,
  type FirstPersonViewState,
} from "@deck.gl/core";
import { PolygonLayer, PointCloudLayer } from "@deck.gl/layers";
import "@deck.gl/widgets/stylesheet.css";
import { _StatsWidget as StatsWidget } from "@deck.gl/widgets";

import { externalDataStore } from "./externalDataStore";
import { HEADER_REV_INDEX, STRIDE_FLOATS } from "./consts";

// The worker measures azimuth and elevation from the observer, so the camera must
// sit on that point. An offset eye shifts near satellites more than far ones: two
// units of height move a satellite at range 40 by 2.9 degrees, one at range 400 by
// 0.28 degrees.
// At exactly +/-90 the view direction meets the up vector and the picture collapses
// sideways, so the pitch stops one degree short of the zenith.
const INITIAL_VIEWSTATE: FirstPersonViewState = {
  position: [0, 0, 0],
  pitch: -20,
  minPitch: -89,
  maxPitch: 89,
};

// Below the eye, so the ground still covers the lower half of the sky.
const DISK_HEIGHT = -1;

const FAR = 2000;
const INITIAL_FOVY = 75;
const MIN_FOVY = 2;
// The projection is rectilinear, so it stretches the edges of the frame by 1/cos(angle
// from the axis) or more. At 75 degrees the top edge stretches 1.55x, at 100 it is 2.32x.
const MAX_FOVY = INITIAL_FOVY;
// Firefox reports wheel deltas in lines, Chrome in pixels. One notch is 3 lines or 100 pixels.
const WHEEL_LINE_PIXELS = 40;
const ZOOM_SPEED = 0.0015;
const POINT_SIZE = 100;

// Look around only. Scroll, drag-pan and the keyboard all move the camera position.
const CONTROLLER = {
  dragMode: "rotate" as const,
  dragPan: false,
  scrollZoom: false,
  doubleClickZoom: false,
  touchZoom: false,
  keyboard: false,
  inertia: 300,
};

function createDiskData() {
  const diskData = [];
  const radius = 120;
  const segments = 128;
  for (let i = 0; i < segments; i++) {
    const theta = (2 * Math.PI * i) / segments;
    const x = radius * Math.sin(theta);
    const y = radius * Math.cos(theta);
    diskData.push([x, y, DISK_HEIGHT]);
  }
  return diskData;
}
const DISK_DATA = createDiskData();

const BACKGROUND_LAYERS = [
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

// How much a narrower field of view magnifies the sky, against the initial view.
function magnification(fovy: number) {
  return (
    Math.tan((INITIAL_FOVY * Math.PI) / 360) / Math.tan((fovy * Math.PI) / 360)
  );
}

function createLayers(fovy: number) {
  const { positions, satIds } = externalDataStore;
  if (!positions) {
    return BACKGROUND_LAYERS;
  }
  return [
    ...BACKGROUND_LAYERS,
    new PointCloudLayer({
      id: "satellites",
      coordinateSystem: "cartesian",
      pickable: true,
      // Binary attribute: uploaded straight to the GPU, no per-point callback.
      data: {
        length: satIds.length,
        attributes: {
          getPosition: { value: positions, size: STRIDE_FLOATS },
        },
      },
      getColor: [255, 255, 255, 255],
      // The shader adds pointSize before the perspective divide, so a point already
      // shrinks with distance but ignores the field of view. Scale it by hand.
      pointSize: POINT_SIZE * magnification(fovy),
      onClick: (info) => {
        if (!info.picked) return;
        console.log("satellite", satIds[info.index]);
      },
    }),
  ];
}

export function SkyView() {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let fovy = INITIAL_FOVY;

    // React owns the canvas element. A canvas that Deck creates itself can outlive
    // finalize() and stay in the DOM when the effect runs twice.
    const deck = new Deck({
      parent: container.current,
      canvas: canvas.current,
      views: new FirstPersonView({ far: FAR, fovy }),
      initialViewState: INITIAL_VIEWSTATE,
      controller: CONTROLLER,
      layers: createLayers(fovy),
      widgets: [new StatsWidget({ type: "deck" })],
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
        layers: createLayers(fovy),
      });
    };
    window.addEventListener("wheel", onWheel, { passive: true });

    let rafId = 0;
    let lastRev = -1;
    const render = () => {
      const { headerInts } = externalDataStore;
      const rev = headerInts ? Atomics.load(headerInts, HEADER_REV_INDEX) : -1;

      if (rev !== lastRev) {
        lastRev = rev;
        deck.setProps({ layers: createLayers(fovy) });
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
    </div>
  );
}
