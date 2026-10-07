import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { refreshSatellites, REFRESH_STATE_KEY, SNAPSHOT_KEY, REFRESH_INTERVAL_MS } from "./refresh.ts";
import type { SatelliteMetadata } from "../shared/satellite-data.ts";
import { validateSatellites } from "../shared/satellite-data.ts";
import worker from "./index.ts";

const fixture = JSON.parse(readFileSync(new URL("../public/active_satellites.json", import.meta.url), "utf8")).slice(0, 2);
function createStore() {
  const values = new Map<string, string>();
  const metadata = new Map<string, SatelliteMetadata>();
  const lastWrites = new Map<string, number>();
  let timeOffset = 0;
  return {
    values, metadata,
    advanceTime: (milliseconds: number) => { timeOffset += milliseconds; },
    get: async (key: string) => values.get(key) ?? null,
    getStream: async (key: string) => values.has(key) ? new Response(values.get(key)).body : null,
    put: async (key: string, value: string | ReadableStream<Uint8Array>, options?: { metadata?: SatelliteMetadata; expirationTtl?: number }) => {
      const now = performance.now() + timeOffset;
      if (now - (lastWrites.get(key) ?? -Infinity) < 1000) throw new Error("KV same-key write limit exceeded");
      lastWrites.set(key, now);
      const text = typeof value === "string" ? value : await new Response(value).text();
      values.set(key, text);
      if (options?.metadata) metadata.set(key, options.metadata);
    },
    delete: async (key: string) => { values.delete(key); },
  };
}

test("valid snapshot is published with metadata; recent attempts never refetch", async () => {
  const store = createStore();
  let calls = 0;
  const source: typeof fetch = async () => { calls++; return Response.json(fixture); };
  await refreshSatellites(store, source, 100000000);
  assert.deepEqual(JSON.parse(store.values.get(SNAPSHOT_KEY)!), fixture);
  assert.equal(store.metadata.get(SNAPSHOT_KEY)?.count, null);
  assert.equal(JSON.parse(store.values.get(REFRESH_STATE_KEY)!).suspended, false);
  assert.match(store.metadata.get(SNAPSHOT_KEY)!.version, /^[a-f0-9-]{36}$/);
  assert.equal([...store.values.keys()].some((key) => key.startsWith("pending:")), false);
  await refreshSatellites(store, source, 100000001);
  assert.equal(calls, 1);
  store.advanceTime(REFRESH_INTERVAL_MS);
  await refreshSatellites(store, source, 100000000 + REFRESH_INTERVAL_MS);
  assert.equal(calls, 2);
});

for (const [name, response] of [
  ["HTTP 403", () => new Response("Blocked", { status: 403 })],
  ["redirect", () => new Response(null, { status: 301 })],
  ["HTML instead of JSON", () => new Response("<html>Error</html>")],
  ["HTML mislabeled as JSON", () => new Response("<html>Error</html>", { headers: { "Content-Type": "application/json" } })],
  ["empty snapshot", () => Response.json([])],
  ["truncated response", () => new Response('[{"NORAD_CAT_ID":900}', { headers: { "Content-Type": "application/json" } })],
  ["oversize response", () => new Response("[{" + " ".repeat(20 * 1024 * 1024) + "}]", { headers: { "Content-Type": "application/json" } })],
] as const) {
  test(`${name} preserves last good data and suspends subsequent requests`, async () => {
    const store = createStore();
    store.values.set(SNAPSHOT_KEY, "last good snapshot");
    let calls = 0;
    const source: typeof fetch = async () => { calls++; return response(); };
    await assert.rejects(refreshSatellites(store, source, 100000000), (error: Error) => {
      assert.equal(JSON.parse(store.values.get(REFRESH_STATE_KEY)!).error, error.message);
      return true;
    });
    assert.equal(store.values.get(SNAPSHOT_KEY), "last good snapshot");
    assert.equal(JSON.parse(store.values.get(REFRESH_STATE_KEY)!).suspended, true);
    await refreshSatellites(store, source, 100000000 + REFRESH_INTERVAL_MS);
    assert.equal(calls, 1);
  });
}

