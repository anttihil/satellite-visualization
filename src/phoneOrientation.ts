export type OrientationMode = "waiting" | "permission" | "denied" | "unavailable" | "tracking" | "manual" | "disabled";
export type OrientationStatus = { mode: OrientationMode; absolute: boolean };
export type Direction = { bearing: number; pitch: number };
export const MANUAL_ORIENTATION_TIMEOUT_MS = 3000;

type OrientationAPI = typeof DeviceOrientationEvent & {
  requestPermission?: (absolute?: boolean) => Promise<"granted" | "denied">;
};
type CompassEvent = DeviceOrientationEvent & { webkitCompassHeading?: number; webkitCompassAccuracy?: number };

export const angleDifference = (a: number, b: number) => ((a - b + 540) % 360 + 360) % 360 - 180;

// The rear camera points along device -Z. Rz(alpha) Rx(beta) Ry(gamma)
// transforms it to east/north/up. Screen rotation does not change this axis,
// so portrait and either landscape orientation use the same pointing vector.
export function phoneDirection(event: CompassEvent): (Direction & { absolute: boolean }) | null {
  if (event.beta === null || event.gamma === null) return null;
  const compass = Number.isFinite(event.webkitCompassHeading) &&
    (event.webkitCompassAccuracy === undefined || event.webkitCompassAccuracy >= 0);
  if (!compass && event.alpha === null) return null;
  const radians = Math.PI / 180;
  const alpha = (compass ? -event.webkitCompassHeading! : event.alpha!) * radians;
  const beta = event.beta * radians;
  const gamma = event.gamma * radians;
  const x = -Math.cos(alpha) * Math.sin(gamma) - Math.sin(alpha) * Math.sin(beta) * Math.cos(gamma);
  const y = -Math.sin(alpha) * Math.sin(gamma) + Math.cos(alpha) * Math.sin(beta) * Math.cos(gamma);
  const z = -Math.cos(beta) * Math.cos(gamma);
  if (![x, y, z].every(Number.isFinite)) return null;
  return {
    bearing: Math.atan2(x, y) / radians,
    // Deck's first-person pitch is negative above the horizon.
    pitch: Math.max(-89, Math.min(89, -Math.asin(Math.max(-1, Math.min(1, z))) / radians)),
    absolute: compass || event.absolute,
  };
}

export class PhoneOrientation {
  status: OrientationStatus = { mode: "waiting", absolute: false };
  private enabled = true;
  private disposed = false;
  private sample: (Direction & { absolute: boolean }) | null = null;
  private offset: Direction | null = null;
  private timer = 0;
  private resumeTimer = 0;
  private absoluteReceived = false;
  private listening = false;

  private notify: (status: OrientationStatus) => void;
  private current: () => Direction;

  constructor(notify: (status: OrientationStatus) => void, current: () => Direction) {
    this.notify = notify;
    this.current = current;
    this.start(false);
  }

  private setMode(mode: OrientationMode) {
    this.status = { mode, absolute: this.sample?.absolute ?? false };
    this.notify(this.status);
  }

  private onOrientation = (event: DeviceOrientationEvent) => {
    const sample = phoneDirection(event);
    if (!sample || !this.enabled) return;
    if (event.type === "deviceorientationabsolute") this.absoluteReceived = true;
    if (this.absoluteReceived && !sample.absolute) return;
    const changedReference = this.sample?.absolute !== sample.absolute;
    this.sample = sample;
    window.clearTimeout(this.timer);
    if (!this.offset || changedReference) {
      const current = this.current();
      this.offset = sample.absolute ? { bearing: 0, pitch: 0 } : {
        bearing: angleDifference(current.bearing, sample.bearing),
        pitch: current.pitch - sample.pitch,
      };
    }
    if (["waiting", "unavailable", "permission", "denied"].includes(this.status.mode)) this.setMode("tracking");
    else if (this.status.absolute !== sample.absolute) this.setMode(this.status.mode);
  };

  private async start(request: boolean) {
    if (!window.isSecureContext || typeof DeviceOrientationEvent === "undefined") {
      this.setMode("unavailable");
      return;
    }
    const api = DeviceOrientationEvent as OrientationAPI;
    if (api.requestPermission) {
      if (!request) { this.setMode("permission"); return; }
      try {
        const permission = await api.requestPermission(true);
        if (this.disposed || !this.enabled) return;
        if (permission !== "granted") { this.setMode("denied"); return; }
      } catch {
        if (!this.disposed && this.enabled) this.setMode("denied");
        return;
      }
    }
    if (this.disposed || !this.enabled) return;
    this.setMode("waiting");
    if (!this.listening) {
      window.addEventListener("deviceorientation", this.onOrientation);
      window.addEventListener("deviceorientationabsolute", this.onOrientation);
      this.listening = true;
    }
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      if (this.status.mode === "waiting") this.setMode("unavailable");
    }, 5000);
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled) { this.start(true); return; }
    this.stop();
    this.setMode("disabled");
  }

  resume() {
    window.clearTimeout(this.resumeTimer);
    if (!this.enabled) return;
    if (!this.sample) { this.start(true); return; }
    this.setMode("tracking");
  }

  manual(dragging = false) {
    if (this.status.mode === "tracking" || this.status.mode === "waiting") this.setMode("manual");
    if (this.status.mode !== "manual") return;
    window.clearTimeout(this.resumeTimer);
    // Wait until release; a stationary finger during a drag is not inactivity.
    // Inertia updates also restart the countdown, keeping the two inputs apart.
    if (!dragging) {
      this.resumeTimer = window.setTimeout(() => {
        if (this.status.mode !== "manual") return;
        if (this.sample) this.resume();
        else this.setMode("unavailable");
      }, MANUAL_ORIENTATION_TIMEOUT_MS);
    }
  }

  direction(): Direction | null {
    if (this.status.mode !== "tracking" || !this.sample || !this.offset || document.hidden) return null;
    return {
      bearing: this.sample.bearing + this.offset.bearing,
      pitch: Math.max(-89, Math.min(89, this.sample.pitch + this.offset.pitch)),
    };
  }

  private stop() {
    window.clearTimeout(this.timer);
    window.clearTimeout(this.resumeTimer);
    window.removeEventListener("deviceorientation", this.onOrientation);
    window.removeEventListener("deviceorientationabsolute", this.onOrientation);
    this.listening = false;
    this.sample = null;
    this.offset = null;
    this.absoluteReceived = false;
  }

  dispose() { this.disposed = true; this.stop(); }
}
