// tools/versions/act2autochess.mjs — build profile of the default version, 第二期下半: 盟约·下半 (act2autochess) in its
// final state V2_2 (docs/DATA.md "Official versions (M0)", DESIGN §35.22). It is today's build, verbatim: the master
// tables of Kengxxiao/ArknightsGameData (.cache/gamedata/), the research in docs/research/, the 下半-measured tables of
// tools/build-data.mjs, and no config.version — data/*.json stays byte-identical (test/versions-default-guard.test.js).

export default Object.freeze({
  id: 'act2autochess',
  season: 'act2autochess',
  pins: null,                    // master, cached in .cache/gamedata/
  adapters: Object.freeze([]),
  research: null,                // docs/research/
  tables: 'default',             // stock / shopDraft / tacticDraft / bountyDrafts as measured on 下半
  config: Object.freeze({ hiddenCore: Object.freeze({ single: 350, multi: 1200 }) }), // no rules: no config.version
  // Measured counts of the files this version builds. bonds 23 → 30 and bands 40 → 42 are the two play sets: 炸惊模拟's 5
  // bonds + its 2 `zjOnly` strategies (docs/research/18-zhaijing-content.json) and 湮灭专属 mod's 2 `annOnly` bonds
  // (rhodesShip / kazdelShip, docs/research/20-annihilation-mods.json) — merged into the default build only.
  // `visibleNonDiy` stays 112: every 炸惊 chess record is `visible: false`, so the official shop pools keep exactly the
  // operators they had (test/match/zhajing-isolation.test.js asserts it).
  expect: Object.freeze({ bonds: 30, bands: 42, visibleNonDiy: 112, triggerDeviations: 'default' }),
});
