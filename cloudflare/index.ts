import type { SatelliteMetadata } from "../shared/satellite-data.ts";
import { refreshSatellites, REFRESH_STATE_KEY, SNAPSHOT_KEY, type RefreshState } from "./refresh.ts";

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    if (path !== "/api/satellites" && path !== "/api/satellites/meta") {
      return new Response("Not found", { status: 404 });
    }
    const headers = new Headers({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    if (path.endsWith("/meta")) {
      // Read metadata atomically with its snapshot without spending KV list quota
      // or buffering the dataset. Cancel the body before reading refresh state.
      const { value, metadata } = await env.SATELLITE_DATA.getWithMetadata<SatelliteMetadata>(SNAPSHOT_KEY, { type: "stream", cacheTtl: 60 });
      await value?.cancel();
      if (!value || !metadata) return Response.json({ error: "Satellite data is not initialized" }, { status: 503, headers: { "Cache-Control": "no-store" } });
      const state = await env.SATELLITE_DATA.get<RefreshState>(REFRESH_STATE_KEY, "json");
      return new Response(request.method === "HEAD" ? null : JSON.stringify({ ...metadata, refreshSuspended: state?.suspended ?? false }), { headers });
    }
    const { value, metadata } = await env.SATELLITE_DATA.getWithMetadata<SatelliteMetadata>(SNAPSHOT_KEY, { type: "stream", cacheTtl: 60 });
    if (!value || !metadata) {
      await value?.cancel();
      return Response.json({ error: "Satellite data is not initialized" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    headers.set("ETag", `"${metadata.version}"`);
    headers.set("X-Data-Version", metadata.version);
    headers.set("X-Data-Fetched-At", metadata.fetchedAt);
    if (request.headers.get("If-None-Match")?.split(",").some((etag) => etag.trim().replace(/^W\//, "") === `"${metadata.version}"` || etag.trim() === "*")) {
      await value.cancel();
      return new Response(null, { status: 304, headers });
    }
    if (request.method === "HEAD") {
      await value.cancel();
      return new Response(null, { headers });
    }
    return new Response(value, { headers });
  },
  async scheduled(controller, env) {
    // CelesTrak explicitly asks clients to stop on errors rather than retry.
    controller.noRetry();
    await refreshSatellites({
      get: (key) => env.SATELLITE_DATA.get(key),
      getStream: (key) => env.SATELLITE_DATA.get(key, "stream"),
      put: (key, value, options) => env.SATELLITE_DATA.put(key, value, options),
      delete: (key) => env.SATELLITE_DATA.delete(key),
    });
  },
} satisfies ExportedHandler<Env>;
