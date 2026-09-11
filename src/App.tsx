import { useEffect, useMemo, useState } from "react";
import "./App.css";

import DeckGL, {_StatsWidget} from "@deck.gl/react";
import { FirstPersonView, type FirstPersonViewState,} from "@deck.gl/core";
import { PolygonLayer, PointCloudLayer } from "@deck.gl/layers";
import "@deck.gl/widgets/stylesheet.css"
import { _StatsWidget as StatsWidget, CompassWidget } from "@deck.gl/widgets";

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

    const render: FrameRequestCallback = ()=> {
      
      // The check is cheap and the bottleneck is in the satellite calculations
      // so throttling here is not needed
      if (externalDataStore.hasNewData) {
        setVisibleSatellites(externalDataStore.positions);
        externalDataStore.hasNewData = false;
        
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
        widgets={[
          new StatsWidget({type: "deck"}), new CompassWidget({
            placement: "top-right"
          })
        ]}
      >

      </DeckGL>
    </>
  );
}

export default App;
