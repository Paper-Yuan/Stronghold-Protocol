import { useState, useEffect } from '../../vendor/hooks.module.js';
import { preloadEngine } from '../resources/preload.js';

export { preloadEngine } from '../resources/preload.js';

export function usePreloadState() {
  const [, setTick] = useState(0);
  useEffect(() => { const off = preloadEngine.subscribe(() => setTick(n => n + 1)); setTick(n => n + 1); return off; }, []);
  return preloadEngine;
}

export function PreloadPill({ onClick }) {
  return null;
}

export function PreloadModal({ open, onClose, required = false, onContinue }) {
  return null;
}
