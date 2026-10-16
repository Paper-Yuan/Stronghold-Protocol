// workshop/ave-mujica/meta/main.mjs — 颂乐人偶/Ave Mujica 的**休整期侧**逻辑（`pack.json.server.meta`，DESIGN §29）。
//
// 原来这份代码住在引擎的 `server/sim/mod/ave-mujica/ave-mujica.js`（引擎专属的 mod 挂载点）。现在它就在包里，通过
// `registry`（受限注册表）注册自己的盟约 tier / 特质 / 策略处理器 —— 引擎的辅助函数从 `registry.api` 取（meta 模块
// 只许 import 本包文件，不许 import 引擎），通报的键写在 pack.json 的 `server.meta.registers` 里（那既是白名单，也是
// 房间摘要闸门的输入）。
//
// 注册（每局一份 registry 副本上）：
//   bond:aveMujica          1/2/3/4/5 人数 tier（刷新发放 / 休整期末层数 / 每回合资金 / 部署位当帧 / 翻倍）
//   garrison:AVEMUJICA_REFRESH_LAYERS  海铃 <刷新时> 自身所属已激活盟约层数 +layers
//   garrison:AVEMUJICA_PREP_REWARD     若麦 <进入休整期时> 成员<3 → +资金；否则 免费刷新
//   band:band_wuyouyoumeng   策略【无忧梦呓】每回合首次获得颂乐人偶干员 → 发一名随机干员

