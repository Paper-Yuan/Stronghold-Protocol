import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AiDanmakuManager, BOND_QUOTE_THRESHOLDS } from '../../public/js/battle/aiDanmakuEvents.js';
import { store } from '../../public/js/store.js';

test('AiDanmakuManager: battle leaks and unite settlement logic', () => {
  const manager = new AiDanmakuManager();
  const myId = 'p_me';
  const pub = {
    round: 2,
    phase: 'UNITE',
    players: [
      { playerId: 'p_me', name: '玩家', seat: 0, isBot: false },
      { playerId: 'bot_1', name: 'AI·1', seat: 1, isBot: true },
      { playerId: 'bot_2', name: 'AI·2', seat: 2, isBot: true },
    ],
    unite: { leakers: ['p_me'] }, // 玩家漏怪，AI 没漏怪
  };

  const msgs = [];
  store.set({ chatMessages: [] });
  // Case 1: 游玩者漏怪而 AI 没漏怪
  manager.checkBattleLeaks(pub, myId);
  const chat1 = store.get().chatMessages;
  assert.equal(chat1.length, 1);
  assert.equal(chat1[0].text, '没关系，兄弟我来兜');

  // Same round won't retrigger leak reaction
  manager.checkBattleLeaks(pub, myId);
  assert.equal(store.get().chatMessages.length, 1);

  // Case 2: 游玩者和 AI 都漏怪
  manager.reset();
  pub.unite.leakers = ['p_me', 'bot_1'];
  manager.checkBattleLeaks(pub, myId);
  const chat2 = store.get().chatMessages;
  assert.equal(chat2.length, 2);
  assert.ok(['坏了坏了', '绝望的区', '要死啦'].includes(chat2[1].text));

  // Case 3: 游玩者没漏怪且联防成功
  manager.reset();
  pub.round = 3;
  pub.unite.leakers = ['bot_1'];
  manager.checkUniteSettlement(pub, myId, { losses: { bot_1: 0 } });
  const chat3 = store.get().chatMessages;
  assert.equal(chat3.length, 3);
  assert.ok(['兄弟nb', '好兜兄弟', '这把由你来C'].includes(chat3[2].text));
});

