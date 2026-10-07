# satellite-viewer

A visualization tool for viewing satellites at your location. You can run it on your localhost with "pnpm dev". The app uses your location only for calculations.


https://github.com/user-attachments/assets/9544b3a0-fc88-4ca9-a4cf-178382981a4a

The satellite positions are rendered in a first person view. Some artistic liberty has been taken with the distances and visual sizes of satellites because they would be otherwise too small to see or click on.

What you can do: You can pan around the view and zoom. Hovering on a satellite will show its name.

## Tech
The app uses Deck.gl to render CelesTrak(tm) data. Most of the mathematical calculations in this demo are from satellite.js. 

## Cloudflare deployment

For a step-by-step explanation of the architecture, setup, deployment, and recovery,
read the [Cloudflare setup tutorial](CLOUDFLARE_SETUP.md).

The Vite build and API run together on Cloudflare Workers with Static Assets.
Production is served at https://orbitgaze.app, configured as a Worker Custom Domain
in `wrangler.jsonc`. The `workers.dev` URL is disabled.
The domain's Cloudflare WAF rate-limiting rule (`satellite_api_rate_limit`) limits
GET and HEAD requests under `/api/` to 30 requests per 10 seconds per IP
(per Cloudflare data center), then blocks matching requests for 10 seconds.
This zone-level rule is managed separately from Wrangler deployments.
Production data is stored in Workers KV; ordinary Vite development uses the bundled
`public/active_satellites.json` fixture and never contacts CelesTrak.

```sh
pnpm install
pnpm exec wrangler login
pnpm cf:types
pnpm check:worker
pnpm test
pnpm run deploy
```

`wrangler.jsonc` contains the production namespace binding and the UTC schedule
`17 */2 * * *`. When deploying to another account, create a namespace with
`pnpm exec wrangler kv namespace create satellite-data` and replace its ID in the config.
For a new, empty namespace, run `pnpm seed:data` once to download and perform streaming checks on the
initial snapshot. This command refuses to overwrite an existing namespace and requires Node.js 24+.

The scheduled handler makes at most one CelesTrak attempt every two hours. It
streams the response into a temporary KV key, checking HTTP status, JSON content type,
a 20 MiB size cap, and the opening/closing array delimiters. Only a completed stream
is published, with a unique publication version and successful fetch timestamp.
Temporary data expires after one day if cleanup is interrupted. Visitor requests only
read KV. The browser checks `/api/satellites/meta` every 15 minutes while visible
and when a tab becomes visible, downloading `/api/satellites` only when the version
changes (each successful scheduled download publishes a new version). Full OMM
validation runs in the browser worker; malformed orbital records leave its previous
snapshot running. This streaming approach avoids parsing, reserializing, and hashing
the whole dataset on the Workers Free plan's 10 ms CPU budget. It does not provide
full server-side JSON/schema validation. The data endpoint supports ETags. KV and HTTP caches can briefly serve a
previous version; each data response carries its own matching version and timestamp.

On any source error, further source requests are suspended and the last good
snapshot remains available without expiration. Inspect Workers Logs and the
`refresh-state` KV key to diagnose the issue. After fixing it, delete **only** that
key to allow the next scheduled attempt:

```sh
pnpm exec wrangler kv key delete refresh-state --binding SATELLITE_DATA --remote
```

`pnpm dev:worker` serves a local production build using local KV. An empty local KV
falls back to the bundled snapshot; do not seed or invoke the scheduled handler
against CelesTrak during routine development. Production displays the fetch time,
warns after four hours without a successful refresh, and reports paused updates.
Snapshot replacement publishes a fresh shared buffer and matching metadata together
and clears satellite selection so reordered records cannot produce incorrect labels.

`public/_headers` supplies cross-origin isolation for `SharedArrayBuffer` on the
deployed site. Deployment config and namespace IDs are public identifiers; credentials,
local secret files, generated types, and Wrangler state are ignored by Git.

## Why
The purpose of this demo is to mainly learn about multi-threading of CPU heavy calculations in the browser. I used a single Web Worker to calculate the positions of around 16k satellites. A single worker on some older machines won't finish the calculations to fit 60Hz target window. That was solved by chunking up the satellite array and updating positions one chunk at a time. Having some of the satellites miss a frame or two is not really perceptible. I could have sent the data at a lower frequency and let the client thread interpolate, but that would have been more complicated code-wise without any real added benefit. If I want strictly 60 Hz, I could have the main worker spin up further workers.

I wanted JS main thread solely dedicated to Deck.gl and React. To that end, I created a SharedArrayBuffer that gets updated by the worker. Deck.gl has the ability to load binary data, which is great for performance reasons. The binary data in that buffer gets loaded straight into GPU from Deck.gl without any main thread processing, ie. Deck.gl doesn't run item by item checks on the data. I noticed that this lowered sped up the rendering by dozens of ms over 60 frames, so a few ms per 16.7ms frame.
