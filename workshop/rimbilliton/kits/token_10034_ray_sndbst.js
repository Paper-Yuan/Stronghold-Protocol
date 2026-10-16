// workshop/rimbilliton/kits/token_10034_ray_sndbst.js — 雷姆必拓 mod 的召唤物 kit：沙地兽（token_10034_ray_sndbst）。
//
// 走官方的**召唤物 kit**通道（docs/WORKSHOP.md §4.7）：本包 tokens.json 声明了 token_10034_ray_sndbst，所以这个
// 同名 `kits/<tokenId>.js` 被 `loadWorkshopKits` 归入 token 键空间，经 `Battle opts.tokenKits` 注入，优先于引擎内置表。
// 形状与干员 kit 同：`(bb, raw, def) => Kit`，`install(battle, token)` 里给召唤物挂 buff。
//
// 沙地兽：不攻击 / 无敌 / 禁疗（不可选中来自其 trait 文本，simdata normalizeToken）。

export default () => ({
  skill: null,
  trait: { noAttack: true },
  talents: [],
  install(battle, t) {
    battle.addBuff(t, { key: 'ray:sandbeast', flags: { invulnerable: true, noHeal: true }, persist: true, allowDead: true });
  },
});