test("browser validation rejects bad orbital records and duplicate IDs", () => {
  assert.deepEqual(validateSatellites(fixture), fixture);
  assert.throws(() => validateSatellites([{ ...fixture[0], MEAN_MOTION: 0 }]));
  assert.throws(() => validateSatellites([fixture[0], fixture[0]]));
});

test("failed suspension update stays fail-closed and preserves the source error", async () => {
  const store = createStore();
  const put = store.put;
  let stateWrites = 0;
  store.put = async (key, value, options) => {
    if (key === REFRESH_STATE_KEY && ++stateWrites > 1) throw new Error("KV unavailable");
    await put(key, value, options);
  };
  let calls = 0;
  const source: typeof fetch = async () => { calls++; return new Response("Blocked", { status: 403 }); };
  await assert.rejects(refreshSatellites(store, source, 100000000), /CelesTrak returned HTTP 403/);
  assert.equal(JSON.parse(store.values.get(REFRESH_STATE_KEY)!).suspended, true);
  await refreshSatellites(store, source, 100000000 + REFRESH_INTERVAL_MS);
  assert.equal(calls, 1);
});

test("staging a failed stream preserves the published snapshot", async () => {
  const store = createStore();
  store.values.set(SNAPSHOT_KEY, "last good snapshot");
  let read = false;
  const source: typeof fetch = async () => new Response(new ReadableStream({
    pull(controller) {
      if (!read) { controller.enqueue(new TextEncoder().encode("[{")); read = true; }
      else controller.error(new Error("Connection lost"));
    },
  }), { headers: { "Content-Type": "application/json" } });
  await assert.rejects(refreshSatellites(store, source));
  assert.equal(store.values.get(SNAPSHOT_KEY), "last good snapshot");
  assert.equal([...store.values.keys()].some((key) => key.startsWith("pending:")), false);
});

for (const method of ["GET", "HEAD"]) {
  test(`metadata ${method} uses a KV read and cancels the unused snapshot stream`, async () => {
    const metadata: SatelliteMetadata = { version: "test-version", fetchedAt: "2026-10-07T00:00:00.000Z", count: null };
    let cancelled = false;
    const env = {
      SATELLITE_DATA: {
        getWithMetadata: async (key: string, options: { type: string; cacheTtl: number }) => {
          assert.equal(key, SNAPSHOT_KEY);
          assert.deepEqual(options, { type: "stream", cacheTtl: 60 });
          return { metadata, value: new ReadableStream({ cancel() { cancelled = true; } }) };
        },
        get: async (key: string, type: string) => {
          assert.equal(cancelled, true);
          assert.equal(key, REFRESH_STATE_KEY);
          assert.equal(type, "json");
          return { suspended: true };
        },
        list: async () => { throw new Error("Metadata must not use KV list quota"); },
      },
    } as unknown as Parameters<typeof worker.fetch>[1];
    const response = await worker.fetch(new Request("https://example.com/api/satellites/meta", { method }), env);
    assert.equal(response.status, 200);
    assert.equal(cancelled, true);
    if (method === "GET") assert.deepEqual(await response.json(), { ...metadata, refreshSuspended: true });
    else assert.equal(await response.text(), "");
  });
}

test("metadata without snapshot metadata cancels the stream and returns an uncached 503", async () => {
  let cancelled = false;
  const env = {
    SATELLITE_DATA: {
      getWithMetadata: async () => ({ metadata: null, value: new ReadableStream({ cancel() { cancelled = true; } }) }),
    },
  } as unknown as Parameters<typeof worker.fetch>[1];
  const response = await worker.fetch(new Request("https://example.com/api/satellites/meta"), env);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(cancelled, true);
});
