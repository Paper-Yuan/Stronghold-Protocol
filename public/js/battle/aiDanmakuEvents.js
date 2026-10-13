// public/js/battle/aiDanmakuEvents.js — AI 玩家互动与羁绊/层数名言专属弹幕系统
import { getRoomDanmaku } from '../ui/roomDanmaku.js';
import { pushChatMessage } from '../store.js';
import { indexPieces } from '../ui/gameLogic.js';
import { data } from '../data.js';

// 阵营层数专属名言配置表（一局游戏只触发一次，以角色名：内容发送，专属颜色，无玩家席位前缀）
export const BOND_QUOTE_THRESHOLDS = Object.freeze([
  // 炎国 (yanShip)
  { bondId: 'yanShip', layer: 75, text: '重岳：云晞万象，烟荡孤径，挹罢河汉共伶仃。', color: '#111111' },
  { bondId: 'yanShip', layer: 150, text: '望：月斫冷子，日老残枰，劫灰吹尽送古今。', color: '#ffffff' },
  { bondId: 'yanShip', layer: 200, text: '黍：霞红晚穗，露染尘襟，千秋种我一粟青。', color: '#86efac' },
  { bondId: 'yanShip', layer: 225, text: '令：风起弹剑，雨过濯缨，权倾浊酒澄吾心。', color: '#38bdf8' },
  { bondId: 'yanShip', layer: 300, text: '年：天有洪炉，地生五金，晖冶寒淬照云清。', color: '#ef4444' },
  { bondId: 'yanShip', layer: 375, text: '夕：星藏点雪，月隐晦明，拙山枯水大江行。', color: '#06b6d4' },
  { bondId: 'yanShip', layer: 500, text: '余：三心殊罔，百味清明，炽吾一梦宴生平。', color: '#ff1744' },

  // 拉特兰 (lateranoShip)
  { bondId: 'lateranoShip', layer: 100, text: '空弦——“弦有三种选择，而敌人有三种苦难”', color: '#fef08a' },
  { bondId: 'lateranoShip', layer: 200, text: '能天使——“愿我的弹雨能熄灭你们的苦痛”', color: '#ef4444' },
  { bondId: 'lateranoShip', layer: 350, text: '蕾缪安——“不必介绍，各位的情况我已知悉”', color: '#f472b6' },

  // 叙拉古 (siracusaShip)
  { bondId: 'siracusaShip', layer: 50, text: '伺夜：让我们尽快结束这场闹剧', color: '#2563eb' },
  { bondId: 'siracusaShip', layer: 100, text: '忍冬：洋服剑舞，所谓伊人醉山花', color: '#fef08a' },
  { bondId: 'siracusaShip', layer: 200, text: '铃兰：难得的出战机会，我会好好努力的！', color: '#fde047' },
  { bondId: 'siracusaShip', layer: 300, text: '荒芜拉普兰德：朋友们，别辜负这个夜晚！', color: '#ffffff' },

  // 卡西米尔 (kazimierzShip)
  { bondId: 'kazimierzShip', layer: 150, text: '瑕光——“家训是，“不畏苦暗”！”', color: '#facc15' },
  { bondId: 'kazimierzShip', layer: 225, text: '玛恩纳——“我仍然……听得见那声叹息”', color: '#facc15' },
  { bondId: 'kazimierzShip', layer: 350, text: '耀骑士临光——“太阳啊，请为我颔首吧！”', color: '#facc15' },

  // 阿戈尔 (egirShip)
  { bondId: 'egirShip', layer: 50, text: '深巡：我会拦截海潮，阿戈尔有义务挡在陆地之前', color: '#2563eb' },
  { bondId: 'egirShip', layer: 150, text: '乌尔比安：经受死亡的洗礼，才能生存', color: '#2563eb' },
  { bondId: 'egirShip', layer: 300, text: '浊心斯卡蒂：那么，就请听听这远海的歌吧……', color: '#67e8f9' },

  // 谢拉格 (kjeragShip)
  { bondId: 'kjeragShip', layer: 100, text: '灵知：做好自己的事，其他我来处理', color: '#111111' },
  { bondId: 'kjeragShip', layer: 150, text: '锏：情绪在这里没有意义', color: '#d4a373' },
  { bondId: 'kjeragShip', layer: 225, text: '圣聆初雪：这是群山许诺于我的力量', color: '#e0f2fe' },
  { bondId: 'kjeragShip', layer: 375, text: '凛御银灰：结局已定，只是他们还看不清', color: '#0284c7' },

  // 维多利亚 (victoriaShip)
  { bondId: 'victoriaShip', layer: 75, text: '风笛：我和我的破城矛，来自维多利亚！', color: '#f97316' },
  { bondId: 'victoriaShip', layer: 125, text: '号角：风暴必须摧毁一切障碍', color: '#d4a373' },
  { bondId: 'victoriaShip', layer: 175, text: '焰影苇草：路上的障碍，我会烧穿', color: '#fde047' },
  { bondId: 'victoriaShip', layer: 250, text: '维娜·维多利亚：为了维多利亚！', color: '#facc15' },

  // 萨尔贡 (sargonShip)
  { bondId: 'sargonShip', layer: 50, text: '缇缇：走吧，看看这次的文物能带来什么新的故事', color: '#ffffff' },
  { bondId: 'sargonShip', layer: 150, text: '佩佩：哇，我要把这枚莲花纹章盖在你的脸上！', color: '#eab308' },
  { bondId: 'sargonShip', layer: 250, text: '异客：请让我为您展示，真正优秀的战争兵器会如何表现', color: '#ffffff' },
  { bondId: 'sargonShip', layer: 350, text: '娜仁图亚：砰——太阳被我吞掉啦！', color: '#dc2626' },
]);

