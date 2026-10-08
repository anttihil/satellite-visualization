export type ManualLocation = { latitude: number; longitude: number; height: number };
type LocationSettings = {
  automatic: boolean;
  manual: ManualLocation | null;
  status: string;
};
const STORAGE_KEY = "observer-location";
const listeners = new Set<() => void>();

function load(): LocationSettings {
  const fallback = { automatic: true, manual: null, status: "Finding your location…" };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    if (!saved || typeof saved.automatic !== "boolean") return fallback;
    const manual = saved.manual;
    const valid = manual && Number.isFinite(manual.latitude) && Math.abs(manual.latitude) <= Math.PI / 2 &&
      Number.isFinite(manual.longitude) && Math.abs(manual.longitude) <= Math.PI && Number.isFinite(manual.height);
    if (!saved.automatic && !valid) return fallback;
    return { automatic: saved.automatic, manual: valid ? manual : null,
      status: saved.automatic ? fallback.status : "Using a manual location." };
  } catch {
    return fallback;
  }
}

let snapshot: LocationSettings = load();
export const locationSettings = {
  getSnapshot: () => snapshot,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  update(patch: Partial<LocationSettings>) {
    snapshot = { ...snapshot, ...patch };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ automatic: snapshot.automatic, manual: snapshot.manual }));
    } catch { /* Location controls still work when storage is unavailable. */ }
    listeners.forEach((listener) => listener());
  },
};
