import { net } from '../net.js';

export const hasRunningMatch = s => !!s?.session?.entered && !!s.room?.inMatch;
export const hasBundledAssets = () => false;
export function installEntryPreload({ store, engine }) {
  engine.require(true);engine.bindNetwork(net);
  store.patch('session', { preloadRequired: true, preloadReady: false });
  const sync = () => {
    if (store.get().session.preloadReady !== engine.entryReady)
      store.patch('session', { preloadReady: engine.entryReady });
  };
  const off = engine.subscribe(sync);
  engine.checkEntry();
  return off;
}
