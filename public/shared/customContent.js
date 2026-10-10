// shared/customContent.js — Custom Content & Mod Pack Overlay Merger.
// Provides pure data manipulation: overlay merging, DIY operator stripping, and bond indexing.

export const CUSTOM_SECTIONS = ['records', 'chess', 'tokens', 'variants', 'bands', 'items', 'skins'];

/**
 * Strips operators that are in the Mod pack from DIY candidate pool and active slots.
 * Prevents double-fielding of operators as both public chess and DIY stand-ins.
 * @param {any} diyState
 * @param {Array<{ charId: string }>} packOperators
 */
export function stripPackOperators(diyState, packOperators = []) {
  if (!diyState || !packOperators || !packOperators.length) return diyState;
  const bannedIds = new Set(packOperators.map(op => typeof op === 'string' ? op : op.charId).filter(Boolean));
  if (!bannedIds.size) return diyState;

  const filteredOwned = (diyState.ownedPool || []).filter(id => !bannedIds.has(id));
  let modified = false;

  const cleanedSlots = (diyState.slots || []).map((slot) => {
    if (slot && bannedIds.has(slot.charId)) {
      modified = true;
      return null;
    }
    return slot;
  });

  return {
    ...diyState,
    ownedPool: filteredOwned,
    slots: cleanedSlots,
    wasAdjusted: modified
  };
}

/**
 * Merges custom content overlay into runtime data without mutating official disk files.
 * @param {Record<string, any>} baseData Official JSON data (e.g. data/records.json)
 * @param {Record<string, any>} overlayData Pack JSON data
 * @returns {Record<string, any>} Merged shallow copy
 */
export function mergeCustomContent(baseData = {}, overlayData = {}) {
  if (!overlayData || typeof overlayData !== 'object') return baseData;
  const result = { ...baseData };

  for (const [key, val] of Object.entries(overlayData)) {
    if (Array.isArray(val) && Array.isArray(result[key])) {
      result[key] = [...result[key], ...val];
    } else if (val && typeof val === 'object' && result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = { ...result[key], ...val };
    } else {
      result[key] = val;
    }
  }

  return result;
}
