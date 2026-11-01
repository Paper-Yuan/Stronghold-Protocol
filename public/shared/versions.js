// shared/versions.js — the official versions this remake can play (DESIGN §35.22, docs/DATA.md "Official versions
// (M0)"). Pure ESM, no Node APIs: the server, the browser and the tools read the same table.
//
//   id         the official activity id (activity_table AUTOCHESS_SEASON key), plus `@<versionInfoDict id>` for a
//              sub-version (autoChessData.versionInfoDict: V1_1 from 2025-11-14 16:00, V1_2 from 2025-11-25 16:00,
//              V2_1 from 2026-03-14 16:00, V2_2 from 2026-03-27 16:00); the id without a suffix is the season's final
//              sub-version
//   season     the activity id the build reads (`config.season` of the built data)
//   family     'covenant' (盟约, AUTOCHESS_SEASON): the build adapters and the rule switches of one engine
//   label      a msgid (public/i18n/*.json): the maintainer's names by period (2026-10-22) — 第一期 is act1autochess, the
//              official 「卫戍协议：盟约」 上半期活动, 第二期 act2autochess, its 下半期活动; each period's 上半 / 下半 are its
//              sub-versions V1_1 / V1_2 and V2_1 / V2_2. Not the official activity names [ASSUMED translations]
//   roomModes  the room modes the version offers (the plain ones: `solo` / `coop`; an infinite room is judged as its base
//              mode — baseRoomMode below, the only place that mapping lives)
//   dir        where the built data lives under data/: '' for the default (data/*.json, unchanged), otherwise
//              versions/<slug>/ — lowercase and safe on every OS (no '@'); a path or a file name uses versionSlug()
//
// The default is a code constant, never a server setting: data, rooms and logs without a version mean act2autochess.
// tools/versions/<slug>.mjs holds each version's build profile (pins, adapters, expected counts). M0 built the data;
// M2 tools bootstrap a selected version per process/worker (DESIGN §35.22.7–§35.22.9). Since M1 (DESIGN §35.23) a
// server serves the versions it enables, plays their rooms in version match hosts, and the page loads their data
// (server/versions.js, public/js/versions.js). Nothing set enables every id here; SP_VERSIONS or the `versions`
// option narrows the list.

import { N_ } from './i18n.js';
import { isInfiniteMode, isSoloRoomMode } from './infiniteMode.js';

/** The version every record without one means (today's 第二期下半: act2autochess V2_2). */
export const DEFAULT_VERSION = 'act2autochess';

/**
 * @typedef {{ id: string, season: string, family: 'covenant', label: string, roomModes: readonly string[], dir: string }} OfficialVersion
 */

/** @type {readonly OfficialVersion[]} */
export const VERSIONS = Object.freeze([
  { id: 'act2autochess', season: 'act2autochess', family: 'covenant', label: N_('第二期下半'), roomModes: ['solo', 'coop'], dir: '' },
  { id: 'act2autochess@V2_1', season: 'act2autochess', family: 'covenant', label: N_('第二期上半'), roomModes: ['solo', 'coop'], dir: 'versions/act2autochess-v2_1/' },
  { id: 'act1autochess', season: 'act1autochess', family: 'covenant', label: N_('第一期下半'), roomModes: ['solo', 'coop'], dir: 'versions/act1autochess/' },
  { id: 'act1autochess@V1_1', season: 'act1autochess', family: 'covenant', label: N_('第一期上半'), roomModes: ['solo', 'coop'], dir: 'versions/act1autochess-v1_1/' },
].map((v) => /** @type {OfficialVersion} */ (Object.freeze({ ...v, roomModes: Object.freeze(v.roomModes) }))));

/**
 * The registry entry of a version id.
 * @param {unknown} id
 * @returns {OfficialVersion | null}
 */
export function versionById(id) {
  return VERSIONS.find((v) => v.id === id) || null;
}

/**
 * The file-system name of a version: the last segment of its dir, or its id for the default ('act2autochess').
 * @param {OfficialVersion} entry
 * @returns {string}
 */
export function versionSlug(entry) {
  if (!entry.dir) return entry.id;
  const parts = entry.dir.split('/').filter(Boolean);
  return parts[parts.length - 1];
}

/**
 * 一个房间模式在「版本适用性」上按哪一类算：超限模拟（solo_infinite / coop_infinite）沿用同方阵的普通模式
 * （solo / coop）。**整个仓库只有这一处映射**，服务端（server/lobby.js `offered`）与页面
 * （public/js/ui/versionPicker.js）都走它。
 *
 * 为什么需要：版本数据只有普通模式，超限是叠在同一套版本内容上的外层规则，
 * data/versions/<slug>/config.json 里也只有 mode_single_* / mode_multi_*。不归一的话，
 * 超限房（room.mode = solo_infinite / coop_infinite）会被判成「该版本不支持当前的模拟方式」，
 * 而 match 层明明能用（test/match/infinite-versions.test.js 四个版本 × 超限全绿）。
 * 注册表的 roomModes 仍然只写 solo / coop：那是版本提供的能力，房间模式只是它的用法。
 * @param {string|undefined|null} mode
 * @returns {string}
 */
export function baseRoomMode(mode) {
  if (isSoloRoomMode(mode)) return 'solo';
  return isInfiniteMode(mode) ? 'coop' : mode;
}

/**
 * The version a loaded data set belongs to: config.version.id of a non-default build, else the default.
 * @param {{ config?: { version?: { id?: unknown } } } | null | undefined} data
 * @returns {string}
 */
export function versionOfData(data) {
  const id = data?.config?.version?.id;
  return typeof id === 'string' ? id : DEFAULT_VERSION;
}
