export const hasRunningMatch = s => !!s?.session?.entered && !!s.room?.inMatch;
export const hasBundledAssets = () => true;

export function installEntryPreload({ store, engine }) {
  store.patch('session', { preloadRequired: false, preloadReady: true });
  // 进入时默认静默开启素材预载，提前预热 CDN 静态资源与 Cache Storage
  if (engine && typeof engine.start === 'function') {
    engine.start().catch(() => {});
  }
  return () => {};
}
