import "./App.css";

import { useEffect } from "react";
import { SkyView } from "./SkyView";
import { externalDataStore } from "./externalDataStore";

function App() {
  useEffect(() => {
    externalDataStore.init();
    return () => externalDataStore.destroy();
  }, []);

  return <SkyView />;
}

export default App;
