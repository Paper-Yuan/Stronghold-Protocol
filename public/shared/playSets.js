// shared/playSets.js — the markers that separate a play set's cards from the official data, in one place.
//
// Two play sets are merged into data/*.json next to the official records, not shipped as separate directories:
//   炸惊模拟 (ZHAJING, 拓展模式): chess records carrying a `zhajing` marker (true **or false** — the imported snapshot
//     also has `zhajing: false` copies of chest_zj_13/22/91 in another role) or the chess_zj_ / chess_chen3_ id family;
//     bonds (`zjOnly`), bands (`zjOnly`) and items (`zjOnly`) of that set.
//   湮灭模拟 (ANNIHILATION, 湮灭专属 mod): chess records carrying `annihilation: true`, bonds (`annOnly`) and items
//     (`annOnly`, the two mods' 每 100 层 reward equipment).
// …and one mode-scoped item family lives here for the same reason: 超限模拟's 词条 (solo_infinite / coop_infinite) hands
// out [万色悠滞之核] (`olOnly: true`, docs/research/25-overlimit-items.json). It has no shop record at all
// (`shopExcluded`), so it must stay out of every "official only" list exactly like the two play sets' cards — the golden
// corpus' equipment cursors are the reason this rule is shared (an extra official EQUIP shifts every scenario).
// Every "official only" list — the golden corpus' scenario generators, the content/data tests, the version keying audit —
// has to apply the same rule (handoff/ZHAJING-SPLIT-PLAN-2026-10-28.md §2; the 湮灭 line, 2026-10-29; the 超限 item line,
// 2026-10-31). Before this module each list spelled the markers out again, and the 湮灭 data of 2026-10-31 was missed by
// every filter that only knew `zjOnly` / `'zhajing' in c`.

/**
 * A chess record of 炸惊模拟's imported roster. `zhajing: true` is that roster's marker, but the imported snapshot also
 * carries `zhajing: false` copies (chest_zj_13/22/91) and `chess_chen3_*` has no `zhajing` field at all, so the marker
 * plus the id family is the rule tools/build-data.mjs itself uses to spot an imported record (isImportedChess).
 * @param {object} rec a data/chess.json record
 * @param {string} [id] the record's id (defaults to `rec.chessId`)
 */
export const isPlaySetChess = (rec, id = rec?.chessId) => !!rec
  && (Object.hasOwn(rec, 'zhajing') || /^chess_(zj_|chen3_)/.test(String(id ?? '')));

/** A chess record of 湮灭模拟: `annihilation: true` (tools/build-data.mjs), `visible: false` in every official mode. */
export const isAnnihilationChess = (rec) => !!rec && rec.annihilation === true;

/** An official chess record: neither play set's card. */
export const isOfficialChess = (rec, id) => !!rec && !isPlaySetChess(rec, id) && !isAnnihilationChess(rec);

/** An official equipment / bond / band record: not a play set's `zjOnly` / `annOnly` card, nor 超限模拟's `olOnly` item. */
export const isOfficialItem = (rec) => !!rec && rec.zjOnly !== true && rec.annOnly !== true && rec.olOnly !== true;
export const isOfficialBond = (rec) => !!rec && rec.zjOnly !== true && rec.annOnly !== true && rec.olOnly !== true;
export const isOfficialBand = (rec) => !!rec && rec.zjOnly !== true && rec.olOnly !== true;
