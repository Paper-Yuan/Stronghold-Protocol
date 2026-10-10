// server/mod/catalogStore.js — the mod catalog the game server aggregates and serves
// at /mods/index.json (CF_MOD_TRI_PLAN.md §0.3: catalog endpoint = game server).
// Storage: server/.mod-cache/catalog.json (runtime state, gitignored dir).

import { promises as fsp } from 'node:fs';
import path from 'node:path';

export const CATALOG_VERSION = 1;

export function catalogPathFor(cacheRoot) {
  return path.join(cacheRoot, 'catalog.json');
}

/** Read the catalog; a missing or corrupt file reads as an empty catalog (never throws). */
export async function readCatalog(cacheRoot) {
  try {
    const doc = JSON.parse(await fsp.readFile(catalogPathFor(cacheRoot), 'utf8'));
    return {
      version: typeof doc.version === 'number' ? doc.version : CATALOG_VERSION,
      packs: Array.isArray(doc.packs) ? doc.packs : [],
    };
  } catch {
    return { version: CATALOG_VERSION, packs: [] };
  }
}

export async function writeCatalog(cacheRoot, catalog) {
  await fsp.mkdir(cacheRoot, { recursive: true });
  const doc = { version: CATALOG_VERSION, packs: catalog.packs ?? [] };
  await fsp.writeFile(catalogPathFor(cacheRoot), JSON.stringify(doc, null, 2));
  return doc;
}

/** Insert or replace one entry by id, keeping the list sorted by id (stable output). */
export async function upsertPack(cacheRoot, entry) {
  const catalog = await readCatalog(cacheRoot);
  const packs = catalog.packs.filter((p) => p.id !== entry.id);
  packs.push(entry);
  packs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return writeCatalog(cacheRoot, { version: catalog.version, packs });
}

/** Remove one entry by id (unpublish). Returns true when something was removed. */
export async function removePack(cacheRoot, id) {
  const catalog = await readCatalog(cacheRoot);
  const packs = catalog.packs.filter((p) => p.id !== id);
  if (packs.length === catalog.packs.length) return false;
  await writeCatalog(cacheRoot, { version: catalog.version, packs });
  return true;
}
