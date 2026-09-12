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
import { DISK_DATA, FAR, HEADER_REV_INDEX, INITIAL_FOVY, MAX_FOVY, MIN_FOVY, POINT_SIZE, STRIDE_FLOATS, WHEEL_LINE_PIXELS, ZOOM_SPEED } from "./consts";

// The satellite position calculations (lookAngles & ENU) place the observer at [0,0,0],
// so we need to preserve that. 
// At exactly +/-90 the view direction meets the up vector and the picture collapses
// sideways, so the pitch stops one degree short of the zenith.
const INITIAL_VIEWSTATE: FirstPersonViewState = {
  position: [0, 0, 0],
  pitch: -20,
  minPitch: -89,
  maxPitch: 89,
};

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
      // this is binary data from SharedArrayBuffer, this loads it straight to GPU without checks
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
      pointSize: POINT_SIZE * (- (fovy / 25) + 4),
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

    
    const deck = new Deck({
      parent: container.current,
      canvas: canvas.current,
      views: new FirstPersonView({ far: FAR, fovy }),
      initialViewState: INITIAL_VIEWSTATE,
      controller: CONTROLLER,
      layers: createLayers(fovy),
      widgets: [new StatsWidget({ type: "deck" })],
      pickingRadius: 25,
      getTooltip: (info) => {
        if (!info.picked) return null
        return "satellite" + ' ' + externalDataStore.satIds[info.index]
      }
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


    // the purpose here is to avoid creating a useState trigger.
    // the difference is probably not much even at 60Hz, but since we are using SharedArrayBuffer
    // whose memory address doesn't change anyway, we might as well remove React diffing
    // and scheduling from touching Deck.gl
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
