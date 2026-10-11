// shared/bandBonds.js — the bonds a strategy (band) is built around, read from the band's own data (DESIGN §21.26).
// Pure (no Node APIs). tools/build-data.mjs runs it once per band and writes the result as data/bands.json `bondIds` —
// the one field both sides read: the server (match/gamedata.js GameData.bandBondIds → bot.js botPickBand never takes a
// band whose bond the mode switches off) and the client (screens/bandDraft.js marks such a band 本局禁用, gameLogic
// bandOffBonds). A band is tied to:
//   * the bonds its text names in <…> — the official note "在<X>部分干员缺席时体验可能不完整" names that bond too; a
//     bracketed name that is no bond (<寻呼模块>, <画卷>, <鸭爵> …) adds nothing;
//   * the bond ids and bond pools its effect's blackboards name (bb / bbStr string values, comma lists included):
//     克莱门莎's `bond_id` egirShip, 玛恩纳's `bond` kazimierzShip, 潘格尼尼's `pool` pool_char_later → choices.json
//     `pools[pool].bond` lateranoShip; a pool without a bond adds nothing.

const isObj = (v) => !!v && typeof v === 'object';

/**
 * Bond ids a band is tied to, in the order of `bonds`.
 * @param {{ desc?: string, buffs?: Array<{ bb?: object, bbStr?: object }> }|null|undefined} band bands.json record
 * @param {{ bonds: Record<string, { name?: string }>|Array<{ bondId: string, name?: string }>,
 *   pools?: Record<string, { bond?: string }>|null }} ctx bonds.json (map or list) and choices.json `pools`
 * @returns {string[]}
 */
export function bandBondIds(band, { bonds, pools = null } = {}) {
  const list = Array.isArray(bonds) ? bonds.filter(isObj).map((b) => [b.bondId, b]) : Object.entries(isObj(bonds) ? bonds : {});
  const ids = list.map(([id]) => id).filter((id) => typeof id === 'string');
  if (!isObj(band) || !ids.length) return [];
  const known = new Set(ids);
  const byName = new Map(list.filter(([, b]) => isObj(b) && typeof b.name === 'string').map(([id, b]) => [b.name, id]));
  const found = new Set();
  for (const [, name] of String(band.desc || '').matchAll(/<([^<>]+)>/g)) {
    const id = byName.get(name.trim());
    if (id) found.add(id);
  }
  const poolOf = (k) => (isObj(pools) && Object.hasOwn(pools, k) && isObj(pools[k]) ? pools[k] : null);
  for (const buff of Array.isArray(band.buffs) ? band.buffs : []) {
    for (const board of [buff && buff.bb, buff && buff.bbStr]) {
      if (!isObj(board)) continue;
      for (const v of Object.values(board)) {
        if (typeof v !== 'string') continue;
        for (const part of v.split(',').map((s) => s.trim())) {
          if (known.has(part)) found.add(part);
          const pool = poolOf(part);
          if (pool && typeof pool.bond === 'string' && known.has(pool.bond)) found.add(pool.bond);
        }
      }
    }
  }
  return ids.filter((id) => found.has(id));
}
