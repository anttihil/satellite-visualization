import { useEffect, useMemo, useState } from "react";
import "./App.css";
import DeckGL, {
  FirstPersonView,
  type FirstPersonViewState,
  PolygonLayer,
  PointCloudLayer,
} from "deck.gl";

import { externalDataStore } from "./externalDataStore";

const FIXED_RANGE = 100

const INITIAL_VIEWSTATE:FirstPersonViewState = {
  position: [0,0,2],
  pitch: -20,
};

function createDiskData() {
 const diskData = []
  const radius = 120;
  const segments = 128;
  for (let i = 0; i< segments; i++) {
    const theta = (2 * Math.PI * i) / segments
    const x = radius * Math.sin(theta);
    const y = radius * Math.cos(theta);
    diskData.push([x, y, 0])
  }
  return diskData
}
const DISK_DATA = createDiskData()

externalDataStore.init()

function App() {

  const [visibleSatellites, setVisibleSatellites] = useState<number[][]>([])

  useEffect(()=> {

    let rafId = 0;
    let lastTime = 0;
    const THRESHOLD_MS = 17

    const render: FrameRequestCallback = (currentTime)=> {

      if (!lastTime) {
        lastTime = currentTime
      }
      
      if (currentTime - lastTime >= THRESHOLD_MS && externalDataStore.hasNewData) {
        setVisibleSatellites(externalDataStore.positions);
        externalDataStore.hasNewData = false;
        lastTime = currentTime;
      } 
      
      rafId = requestAnimationFrame(render)
    }

    render(performance.now());

    return ()=> {
      if (rafId) {
        cancelAnimationFrame(rafId)
      }
    }

  }, [])

  const backgroundLayers = useMemo(
    () => [
      new PolygonLayer({
    id: "disk",
    data: [DISK_DATA],
    getPolygon: d => d,
    coordinateSystem: "cartesian",
    getFillColor: [14, 44, 42],
    parameters: {
      depthCompare: 'less-equal',
      depthWriteEnabled: true
    },
  }), 
      new PointCloudLayer({
        id: 'satellites',
        coordinateSystem: "cartesian",
        data: visibleSatellites,
        getColor: [255,255,255, 255],
        getPosition: d => d,
        pointSize: 100
      })
    ],
    [visibleSatellites],
  );

  return (
    <>
      <DeckGL
        views={new FirstPersonView({
          far: FIXED_RANGE *3
        })}
        initialViewState={INITIAL_VIEWSTATE}
        controller={true}
        layers={[backgroundLayers]}
      />
    </>
  );
}

export default App;
