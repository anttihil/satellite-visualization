import type { SatelliteMetadata } from "../shared/satellite-data.ts";

export const SNAPSHOT_KEY = "snapshot";
export const REFRESH_STATE_KEY = "refresh-state";
export const REFRESH_INTERVAL_MS = 2 * 60 * 60 * 1000;
export const SOURCE_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=JSON";
const MAX_BYTES = 20 * 1024 * 1024;

export type RefreshState = {
  attemptedAt: string;
  suspended: boolean;
  error?: string;
};

type Store = {
  get(key: string): Promise<string | null>;
  getStream(key: string): Promise<ReadableStream<Uint8Array> | null>;
  put(key: string, value: string | ReadableStream<Uint8Array>, options?: { metadata?: SatelliteMetadata; expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
};

export async function refreshSatellites(store: Store, fetchSource: typeof fetch = fetch, now = Date.now()) {
  const storedState = await store.get(REFRESH_STATE_KEY);
  const state: RefreshState | null = storedState ? JSON.parse(storedState) : null;
  if (state?.suspended || (state && now - Date.parse(state.attemptedAt) < REFRESH_INTERVAL_MS)) {
    console.log(JSON.stringify({ event: "refresh-skipped", reason: state.suspended ? "suspended" : "recent-attempt" }));
    return;
  }
  const next: RefreshState = { attemptedAt: new Date(now).toISOString(), suspended: true };
  // Fail closed before contacting the source, even if the final state write fails.
  await store.put(REFRESH_STATE_KEY, JSON.stringify(next));
  // KV allows at most one write per second to the same key. Start the wait
  // after the initial write completes, with a small timing margin, and overlap
  // it with the download.
  const stateWriteReady = new Promise<void>((resolve) => setTimeout(resolve, 1100));
  const pendingKey = `pending:${crypto.randomUUID()}`;
  try {
    const response = await fetchSource(SOURCE_URL, {
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
      headers: { Accept: "application/json" },
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error(`CelesTrak returned HTTP ${response.status}`);
    }
    if (!response.body) throw new Error("CelesTrak returned no body");
    if (!response.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
      await response.body.cancel();
      throw new Error("CelesTrak did not return application/json");
    }
    let bytes = 0;
    let prefix = "";
    let suffix = "";
    const decoder = new TextDecoder();
    const checkedBody = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > MAX_BYTES) throw new Error("Satellite data exceeds the 20 MiB limit");
        // Inspect only a bounded prefix and suffix, never parse or copy the full file.
        if (prefix.length < 256) prefix += decoder.decode(chunk.subarray(0, 256 - prefix.length));
        suffix = (suffix + decoder.decode(chunk.subarray(Math.max(0, chunk.byteLength - 64)))).slice(-64);
        controller.enqueue(chunk);
      },
      flush() {
        if (!/^\s*\[\s*\{/.test(prefix) || !/\]\s*$/.test(suffix)) {
          throw new Error("Expected a non-empty JSON array with a complete response body");
        }
      },
    }));
    // Stage first: a failed/truncated download cannot replace live data.
    await store.put(pendingKey, checkedBody, { expirationTtl: 86400 });
    const data = await store.getStream(pendingKey);
    if (!data) throw new Error("Staged satellite data is not available");
    const metadata: SatelliteMetadata = {
      // A publication version avoids hashing the entire dataset on Workers Free.
      version: crypto.randomUUID(),
      fetchedAt: next.attemptedAt,
      count: null,
    };
    // Data and its metadata are replaced together; the last good snapshot never expires.
    await store.put(SNAPSHOT_KEY, data, { metadata });
    await stateWriteReady;
    await store.put(REFRESH_STATE_KEY, JSON.stringify({ ...next, suspended: false }));
    console.log(JSON.stringify({ event: "refresh-succeeded", ...metadata, bytes }));
  } catch (error) {
    next.suspended = true;
    next.error = error instanceof Error ? error.message : String(error);
    await stateWriteReady;
    await store.put(REFRESH_STATE_KEY, JSON.stringify(next)).catch((stateError) => {
      console.error(JSON.stringify({ event: "refresh-state-write-failed", error: String(stateError) }));
    });
    console.error(JSON.stringify({ event: "refresh-suspended", ...next }));
    throw error;
  } finally {
    await store.delete(pendingKey).catch(() => {
      console.error(JSON.stringify({ event: "staged-data-cleanup-failed", key: pendingKey }));
    });
  }
}
