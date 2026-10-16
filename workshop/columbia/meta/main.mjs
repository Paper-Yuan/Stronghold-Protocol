// workshop/columbia/meta/main.mjs — 哥伦比亚 mod 的**休整期侧**逻辑（`pack.json.server.meta`，DESIGN §29）。
//
// 原来这份代码住在引擎的 `server/sim/mod/columbia/columbia.js`。现在它就在包里，通过受限注册表把自己接进官方对局
// 逻辑；引擎辅助函数从 `registry.api` 取（meta 模块只许 import 本包文件），通报的键写在 pack.json 的
// `server.meta.registers`。
//
// 注册：
//   bond:columbiaShip         3/6 人档各发源石辅助仪 + 6 人档每回合发进阶装备
//   band:band_columbia        策略【混沌本质】：盟约每叠加 50 层发 1 件沙盘·α + 1 件沙盘·β
//   item:chess_item_3_13_e    沙盘·α（装备时销毁，发哥伦比亚干员）
//   item:chess_item_3_14_e    沙盘·β（装备时销毁，发装备）
//   item:chess_item_6_13_e    源石辅助仪（<进入休整期时> 吸收其余装备；onEquip 镜像继承；onDestroy 清继承）
//   item:chess_item_6_09_e    变形同构体（装备状态变化 → 重算源石辅助仪的盟约授予）
//   garrison:COL_*            娜斯提/涤火杰西卡/霍尔海雅/卡夫卡的休整期特质

