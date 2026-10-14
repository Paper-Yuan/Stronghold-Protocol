// shared/formNames.js — **第一方形态名**的只读快照（`public/js/render/units.js` 的 `FORMS` 里已经有哪几个形态名）。
//
// 为什么需要它，而不是干脆把 `FORMS` 本身搬进 shared：`FORMS` 的**值**是 clip 集（`roles` 里几十条 clip 名、`via`
// 与 `index` 这类渲染器内部语义），它是浏览器渲染器的家当；而加载器与校验器只需要回答一个问题 ——
// 「这个包声明的形态名，跟第一方那一个撞了没有」。把整张 `FORMS` 搬过来会把渲染器的细节变成 ABI。
//
// 于是这里只镜像**名字**，并且镜像这件事有守卫：
//   * 生成：`npm run forms:names`（`tools/build-form-names.mjs`，从 `FORMS` 真身读出来）；
//   * 校验：`test/packForms.test.js` 把这里的每一格与 `FORMS` 逐条比对（少一个、多一个、拼错都红）。
//
// 消费点只有一处：`shared/workshop.js` 的 `parseFormsDecl` —— 一个包不许声明与第一方同名的形态
// （`FORMS_FIRST_PARTY_OVERLAP`）。理由见 docs/design/mod-layer.md §28.29：第一方优先是**合并规则**，
// 而「声明了却不生效」正是这一层要消灭的静默失败，所以它在形状层就被点名拒绝，不是悄悄丢掉。
//
// 本文件是**生成物**：不要手改，改 `tools/build-form-names.mjs` 后重跑。目录不由脚本扫，直接 `npm run forms:names`。

/**
 * 第一方 `FORMS` 的「spine id → 形态名列表」（已排序，便于比对）。
 * 形态名带 `_` 前缀的（转译基底的 `translator_*`）只在这里出现，包不许占用。
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const FIRST_PARTY_FORM_NAMES = Object.freeze({
  char_1023_ghost2:    Object.freeze(['doll']),
  char_4016_kazema:    Object.freeze(['doll']),
  enemy_10081_mpplai:  Object.freeze(['translator_fuchou', 'translator_shushi', 'translator_youling']),
  enemy_1040_bombd:    Object.freeze(['bombed']),
  enemy_1116_liprr:    Object.freeze(['liberty', 'warning']),
  enemy_1116_liprr_2:  Object.freeze(['liberty', 'warning']),
  enemy_1118_lidbox_2: Object.freeze(['liberty', 'warning']),
  enemy_1119_vofsd:    Object.freeze(['liberty', 'warning']),
  enemy_1121_lifbos:   Object.freeze(['liberty', 'warning']),
  enemy_1121_lifbos_2: Object.freeze(['liberty', 'warning']),
  enemy_1172_dugago:   Object.freeze(['fly', 'stone']),
  enemy_1172_dugago_2: Object.freeze(['fly', 'stone']),
  enemy_1288_duskls:   Object.freeze(['husk', 'revived']),
  enemy_1288_duskls_2: Object.freeze(['husk', 'revived']),
  enemy_1292_duskld:   Object.freeze(['husk', 'revived']),
  enemy_1512_mcmstr:   Object.freeze(['form2', 'reborn']),
  enemy_1516_jakill:   Object.freeze(['form2', 'reborn']),
  enemy_1517_xi:       Object.freeze(['form2', 'reborn']),
  enemy_1525_blkswb:   Object.freeze(['form2', 'reborn']),
  enemy_1535_wlfmster: Object.freeze(['form2', 'reborn']),
  enemy_1539_reid:     Object.freeze(['form2', 'reborn']),
  enemy_2025_syufo:    Object.freeze(['crawl']),
  enemy_9008_acbunn:   Object.freeze(['revealed']),
  enemy_9010_acpupp:   Object.freeze(['husk', 'revived']),
});

/**
 * 一个 spine id 上第一方形态名的集合（`FIRST_PARTY_FORM_NAMES` 的查询面）。
 * @param {string} spineId
 * @returns {ReadonlySet<string>} 没有第一方形态时是空集，不是 `undefined`（调用点不必再写守卫）
 */
export function firstPartyFormNames(spineId) {
  const list = FIRST_PARTY_FORM_NAMES[spineId];
  return new Set(Array.isArray(list) ? list : []);
}
