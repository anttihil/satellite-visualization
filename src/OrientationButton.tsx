import type { OrientationStatus } from "./phoneOrientation";

export function OrientationButton({ status, onClick }: { status: OrientationStatus; onClick: () => void }) {
  const tracking = status.mode === "tracking";
  const locked = status.mode === "permission" || status.mode === "denied";
  const unavailable = status.mode === "unavailable" || status.mode === "disabled";
  const label = status.mode === "disabled" ? "Phone orientation disabled" :
    locked ? "Allow phone orientation" : status.mode === "unavailable" ? "Retry phone orientation" :
    status.mode === "waiting" ? "Waiting for phone orientation" :
    tracking ? "Following phone orientation" : "Return to phone orientation";
  return (
    <button className="orientation-button" data-mode={status.mode} aria-label={label}
      title={label} aria-pressed={tracking} disabled={status.mode === "disabled"} onClick={onClick}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        {status.mode === "manual" ? <>
          <circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" />
          <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
        </> : <path d="m12 3 7 17-7-4-7 4Z" fill={tracking ? "currentColor" : "none"} />}
        {unavailable && <path d="m3 3 18 18" strokeWidth="2.5" />}
        {locked && <g fill="#071013"><rect x="14" y="13" width="8" height="8" rx="1.5" /><path d="M16 13v-2a2 2 0 0 1 4 0v2" /></g>}
      </svg>
    </button>
  );
}