export function emitDanmaku({ text, name, seat, color, gradient, noPrefix = false, delayMs = 0 }) {
  const run = () => {
    const msg = {
      playerId: 'ai',
      name: name || '',
      seat: seat ?? 0,
      text,
      color,
      gradient,
      noPrefix,
      at: Date.now(),
    };
    try {
      getRoomDanmaku().show(msg, false);
      pushChatMessage(msg);
    } catch (err) {
      console.warn('[aiDanmaku] emit failed', err);
    }
  };
  if (delayMs > 0 && typeof window !== 'undefined') setTimeout(run, delayMs);
  else run();
}

export function hasAiTeammates(pub) {
  if (!pub) return false;
  // 单人独立模拟下始终支持 AI 互动
  if (pub.mode === 'solo') return true;
  // 联机模式下：只有当房间内确实存在 AI bot 队友时才返回 true
  const players = Array.isArray(pub.players) ? pub.players : [];
  return players.some((p) => p && p.isBot);
}

function getAiPlayers(pub) {
  const list = (pub?.players || []).filter((p) => p && p.isBot);
  if (list.length > 0) return list;
  // 仅在单人独立模拟 (solo) 模式下才使用兜底 AI，在联机模式下只使用真实加入房间的 bot
  if (pub?.mode === 'solo') {
    return [{ playerId: 'ai_fallback', name: 'AI·队友', seat: 1, isBot: true }];
  }
  return [];
}

function getRandomAi(pub) {
  const ais = getAiPlayers(pub);
  if (!ais.length) return null;
  return ais[Math.floor(Math.random() * ais.length)];
}

export function isOperatorOnBoard(priv, targetCharId) {
  if (!priv) return false;
  try {
    const pieces = indexPieces(priv);
    for (const entry of pieces.values()) {
      if (entry.area === 'board' && entry.piece && entry.piece.kind === 'chess') {
        const id = entry.piece.id;
        const rec = data?.lookup ? data.lookup('chess', id) : null;
        if (rec?.charId === targetCharId) return true;
        // 关键干员 ID 兜底
        if (targetCharId === 'char_237_gravel' && (id === 'chess_char_2_12_a' || id === 'chess_char_2_12_b')) return true;
        if (targetCharId === 'char_4064_mlynar' && (id === 'chess_char_5_19_a' || id === 'chess_char_5_19_b')) return true;
        if (targetCharId === 'char_1012_skadi2' && (id === 'chess_char_6_04_a' || id === 'chess_char_6_04_b')) return true;
      }
    }
  } catch {}
  return false;
}

export class AiDanmakuManager {
  constructor() {
    this.triggeredOnce = new Set();
    this.triggeredRounds = new Map(); // round -> Set
    this.lastCheckedLeakRound = -1;
    this.lastCheckedUniteRound = -1;
  }

  reset() {
    this.triggeredOnce.clear();
    this.triggeredRounds.clear();
    this.lastCheckedLeakRound = -1;
    this.lastCheckedUniteRound = -1;
  }

