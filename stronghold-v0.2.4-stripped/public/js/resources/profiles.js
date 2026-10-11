// Preload profiles use only files from the current, content-hashed resource manifest.
export function profileFiles(manifest, profile, assets = null, storedDiy = null) {
  const files = manifest.files;
  if (profile === 'full') return files;
  const extra = new Set();
  const add = node => {
    if (typeof node === 'string') extra.add(node);
    else if (node && typeof node === 'object') for (const value of Object.values(node)) add(value);
  };
  const picks = storedDiy?.picks || storedDiy;
  if (picks && typeof picks === 'object' && !Array.isArray(picks)) {
    for (const pick of Object.values(picks)) {
      const charId = typeof pick === 'string' ? pick : pick?.charId;
      if (typeof charId !== 'string' || !Object.hasOwn(assets?.chars || {}, charId)) continue;
      const char = assets.chars[charId];
      add(char?.portrait); add(char?.portraitE2); add(char?.spine);
      for (const skin of Object.values(char?.skins || {})) add(skin?.spine);
    }
  }
  return files.filter(f => extra.has(f.url) ||
    (f.tier === 1 && !f.url.includes('/guide/') && !f.url.includes('/audio/voice/') &&
      (!f.url.includes('/audio/bgm/') || /(?:title|lobby)\./.test(f.url))));
}
