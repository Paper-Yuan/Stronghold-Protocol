// server/modRegistry.js — 模组管理器的**登记册**（DESIGN §28.47）：一个状态文件，记录**这个管理器装过什么**、
// 以及操作者把哪些包启用 / 禁用了；外加把它作用到一份已加载集合上的**纯函数**一半。
//
// 这一层存在的理由只有一条，但它是一条硬规矩：**被操作者禁用的包，必须和一个装载失败的包一样"彻底不在"**
// —— 没有 hook、没有订阅、没有面板、没有字节进数据叠加层 —— 而文件**留在磁盘上**，一条 `enable` 就回来。
// 「包照旧加载、只是它的效果不在」是本仓库反复判过死刑的形状（见 server/index.js 里那条注释：那会让运维
// 以为自己有一道不存在的闸门，而它的内容却已经并进了游戏数据）。
//
// 状态文件 `mod-registry.json` 的位置是**状态根**（`server/modModules.js` 的 `stateRootFor`，即 `<repo>/var`
// 或 `SP_STATE_DIR`）—— 与 server.modules 写的是同一棵树，**永远不在** `workshop/` 包根里：那里是加载器
// 扫描的地方，一个状态文件放进去会被当成一个包（这正是「管理器自己的东西不许混进被管理的东西」）。
//
// 文件形状（`version` 现在是 1）：
//
//   { "version": 1,
//     "packs": { "<包 id>": { "state": "enabled" | "disabled",
//                             "installedAt": "<ISO 日期>",       // 管理器在 import 时记下的
//                             "source": "<文件名|目录名>",        // 字节从哪来
//                             "digest": "<sha256>",             // 回执点名的 pack.json 摘要
//                             "previous": { "digest": "<sha256>", "backup": "<相对留底目录>" } } } }
//
// **不在登记册里的包 = 启用**。这是故意选的方向：装一个包就该立刻能用（所有现存的安装方式都依赖这一点），
// 「禁用」是操作者的一次**明确动作**。反过来的话，这个文件一旦丢了（或换了机器）所有包都会静默消失。
//
// 这个文件是**唯一事实**：CLI、编辑器、服务器都读它，谁都不留第二份副本。

import fs from 'node:fs';
import path from 'node:path';
import { PACK_ID_RE } from '../shared/workshop.js';
import { stateRootFor } from './modModules.js';

/** 登记册文件在状态根里的名字。 */
export const MOD_REGISTRY_FILE = 'mod-registry.json';
const STATES = Object.freeze(['enabled', 'disabled']);
const REGISTRY_VERSION = 1;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isIsoDate = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

/**
 * 校验一条登记项：不认识的、形状坏的、可疑的**全部按名字丢掉**（调用方负责报出来），
 * 所以一份手改过或更老的状态文件**永远不会半生效** —— 要么整条读进来，要么整条不要，且理由具名。
 *
 * 这里有一道**安全闸**，不是形状洁癖：`previous.backup` 是**会被拼进路径**的（`cliRollback` 用它算留底目录）。
 * 一份手改过的登记册如果写着 `"backup": "../../somewhere"` 或一个绝对路径，回滚就会去 rename **工坊根之外**
 * 的东西。所以这一格**只接受包内相对的留底目录**：含 `..` 的、或绝对路径的，**整格丢掉并具名报出**。
 * 与 `tools/workshop-pack.mjs` 的 `PACK_ID_RE` 闸同一条纪律 —— 路径不许由外部数据拼出来。
 * @returns {{ entry: { state: 'enabled'|'disabled', installedAt?: string, source?: string, digest?: string,
 *                      previous?: { digest: string, backup: string } } | null, issues: string[] }}
 */
export function normalizePackEntry(raw) {
  const issues = [];
  if (!isObj(raw)) return { entry: null, issues: ['the entry is not a JSON object'] };
  const state = raw.state === undefined ? 'enabled' : raw.state;
  if (!STATES.includes(state)) { issues.push(`"state": ${JSON.stringify(raw.state)} is not one of ${STATES.join(' / ')}`); return { entry: null, issues }; }
  const entry = { state };
  if (raw.installedAt !== undefined) {
    if (!isIsoDate(raw.installedAt)) issues.push(`"installedAt": ${JSON.stringify(raw.installedAt)} is not a date (dropped)`);
    else entry.installedAt = raw.installedAt;
  }
  for (const key of ['source', 'digest']) {
    if (raw[key] !== undefined) {
      if (typeof raw[key] !== 'string' || !raw[key].trim()) issues.push(`"${key}": not a non-empty string (dropped)`);
      else entry[key] = raw[key].trim();
    }
  }
  if (raw.previous !== undefined) {
    const p = raw.previous;
    if (!isObj(p) || typeof p.digest !== 'string' || !p.digest.trim() || typeof p.backup !== 'string' || !p.backup.trim()
      || p.backup.includes('..') || path.isAbsolute(p.backup)) {
      issues.push('"previous": must be { digest, backup } with a pack-relative backup directory (dropped)');
    } else entry.previous = { digest: p.digest.trim(), backup: p.backup.trim() };
  }
  return { entry, issues };
}

