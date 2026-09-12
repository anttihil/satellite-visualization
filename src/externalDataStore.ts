import {
  BYTES_PER_FLOAT,
  HEADER_BYTES,
  HEADER_INTS,
  MAX_SATS,
  STRIDE_FLOATS,
} from "./consts";

export const externalDataStore = {
  buffer: null as SharedArrayBuffer | null,
  headerInts: null as Int32Array | null,
  positions: null as Float32Array | null,
  // Index-aligned with the slots in `positions`, so a picked index maps to an ID.
  satIds: [] as string[],
  worker: null as Worker | null,
  init() {
    if (this.worker) this.destroy();

    const totalBytes =
      HEADER_BYTES + MAX_SATS * STRIDE_FLOATS * BYTES_PER_FLOAT;

    this.buffer = new SharedArrayBuffer(totalBytes);
    this.headerInts = new Int32Array(this.buffer, 0, HEADER_INTS);
    this.positions = new Float32Array(this.buffer, HEADER_BYTES);

    this.worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });

    this.worker.onmessage = (ev) => {
      const d = ev.data;
      switch (d.message) {
        case "started": {
          externalDataStore.satIds = d.satIds;
          console.info(`worker ${d.id} started, ${d.satIds.length} satellites`);
          break;
        }
        case "ended": {
          console.info(`worker ${d.id} ended`);
          this.worker?.terminate();
          break;
        }
      }
    };

    this.worker.postMessage({ message: "start", sab: this.buffer });
  },

  destroy() {
    if (this.worker) {
      this.worker.postMessage({ message: "end" });
    }
    this.positions = null;
    this.satIds = [];
  },
};
