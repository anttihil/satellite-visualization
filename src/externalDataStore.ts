export const externalDataStore = {
    positions: [] as number[][],
    hasNewData: false,
    worker: null as Worker | null,
    init() {
        if (this.worker) this.destroy();

        this.worker = new Worker(
            new URL('./worker.ts', import.meta.url), {type: "module"}
        );

        this.worker.onmessage = (ev)=> {
                const d = ev.data; 
                switch (d.message) {
                    case "started": {
                        console.log(`worker ${d.id} started`);
                        break;
                    }
                    case "data": {
                        externalDataStore.positions = d.positions;
                        externalDataStore.hasNewData = true;
                        break;
                    }
                    case "ended": {
                        console.log(`worker ${d.id} ended`)
                        this.worker?.terminate()
                        break;
                    }
                }    
            }

        this.worker.postMessage("start");
    },
    
    destroy() {
        if (this.worker) {
            this.worker.postMessage('end');
        }
        this.positions = [];
        this.hasNewData = false;

    }
    
}