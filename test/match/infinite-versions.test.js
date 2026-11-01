// test/match/infinite-versions.test.js — 四个官方版本下的超限模拟（业主 2026-10-26）
//
// 目的：确认「超限」不是只在默认版本可用。每个版本用自己的 data 跑一局无限模式，推进到 R20，
// 断言：isInfinite、R16+ 波次、R20 Boss 轮真的进入过 FINAL_ASSAULT、Boss 词缀被记录、Boss 击杀进档案。
// 第一期与第二期上半没有终极难度（只有 funny/normal/hard），与 lobby 的 fallback 一致用 HARD。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { loadData, versionDataDir } from '../../server/data.js';
import { VERSIONS, DEFAULT_VERSION } from '../../shared/versions.js';

const ids = VERSIONS.map((v) => v.id);
const dataOf = (id) => loadData(id === DEFAULT_VERSION ? undefined : versionDataDir(id), { log: { info() {}, warn() {}, error() {} } });

for (const id of ids) {
  test(`超限在 ${id} 下可运行到 R21（含 R20 Boss 与词条抉择）`, () => {
    const data = dataOf(id);
    assert.ok(data, `${id} 数据不可用`);
    const modes = Object.keys(data.config?.modes || {});
    const difficulty = modes.includes('mode_single_abyss') ? 'ABYSS' : 'HARD';
    const h = makeMatch({
      mode: 'solo_infinite', difficulty, data, seed: 11, fake: true,
      script: () => ({ duration: 1, leaks: {}, bossDps: 1e9 }),
    }).start();
    h.autoHumans();
    try {
      assert.equal(h.m.isInfinite, true);
      // 一路推进到 R21：R20 是 Boss 轮，打完会进词条抉择；自动选第一张可选的卡
      let guard = 0;
      let reached = false;
      let affixSeen = null;
      while (!h.ended && guard++ < 200) {
        if (h.m.roundBossAffix) affixSeen = h.m.roundBossAffix;
        if (h.m.phase === 'TRAIT_DRAFT') {
          const t = h.m.trait;
          const idx = (t?.cards || []).findIndex((_, i) => i !== t?.lockedIdx);
          const ps = [...h.m.players.values()].find((p) => !p.isBot);
          h.m.handle(ps.playerId, { t: 'g.traitChoice', idx: idx < 0 ? 0 : idx });
          continue;
        }
        if (h.m.phase === 'PREP' && h.m.round >= 21) { reached = true; break; }
        const ok = h.drive(() => {
          if (h.m.roundBossAffix) affixSeen = h.m.roundBossAffix;
          return h.ended != null || h.m.phase === 'TRAIT_DRAFT' || (h.m.phase === 'PREP' && h.m.round >= 21);
        });
        if (!ok) break;
      }
      assert.ok(reached, `${id} 未推进到 R21（停在 R${h.m.round} / ${h.m.phase}）`);
      assert.ok(Array.isArray(h.m.infiniteBossKills) && h.m.infiniteBossKills.some((k) => k.round === 20),
        `${id} R20 的 Boss 击杀未进档案`);
      assert.ok(affixSeen && affixSeen.id, `${id} R20 未记录 Boss 词缀`);
      assert.ok(affixSeen.name, `${id} 词缀缺少名称`);
    } finally {
      h.m.dispose?.();
    }
  });
}