export function registerMeta(registry) {
  const { num } = registry.api;
  const BOND = 'columbiaShip';
  const BAND = 'band_columbia';
  /** 默认发的那件装备（数据里 bb.item_id 优先）。 */
  const PLDEVICE = 'chess_item_6_13_e_a';
  /** 源石辅助仪的 item key（不带 `_a` / `_b`；registry.item 与 installItem 用同一把键）。 */
  const DEVICE = 'chess_item_6_13_e';
  /** 变形同构体的 item key：源石辅助仪继承来的盟约要靠它「激活」，所以本 mod 也挂它在携带者上的装备状态变化。 */
  const MORPH = 'chess_item_6_09_e';
  /** 策略给的两件沙盘（数据里 band.params.items 优先）。 */
  const SANDBOX = ['chess_item_3_13_e_a', 'chess_item_3_14_e_a'];

  // ---- 与战斗侧同源的数值汇总（源石辅助仪吸收用） ----
  const NUM_KEYS = ['atk', 'def', 'hp', 'aspd', 'resFlat', 'redeploy', 'spRecovery', 'resIgnorePct', 'defIgnorePct', 'taunt'];
  const zeroNumbers = () => ({ atk: 0, def: 0, hp: 0, aspd: 0, resFlat: 0, redeploy: 0, spRecovery: 0, resIgnorePct: 0, defIgnorePct: 0, taunt: 0 });
  const keyOfItem = (id) => (typeof id === 'string' ? id.replace(/_[ab]$/, '') : '');
  const itemNumbers = (rec) => {
    const out = zeroNumbers();
    for (const b of registry.api.buffsOf(rec)) {
      const p = b.p;
      out.atk += num(p.atk, 0);
      out.def += num(p.def, 0);
      out.hp += num(p.max_hp, 0);
      out.aspd += num(p.attack_speed, 0);
      out.resFlat += num(p.magic_resistance, 0);
      out.redeploy += num(p.respawn_time, 0);
      out.spRecovery += num(p.sp_recovery_per_sec, 0);
      out.resIgnorePct += num(p.magic_resist_penetrate, 0);
      out.defIgnorePct += num(p.def_penetrate, 0);
      out.taunt += num(p.taunt_level, 0);
    }
    return out;
  };
  const addNumbers = (a, b) => {
    const out = zeroNumbers();
    for (const k of NUM_KEYS) out[k] = num(a && a[k], 0) + num(b && b[k], 0);
    return out;
  };

  /**
   * 本 mod 的参数在**派发时**从 `ctx.gd`（合并后的数据）读 —— 注册时 `server/data.js getData` 不合并 pack。
   */
  const colParams = (ctx) => {
    const gd = ctx.gd;
    const bond = gd && typeof gd.bond === 'function' ? gd.bond(BOND) : null;
    const buff = bond && Array.isArray(bond.buffs) ? bond.buffs.find((b) => b && b.key === 'env_gbuff_new') : null;
    const bb = { ...(bond && bond.bb ? bond.bb : {}), ...(buff && buff.bb ? buff.bb : {}), ...(buff && buff.bbStr ? buff.bbStr : {}) };
    const band = gd && typeof gd.band === 'function' ? gd.band(BAND) : null;
    const items = band && band.params && Array.isArray(band.params.items) ? band.params.items : SANDBOX;
    return {
      itemId: typeof bb.item_id === 'string' && bb.item_id ? bb.item_id : PLDEVICE,
      sandbox: items.slice(),
      // 策略【混沌本质】的触发步长：与「视为额外携带」的每 N 层同源（数据里 bb.extra_carry_per_layer）。
      layerStep: Math.max(1, num(bb.extra_carry_per_layer, 50)),
    };
  };

  /** 进阶（golden）id：数据里有 `goldenIdOf` 就用它，否则按 `_a` → `_b` 约定兜底。 */
  const goldenOf = (ctx, id) => {
    const gd = ctx.gd;
    const g = gd && typeof gd.goldenIdOf === 'function' ? gd.goldenIdOf(id) : null;
    return g || (typeof id === 'string' && id.endsWith('_a') ? `${id.slice(0, -2)}_b` : null);
  };

  /**
   * 盟约【哥伦比亚】的休整期部分：
   *   * 3 人 / 6 人档各发 1 件源石辅助仪（每档一次，幂等靠 counter）；
   *   * 6 人 <进入休整期时> 发 1 件阶级不超过调度中心的随机**进阶**装备。
   *
   * ⚠ 发装置的时机必须挂在 **`onBondChange`** 而不是 `onBondActivate`：后者只在「未激活 → 激活」那一刻派发
   * （server/match/player/round.js recompute），从 3 人档再加到 6 人档时盟约早就是激活态，不会再触发，6 人那件就永远发不出来
   * （业主 2026-10-12 报告）。`onBondChange` 覆盖任意 count / tier 变化（激活那一次也在内），配合 counter 幂等。
   */
  const columbiaBondPrep = () => {
    const grantDevice = (ctx, tag) => {
      if (ctx.counter(`columbia:${tag}`) > 0) return;
      ctx.setCounter(`columbia:${tag}`, 1);
      ctx.grantItem(colParams(ctx).itemId);
    };
    const grantTiers = (ctx) => {
      const b = ctx.bond(BOND);
      if (!b) return;
      if (b.tier >= 1) grantDevice(ctx, 'three');
      if (b.tier >= 2) grantDevice(ctx, 'six');
    };
    return {
      onBondChange(ctx, ev) {
        if (!ev || ev.bondId !== BOND) return;
        grantTiers(ctx);
      },
      onRoundStart(ctx) {
        const b = ctx.bond(BOND);
        if (!b || !b.active || b.tier < 2) return;
        const id = ctx.rollItem({ maxTier: 6 });
        const golden = id ? goldenOf(ctx, id) : null;
        if (golden) ctx.grantItem(golden);
      },
    };
  };

  /**
   * 策略【混沌本质】：【哥伦比亚】盟约层**每叠加 50 层**时，获得 1 件沙盘·α **和** 1 件沙盘·β（可重复触发）。
   *
   * 用 `onLayers` 记步长而不是早先的 `onMerge`：层数在休整期（`ps.addLayers`，economy.js）与结算
   * （battle layerGains，settle.js）两条路径上各自派发一次 `{bondId, from, to}`，
   * `floor(to/step) - floor(from/step)` 即本次跨过的「50 层整数倍」个数 —— 一次跨过多个里程碑就逐份发。
   */
  const columbiaBand = () => ({
    onLayers(ctx, ev) {
      if (!ev || ev.bondId !== BOND) return;
      const p = colParams(ctx);
      const n = Math.floor(num(ev.to, 0) / p.layerStep) - Math.floor(num(ev.from, 0) / p.layerStep);
      if (n <= 0 || !p.sandbox.length) return;
      for (let i = 0; i < n; i++) for (const id of p.sandbox) ctx.grantItem(id);
    },
  });

  /** 沙盘·α：装备时销毁（`kind: consume_on_equip` 由引擎自动销毁），获得 count 位阶级等于调度中心的【哥伦比亚】干员。 */
  const sandboxAlpha = () => ({
    onEquip(ctx, ev) {
      const rec = ev && ev.item && ctx.gd && typeof ctx.gd.item === 'function' ? ctx.gd.item(ev.item.id) : null;
      const count = Math.max(1, num(rec && rec.params ? rec.params.count : null, 1));
      const tier = Math.max(1, ctx.shopLevel());
      for (let i = 0; i < count; i++) {
        // 精确阶级优先，池里该阶级没有【哥伦比亚】干员时回退到 ≤ 调度中心阶级（与「开拓大地」同一条兜底写法）
        const id = ctx.rollChess({ bond: BOND, tier }) || ctx.rollChess({ bond: BOND, maxTier: tier });
        if (!id || !ctx.grantChess(id)) break;
      }
    },
  });

  /** 沙盘·β：装备时销毁，获得 count 件阶级不超过调度中心的装备。 */
  const sandboxBeta = () => ({
    onEquip(ctx, ev) {
      const rec = ev && ev.item && ctx.gd && typeof ctx.gd.item === 'function' ? ctx.gd.item(ev.item.id) : null;
      const count = Math.max(1, num(rec && rec.params ? rec.params.count : null, 2));
      const tier = Math.max(1, ctx.shopLevel());
      for (let i = 0; i < count; i++) {
        const id = ctx.rollItem({ maxTier: tier });
        if (!id) break;
        ctx.grantItem(id);
      }
    },
  });

  const isCanGiveBond = (ctx, id) => !!(ctx.gd && typeof ctx.gd.item === 'function' && ctx.gd.item(id)?.canGiveBond);
  const isBond = (ctx, id) => !!(ctx.gd && typeof ctx.gd.bond === 'function' && id && ctx.gd.bond(id));

  /**
   * 把「吸收来的盟约源」（`columbia.bondSources`）按**当前是否装备着变形同构体**写进 `bondGrants`（引擎的
   * `piece.meta.data.bondGrants`，被 bondsMeta.pieceBonds / support.unitBonds 当成变形同构体授予计数）。
   *
   * 为什么需要它：变形同构体的授予本来由引擎按「携带者身上的 `giveBondId` 装备」算（server/match/bondsMeta.js
   * pieceBonds），但被吸收的装备已经被销毁、不在 `items` 里了，引擎看不到 —— 所以源石辅助仪把它们的盟约记在
   * `bondSources`，再由这里按配对状态转写。这样：
   *   * 先吸收、**之后**才装上变形同构体 → 一装上就生效（不再受「吸收那一刻是否配对」限制，业主 2026-10-12 报告）；
   *   * 变形同构体被换掉 / 销毁 → 这些盟约随之失效。
   */
  const syncMorphGrants = (ctx, uid) => {
    const view = ctx.piece(uid);
    if (!view || view.kind !== 'chess') return;
    const pd = ctx.pieceData(uid) || {};
    const sources = pd.columbia && Array.isArray(pd.columbia.bondSources) ? pd.columbia.bondSources : [];
    const hasMorph = (Array.isArray(view.items) ? view.items : []).some((it) => isCanGiveBond(ctx, it && it.id));
    const want = hasMorph ? [...new Set(sources.filter((b) => isBond(ctx, b)))] : [];
    const cur = Array.isArray(pd.bondGrants) ? pd.bondGrants : [];
    if (want.length === cur.length && want.every((b) => cur.includes(b))) return; // 无变化：不写、不触发 recompute
    ctx.setPieceData(uid, { bondGrants: want.length ? want : null });
  };

  /**
   * 源石辅助仪（休整期）：<进入休整期时> 把携带者**其余装备**（其它源石辅助仪、以及变形同构体除外）的数值与效果汇总吸收到
   * 该装备上并销毁它们，可跨回合叠加（每次在上一轮的基础上累加）。吸收结果写进携带者棋子的 `piece.meta.data.columbia`
   * （ctx.setPieceData），战斗侧由 registerItemBehaviour(DEVICE) 读取。
   *
   * **变形同构体（`canGiveBond`）不吸收、不销毁、不继承**：它留在携带者身上；被销毁的其它装备里带 `giveBondId` 的那些，
   * 其盟约记进 `columbia.bondSources`（持久，跨回合去重累加）——**只要携带者当前装备着变形同构体**，这些盟约就写进
   * `bondGrants` 生效（syncMorphGrants），变形同构体被换掉时再撤掉。契约见 items.json 的描述。
   * `columbia.items` 记下**已继承**的装备 id（供详情卡列出「已继承的装备」），跨回合累加、去重。
   *
   * 吸收用「销毁」而不是「卸下」：ctx.destroyPiece 对已装备物品就是**就地销毁**（server/match/effectsMeta.js），
   * 不触发 stow、不给回手牌。
   */
  const absorbCarrier = (ctx, view) => {
    const items = Array.isArray(view.items) ? view.items : [];
    const dev = items.find((it) => it && keyOfItem(it.id) === DEVICE);
    if (!dev) return;
    const recOf = (id) => (ctx.gd && typeof ctx.gd.item === 'function' ? ctx.gd.item(id) : null);
    // 变形同构体（canGiveBond）不吸收：它留在携带者身上
    const others = items.filter((it) => it && keyOfItem(it.id) !== DEVICE && !(recOf(it.id)?.canGiveBond));
    // 记录有**两份**：装备自己（`dev.uid`，持久、随装备走——携带者被出售时装备回整备区，效果不能丢，业主 2026-10-12 报告）
    // 和携带者（`view.uid`，战斗侧 u.pieceData / 详情卡读的那份镜像）。取件数更全的一份当基准，兼容进阶合成后新件为空的情况。
    const itemRec = (ctx.pieceData(dev.uid) || {}).columbia;
    const carrierRec = (ctx.pieceData(view.uid) || {}).columbia;
    const prev = num(itemRec && itemRec.count, 0) >= num(carrierRec && carrierRec.count, 0)
      ? (itemRec && typeof itemRec === 'object' ? itemRec : carrierRec) : carrierRec;
    if (!others.length) {
      // 没有可吸收的装备：只按当前是否装备着变形同构体同步一次授予（例如本回合才装上变形同构体）
      if (prev && Array.isArray(prev.bondSources) && prev.bondSources.length) syncMorphGrants(ctx, view.uid);
      return;
    }
    // 被吸收装备里带 giveBondId 的盟约源（**不管当下有没有变形同构体都记下来** —— 之后补装变形同构体也要能生效）
    const sources = [];
    for (const it of others) {
      const r = recOf(it.id);
      if (r && !r.canGiveBond && typeof r.giveBondId === 'string' && r.giveBondId && !sources.includes(r.giveBondId)) sources.push(r.giveBondId);
    }
    let add = zeroNumbers();
    for (const it of others) { const r = ctx.gd.item(it.id); if (r) add = addNumbers(add, itemNumbers(r)); }
    const prevItems = prev && Array.isArray(prev.items) ? prev.items : [];
    const prevSources = prev && Array.isArray(prev.bondSources) ? prev.bondSources : [];
    const next = {
      mods: prev && prev.mods ? addNumbers(prev.mods, add) : add,
      count: num(prev && prev.count, 0) + others.length,
      // **保留件数**（不去重）：同一件装备在不同休整期各吸收一次（前一份已被销毁，第二次不再触发合成），
      // 战斗侧的数值就会累加两次；详情卡「已继承的装备」按名字合并时用的也是这份列表，去重会让显示少算。
      items: [...prevItems, ...others.map((it) => it.id)],
      bondSources: [...new Set([...prevSources, ...sources])],
    };
    ctx.setPieceData(dev.uid, { columbia: next });       // 持久份：随装备走（出售 / 换人后仍在）
    ctx.setPieceData(view.uid, { columbia: next });      // 镜像份：战斗侧与详情卡读携带者的 pieceData
    for (const it of others) ctx.destroyPiece(it.uid);
    syncMorphGrants(ctx, view.uid);
  };

  /** 源石辅助仪的休整期处理器（registry.item(DEVICE)）。 */
  const columbiaDevice = () => ({
    /**
     * 装到新携带者身上时：把**装备自己**带着的已继承记录（`dev.meta.data.columbia`，出售 / 换人后仍在）镜像到新携带者身上，
     * 效果随之恢复（业主 2026-10-12：出售干员后源石辅助仪进整备区，再装备时「获得的其他装备效果」不该丢）。
     *
     * 装备自己**没有**记录时（例如刚由两件基础合成出来的进阶件）不动携带者身上已有的记录 —— 保住「进阶后保留继承」。
     */
    onEquip(ctx, ev) {
      const holder = (ev && ev.holder) || (ctx.source && ctx.source.holder);
      const item = (ev && ev.item) || (ctx.source && ctx.source.piece);
      if (!holder || holder.kind !== 'chess' || !item) return;
      const rec = (ctx.pieceData(item.uid) || {}).columbia;
      if (rec && Array.isArray(rec.items) && rec.items.length) ctx.setPieceData(holder.uid, { columbia: rec });
      syncMorphGrants(ctx, holder.uid);
    },
    /**
     * 源石辅助仪**离开携带者**（被第 3 件装备替换 / 被销毁，`dispatchItem('onDestroy', { reason: 'replace' })`）时，
     * 清掉该棋子已继承的数值、件数与盟约授予：继承挂在**携带者**身上（`piece.meta.data`），装备没了就该作废。
     *
     * **进阶合成不会触发这里**：两件基础合成进阶走 `_mergeItem`，它只 `_detach` 不派发 `onDestroy`，所以合成后携带者
     * 已继承的 `columbia` / `bondGrants` 保留（业主规则 2026-10-12：进阶后保留继承的数值与效果）。
     */
    onDestroy(ctx, ev) {
      const holder = (ev && ev.holder) || (ctx.source && ctx.source.holder);
      if (!holder || holder.kind !== 'chess') return;
      const pd = ctx.pieceData(holder.uid);
      if (!pd || (!pd.columbia && !pd.bondGrants)) return;
      ctx.setPieceData(holder.uid, { columbia: null, bondGrants: null });
    },
    onRoundStart(ctx) {
      for (const v of [...ctx.board(), ...ctx.hand(), ...ctx.temp()]) if (v && v.kind === 'chess') absorbCarrier(ctx, v);
    },
  });

  /**
   * 变形同构体（`canGiveBond`）自己的装备 / 卸下：装备状态一变就重算源石辅助仪继承来的盟约授予（syncMorphGrants）。
   *
   * 官方数据里变形同构体没有任何 buff（`buffs: []`），所以引擎的 registerBuiltins 不会给它注册 `item:chess_item_6_09_e`
   * 处理器（builtinMeta.js 只在有 ITEM_HANDLERS 命中时注册）—— 这把键由本 mod 占用；变形同构体自身的「视为盟约成员」
   * 规则是引擎里的纯计算（bondsMeta / support），不依赖任何注册处理器，因此不会冲突。
   */
  const morphItem = () => {
    const resync = (ctx, ev) => {
      const holder = (ev && ev.holder) || (ctx.source && ctx.source.holder);
      if (holder && holder.kind === 'chess') syncMorphGrants(ctx, holder.uid);
    };
    return { onEquip: resync, onDestroy: resync };
  };

  // ===================================================================================================================
  // 干员特质（休整期 SERVER_*）

  /** 娜斯提：「<获得时>获得一件阶级等于调度中心的随机装备（精锐：随机进阶装备）」。 */
  const nastiGainEquip = () => ({
    run(ctx) {
      const { bb, bbStr } = ctx.source;
      const tier = Math.max(1, ctx.shopLevel());
      const golden = bbStr.golden === true || bbStr.golden === 'true';
      const n = Math.max(1, num(bb.count, 1));
      for (let i = 0; i < Math.min(10, n); i++) {
        // 精确阶级优先，池里没有该阶级的装备时回退到 ≤ 调度中心阶级（与「开拓大地」同一条兜底写法）
        const id = ctx.rollItem({ tier }) || ctx.rollItem({ maxTier: tier });
        if (!id) break;
        const g = golden ? goldenOf(ctx, id) : null;
        ctx.grantItem(g || id);
      }
    },
  });

  /** 涤火杰西卡：「<休整期结束时>自身每携带1件装备，使已激活的【哥伦比亚】层数+N」。 */
  const jescaBondByEquipCount = () => ({
    run(ctx) {
      const { bb, bbStr, piece } = ctx.source;
      const bond = bbStr && typeof bbStr.bond === 'string' && bbStr.bond ? bbStr.bond : BOND;
      const view = piece && Number.isInteger(piece.uid) ? ctx.piece(piece.uid) : null;
      const items = view && Array.isArray(view.items) ? view.items : (piece && Array.isArray(piece.items) ? piece.items : []);
      if (!items.length) return;
      ctx.addLayers(bond, items.length * num(bb.count, 3), { requireActive: true });
    },
  });

  /**
   * 霍尔海雅：「获得装备时，额外获得 1 件阶级不超过该装备的随机装备（精锐：随机进阶装备）；每回合 1 次」。
   *
   * 走引擎新增的 `SERVER_GAIN_ITEM` / `onGainItem` 钩子（`acquire.js` 在获得装备时派发、`_garrisons` 遍历场上 /
   * 整备区）：装备本身不是棋子，`onGain` 只喂给「获得的那个棋子」的特质，携带者收不到 —— 本钩子对每个携带者逐个
   * 派发，`ctx.source` 就是该携带者的 garrison 上下文（`bb` / `bbStr` / `piece`）。「每回合 1 次」用 `pieceCounter`
   * （每回合自动归零）。
   */
  const heyakGainEquip = () => ({
    onGainItem(ctx, ev) {
      if (!ev || ev.kind !== 'item' || !ev.piece) return;
      const { bbStr, piece } = ctx.source;
      const uid = piece && Number.isInteger(piece.uid) ? piece.uid : null;
      if (uid == null) return;
      if (ctx.pieceCounter(uid, 'columbia:heyak') > 0) return;
      ctx.incPieceCounter(uid, 'columbia:heyak', 1);   // 先记后发：发出去的那件再派发 onGainItem 时会被本行挡住
      const rec = ctx.gd.item(ev.piece.id);
      const tier = Math.max(1, num(rec && rec.tier, 1));
      const id = ctx.rollItem({ maxTier: tier });
      if (!id) return;
      const golden = bbStr.golden === true || bbStr.golden === 'true';
      ctx.grantItem(golden ? (goldenOf(ctx, id) || id) : id);
    },
  });

  /** 卡夫卡（休整期那半）：「上场战斗没有陷入过再部署状态 → 获得1件随机X阶装备」。
   * 阶数来自**战斗 → 休整期的通用通道**（战斗侧 `setBattleMark(battle, pid, 'equipTier', <阶数|null>)`）。
   * 标记每场战斗结束**整体替换**，所以本回合没写就是 null —— 不需要自己清零（见 battle/main.mjs COL_DEPLOY_LAYER_NOREDEPLOY_EQUIP）。 */
  const kafkaPrepEquip = () => ({
    run(ctx) {
      const tier = Number(ctx.mark('equipTier'));
      if (!(tier > 0)) return;
      const t = Math.max(1, Math.floor(tier));
      const id = ctx.rollItem({ tier: t }) || ctx.rollItem({ maxTier: t });
      if (id) ctx.grantItem(id);
    },
  });

  registry.bond(BOND, columbiaBondPrep());
  registry.band(BAND, columbiaBand());
  registry.item('chess_item_3_13_e', sandboxAlpha());
  registry.item('chess_item_3_14_e', sandboxBeta());
  registry.item(DEVICE, columbiaDevice());
  registry.item(MORPH, morphItem());
  registry.garrison('COL_GAIN_RANDOM_EQUIP', nastiGainEquip());
  registry.garrison('COL_ADD_BOND_BY_EQUIP_COUNT', jescaBondByEquipCount());
  registry.garrison('COL_GAIN_FRONT_EQUIP', heyakGainEquip());
  registry.garrison('COL_KAFKA_PREP_EQUIP', kafkaPrepEquip());
}
