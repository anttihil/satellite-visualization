import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { externalDataStore } from "./externalDataStore";

const PAGE_SIZE = 50;

export function SatelliteSearch({ onSelect }: { onSelect: (index: number) => void }) {
  const satellites = useSyncExternalStore(externalDataStore.subscribe, externalDataStore.getSnapshot);
  const panel = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const search = query.trim().toLowerCase();
  const ready = search.length >= 3;
  const matches = useMemo(() => ready ? satellites.flatMap((satellite, index) =>
    satellite.OBJECT_NAME.toLowerCase().includes(search) || String(satellite.NORAD_CAT_ID).includes(search)
      ? [{ satellite, index }] : []) : [], [satellites, search, ready]);
  const pageCount = Math.ceil(matches.length / PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const start = currentPage * PAGE_SIZE;
  const visibleMatches = matches.slice(start, start + PAGE_SIZE);
  const changePage = (next: number) => {
    setPage(next);
    results.current?.scrollTo(0, 0);
  };

  return (
    <>
      <button className="search-toggle" aria-label="Search satellites" aria-controls="satellite-search"
        aria-expanded={open} onClick={() => {
          panel.current?.showModal();
          input.current?.focus();
          setOpen(true);
        }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" />
        </svg>
      </button>
      <dialog ref={panel} id="satellite-search" className="satellite-search" aria-labelledby="search-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            panel.current?.close();
          }
        }}
        onClose={() => setOpen(false)} onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom) panel.current?.close();
        }}>
        <header className="settings-header">
          <h1 id="search-title">Search satellites</h1>
          <button className="settings-close" aria-label="Close search" onClick={() => panel.current?.close()}>
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
        {pageCount > 1 && <nav className="search-pagination" aria-label="Search result pages">
          <button className="location-action" disabled={currentPage === 0} onClick={() => changePage(currentPage - 1)}>Previous</button>
          <span>Page {currentPage + 1} of {pageCount}</span>
          <button className="location-action" disabled={currentPage === pageCount - 1} onClick={() => changePage(currentPage + 1)}>Next</button>
        </nav>}
        {matches.length > 0 && <ul ref={results} className="search-results" aria-label="Matching satellites">
          {visibleMatches.map(({ satellite, index }) => <li key={satellite.NORAD_CAT_ID}>
            <button onClick={() => {
              onSelect(index);
              panel.current?.close();
            }}>
              <span>{satellite.OBJECT_NAME}</span>
              <small>NORAD {satellite.NORAD_CAT_ID}</small>
            </button>
          </li>)}
        </ul>}
      </dialog>
    </>
  );
}
