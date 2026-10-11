import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { externalDataStore } from "./externalDataStore";
import { FAR, HIDDEN, STRIDE_FLOATS } from "./consts";

const PAGE_SIZE = 50;

export function SatelliteSearch({ onSelect, onPreview, onMatches }: {
  onSelect: (index: number, center: boolean) => void;
  onPreview: (index: number) => void;
  onMatches: (indices: number[]) => void;
}) {
  const satellites = useSyncExternalStore(externalDataStore.subscribe, externalDataStore.getSnapshot);
  const panel = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLUListElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [hovered, setHovered] = useState(-1);
  const [focused, setFocused] = useState(-1);
  const [, refreshVisibility] = useState(0);
  const search = query.trim().toLowerCase();
  const ready = search.length >= 3;
  const matches = useMemo(() => ready ? satellites.flatMap((satellite, index) =>
    satellite.OBJECT_NAME.toLowerCase().includes(search) || String(satellite.NORAD_CAT_ID).includes(search)
      ? [{ satellite, index }] : []) : [], [satellites, search, ready]);
  const pageCount = Math.ceil(matches.length / PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const start = currentPage * PAGE_SIZE;
  const visibleMatches = matches.slice(start, start + PAGE_SIZE);
  const candidate = hovered >= 0 ? hovered : focused;
  const previewIndex = open && visibleMatches.some(({ index }) => index === candidate) ? candidate : -1;

  useEffect(() => {
    const dialog = panel.current!;
    const mobile = window.matchMedia("(max-width: 600px)");
    const show = () => {
      if (mobile.matches) dialog.showModal();
      else dialog.show();
    };
    if (!open) {
      dialog.close();
      return;
    }
    show();
    input.current?.focus();
    const resize = () => {
      dialog.close();
      show();
    };
    mobile.addEventListener("change", resize);
    return () => mobile.removeEventListener("change", resize);
  }, [open]);

  useEffect(() => {
    onMatches(open ? matches.map(({ index }) => index) : []);
  }, [open, matches, onMatches]);

  useEffect(() => { onPreview(previewIndex); }, [previewIndex, onPreview]);
  useEffect(() => () => {
    onPreview(-1);
    onMatches([]);
  }, [onPreview, onMatches]);

  useEffect(() => {
    if (!open) return;
    const interval = window.setInterval(() => refreshVisibility((value) => value + 1), 1000);
    return () => window.clearInterval(interval);
  }, [open]);

  const close = () => {
    setHovered(-1);
    setFocused(-1);
    setOpen(false);
    toggle.current?.focus({ preventScroll: true });
  };
  const changePage = (next: number) => {
    setPage(next);
    setHovered(-1);
    setFocused(-1);
    results.current?.scrollTo(0, 0);
  };

  return (
    <>
      <button ref={toggle} className="search-toggle" aria-label="Search satellites" aria-controls="satellite-search"
        aria-expanded={open} onClick={() => open ? close() : setOpen(true)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" />
        </svg>
      </button>
      <dialog ref={panel} id="satellite-search" className="satellite-search" aria-labelledby="search-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            close();
          }
        }}
        onClose={(event) => { if (!event.currentTarget.open) close(); }} onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom) close();
        }}>
        <header className="settings-header">
          <h1 id="search-title">Search satellites</h1>
          <button className="settings-close" aria-label="Close search" onClick={close}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="m6 6 12 12M6 18 18 6" />
            </svg>
          </button>
        </header>
        <label htmlFor="satellite-query">Satellite name or NORAD ID</label>
        <input ref={input} id="satellite-query" type="search" value={query} autoComplete="off"
          placeholder="Type at least 3 characters" aria-describedby="search-status"
          onChange={(event) => {
            setQuery(event.target.value);
            changePage(0);
          }} />
        <p id="search-status" role="status">
          {!ready ? "Type at least 3 characters to see matches." : satellites.length === 0
            ? "Satellite data is not available yet." : matches.length === 0
              ? "No matching satellites." : `${matches.length} matching satellite${matches.length === 1 ? "" : "s"}.${pageCount > 1
                ? ` Showing ${start + 1}–${start + visibleMatches.length}.` : ""}`}
        </p>
        {matches.length > 0 && <p className="search-help">Pink: all matches. Gold: selected. Hover, focus, or tap a name to preview one path.</p>}
        {pageCount > 1 && <nav className="search-pagination" aria-label="Search result pages">
          <button className="location-action" disabled={currentPage === 0} onClick={() => changePage(currentPage - 1)}>Previous</button>
          <span>Page {currentPage + 1} of {pageCount}</span>
          <button className="location-action" disabled={currentPage === pageCount - 1} onClick={() => changePage(currentPage + 1)}>Next</button>
        </nav>}
        {matches.length > 0 && <ul ref={results} className="search-results" aria-label="Matching satellites">
          {visibleMatches.map(({ satellite, index }) => {
            const positions = externalDataStore.positions;
            const offset = index * STRIDE_FLOATS;
            const up = positions?.[offset + 2];
            const aboveHorizon = up !== undefined && Number.isFinite(up) && up !== HIDDEN && up > 0;
            const visible = aboveHorizon && Math.hypot(positions![offset], positions![offset + 1], up) < FAR;
            const visibility = up === undefined ? "Position unavailable" : aboveHorizon
              ? visible ? "Above horizon" : "Above horizon · beyond view range" : "Below horizon";
            return <li key={satellite.NORAD_CAT_ID} data-preview={previewIndex === index}
              onMouseEnter={() => setHovered(index)} onMouseLeave={() => setHovered(-1)}
              onFocus={() => setFocused(index)} onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setFocused(-1);
              }}>
              <button className="search-result-name" aria-pressed={previewIndex === index} onClick={() => setFocused(index)}>
                <span>{satellite.OBJECT_NAME}</span>
                <small>NORAD {satellite.NORAD_CAT_ID} · {visibility}</small>
              </button>
              <button className="location-action search-show" aria-label={`${visible ? "Show in sky" : "View details"}: ${satellite.OBJECT_NAME}`}
                onClick={() => {
                  onSelect(index, visible);
                  close();
                }}>{visible ? "Show in sky" : "View details"}</button>
            </li>;
          })}
        </ul>}
      </dialog>
    </>
  );
}
