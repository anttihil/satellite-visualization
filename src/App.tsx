import "./App.css";

import { SkyView } from "./SkyView";
import { externalDataStore } from "./externalDataStore";

externalDataStore.init();

function App() {
  return <SkyView />;
}

export default App;
