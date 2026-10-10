#!/usr/bin/env node
// tools/patch-endless.mjs — 就地给已有的 data/config.json 注入无尽模式条目（幂等）。
//
// tools/build-data.mjs 会从官方数据重新生成 data/config.json（其中已包含无尽模式）；本脚本用于
// 不重新跑完整构建、直接给现成的 data/config.json 打上无尽模式。改完后记得跑
// `node tools/sync-static-web.mjs` 把 data/ 同步到 public/data/。
//
// 无尽模式有四档底难度（标准/险境/绝境/终极），各生成一份
// `mode_{single,multi}_endless_{funny,normal,hard,abyss}`；旧的无底 `mode_*_endless` 会被清除。
//
// 用法：node tools/patch-endless.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEndlessModes, ENDLESS_BANS } from './endlessMode.mjs';
import { PICK_DIFFICULTIES } from '../shared/constants.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(ROOT, 'data', 'config.json');

const cfg = JSON.parse(readFileSync(file, 'utf8'));
if (!cfg.modes || typeof cfg.modes !== 'object') throw new Error('config.json: modes missing');
const endless = buildEndlessModes(cfg.modes);
// 早期版本只有一个无底的 mode_*_endless 条目：现在按底难度拆成四份，清掉旧条目免得留下死数据。
for (const id of Object.keys(cfg.modes)) if (/^mode_(single|multi)_endless$/.test(id)) delete cfg.modes[id];
Object.assign(cfg.modes, endless);
// 保留一个无尽家族的整体档位（供任何直接查难度名的调用方兜底）；每个 `ENDLESS_<底难度>` 实际按自己的底难度取表
// （server/match/gamedata.js bans()）。build-data.mjs 写入的也是同一个值。
if (!cfg.bans || typeof cfg.bans !== 'object') cfg.bans = {};
cfg.bans.ENDLESS = { ...ENDLESS_BANS };

writeFileSync(file, JSON.stringify(cfg) + '\n');
const ids = Object.keys(cfg.modes).filter((k) => /^mode_(single|multi)_endless(_|$)/.test(k));
console.log(`patched ${file}`);
console.log(`endless modes (${ids.length}, ${PICK_DIFFICULTIES.length} bases × solo/multi): ${ids.join(', ')}`);
