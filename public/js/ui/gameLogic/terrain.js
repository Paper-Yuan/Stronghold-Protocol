// ui/gameLogic/terrain.js — special terrain tips (GitHub issue #184: 特殊地形的单击信息提示). Re-exported from
// ../gameLogic.js.
//
// The words go through t() (docs/I18N.md: the Chinese text is the msgid, public/i18n/en.json the English): the name /
// tag / fact tables are marked N_() and translated where terrainInfo hands them out, the mechanism lines are built
// with their numbers as params.

import { isObj } from './shared.js';
import { t, N_ } from '../../../../shared/i18n.js';

// ---- special terrain tips (GitHub issue #184: 特殊地形的单击信息提示) ----------------------------------------

/**
 * What tapping a special tile says. `lines` are functions of the stage's own terrain parameters (`stage.special[<terrain>]`
 * and the tile's `bb`, the very numbers the sim runs on — server/sim/content/devices.js), so a tip can never disagree with
 * the battle; the prose is ours (docs/PLAYING.md wording, PRTS 特殊地形 / 沼泽控制 / 深水区 地形信息).
 * `tag` is the chip above the name; `fact` needs the tile's own legend entry (see terrainInfo).
 */
const TERRAIN_TIPS = Object.freeze({
  infection: {
    name: N_('活性源石'), tag: N_('特殊地形'),
    lines: (st) => {
      const b = isObj(st?.infection?.bb) ? st.infection.bb : {};
      const dmg = param(b.damage, 0);
      const mods = [];
      if (param(b.atk, 0)) mods.push(t('攻击力 +{atk}%', { atk: Math.round(param(b.atk, 0) * 100) }));
      if (param(b.attack_speed, 0)) mods.push(t('攻击速度 +{aspd}', { aspd: param(b.attack_speed, 0) }));
      return [
        dmg ? t('部署于其上的我方单位、经过的敌方单位，每秒受到 {dmg} 点真实伤害（无来源）', { dmg }) : t('在其上的我方单位与经过的敌方单位持续受到伤害'),
        mods.length ? t('同时获得：{mods}', { mods }) : null,
        param(b.duration, 0) ? t('效果持续 {sec} 秒；离开地块后仍然保留，再次接触会重新计时', { sec: param(b.duration, 0) }) : null,
      ].filter(Boolean);
    },
  },
  mire: {
    name: N_('沼泽'), tag: N_('特殊地形'),
    lines: (st) => {
      const m = isObj(st?.mire) ? st.mire : {};
      const per = param(m.aspdPerStack, -0.05);
      const move = param(m.moveMulPerStack, -0.05);
      const max = param(m.maxStacks, 10);
      const heavy = param(m.heavyWeight, 3);
      const sec = param(m.intervalSec, 1);
      return [
        move
          ? t('留在沼泽里的单位每 {sec} 秒获得 1 层「陷入沼泽」：攻击速度 {aspd}，敌方单位还有移动速度 {move}', { sec, aspd: pctText(per), move: pctText(move) })
          : t('留在沼泽里的单位每 {sec} 秒获得 1 层「陷入沼泽」：攻击速度 {aspd}', { sec, aspd: pctText(per) }),
        heavy ? t('重量 ≥ {heavy} 的敌人一次获得 2 层', { heavy }) : null,
        t('最多 {max} 层；离开沼泽后解除', { max }),
      ].filter(Boolean);
    },
  },
  smog: {
    name: N_('排气格栅'), tag: N_('特殊地形'),
    // the sim gives the tile's buff `flags: { stealth: true }` (devices.js enterTerrain): enemy ranged targeting
    // skips it like 隐匿 — and, like 隐匿, it does NOT stop the enemy it blocks from attacking it (PRTS 隐匿).
    lines: () => [
      t('站在排气格栅上的干员不会被敌方的远程攻击选中（效果相当于隐匿）'),
      t('但挡住敌人的干员仍会被它攻击到'),
    ],
  },
  deepsea: {
    name: N_('深水区'), tag: N_('特殊地形'),
    lines: (st) => {
      const b = isObj(st?.deepsea?.bb) ? st.deepsea.bb : {};
      const dmg = param(b['sea_drown[enemy].damage'], 0);
      const aspd = param(b['sea_drown[enemy].attack_speed'], 0);
      const move = param(b['sea_drown[enemy].move_speed'], 0);
      const out = [];
      if (dmg) out.push(t('敌人每秒受到 {dmg} 点伤害', { dmg }));
      const slowed = move && move !== 1;
      if (aspd && slowed) out.push(t('攻击速度 {aspd}、移动速度 ×{move}', { aspd: pctText(aspd), move }));
      else if (aspd) out.push(t('攻击速度 {aspd}', { aspd: pctText(aspd) }));
      else if (slowed) out.push(t('移动速度 ×{move}', { move }));
      // devices.js tickDeepsea: sourceless true damage tagged 'dot' / 'periodic' / 'deepsea' — deliberately NOT 'terrain'
      // (环境伤害, which is what 活性源石's tick is): it is nobody's damage, so no 干员's 增伤 / 穿透 / 装备 applies.
      out.push(t('溺水伤害属于无来源伤害（不吃干员的增伤、穿透与装备加成），也不归类为环境伤害'));
      out.push(t('拒绝部署（特制水上平台可以让这一格变得可部署）'));
      return out;
    },
  },
  start: { name: N_('红门'), tag: N_('敌方入口'), lines: () => [t('敌方单位从这里出场')] },
  end: { name: N_('蓝门'), tag: N_('保护目标'), lines: () => [t('敌人走进这里会扣你的目标生命值（LP），一回合至多 10 点')] },
  telin: { name: N_('传送入口'), tag: N_('特殊地形'), lines: () => [t('敌人走到这里会从场上消失')] },
  telout: { name: N_('传送出口'), tag: N_('特殊地形'), lines: () => [t('消失的敌人会从这里重新出现')] },
});

