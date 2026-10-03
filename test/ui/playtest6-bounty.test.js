// User playtest #6 item 4 (workstream WC), the client side: a 悬赏决策 card shows how many battles its enemies come for
// the way the official card does — "下场作战" / "两场作战" in blue, a multi-round card's "每场" in red (activity_table
// effectDesc rich text) — instead of plain text. A real draft (server/match/choices.js generateDraft → cardView), through
// m.public's normalisation (ui/gameLogic.js normalizeSp), resolved by the overlay (ui/choiceOverlay.js resolveSpCard).
// The server side is in test/match/playtest6-matchflow.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA } from '../match/harness.js';
import { GameData } from '../../server/match/gamedata.js';
import { generateDraft, cardView, bountyCard } from '../../server/match/choices.js';
import { createRng } from '../../server/sim/rng.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// the browser data store reads the real data files from disk
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { data } = await import('../../public/js/data.js');
const { resolveSpCard } = await import('../../public/js/ui/choiceOverlay.js');
const { normalizeSp } = await import('../../public/js/ui/gameLogic.js');
const { parseRichText } = await import('../../public/js/ui/richText.js');

test('#4 the draft overlay shows each bounty card\'s battles in the official colours (blue 下场 / 两场; a multi-round card reads 两场 too)', async () => {
  await data.loadAll('choices', 'effects', 'items', 'assets', 'enemies');
  const gd = new GameData(DATA, 'mode_multi_hard');
  // the official multi-round cards: two battles, in the two-battle cards' blue (the user's call after playtest #6)
  const MULTI = new Set(DATA.choices.cards.bounty.filter((c) => c.multiRound).map((c) => c.effectId));
  const seen = new Set();
  // R3 offers the two-battle cards, R9 the next-battle ones (player feedback #2: the official drafts); no draft offers a
  // multi-round card any more, so one (教鞭's 法术大师A2·多轮战术特训) goes through the same card view on its own
  const multiCard = bountyCard(gd, DATA.choices.cards.bounty.find((c) => c.effectId === 'enemyeffect_2'));
  for (let seed = 1; seed <= 80 && seen.size < 3; seed++) {
    const round = seed % 2 ? 3 : 9;
    const d = generateDraft(gd, createRng(seed * 977 + 3), round, { stageId: 'act2autochess_m02' });
    assert.equal(d.family, 'bounty', `co-op 绝境 R${round} is a bounty draft`);
    const cards = seed === 1 ? [...d.cards.slice(0, 5), { ...multiCard, idx: 5, family: 'bounty' }] : d.cards;
    const sp = normalizeSp({ family: d.family, cards: cards.map(cardView), order: ['p_0'], turn: 'p_0', picks: {}, taken: {} }, [{ playerId: 'p_0' }]);
    for (const card of sp.cards) {
      const view = resolveSpCard(card, sp.family);
      const segs = parseRichText(view.desc).filter((s) => s.text);
      const styled = (cls) => segs.filter((s) => s.cls.includes(cls)).map((s) => s.text).join('|');
      assert.ok(!styled('ba.vdown').includes('每场'), `${card.id} ${view.name}: no red 每场 (${view.desc})`);
      if (card.rounds === 2) assert.ok(styled('ba.vup').includes('两场作战'), `${card.id} ${view.name}: blue 两场作战 (${view.desc})`);
      else assert.match(styled('ba.vup'), /下场(作战|战斗)/, `${card.id} ${view.name}: blue 下场 (${view.desc})`);
      seen.add(MULTI.has(card.id) ? 'multi' : card.rounds);
    }
  }
  assert.deepEqual([...seen].map(String).sort(), ['1', '2', 'multi'], 'drafts with 1-, 2-battle and multi-round cards were checked');
});