test('AiDanmakuManager: bond activation and layers/count logic with strict anti-repetition', () => {
  const manager = new AiDanmakuManager();
  const myId = 'p_me';
  const pub = {
    round: 4,
    players: [
      { playerId: 'p_me', name: '玩家', seat: 0, isBot: false },
      { playerId: 'bot_1', name: 'AI·1', seat: 1, isBot: true },
    ],
  };

  store.set({ chatMessages: [] });

  // 1. Inactive bond does NOT trigger even if layers or count meet requirements
  const privInactive = {
    bonds: [{ bondId: 'yanShip', active: false, count: 9, layers: 500 }],
  };
  manager.checkBondAndLayerEvents(pub, privInactive, myId);
  assert.equal(store.get().chatMessages.length, 0, 'inactive bond never triggers');

  // 2. Active 炎国 (yanShip) count 6 -> AI sends ？！区区？！ or 龙可是... (red)
  const privActive = {
    bonds: [{ bondId: 'yanShip', active: true, count: 6, layers: 75 }],
  };
  manager.checkBondAndLayerEvents(pub, privActive, myId);
  const msgs = store.get().chatMessages;
  assert.ok(msgs.length >= 2, 'triggered count and 75 layer quote');
  const countMsg = msgs.find((m) => m.text === '？！区区？！' || m.text === '龙可是...');
  assert.ok(countMsg, 'yan count message found');
  assert.equal(countMsg.color, '#ff3b30');

  // Layer 75 quote: 重岳
  const q75 = msgs.find((m) => m.text.includes('重岳：'));
  assert.ok(q75);
  assert.equal(q75.color, '#111111');
  assert.equal(q75.noPrefix, true);

  // 3. Deactivate bond and reactivate in next tick: already triggered layer 75 MUST NOT retrigger
  const lenBefore = store.get().chatMessages.length;
  // deactive
  manager.checkBondAndLayerEvents(pub, privInactive, myId);
  assert.equal(store.get().chatMessages.length, lenBefore);
  // reactive at 75 layers
  manager.checkBondAndLayerEvents(pub, privActive, myId);
  assert.equal(store.get().chatMessages.length, lenBefore, 'already triggered 75 layer quote will never retrigger');

  // 4. Synergies: 远见 + 投资人
  store.set({ chatMessages: [] });
  const privCombo = {
    bonds: [
      { bondId: 'visiShip', active: true, count: 2, layers: 0 },
      { bondId: 'investShip', active: true, count: 2, layers: 0 },
    ],
  };
  manager.checkBondAndLayerEvents(pub, privCombo, myId);
  const comboMsgs = store.get().chatMessages;
  assert.equal(comboMsgs.length, 1);
  assert.ok(['倒转区来了', '倒转？！'].includes(comboMsgs[0].text));

  // 5. 叙拉古 6人
  store.set({ chatMessages: [] });
  const privSiracusa = {
    bonds: [{ bondId: 'siracusaShip', active: true, count: 6, layers: 0 }],
  };
  manager.checkBondAndLayerEvents(pub, privSiracusa, myId);
  const siraMsgs = store.get().chatMessages;
  assert.equal(siraMsgs.length, 1);
  assert.ok(['罗叙nb', '我的天哪罗叙'].includes(siraMsgs[0].text));
  assert.ok(siraMsgs[0].gradient.includes('gradient'));

  // 6. 卡西米尔 3人 + 砾
  store.set({ chatMessages: [] });
  const privKazimierz = {
    bonds: [{ bondId: 'kazimierzShip', active: true, count: 3, layers: 150 }],
    board: [{ uid: 1, id: 'chess_char_2_12_a', row: 1, col: 1, kind: 'chess' }],
  };
  manager.checkBondAndLayerEvents(pub, privKazimierz, myId);
  const kaziMsgs = store.get().chatMessages;
  assert.ok(kaziMsgs.some((m) => m.text === 'i砾TV'));
  assert.ok(kaziMsgs.some((m) => m.text.includes('瑕光——')));

  // 7. 卡西米尔 6人 + 玛恩纳 (所有 AI 发送)
  store.set({ chatMessages: [] });
  const privMlynar = {
    bonds: [{ bondId: 'kazimierzShip', active: true, count: 6, layers: 225 }],
    board: [{ uid: 2, id: 'chess_char_5_19_a', row: 1, col: 2, kind: 'chess' }],
  };
  manager.checkBondAndLayerEvents(pub, privMlynar, myId);
  const mlynarMsgs = store.get().chatMessages;
  assert.ok(mlynarMsgs.some((m) => ['玛头来了！', '玛↑恩↓纳~', '玛头有大'].includes(m.text)));
  assert.ok(mlynarMsgs.some((m) => m.text.includes('玛恩纳——')));

  // 8. 阿戈尔 5人 + 浊心斯卡蒂 (固定海蓝色)
  store.set({ chatMessages: [] });
  const privEgir = {
    bonds: [{ bondId: 'egirShip', active: true, count: 5, layers: 300 }],
    board: [{ uid: 3, id: 'chess_char_6_04_a', row: 1, col: 3, kind: 'chess' }],
  };
  manager.checkBondAndLayerEvents(pub, privEgir, myId);
  const egirMsgs = store.get().chatMessages;
  const unionMsg = egirMsgs.find((m) => m.text === '我们联合！');
  assert.ok(unionMsg);
  assert.equal(unionMsg.color, '#00b4d8');
  assert.ok(egirMsgs.some((m) => m.text.includes('浊心斯卡蒂：')));
});

test('BOND_QUOTE_THRESHOLDS table covers all requested factions and layers', () => {
  const factions = new Set(BOND_QUOTE_THRESHOLDS.map((q) => q.bondId));
  assert.ok(factions.has('yanShip'));
  assert.ok(factions.has('lateranoShip'));
  assert.ok(factions.has('siracusaShip'));
  assert.ok(factions.has('kazimierzShip'));
  assert.ok(factions.has('egirShip'));
  assert.ok(factions.has('kjeragShip'));
  assert.ok(factions.has('victoriaShip'));
  assert.ok(factions.has('sargonShip'));

  // yanShip has 7 characters
  const yanQuotes = BOND_QUOTE_THRESHOLDS.filter((q) => q.bondId === 'yanShip');
  assert.equal(yanQuotes.length, 7);

  // victoriaShip has 4 characters
  const vicQuotes = BOND_QUOTE_THRESHOLDS.filter((q) => q.bondId === 'victoriaShip');
  assert.equal(vicQuotes.length, 4);

  // sargonShip has 4 characters
  const sargonQuotes = BOND_QUOTE_THRESHOLDS.filter((q) => q.bondId === 'sargonShip');
  assert.equal(sargonQuotes.length, 4);
});
