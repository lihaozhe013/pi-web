// Stand-in for React's useSyncExternalStore that reads the snapshot eagerly,
// so external-store hooks can run outside a render.
export function useSyncExternalStore(_subscribe, getSnapshot) {
  return getSnapshot();
}
