// shared/enabled.js — 包的启用声明 (`pack.json.enabled`, DESIGN §28.50).
// (i18n-ignore-file: 工坊作者层的校验与推导文本 —— 给作者、编辑器与 AI 读的规则说明（编辑器有自己的中英词典，见 docs/EDITOR.md），不是客户端界面文案)
//
// 这一格补的缺口：**装好 ≠ 生效**。`loadWorkshop` 今天读 `workshop/` 下的每个目录，只要 `pack.json`
// 校验得过、有贡献项，这个包就**参与**装载 —— 它的内容并进数据、它的钩子装上。于是「我想先把这个包留着，
// 但现在不要它生效」在这台机器上**没有表达方式**：要么删目录（丢包），要么留着（生效）。删除目录与停用是两件
// 不同的事，把前者当后者用，代价是重新下载、重新校验、重新对齐房间摘要。
//
// 另一条产品线（Android APK 壳，见 issue #7）用 `filesDir/workshop/enabled.json` 这个**旁挂文件**表达同一件事。
// 那个形态在这里不可取：它把「这个包生不生效」从 `pack.json` 里拿走，于是 (a) 包的身份哈希不含它 ——
// 同一个包在两台机器上摘要相同而行为不同；(b) 编辑器校验一个包时看不到它；(c) 它是一份**第二个真相源**，
// 而 `pack.json` 已经是第一个。所以这一格声明在 `pack.json` 里，**进身份哈希**，装载期与编辑期读同一份。
//
// 判据（本文件就是这条判据的唯一一份）：
//   1. **只有布尔**。`true` = 参与（缺省，保持今天每一个包一个字节都不变）；`false` = 装载期跳过。
//      没有第三种值：字符串 `"false"`、数字 `0`、`null` 一律 `ENABLED_BAD_SHAPE` 点名拒绝 —— 一个被
//      JS 真值表放行的假布尔，正是这一层到处在消灭的静默失效。
//   2. **缺省 = 引擎今天的行为**。不写 `enabled` 的包与今天逐字相同。写了 `true` 的包同样逐字相同。
//   3. **不是贡献项**。一个只写 `"enabled": true` 的包照旧 `EMPTY_PACK`（它没有带来任何东西），
//      而 `"enabled": false` 的包**不进入**已加载集合 —— 它不报 `EMPTY_PACK`，因为它被显式关掉了，
//      报那个码会让作者以为包坏了。
//   4. **跳过必须响亮**。被跳过的包进 `loadWorkshop` 的 `errors`（`ENABLED_FALSE`，点名包 + 声明位置），
//      与「目录里有个坏包」同一个裁剪点、同一份报告 —— 一个静默消失的包比一个报错的包更难查。
//
// 这一格**不**是热更新（`docs/design/mod-layer.md:684` 的「No hot reload」不受影响）：`enabled` 在
// **装载期**读一次，改它要重启，与今天改 `pack.json` 任何一格同一条规矩。

/** 具名失败的统一形状（`ok: false` 是**字面量**，好让下面那条 `@returns` 联合类型收得住）。
 *  @type {(error: string, detail: string) => { ok: false, error: string, detail: string }} */
const fail = (error, detail) => ({ ok: false, error, detail });

/** 拒绝码：`enabled` 这一格的具名失败（`PACK_UNKNOWN_FIELD` 之外只此一个）。 */
export const ENABLED_BAD_SHAPE = 'ENABLED_BAD_SHAPE';

/** 装载期跳过一个被显式关掉的包时用的码（`loadWorkshop` 的 `errors` 条目）。 */
export const ENABLED_SKIP_CODE = 'ENABLED_FALSE';

/** 这一格在 `pack.json` 里的键名（`PACK_FIELDS` 与 `test/modSurface.test.js` 账本都用它）。 */
export const ENABLED_FIELD = 'enabled';

/**
 * 读 `pack.json.enabled`。
 *
 * @param {unknown} raw 作者写的那一格（`undefined` = 没写）
 * @returns {{ ok: true, value: boolean, declared: boolean } | { ok: false, error: string, detail: string }}
 *   `declared` = 作者显式写了这一格（区分「写了 true」与「没写」，只给报告用，行为相同）
 */
export function parseEnabledDecl(raw) {
  if (raw === undefined) return { ok: true, value: true, declared: false };
  if (typeof raw !== 'boolean') {
    const shown = raw === null ? 'null' : Array.isArray(raw) ? 'an array' : typeof raw;
    return fail(ENABLED_BAD_SHAPE, `"enabled" must be a boolean (true = this pack participates, false = skipped at load time) — got ${shown}. `
      + 'Only a real boolean is read: a truthy non-boolean would be a silent disagreement between what the author wrote and what the loader does');
  }
  return { ok: true, value: raw, declared: true };
}

/**
 * 这个包是否参与装载。**纯判定**，供 `loadWorkshop` 与编辑器共用。
 *
 * @param {Record<string, any>} manifest 已归一化的 `pack.json`
 * @returns {{ enabled: boolean, reason: string|null }} `reason` 非空 = 被显式关掉，报告里点名用
 */
export function packEnabled(manifest) {
  const parsed = parseEnabledDecl(manifest && manifest.enabled);
  if (parsed.ok !== true) {
    const bad = /** @type {{ ok: false, error: string, detail: string }} */ (parsed);
    return { enabled: false, reason: `${bad.error}: ${bad.detail}` };
  }
  if (!parsed.value) {
    return {
      enabled: false,
      reason: `${ENABLED_SKIP_CODE}: pack.json sets "enabled": false — this pack is installed but not participating (delete the directory to uninstall; set true to bring it back)`,
    };
  }
  return { enabled: true, reason: null };
}
