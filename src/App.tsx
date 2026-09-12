import { useEffect, useMemo, useRef } from "react";
import "./App.css";

import DeckGL, { type DeckGLRef } from "@deck.gl/react";
import { FirstPersonView, type FirstPersonViewState } from "@deck.gl/core";
import { PolygonLayer, PointCloudLayer } from "@deck.gl/layers";
import "@deck.gl/widgets/stylesheet.css";
import { _StatsWidget as StatsWidget } from "@deck.gl/widgets";

import { externalDataStore } from "./externalDataStore";

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
    let lastTime = 0;

    const render: FrameRequestCallback = (currentTime) => {
      if (!lastTime) {
        lastTime = currentTime;
      }
      if (externalDataStore.hasNewData) {
        deck.current?.deck?.setProps({
          layers: [
            ...backgroundLayers,

            new PointCloudLayer({
              id: "satellites",
              coordinateSystem: "cartesian",
              data: externalDataStore.positions,
              getColor: [255, 255, 255, 255],
              getPosition: (d) => d,
              pointSize: 100,
            }),
          ],
        });
        externalDataStore.hasNewData = false;
        lastTime = currentTime;
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
