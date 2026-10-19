# 官方特效 · 未接线清单

> 记录时间：2026-10-20
> 用途：记下「素材有、但客户端没接上官方特效」的位置，避免下次重新排查。

---

## 引星棘刺（char_1039_thorn2 / chess_char_5_15_a|b）

### 素材齐全

```
public/assets/local/fx/prefabs/thorn2_*.json     21 个
public/assets/local/fx/tex/thorn2_*.webp          9 张
public/assets/local/fx/index.json
  units.char_1039_thorn2                        有
  projectiles: projectile_chr_thorn2 / _s1 / _s2 / _s3 / _s3_polygon
```

| 组 | prefab |
|---|---|
| 普攻 | thorn2_attack_start / _trail / _hit |
| S1 度算浪波 | thorn2_skill_01_buff / _range / _token |
| S2 解构涌潮 | thorn2_skill_02_range / _token |
| S3 我的海疆 | thorn2_skill_03_line / _start / _token |
| 通用 | thorn2_skill_start / _start_02 / thorn2_skill_hit / thorn2_token_start / thorn2_buff |
| 武器 | thorn2_weapon_buff_01 ~ _05 |

### 已接官方特效

- **普攻**：官方弹体 `projectile_chr_thorn2`，主特效 `thorn2_attack_trail`
- **S1**：`FX_BINDINGS.skchr_thorn2_1` → `projectile_chr_thorn2_s1`，覆盖 `thorn2_token_start` / `thorn2_skill_01_token` / `thorn2_skill_01_range`；施法 `thorn2_skill_start`，命中 `thorn2_skill_01_buff`
- **S3**：`FX_BINDINGS.skchr_thorn2_3` → `projectile_chr_thorn2_s3`，覆盖 `thorn2_token_start` / `thorn2_skill_03_token`；施法 `thorn2_skill_03_start` + `thorn2_skill_start_02`，命中 `thorn2_skill_hit`
- **武器（被动 ability）**：`thorn2_weapon_buff_01` ~ `_04`，`when: passive` 常驻

### 未接 - ① S2 解构涌潮

`public/js/render/vfx/skills.js` 的 `FX_BINDINGS` 注释原文：

```
S2's unit drifts (its zone re-sent every second): not bound — the procedural area stays (open)
```

S2 的地面单位每秒重发一次范围区，官方绑定那套要求固定落点，所以**仍在用程序化特效**。
资源 `thorn2_skill_02_range` / `thorn2_skill_02_token` 是有的。

### 未接 - ② 天赋「心相」的 thorn2_weapon_buff_05

`render/vfx/talents.js` 的 `talentBindings('char_1039_thorn2')` 输出：

```
t:1#0  when=passive  ability=AuraAbility   unmapped=["thorn2_weapon_buff_05"]
t:1#1  when=passive  ability=AuraAbility   unmapped=["thorn2_weapon_buff_05"]
t:2#0  when=null     ability=AbilityParallelGroup   空
t:2#1  when=null     ability=EmptyAbility          空
```

天赋 1（心相）的官方光效落进 `unmapped`，**不播放**。
天赋 2（视界）两个节点本身就没有特效。

---

## 排查方法（复用）

```bash
# 1. 素材在不在
ls public/assets/local/fx/prefabs/<前缀>_*.json

# 2. 玩家单位在不在 fx index
node -e "const i=require('./public/assets/local/fx/index.json');console.log(!!i.units['char_XXXX']);"

# 3. 技能绑了什么
node -e "import('./public/js/render/vfx/skills.js').then(V=>{
  const i=require('./public/assets/local/fx/index.json');
  console.log(V.bindingKeys(i,'skchr_xxxx_1'));
})"

# 4. 天赋/被动绑了什么
node -e "import('./public/js/render/vfx/talents.js').then(T=>{
  const i=require('./public/assets/local/fx/index.json');
  for (const b of T.talentBindings(i,'char_XXXX',{}))
    console.log(b.id, b.when,
      (b.plan.loop||[]).map(e=>e.key),
      (b.plan.unmapped||[]).map(e=>e.key));
})"
```