export function registerMeta(registry) {
  const { num, bondOrder } = registry.api;
  const BOND = 'aveMujica';
  const BOND_KEY = 'act2autochess_bond_eff_avemujica';

  /** 派发时从 ctx.gd（匹配的合并数据）读参数 —— 不在 boot 注册时读 sim 侧 gameData()。 */
  const params = (ctx) => {
    const rec = ctx.gd && typeof ctx.gd.bond === 'function' ? ctx.gd.bond(BOND) : null;
    const buff = rec && Array.isArray(rec.buffs) ? rec.buffs.find((b) => b && (b.bbStr?.key === BOND_KEY || b.key === BOND_KEY)) : null;
    return buff ? { ...(buff.bb || {}) } : {};
  };
  const tierOf = (ctx) => { const b = typeof ctx.bond === 'function' ? ctx.bond(BOND) : null; return b && Number.isInteger(b.tier) ? b.tier : 0; };
  const dblOf = (ctx) => (tierOf(ctx) >= 5 ? 2 : 1);
  const memberCount = (ctx) => { const b = typeof ctx.bond === 'function' ? ctx.bond(BOND) : null; return b && Number.isInteger(b.count) ? b.count : 0; };

  registry.bond(BOND, {
    // 1人: 每刷新9次（5人时每4次），获得1名阶级不超过调度中心的随机颂乐人偶干员
    onRefresh(ctx) {
      if (tierOf(ctx) < 1) return;
      const p = params(ctx);
      const every = Math.max(1, Math.floor(num(p.refresh_every, 9) / dblOf(ctx)));
      const next = ctx.counter('avemujica:refresh') + 1;
      ctx.setCounter('avemujica:refresh', next);
      if (next % every !== 0) return;
      const tier = Math.max(1, ctx.shopLevel());
      const id = ctx.rollChess({ bond: BOND, maxTier: tier });
      if (id) ctx.grantChess(id, { source: 'bond:aveMujica' });
    },
    // 2人: 休整期结束时，场上每有1名颂乐人偶成员，使已激活的盟约层数 +1（5人时 +2）
    onPrepEnd(ctx) {
      if (tierOf(ctx) < 2) return;
      const p = params(ctx);
      const per = Math.max(1, Math.floor(num(p.prep_layer, 1) * dblOf(ctx)));
      const n = memberCount(ctx) * per;
      if (!(n > 0)) return;
      for (const b of bondOrder(ctx)) if (ctx.bondActive(b)) ctx.addLayers(b, n, { requireActive: false });
    },
    // 3人: 进入休整期（新轮开始）时，每有1名颂乐人偶成员，额外获得 prep_fund 资金；该效果最多生效 2 名成员
    // （5人盟约效果翻倍 → 单次数额 ×2）
    onRoundStart(ctx) {
      if (tierOf(ctx) < 3) return;
      const p = params(ctx);
      const fund = Math.max(1, Math.floor(num(p.prep_fund, 1) * dblOf(ctx)));
      const n = Math.min(2, memberCount(ctx)); // 「该效果最多生效2名干员」：每回合最多计 2 名成员
      if (n > 0) ctx.addFunds(n * fund, 'bond:aveMujica');
    },
    // 4人: 可部署干员数量上限 +1（5人盟约效果翻倍 → +2）。固定值，不随成员数变化。改为在编队变化当帧即时结算
    // —— 走 recompute 派发的 onBondChange（摆放 / 撤回成员都覆盖），不再等到下个休整期开始时才生效。
    onBondChange(ctx, ev) {
      if (ev && ev.bondId && ev.bondId !== BOND) return;
      const p = params(ctx);
      const want = tierOf(ctx) >= 4 ? Math.max(1, Math.floor(num(p.deploy_slot, 1) * dblOf(ctx))) : 0;
      const prev = ctx.counter('avemujica:deploy');
      if (want !== prev) {
        ctx.addDeployCap(want - prev);
        ctx.setCounter('avemujica:deploy', want);
      }
    },
  });

  // 海铃: <刷新时>使自身所属已激活盟约层数 +layers（max_count = 该干员每回合的触发上限）
  registry.garrison('AVEMUJICA_REFRESH_LAYERS', {
    run(ctx) {
      const src = ctx.source || {};
      const piece = src.piece;
      const bb = src.bb || {};
      if (!piece || !piece.id) return;
      const rec = ctx.gd.chess(piece.id);
      const n = Math.max(1, Math.floor(num(bb.layers, 1)));
      if (!rec || !Array.isArray(rec.bonds)) return;
      // 「（最多N次）」: a per-piece counter of THIS round (PlayerState.pieceRoundCount, the official 拉普兰德 pattern):
      // the 6th / 12th manual refresh of a round stops adding layers, and the next round starts from 0 again.
      const cap = Math.max(0, Math.floor(num(bb.max_count, 0)));
      if (cap > 0 && Number.isInteger(piece.uid) && piece.uid > 0 && typeof ctx.incPieceCounter === 'function') {
        if (ctx.incPieceCounter(piece.uid, 'avemujica:refresh') > cap) return;
      }
      for (const b of rec.bonds) if (ctx.bondActive(b)) ctx.addLayers(b, n, { requireActive: false });
    },
  });

  // 若麦: <进入休整期时>成员数 <check_count → +fund 资金；否则 免费刷新 refresh 次
  registry.garrison('AVEMUJICA_PREP_REWARD', {
    run(ctx) {
      const src = ctx.source || {};
      const bb = src.bb || {};
      const count = typeof ctx.bondCount === 'function' ? ctx.bondCount(BOND) : 0;
      const check = Math.max(1, Math.floor(num(bb.check_count, 3)));
      if (count < check) {
        const v = Math.max(1, Math.floor(num(bb.fund, 1)));
        ctx.addFunds(v, 'bond:aveMujica');
      } else {
        const f = Math.max(1, Math.floor(num(bb.refresh, 1)));
        if (typeof ctx.grantFreeRefresh === 'function') ctx.grantFreeRefresh(f);
      }
    },
  });

  // 策略【无忧梦呓】（band_wuyouyoumeng，图标干员丰川祥子，初始生命21）: 每回合首次获得<颂乐人偶>干员时，
  // 获得1位阶级等于调度中心的随机干员。数据见 bands.json + effects.json。
  registry.band('band_wuyouyoumeng', {
    onGain(ctx, ev) {
      const KEY = 'band:wuyouyoumeng:used';
      const BUFF = 'band_wuyouyoumeng_first_gain_bond_gain_random_char';
      // 每回合首次：本回合已触发过则不再触发
      if (ctx.counter(KEY) === ctx.round) return;
      const piece = ev && ev.piece;
      if (!piece || piece.kind !== 'chess') return;
      const rec = typeof ctx.gd.chess === 'function' ? ctx.gd.chess(piece.id) : null;
      if (!rec || !Array.isArray(rec.bonds) || !rec.bonds.includes(BOND)) return;
      // 读参数（未来可调 count/bond；默认获得 1 位）
      const buff = Array.isArray(ctx.band && ctx.band.buffs)
        ? ctx.band.buffs.find((b) => b && b.key === BUFF) : null;
      const count = Math.max(1, Math.floor(num(buff && buff.bb && buff.bb.count, 1) || 1));
      ctx.setCounter(KEY, ctx.round);
      const tier = Math.max(1, ctx.shopLevel());
      for (let k = 0; k < count; k++) {
        const id = ctx.rollChess({ maxTier: tier });
        if (id) ctx.grantChess(id, { source: 'band' });
      }
    },
  });
}