  /**
   * 检查游玩者激活的羁绊、层数及干员配置
   */
  checkBondAndLayerEvents(pub, priv, myId, liveBondLayers = null) {
    if (!pub) return;
    const round = pub.round || 1;

    // 1. 阵营专属层数名言弹幕（一局一次，全场任意玩家满足层数即触发，不论单人还是联机满人）
    const layerMap = new Map(); // bondId -> maxLayers
    // 本地私有 bonds
    for (const b of (priv?.bonds || [])) {
      if (b && typeof b.bondId === 'string') {
        const cur = layerMap.get(b.bondId) || 0;
        layerMap.set(b.bondId, Math.max(cur, Number(b.layers) || 0));
      }
    }
    // 本地实时战斗战斗内 bondLayers
    if (liveBondLayers && typeof liveBondLayers === 'object') {
      for (const [bondId, n] of Object.entries(liveBondLayers)) {
        if (typeof n === 'number') {
          const cur = layerMap.get(bondId) || 0;
          layerMap.set(bondId, Math.max(cur, n));
        }
      }
    }
    // 所有玩家（联机队友）在 pub.players 中的 bonds
    for (const p of (pub.players || [])) {
      for (const b of (p.bonds || [])) {
        if (b && typeof b.bondId === 'string') {
          const cur = layerMap.get(b.bondId) || 0;
          layerMap.set(b.bondId, Math.max(cur, Number(b.layers) || 0));
        }
      }
    }

    for (const item of BOND_QUOTE_THRESHOLDS) {
      const layers = layerMap.get(item.bondId) || 0;
      if (layers >= item.layer) {
        const key = `quote:${item.bondId}:${item.layer}`;
        if (!this.triggeredOnce.has(key)) {
          this.triggeredOnce.add(key);
          emitDanmaku({
            text: item.text,
            color: item.color,
            noPrefix: true,
          });
        }
      }
    }

    // 若场上不存在 AI bot 队友（全真人联机），坚决不触发 AI 特殊互动弹幕
    if (!hasAiTeammates(pub)) return;
    const ais = getAiPlayers(pub);
    if (!ais.length) return;

    // 提取本地活跃羁绊
    const bonds = priv?.bonds || [];
    const activeBondsMap = new Map();
    for (const b of bonds) {
      if (b && b.active && typeof b.bondId === 'string') {
        activeBondsMap.set(b.bondId, b);
      }
    }

    // 2. 炎国达到 6人 / 9人（一回合一次，且弹幕为固定红色）
    const yan = activeBondsMap.get('yanShip');
    if (yan) {
      const count = yan.count ?? 0;
      if (count >= 6) {
        const roundSet = this.triggeredRounds.get(round) || new Set();
        const tier = count >= 9 ? 9 : 6;
        const key = `yan_count_${tier}`;
        if (!roundSet.has(key)) {
          roundSet.add(key);
          this.triggeredRounds.set(round, roundSet);
          const ai = getRandomAi(pub);
          if (ai) {
            const lines = ['？！区区？！', '龙可是...'];
            const text = lines[Math.floor(Math.random() * lines.length)];
            emitDanmaku({
              name: ai.name,
              seat: ai.seat,
              text,
              color: '#ff3b30',
            });
          }
        }
      }
    }

    // 3. 叙拉古盟约达到 6人（一局一次，蓝黑渐变）
    const siracusa = activeBondsMap.get('siracusaShip');
    if (siracusa && (siracusa.count ?? 0) >= 6) {
      const key = 'siracusa_count_6';
      if (!this.triggeredOnce.has(key)) {
        this.triggeredOnce.add(key);
        const ai = getRandomAi(pub);
        const lines = ['罗叙nb', '我的天哪罗叙'];
        const text = lines[Math.floor(Math.random() * lines.length)];
        emitDanmaku({
          name: ai.name,
          seat: ai.seat,
          text,
          gradient: 'linear-gradient(90deg, #3b82f6 0%, #1e1b4b 100%)',
        });
      }
    }

    // 4. 远见和投资人都解锁激活（一局一次）
    const visi = activeBondsMap.get('visiShip');
    const invest = activeBondsMap.get('investShip');
    if (visi && invest) {
      const key = 'combo_visi_invest';
      if (!this.triggeredOnce.has(key)) {
        this.triggeredOnce.add(key);
        const ai = getRandomAi(pub);
        const lines = ['倒转区来了', '倒转？！'];
        const text = lines[Math.floor(Math.random() * lines.length)];
        emitDanmaku({
          name: ai.name,
          seat: ai.seat,
          text,
        });
      }
    }

    // 5. 卡西米尔达到 3人 且有「砾」在场（一局一次）
    const kazimierz = activeBondsMap.get('kazimierzShip');
    if (kazimierz && (kazimierz.count ?? 0) >= 3) {
      if (isOperatorOnBoard(priv, 'char_237_gravel')) {
        const key = 'kazimierz_gravel';
        if (!this.triggeredOnce.has(key)) {
          this.triggeredOnce.add(key);
          const ai = getRandomAi(pub);
          emitDanmaku({
            name: ai.name,
            seat: ai.seat,
            text: 'i砾TV',
          });
        }
      }
    }

    // 6. 卡西米尔达到 6人 且有「玛恩纳」在场（一局一次，全部 AI 发送）
    if (kazimierz && (kazimierz.count ?? 0) >= 6) {
      if (isOperatorOnBoard(priv, 'char_4064_mlynar')) {
        const key = 'kazimierz_mlynar';
        if (!this.triggeredOnce.has(key)) {
          this.triggeredOnce.add(key);
          const ais = getAiPlayers(pub);
          const lines = ['玛头来了！', '玛↑恩↓纳~', '玛头有大'];
          ais.forEach((ai, idx) => {
            const text = lines[Math.floor(Math.random() * lines.length)];
            emitDanmaku({
              name: ai.name,
              seat: ai.seat,
              text,
              delayMs: idx * 300,
            });
          });
        }
      }
    }

    // 7. 阿戈尔达到 5人 且有「浊心斯卡蒂」在场（一局一次，固定海蓝色）
    const egir = activeBondsMap.get('egirShip');
    if (egir && (egir.count ?? 0) >= 5) {
      if (isOperatorOnBoard(priv, 'char_1012_skadi2')) {
        const key = 'egir_skadi2';
        if (!this.triggeredOnce.has(key)) {
          this.triggeredOnce.add(key);
          const ai = getRandomAi(pub);
          emitDanmaku({
            name: ai.name,
            seat: ai.seat,
            text: '我们联合！',
            color: '#00b4d8',
          });
        }
      }
    }
  }

