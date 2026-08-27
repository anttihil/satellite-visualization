import { useMemo } from "react";
import "./App.css";
import DeckGL, {
  GeoJsonLayer,
  _GlobeView as GlobeView,
  SimpleMeshLayer,
} from "deck.gl";

import { SphereGeometry } from "@luma.gl/engine";

const INITIAL_VIEWSTATE = {
  longitude: 90,
  latitude: 30,
  zoom: 0,
};

const EARTH_RADIUS_METERS = 6.3e6;

function App() {
  const backgroundLayers = useMemo(
    () => [
      new SimpleMeshLayer({
        id: "mesh",
        data: [],
        mesh: new SphereGeometry({ radius: EARTH_RADIUS_METERS }),
      }),
      new GeoJsonLayer({
        id: "earth-land",
        data: "https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_50m_land.geojson",
        // Styles
        stroked: false,
        filled: true,
        opacity: 0.1,
        getFillColor: [30, 80, 120],
      }),
    ],
    [],
  );

  return (
    <>
      <DeckGL
        views={new GlobeView()}
        initialViewState={INITIAL_VIEWSTATE}
        controller={true}
        layers={[backgroundLayers]}
      />
    </>
  );
}

export default App;
