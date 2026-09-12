import { radiansToDegrees } from "satellite.js"
import { locationStore } from "./externalDataStore"
import { useSyncExternalStore } from "react"

export const ObserverLocationBox = ()=> {

    const observer = useSyncExternalStore(
    locationStore.subscribe,
    locationStore.getSnapshot
  );

  return  (<div className="location">
        <p>
          Long: {radiansToDegrees(observer.longitude).toFixed(3)}
        </p>
        <p>
          Lat: {radiansToDegrees(observer.latitude).toFixed(3)}
        </p>
    </div>)
}