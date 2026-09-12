import { useEffect, useMemo, useRef } from "react";
import "./App.css";

import DeckGL, { type DeckGLRef } from "@deck.gl/react";
import { FirstPersonView, type FirstPersonViewState } from "@deck.gl/core";
import { PolygonLayer, PointCloudLayer } from "@deck.gl/layers";
import "@deck.gl/widgets/stylesheet.css";
import { _StatsWidget as StatsWidget } from "@deck.gl/widgets";

import { externalDataStore } from "./externalDataStore";
import { HEADER_REV_INDEX, STRIDE_FLOATS } from "./consts";

const INITIAL_VIEWSTATE: FirstPersonViewState = {
  position: [0, 0, 2],
  pitch: -20,
};

function createDiskData() {
  const diskData = [];
  const radius = 120;
  const segments = 128;
  for (let i = 0; i < segments; i++) {
    const theta = (2 * Math.PI * i) / segments;
    const x = radius * Math.sin(theta);
    const y = radius * Math.cos(theta);
    diskData.push([x, y, 0]);
  }
  return diskData;
}
const DISK_DATA = createDiskData();

externalDataStore.init();

function App() {
  const deck = useRef<DeckGLRef | null>(null);
  const backgroundLayers = useMemo(
    () => [
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
    ],
    [],
  );
  useEffect(() => {
    let rafId = 0;
    let lastRev = -1;

    const render: FrameRequestCallback = () => {
      const { headerInts, positions, satIds } = externalDataStore;
      const rev = headerInts ? Atomics.load(headerInts, HEADER_REV_INDEX) : -1;

      if (rev !== lastRev && positions) {
        lastRev = rev;
        deck.current?.deck?.setProps({
          layers: [
            ...backgroundLayers,

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
              pointSize: 100,
              onClick: (info) => {
                if (!info.picked) return;
                console.log("satellite", satIds[info.index]);
              },
            }),
          ],
        });
      }

      rafId = requestAnimationFrame(render);
    };

    render(performance.now());

    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, []);

  return (
    <>
      <DeckGL
        ref={deck}
        views={
          new FirstPersonView({
            far: 2000,
          })
        }
        initialViewState={INITIAL_VIEWSTATE}
        controller={true}
        layers={[backgroundLayers]}
        widgets={[new StatsWidget({ type: "deck" })]}
      ></DeckGL>
    </>
  );
}

export default App;
