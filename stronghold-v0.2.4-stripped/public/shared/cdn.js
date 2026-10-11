/** Rewrite only root-relative asset URLs. Absolute URLs stay intact, including manifests already rewritten by a server. */
export function rewriteAssetPaths(value, base) {
  if (!base || value === null || typeof value !== 'object') return value;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && entry.startsWith('/assets/')) value[key] = base + entry;
    else if (entry !== null && typeof entry === 'object') rewriteAssetPaths(entry, base);
  }
  return value;
}

/** Route static game JSON directly to the data CDN; local art and generated preload manifests stay on the game origin. */
export function dataUrl(url, base) {
  if (!base || typeof url !== 'string') return url;
  const match = url.match(/^\/data\/([^/?#]+\.json)(?:[?#]|$)/);
  if (!match || ['local-assets.json', 'resource-manifest.json'].includes(match[1].toLowerCase())) return url;
  return base.replace(/\/+$/, '') + url;
}