/**
 * 校验一整份登记册文件。不认识的包 id（不是合法 id / 不是对象）按名字丢掉。
 * @returns {{ registry: { version: number, packs: Record<string, object> }, issues: string[] }}
 */
export function normalizeRegistry(raw) {
  const issues = [];
  const packs = {};
  if (raw === undefined || raw === null) return { registry: { version: REGISTRY_VERSION, packs }, issues };
  if (!isObj(raw)) { issues.push('the registry file is not a JSON object'); return { registry: { version: REGISTRY_VERSION, packs }, issues }; }
  if (raw.version !== undefined && raw.version !== REGISTRY_VERSION) issues.push(`"version": ${JSON.stringify(raw.version)} is not ${REGISTRY_VERSION} (read anyway)`);
  const rawPacks = isObj(raw.packs) ? raw.packs : {};
  if (!isObj(raw.packs) && raw.packs !== undefined) issues.push('"packs" is not a JSON object (read as empty)');
  for (const [id, entry] of Object.entries(rawPacks)) {
    if (!PACK_ID_RE.test(id)) { issues.push(`"${id}" is not a pack id (dropped)`); continue; }
    const n = normalizePackEntry(entry);
    issues.push(...n.issues.map((i) => `${id}: ${i}`));
    if (n.entry) packs[id] = n.entry;
  }
  return { registry: { version: REGISTRY_VERSION, packs }, issues };
}

/** 登记册文件的绝对路径。 */
export function registryPath(stateRoot) { return path.join(stateRoot, MOD_REGISTRY_FILE); }

/** 读登记册（文件不在 = 空的；坏条目丢掉并返回）。 */
export function readModRegistry(stateRoot, { log = null } = {}) {
  const file = registryPath(stateRoot);
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    if (e.code !== 'ENOENT') log?.warn?.(`[mod-registry] ${MOD_REGISTRY_FILE} unreadable (${e.message}) — starting from an empty registry`);
    return { version: REGISTRY_VERSION, packs: {} };
  }
  const { registry, issues } = normalizeRegistry(raw);
  for (const i of issues) log?.warn?.(`[mod-registry] ${i}`);
  return registry;
}

/** 原子地写登记册（同目录内的临时文件 + rename —— 半个文件比没有文件更坏）。 */
export function writeModRegistry(stateRoot, registry) {
  fs.mkdirSync(stateRoot, { recursive: true });
  const file = registryPath(stateRoot);
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(tmp, `${JSON.stringify(registry, null, 2)}\n`);
  fs.renameSync(tmp, file);
  return registry;
}

/** 一次改动：读 → 改 → 写。返回新的登记册。 */
function mutate(stateRoot, id, fn) {
  const registry = readModRegistry(stateRoot);
  const entry = registry.packs[id] || { state: 'enabled' };
  const next = fn(entry);
  if (next) registry.packs[id] = next; else delete registry.packs[id];
  writeModRegistry(stateRoot, registry);
  return registry;
}

/** 启用一个包（操作者的重开；记录留着）。 */
export function enablePack(stateRoot, id) { return mutate(stateRoot, id, (e) => ({ ...e, state: 'enabled' })); }
/** 禁用一个包：文件留在磁盘上，服务器不再装载它。 */
export function disablePack(stateRoot, id) { return mutate(stateRoot, id, (e) => ({ ...e, state: 'disabled' })); }
/** 记下管理器装了什么（由 import 那条路调）。 */
export function recordInstall(stateRoot, id, { source, digest, installedAt = new Date().toISOString() } = {}) {
  return mutate(stateRoot, id, (e) => ({ ...e, state: e.state || 'enabled', installedAt, ...(source ? { source } : {}), ...(digest ? { digest } : {}) }));
}
/** 记下被升级顶掉的那一版（回滚目标）。 */
export function recordBackup(stateRoot, id, { digest, backup }) {
  return mutate(stateRoot, id, (e) => ({ ...e, previous: { digest, backup } }));
}
/** 丢掉一个包的记录（uninstall 那条路；文件由调用方处理）。 */
export function forgetPack(stateRoot, id) { return mutate(stateRoot, id, () => null); }

/**
 * **纯函数**那一半：把登记册作用到一份已加载的包集合上。
 *
 * 被禁用的包在任何载荷（server 模块、kits、面板、素材、数据叠加层）算出来**之前**就离开集合 —— 所以一个被
 * 禁用的包没有任何 hook、没有任何订阅、没有任何字节，与一个装载失败的包**完全一样**，区别只有文件还在盘上。
 * @param {{ id: string, where?: string, dir?: string }[]} packs loadWorkshop 的 `packs`
 * @param {{ version: number, packs: Record<string, object> }} registry
 * @returns {{ packs: unknown[], disabled: { id: string, where: string, reason: string }[] }}
 */
export function applyModRegistry(packs, registry) {
  const list = Array.isArray(packs) ? packs : [];
  const out = [];
  const disabled = [];
  for (const p of list) {
    const entry = registry?.packs?.[p.id];
    if (entry?.state === 'disabled') {
      disabled.push({ id: p.id, where: p.where || p.dir || `workshop/${p.id}/`, reason: 'disabled by the operator (mod-registry)' });
      continue;
    }
    out.push(p);
  }
  return { packs: out, disabled };
}