/** Tile keys that carry a tip of their own although the legend gives them no `special` tag (gates, teleports). */
const TIP_BY_TILEKEY = Object.freeze({ tile_start: 'start', tile_end: 'end', tile_telin: 'telin', tile_telout: 'telout' });
/** 深水区's own legend entry is the one tile whose mechanism overrides the level's buildableType (grid.js DEPLOY_REFUSED_TILES). */
const BUILDABILITY = Object.freeze({ ALL: N_('可部署'), MELEE: N_('仅近战位可部署'), RANGED: N_('仅远程位可部署'), NONE: N_('不可部署') });

const param = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const pctText = (v) => `${v > 0 ? '+' : '−'}${Math.abs(Math.round(param(v, 0) * 100))}%`;

/**
 * The tip a tap on board tile (row, col) opens (GitHub issue #184 — "建议加入对于特殊地形的单击信息提示"), or null for an
 * ordinary tile (road / floor / wall / fence …): those say nothing, so a tap on them still just closes what is open.
 * The tile comes from the stage the board on screen is built from (`stage.rows` + `stage.tiles`, data/stages.json), and
 * the numbers from that stage's own terrain parameters — the same values the sim runs. It reads the stage only, so a
 * 补位 / 自选 board (whose pieces are other records) explains its tiles the same way. The text is in the current
 * language (t()).
 * @param {{ rows?: string[], tiles?: Record<string, any>, special?: any } | null | undefined} stage the shown field's stage
 * @param {number} row board row (row 0 = the bottom row, DESIGN §1)
 * @param {number} col
 * @returns {{ key:string, name:string, tag:string, row:number, col:number, lines:string[], facts:string[] } | null}
 */
export function terrainInfo(stage, row, col) {
  const rows = Array.isArray(stage?.rows) ? stage.rows : null;
  const line = rows && Number.isInteger(row) && row >= 0 ? rows[row] : null;
  if (typeof line !== 'string' || !Number.isInteger(col) || col < 0 || col >= line.length) return null;
  const tiles = isObj(stage.tiles) ? stage.tiles : null;
  const tile = tiles ? tiles[line[col]] : null;
  if (!isObj(tile)) return null;
  const key = tile.special || TIP_BY_TILEKEY[tile.tileKey] || null;
  const tip = key ? TERRAIN_TIPS[key] : null;
  if (!tip) return null;
  const facts = [];
  const build = BUILDABILITY[tile.buildable];
  if (build) facts.push(t(build));
  if (tile.height === 'HIGH') facts.push(t('高台'));
  if (tile.groundPassable === false) facts.push(t('只有空中单位能通过'));
  else if (tile.groundPassable === true) facts.push(t('地面单位可通过'));
  return { key, name: t(tip.name), tag: t(tip.tag), row, col, lines: tip.lines(stage.special).filter((s) => typeof s === 'string' && s), facts };
}
