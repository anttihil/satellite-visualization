type Status = {
  fetchedAt: string | null;
  count: number;
  error: string | null;
  refreshSuspended: boolean;
};

let status: Status = { fetchedAt: null, count: 0, error: null, refreshSuspended: false };
const listeners = new Set<() => void>();
export const satelliteDataStatus = {
  getSnapshot: () => status,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  update(next: Partial<Status>) {
    status = { ...status, ...next };
    listeners.forEach((listener) => listener());
  },
};
