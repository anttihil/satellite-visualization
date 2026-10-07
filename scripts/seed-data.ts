import { execFileSync } from "node:child_process";
import { mkdtempSync, createReadStream, rmSync } from "node:fs";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshSatellites } from "../cloudflare/refresh.ts";

const location = process.argv.includes("--local") ? "--local" : "--remote";
const run = (args: string[]) => execFileSync("pnpm", ["exec", "wrangler", "kv", "key", ...args, "--binding", "SATELLITE_DATA", location], { encoding: "utf8" });
const keys = JSON.parse(run(["list"])) as { name: string }[];
if (keys.length) throw new Error("Refusing to seed an existing namespace. Use the scheduled handler for updates.");
const directory = mkdtempSync(join(tmpdir(), "satellite-seed-"));
try {
  await refreshSatellites({
    get: async () => null,
    getStream: async (key) => Readable.toWeb(createReadStream(join(directory, key.replace(":", "-")))) as ReadableStream<Uint8Array>,
    put: async (key, value, options) => {
      const path = join(directory, key.replace(":", "-"));
      const file = await open(path, "w");
      try {
        if (typeof value === "string") await file.writeFile(value);
        else for await (const chunk of value) await file.write(chunk);
      } finally { await file.close(); }
      // Pending data stays local during bootstrap.
      if (key.startsWith("pending:")) return;
      console.log(run(["put", key, "--path", path, ...(options?.metadata ? ["--metadata", JSON.stringify(options.metadata)] : [])]));
    },
    delete: async () => {},
  });
} finally {
  rmSync(directory, { recursive: true, force: true });
}
