// workshop/rimbilliton/meta/main.mjs — 雷姆必拓 mod 的**休整期侧**逻辑（`pack.json.server.meta`，DESIGN §29）。
//
// 原来这份代码住在引擎的 `server/sim/mod/rimbilliton/rimbilliton.js`。现在它就在包里，通过受限注册表把自己接进
// 官方对局逻辑；引擎辅助函数从 `registry.api` 取（meta 模块只许 import 本包文件），通报的键写在 pack.json 的
// `server.meta.registers`。
//
// 注册：
//   band:band_kaituo                            开拓大地（首次激活 <bond> 盟约时立即发精锐干员）
//   garrison:SERVER_GAIN_PIONEER_HOLDER          予愿安洁莉娜 <获得N名开拓心干员>
//   garrison:SERVER_GRANT_NO_REDEPLOY_CHAR      暴行 <上场战斗未陷入再部署 → 发干员>
//   garrison:SERVER_ADD_ACT_BOND_LAYER_BY_BOARD_BOND_CHAR  蜜莓 <场上每名不同雷姆必拓成员使已激活层数+N>

export function registerMeta(registry) {
  const { num, ids, bondOrder, chessOnBoard, metaBonds } = registry.api;

  // 开拓大地 (band_kaituo): 首次激活 <bond> 盟约（成员数跨过激活阈值）时，立即获得 count 名阶级等于调度中心的精锐化
  // <bond> 干员（「首次」 = once per match）。「立即」= 激活那个动作发生的瞬间就发放：引擎在 recompute 侦测到盟约由
  // 未激活转激活后派发 onBondActivate（摆位放上第 N 名成员即得，合成 / 加层激活同样覆盖），不等休整期结束、更不是下回合。
  //
  // 参数在派发时从 ctx.gd（匹配的合并数据，含 pack 补丁）读取 —— 不能在注册时读 sim 侧 gameData()（server/data.js
  // getData 只读原始 data/*.json，不合并 pack）。
  const KAITUO_DEFAULT = { count: 1, bond: 'rimBilliton' };
  const kaituoParams = (ctx) => {
    const band = ctx.gd && typeof ctx.gd.band === 'function' ? ctx.gd.band('band_kaituo') : null;
    const buff = band && Array.isArray(band.buffs) ? band.buffs.find((b) => b && b.key === 'first_activate_bond_gain_golden_bond_char') : null;
    if (!buff) return KAITUO_DEFAULT;
    const p = { ...(buff.bb || {}), ...(buff.bbStr || {}) };
    return { count: Math.max(1, num(p.count, 1)), bond: p.bond || KAITUO_DEFAULT.bond };
  };
  const kaituoHandler = () => {
    const grant = (ctx) => {
      // 幂等：先标记再发放 —— 发放触发获得时效果（onGain → 加层 → onLayers 递归）会重入本函数
      if (ctx.counter('band:kaituo:done') > 0) return;
      ctx.setCounter('band:kaituo:done', 1);
      const p = kaituoParams(ctx);
      const tier = Math.max(1, ctx.shopLevel());
      for (let k = 0; k < p.count; k++) {
        // 优先精确阶级（「阶级等于调度中心」）；池中该阶级无可发副本时回退到 ≤ 调度中心阶级
        const id = ctx.rollChess({ bond: p.bond, tier, filter: (x) => !!ctx.gd.goldenIdOf(x) })
          || ctx.rollChess({ bond: p.bond, maxTier: tier, filter: (x) => !!ctx.gd.goldenIdOf(x) });
        if (id) ctx.grantChess(id, { golden: true, source: 'band' });
      }
    };
    return {
      // 激活瞬间发放：recompute 侦测到 <bond> 盟约 active 由假转真（摆位 / 加层 / 合成等任何激活路径）后派发本事件。
      onBondActivate(ctx, ev) {
        const p = kaituoParams(ctx);
        if (!p.bond || !ev || ev.bondId !== p.bond) return;
        if (ctx.counter('band:kaituo:done') > 0) return;
        grant(ctx);
      },
    };
  };

  // 予愿安洁莉娜 "获得N名开拓心干员": 复制上场战斗最后的开拓心持有者棋子（无持有者不触发）。
  // 持有者来自**战斗 → 休整期的通用通道**（`ctx.mark`：战斗侧 `setBattleMark(battle, pid, 'holder', …)` 写）。
  const gainPioneerHolder = (ctx) => {
    const holder = ctx.mark('holder');
    if (typeof holder !== 'string' || !holder) return;
    const base = (ctx.gd.baseIdOf ? ctx.gd.baseIdOf(holder) : String(holder).replace(/_b$/, '_a')) || holder;
    const n = Math.max(1, num(ctx.source.bb.count, 1));
    for (let i = 0; i < Math.min(10, n); i++) if (!ctx.grantChess(base)) break;
  };

  // 暴行 (休整期发放): 上场战斗未陷入过再部署状态（未被击倒 / 退场）→ 获得N名阶级不超过调度中心的【雷姆必拓】干员。
  // 标记来自通用通道（战斗侧 `setBattleMark(battle, pid, 'noRedeploy', <defId|null>)`）。
  const grantNoRedeployChar = (ctx) => {
    const mark = ctx.mark('noRedeploy');
    if (typeof mark !== 'string' || !mark) return;
    const n = Math.max(1, num(ctx.source.bb.count, 1));
    for (let i = 0; i < Math.min(10, n); i++) {
      const id = ctx.rollChess({ bond: 'rimBilliton', maxTier: ctx.shopLevel() });
      if (!id || !ctx.grantChess(id)) break;
    }
  };

  // 蜜莓 "场上每有1名不同的雷姆必拓干员，使所有已激活的层数+N"（无需激活盟约，加给所有已激活盟约）。
  const addActBondLayerByBoardBondChar = (ctx) => {
    const { bb, bbStr } = ctx.source;
    const bondId = ids(bbStr.bond_id)[0] || null;
    if (!bondId) return;
    const seen = new Set();
    let n = 0;
    for (const p of chessOnBoard(ctx)) {
      const base = (ctx.gd.baseIdOf ? ctx.gd.baseIdOf(p.id) : String(p.id).replace(/_b$/, '_a')) || p.id;
      if (seen.has(base)) continue;
      seen.add(base);
      if (metaBonds(ctx, p).includes(bondId)) n++;
    }
    if (!(n > 0)) return;
    const count = num(bb.count, 1);
    if (!(count > 0)) return;
    for (const b of bondOrder(ctx)) if (ctx.bondActive(b)) ctx.addLayers(b, n * count, { requireActive: false });
  };

  // 开拓大地 (band_kaituo)：无条件注册；参数（count / bond）在派发时从 ctx.gd 的 band 数据读（kaituoParams）
  registry.band('band_kaituo', kaituoHandler());
  registry.garrison('SERVER_GAIN_PIONEER_HOLDER', { run: gainPioneerHolder });
  registry.garrison('SERVER_GRANT_NO_REDEPLOY_CHAR', { run: grantNoRedeployChar });
  registry.garrison('SERVER_ADD_ACT_BOND_LAYER_BY_BOARD_BOND_CHAR', { run: addActBondLayerByBoardBondChar });
}
