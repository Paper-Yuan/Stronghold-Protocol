export const hasRunningMatch = s => !!s?.session?.entered && !!s.room?.inMatch;
export const hasBundledAssets = () => true;

export function installEntryPreload({ store }) {
  store.patch('session', { preloadRequired: false, preloadReady: true });
  return () => {};
}
