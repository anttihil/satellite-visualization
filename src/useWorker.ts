import { useEffect, useMemo } from "react";


export function useWorker(url: string) {


    const worker = new Worker(
        new URL('./worker.ts', import.meta.url), {type: "module"}
    )

    worker.
}