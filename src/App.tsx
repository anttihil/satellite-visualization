import { useEffect, useMemo, useState } from "react";
import "./App.css";
import DeckGL, {
  FirstPersonView,
  type FirstPersonViewState,
  PolygonLayer,
  PointCloudLayer,
} from "deck.gl";

import { loadSatellites } from "./omm";

import {
  ecfToLookAngles,
  json2satrec,
  propagate,
  degreesToRadians,
  eciToEcf,
  gstime
  
} from "satellite.js"

const LATITUDE = 34.065235;
const LONGITUDE = -118.306915;
const OBS_ALTITUDE_KM = 0.1
const FIXED_RANGE = 100

const INITIAL_VIEWSTATE:FirstPersonViewState = {
  position: [0,0,2],
  pitch: -20,
};

const observerGd = {
  latitude: degreesToRadians(LATITUDE),
  longitude: degreesToRadians(LONGITUDE),
  height: OBS_ALTITUDE_KM
}

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



function App() {

  const [visibleSatellites, setVisibleSatellites] = useState<number[][]>([])

  useEffect(()=>  {

    async function loadData() {
    const ommData = await loadSatellites()

    const sats = ommData.map((item)=> json2satrec(item))

    const now = new Date();

    const props = sats.map((sat) => propagate(sat, now)).filter(prop => {
      return prop !== null
    })

    const gmst = gstime(now)

    const lookAngles = props.map(prop=> eciToEcf(prop.position, gmst )).map(ecf => ecfToLookAngles(observerGd,ecf))

    const enus = lookAngles.map(look => {
      return [
        FIXED_RANGE * Math.cos(look.elevation) * Math.sin(look.azimuth),
        FIXED_RANGE * Math.cos(look.elevation) * Math.cos(look.azimuth),
        FIXED_RANGE * Math.sin(look.elevation) 
      ]
    })
    console.log(enus.slice(0,50))
    setVisibleSatellites(enus)
  }

  loadData()

  return ()=> {}
  }, [])

  const backgroundLayers = useMemo(
    () => [
      new PolygonLayer({
    id: "disk",
    data: [DISK_DATA],
    getPolygon: d => d,
    coordinateSystem: "cartesian",
    getLineColor: [255,255,255],
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