  /**
   * 检查战斗漏怪态势（进入联防阶段时）
   */
  checkBattleLeaks(pub, myId) {
    if (!pub || pub.phase !== 'UNITE' || !hasAiTeammates(pub)) return;
    const round = pub.round || 1;
    if (this.lastCheckedLeakRound === round) return;
    this.lastCheckedLeakRound = round;

    const leakers = Array.isArray(pub?.unite?.leakers) ? pub.unite.leakers : [];
    const playerLeaked = leakers.includes(myId);
    const ais = getAiPlayers(pub);
    if (!ais.length) return;
    const aiLeakers = ais.filter((a) => leakers.includes(a.playerId));
    const aiNonLeakers = ais.filter((a) => !leakers.includes(a.playerId));

    // 场景 1：游玩者和 AI 都漏怪
    if (playerLeaked && aiLeakers.length > 0) {
      const ai = aiLeakers[Math.floor(Math.random() * aiLeakers.length)];
      const lines = ['坏了坏了', '绝望的区', '要死啦'];
      const text = lines[Math.floor(Math.random() * lines.length)];
      emitDanmaku({
        name: ai.name,
        seat: ai.seat,
        text,
        delayMs: 300,
      });
      return;
    }

    // 场景 2：游玩者漏怪而 AI 没漏怪
    if (playerLeaked && aiNonLeakers.length > 0) {
      const ai = aiNonLeakers[Math.floor(Math.random() * aiNonLeakers.length)];
      emitDanmaku({
        name: ai.name,
        seat: ai.seat,
        text: '没关系，兄弟我来兜',
        delayMs: 400,
      });
    }
  }

  /**
   * 检查联防结算（游玩者没漏怪且联防成功时，漏怪的 AI 依次感谢）
   */
  checkUniteSettlement(pub, myId, uniteResult) {
    if (!pub || !hasAiTeammates(pub)) return;
    const round = pub.round || 1;
    if (this.lastCheckedUniteRound === round) return;
    this.lastCheckedUniteRound = round;

    const leakers = Array.isArray(pub?.unite?.leakers) ? pub.unite.leakers : [];
    const playerLeaked = leakers.includes(myId);
    // 游玩者没漏怪
    if (playerLeaked) return;

    const ais = getAiPlayers(pub);
    if (!ais.length) return;
    const aiLeakers = ais.filter((a) => leakers.includes(a.playerId));
    if (aiLeakers.length === 0) return;

    // 判定联防是否成功（所有漏怪被阻击成功，损失为 0 或通关）
    const losses = uniteResult?.losses || {};
    const uniteSuccess = aiLeakers.every((a) => (losses[a.playerId] ?? 0) <= 0);
    if (!uniteSuccess) return;

    const lines = ['兄弟nb', '好兜兄弟', '这把由你来C'];
    aiLeakers.forEach((ai, idx) => {
      const text = lines[Math.floor(Math.random() * lines.length)];
      emitDanmaku({
        name: ai.name,
        seat: ai.seat,
        text,
        delayMs: 500 + idx * 600,
      });
    });
  }
}

export const aiDanmakuEvents = new AiDanmakuManager();
