import { useMemo } from "react";
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

const INITIAL_VIEWSTATE:FirstPersonViewState = {
  longitude: 0,
  latitude: 0,
};

const observerGd = {
  latitude: degreesToRadians(LATITUDE),
  longitude: degreesToRadians(LONGITUDE),
  height: 0.1
}

function createDiskLayer() {

  const diskData = []
  const radius = 2000;
  const segments = 128;
  for (let i = 0; i< segments; i++) {
    const x = radius * Math.sin(i/segments);
    const y = radius * Math.cos(i/segments);
    diskData.push([x, y, 0])
  }

  return new PolygonLayer({
    id: "disk",
    data: [diskData],
    getPolygon: d => d,
    coordinateSystem: "cartesian",
    getLineColor: [255,255,255],
    getFillColor: [14, 44, 42],
    parameters: {
      depthTest: true,
      depthMask: true,
    },
  })
}

const FIXED_RANGE = 100

function App() {

  const visibleSatellites = useMemo(async ()=> {

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
    return enus

  }, [])

  const backgroundLayers = useMemo(
    () => [
      createDiskLayer(),
      new PointCloudLayer({
        id: 'satellites',
        coordinateSystem: "cartesian",
        data: [visibleSatellites],
        getColor: [255,255,255, 255],
        getPosition: d => d,
        pointSize: 2
      })
    ],
    [],
  );

  return (
    <>
      <DeckGL
        views={new FirstPersonView({
        })}
        initialViewState={INITIAL_VIEWSTATE}
        controller={true}
        layers={[backgroundLayers]}
      />
    </>
  );
}

export default App;
