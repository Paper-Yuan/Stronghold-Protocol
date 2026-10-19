// public/js/ui/overlimitBondText.js — 超限模式下大盟约的效果文本（sweep 的盟约报告与局内的盟约详情共用）
//
// 业主 2026-10-19：局内点开盟约详情时看到的是原版效果，和超限实际生效的数值不一致。
// 这里把六条超限文本抽成一份，两处引用同一来源，避免再次走散。

/**
 * 超限模式下某个大盟约的效果文本（原版结构，一行一句；每项都带具体公式）。
 * 不是这六个大盟约时返回 null，调用方回落到 data/bonds.json 的 descRaw。
 * @param {string} bondId
 * @returns {string|null}
 */
export function overlimitBondText(bondId) {
  // 业主 2026-10-19：超限文本要把每一项的具体数值公式写出来（基础值 + 每层值 × 层数）。
  // 结构与原版一致：一行一句，不额外空行。
  if (bondId === 'yanShip') {
    return '【炎】干员<@ba.vup>攻击力</>提升<@ba.vup>(23+0.9×层数)%</><@autochess.gray>（受层数影响）</>，<@ba.vup>生命值</>额外提升<@ba.vup>(15+0.2×层数)%</><@autochess.gray>（受层数影响）</>\n<在场<@autochess.dgreen>6</>名不同【炎】干员>战斗开始时召唤可自主行动的<@ba.vup>“炎佑”</>，其攻击力生命值分别为开战时【炎】干员攻击力生命值总和的<@ba.vup>30%</>，“炎佑”同时攻击3个目标，可使用<@ba.vup>“祛恶之焰”</>，攻击时附带攻击力一定比例的灼燃损伤且周围敌人受到一定比例的元素脆弱\n<在场<@autochess.dgreen>9</>名不同【炎】干员>改为召唤<@ba.vup>2</>只<@ba.vup>“炎佑”</>，攻击力提升至<@ba.vup>1.5</>倍，受到的伤害<@ba.vup>-90%</>';
  }
  if (bondId === 'sargonShip') {
    return '【萨尔贡】干员开启技能时，所有【萨尔贡】干员<@ba.vup>攻击速度+12</>（至多叠<@ba.vup>25</>层），持续<@ba.vup>(5+0.22×层数)</>秒<@autochess.gray>（受层数影响，每层持续时间独立计算）</>\n<在场<@autochess.dgreen>6</>名不同【萨尔贡】干员>每层攻击速度还会提供<@ba.vup>攻击力+12%</>（至多<@ba.vup>25</>层，即<@ba.vup>+300%</>）；【萨尔贡】<@ba.vup>盟约层数每达到100层</>，全体【萨尔贡】干员额外获得<@ba.vup>5%</>攻击力\n<@ba.acrem>选择策略【娜仁图亚】时，<在场<@autochess.dgreen>6</>名不同【萨尔贡】干员>的攻击力加成减半（每层<@ba.vup>+6%</>），改为开启技能时把自身装备借给周围<@ba.vup>8</>名干员，持续<@ba.vup>60</>秒</>';
  }
  if (bondId === 'victoriaShip') {
    return '携带装备的【维多利亚】干员造成的<@ba.vup>伤害提升至(125+0.8×层数)%</><@autochess.gray>（受层数影响）</>\n<每叠加<@autochess.dgreen>25</>层>获得<@ba.vup>1</>件带有随机效果的<@ba.vup>维式重锤</>，至多<@ba.vup>30</>件\n<在场<@autochess.dgreen>6</>名不同【维多利亚】干员>携带装备的【维多利亚】干员<@ba.vup>攻击力+50%</>，携带进阶装备时改为<@ba.vup>+80%</>；<@ba.vup>盟约层数超过750层</>（30件维式重锤）后，每额外<@ba.vup>50</>层，造成的<@ba.vup>伤害额外提升1%</>';
  }
  if (bondId === 'egirShip') {
    return '【阿戈尔】干员<@ba.vup>生命值提升(35+1×层数)%</><@autochess.gray>（受层数影响）</>，<@ba.vup>攻击力提升0.8%×层数</><@autochess.gray>（受层数影响）</>\n战斗开始时，【阿戈尔】干员会<@ba.vup>吞噬</>身前一格干员对其造成<@ba.vdown>5000</>点物理伤害并获得其<@ba.vup>基础攻击力</>和<@ba.vup>阻挡数</>，使【阿戈尔】叠加等于被吞噬者等阶的<@ba.vup>盟约层数</><@autochess.gray>（【阿戈尔】之间优先更靠左和靠上的干员发起吞噬）</>\n<在场<@autochess.dgreen>5</>名不同【阿戈尔】干员>前<@ba.vup>3</>名【阿戈尔】干员首次被击倒时<@ba.vup>立刻复活</>并获得<@ba.vup>50</>攻击速度';
  }
  if (bondId === 'lateranoShip') {
    return '【拉特兰】干员开启技能时获得的<@ba.vup>弹药量+(5+1.5×层数)%</><@autochess.gray>（受层数影响）</>\n<在场<@autochess.dgreen>6</>名不同【拉特兰】干员>任意【拉特兰】干员每消耗<@ba.vup>1</>发弹药，全体【拉特兰】干员<@ba.vup>攻击力+8%</>（至多<@ba.vup>+700%</>，即<@ba.vup>88</>发叠满）；每累计消耗<@ba.vup>100</>发弹药，对全场敌人造成全队【拉特兰】干员<@ba.vup>攻击力总和20%</>的真实伤害';
  }
  if (bondId === 'siracusaShip') {
    return '【叙拉古】干员部署后<@ba.vup>攻击速度+(25+0.8×层数)</>，持续<@ba.vup>(32+0.4×层数)</>秒<@autochess.gray>（受层数影响）</>\n<在场<@autochess.dgreen>6</>名不同【叙拉古】干员>【叙拉古】干员部署后进入等时长的<@ba.vup>隐匿</>状态，【叙拉古】干员隐匿状态下和脱离隐匿<@ba.vup>10</>秒内对敌人攻击时有<@ba.vup>8%</>的概率造成<@ba.vup>(5000+50×层数)+目标最大生命值0.5%</><@autochess.gray>（受层数影响）</>点真实伤害并<@ba.vup>恐惧</>目标<@ba.vup>3</>秒，对<@ba.vup>精英</>与<@ba.vup>首领</>单位该伤害至多<@ba.vup>250万</>；若目标<@ba.vup>免疫控制</>或被超限抗性抵抗，则改为造成等额真实伤害';
  }
  return null;
}


/**
 * 把超限文本里的 `(基础+每层×层数)` 公式代入当前层数，得到「当前效果」用的纯数值文本。
 * 业主 2026-10-19（方案 A）：当前效果只显示「现在多少」，公式留在「盟约效果」里。
 * @param {string} bondId
 * @param {number} layers
 * @returns {string|null} 不是这六个大盟约时返回 null
 */
export function overlimitBondNow(bondId, layers) {
  const raw = overlimitBondText(bondId);
  if (!raw) return null;
  const L = Number.isFinite(Number(layers)) ? Math.max(0, Number(layers)) : 0;
  const fmt = (v) => String(Math.round(v * 100) / 100);
  return raw
    // (a+b×层数) / (a×层数)
    .replace(/\((\d+(?:\.\d+)?)(?:\+([\d.]+)×层数|×层数)\)/g, (whole, a, b) => {
      const base = Number(a) || 0;
      const per = b == null ? 1 : (Number(b) || 0);
      return fmt(base + per * L);
    })
    // 不带括号的 a%×层数（阿戈尔的攻击力那一项）
    .replace(/(\d+(?:\.\d+)?)%×层数/g, (whole, pct) => fmt((Number(pct) || 0) * L) + '%');
}
