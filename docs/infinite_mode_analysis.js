/**
 * 卫戍协议：单机无限模式 - 大盟约组合数值分析工具
 * 基于 INFINITE_MODE.md 中的伤害公式与膨胀曲线，计算所有盟约组合的理论波次上限
 */

// ============ 敌人属性膨胀公式 ============
function getEnemyHP(round) {
  const n = round - 15;
  const baseHP = 300000; // R15 BOSS 基础血量
  const growth = Math.pow(1.13, n);
  const post40Multiplier = round > 40 ? 2 : 1;
  return baseHP * growth * post40Multiplier;
}

function getEnemyATK(round) {
  const n = round - 15;
  const baseATK = 100; // R15 基础攻击
  return baseATK * (1 + 0.05 * n);
}

// ============ 大盟约基础伤害公式（9000层假设） ============
const LAYER = 9000; // 假设玩家能刷到的高层数

// 炎国 (Yan) - 双炎佑核弹流
function calcYanDPS(layer, minorCovenants) {
  const baseOperatorATK = 500;
  const yanOperatorCount = 9;
  const totalYanATK = baseOperatorATK * yanOperatorCount;
  
  // 双炎佑，每只 1.5 倍攻击力
  const flameGuardATK = totalYanATK * 1.5 * 2;
  
  // 基础层数增幅（假设炎佑基础伤害倍率）
  const layerMultiplier = 1 + layer * 0.015; // 每层 1.5% 增幅
  
  let dps = flameGuardATK * layerMultiplier * 10; // 假设攻速为 10 次/秒
  
  // 小盟约加成
  if (minorCovenants.includes('3奥术')) {
    dps *= (1 + 0.50 + layer * 0.005); // 奥术提供伤害放大与脆弱
  }
  if (minorCovenants.includes('2奥术')) {
    dps *= (1 + 0.35 + layer * 0.003);
  }
  if (minorCovenants.includes('精准')) {
    dps *= (1 + 0.30); // 独立攻击乘区
  }
  
  return dps;
}

// 卡西米尔 (Kazimierz) - 部署叠攻流
function calcKazimierzDPS(layer, minorCovenants) {
  const baseATK = 300;
  const deploymentStacks = 50; // 假设平均部署叠层
  const deploymentMultiplier = 1 + (0.50 + 0.01 * layer) * deploymentStacks;
  
  let dps = baseATK * deploymentMultiplier * 5; // 5 个主力输出
  
  // 真伤加成（阻挡时 2 秒 120% 真伤 AOE）
  dps += baseATK * deploymentMultiplier * 0.6 * 5; // 平均真伤贡献
  
  if (minorCovenants.includes('突袭')) {
    const assaultMultiplier = 1 + 0.25 + 0.01 * layer;
    dps *= assaultMultiplier; // 二次曲线爆发
  }
  if (minorCovenants.includes('不屈')) {
    dps *= 1.5; // 超长输出时间加成
  }
  if (minorCovenants.includes('精准')) {
    dps *= 1.3;
  }
  
  return dps;
}

// 维多利亚 (Victoria) - 装备叠攻流
function calcVictoriaDPS(layer, minorCovenants) {
  const baseATK = 400;
  const equipmentBonus = 1.25 + 0.008 * Math.min(layer, 750); // 750 层封顶
  const sixPersonEquipBonus = 1.80; // 6 人每件装备 +80% 攻击
  
  // 超额共鸣转化（750 层后）
  const overflowLayers = Math.max(0, layer - 750);
  const overflowATKBonus = 1 + (overflowLayers / 100) * 0.015;
  
  let dps = baseATK * equipmentBonus * sixPersonEquipBonus * overflowATKBonus * 6;
  
  if (minorCovenants.includes('2精准')) {
    dps *= (1 + 0.40 + 0.005 * layer); // 独立乘区 + 穿透
  }
  if (minorCovenants.includes('3精准')) {
    dps *= (1 + 0.50 + 0.007 * layer);
  }
  if (minorCovenants.includes('灵巧')) {
    dps *= 1.4; // 攻速顶满
  }
  
  return dps;
}

// 萨尔贡 (Sargon) - 攻速暴击流
function calcSargonDPS(layer, minorCovenants) {
  const baseATK = 350;
  const sargonATKBonus = 1 + 3.0; // +300% 攻击
  const sargonASBonus = 300; // +300 攻速（物理上限 15 次/秒）
  
  // 6 人弱点增伤
  const weaknessBonus = 1 + (layer / 200) * 0.04;
  
  let dps = baseATK * sargonATKBonus * 15 * weaknessBonus * 6; // 15 次/秒攻速上限
  
  if (minorCovenants.includes('灵巧')) {
    dps *= 1.5; // 攻速协同
  }
  if (minorCovenants.includes('2精准')) {
    dps *= (1 + 0.40 + 0.005 * layer);
  }
  if (minorCovenants.includes('娜仁图亚')) {
    const equipmentBonus = 1 + (layer / 200) * 0.02;
    dps *= equipmentBonus;
  }
  
  return dps;
}

// 拉特兰 (Laterano) - 弹药流
function calcLateranoDPS(layer, minorCovenants) {
  const baseATK = 380;
  const ammoMultiplier = Math.min(10, 1.05 + 0.015 * layer); // 600 层封顶 10 倍弹药
  
  // 超额穿透转化
  const overflowLayers = Math.max(0, layer - 600);
  const armorPenetration = 1 + (overflowLayers / 100) * 0.004;
  
  let dps = baseATK * ammoMultiplier * armorPenetration * 8;
  
  if (minorCovenants.includes('3精准')) {
    dps *= (1 + 0.50 + 0.007 * layer) * 1.30; // 独立乘区 + 30% 穿透
  }
  if (minorCovenants.includes('2精准')) {
    dps *= (1 + 0.40 + 0.005 * layer) * 1.30;
  }
  
  return dps;
}

// 叙拉古 (Siracusa) - 隐匿真伤流
function calcSiracusaDPS(layer, minorCovenants) {
  const baseATK = 320;
  const trueDamageProc = 5000 + 50 * layer;
  const procRate = 0.03; // 3% 触发率
  
  let dps = (baseATK * 8 + trueDamageProc * procRate) * 10;
  
  if (minorCovenants.includes('迅捷')) {
    dps *= 2.0; // 零 CD 技能连发
  }
  if (minorCovenants.includes('2奥术')) {
    dps *= (1 + 0.35 + 0.003 * layer);
  }
  
  return dps;
}

// 阿戈尔 (Aegir) - 超高生存坦度流
function calcAegirDPS(layer, minorCovenants) {
  const baseATK = 250;
  const hpMultiplier = 1.35 + 0.01 * layer; // 生命值倍率
  
  // 阿戈尔主打生存，输出偏弱
  let dps = baseATK * 6 * 1.2; // 假设基础输出
  
  if (minorCovenants.includes('精准')) {
    dps *= 1.3;
  }
  if (minorCovenants.includes('奥术')) {
    dps *= 1.4;
  }
  
  return dps;
}

// ============ 小盟约组合生成器 ============
const MAJOR_COVENANTS = [
  { name: '炎国', calc: calcYanDPS, bestMinors: ['3奥术', '2奥术', '精准'] },
  { name: '卡西米尔', calc: calcKazimierzDPS, bestMinors: ['突袭', '不屈', '精准'] },
  { name: '维多利亚', calc: calcVictoriaDPS, bestMinors: ['2精准', '3精准', '灵巧'] },
  { name: '萨尔贡', calc: calcSargonDPS, bestMinors: ['灵巧', '2精准', '娜仁图亚'] },
  { name: '拉特兰', calc: calcLateranoDPS, bestMinors: ['3精准', '2精准'] },
  { name: '叙拉古', calc: calcSiracusaDPS, bestMinors: ['迅捷', '2奥术'] },
  { name: '阿戈尔', calc: calcAegirDPS, bestMinors: ['精准', '奥术'] }
];

// 小盟约需要来自不同大盟约（满足 2/3 人要求）
const MINOR_COVENANT_SOURCES = {
  '3奥术': '炎国',
  '2奥术': '炎国',
  '突袭': '卡西米尔',
  '不屈': '卡西米尔',
  '精准': '维多利亚',
  '2精准': '维多利亚',
  '3精准': '维多利亚',
  '灵巧': '萨尔贡',
  '娜仁图亚': '萨尔贡',
  '迅捷': '叙拉古'
};

// 验证小盟约组合是否合法（需要来自不同大盟约）
function isValidMinorCombination(majorName, minors) {
  const sources = minors.map(m => MINOR_COVENANT_SOURCES[m] || majorName);
  const uniqueSources = new Set([majorName, ...sources]);
  
  // 至少需要 2 个不同来源（1 个小盟约）或 3 个不同来源（2 个小盟约）
  if (minors.length === 1) return uniqueSources.size >= 2;
  if (minors.length === 2) return uniqueSources.size >= 3;
  return false;
}

// 生成所有合法组合
function generateValidCombinations() {
  const combinations = [];
  
  for (const major of MAJOR_COVENANTS) {
    // 单小盟约组合
    for (const minor of major.bestMinors) {
      if (isValidMinorCombination(major.name, [minor])) {
        combinations.push({
          major: major.name,
          minors: [minor],
          calc: major.calc
        });
      }
    }
    
    // 双小盟约组合
    for (let i = 0; i < major.bestMinors.length; i++) {
      for (let j = i + 1; j < major.bestMinors.length; j++) {
        const minors = [major.bestMinors[i], major.bestMinors[j]];
        if (isValidMinorCombination(major.name, minors)) {
          combinations.push({
            major: major.name,
            minors: minors,
            calc: major.calc
          });
        }
      }
    }
  }
  
  return combinations;
}

// ============ 波次上限计算 ============
function calculateWaveLimit(dpsFunc, layer, minors, timeLimit = 50) {
  // 从 R15 开始，找到 DPS 无法在 timeLimit 秒内击杀 BOSS 的轮次
  let round = 15;
  
  while (round <= 100) {
    const bossHP = getEnemyHP(round);
    const playerDPS = dpsFunc(layer, minors);
    const timeToKill = bossHP / playerDPS;
    
    if (timeToKill > timeLimit) {
      return round - 5; // 返回上一个周期的 BOSS 轮次
    }
    
    round += 5; // 每 5 回合一个 BOSS
  }
  
  return 100; // 超过 R100
}

// ============ 主分析函数 ============
function analyzeAllCombinations() {
  const combinations = generateValidCombinations();
  const results = [];
  
  for (const combo of combinations) {
    const waveLimit = calculateWaveLimit(combo.calc, LAYER, combo.minors);
    const dps = combo.calc(LAYER, combo.minors);
    
    results.push({
      major: combo.major,
      minors: combo.minors.join(' + '),
      dps: Math.round(dps),
      waveLimit: waveLimit,
      tier: waveLimit >= 70 ? 'S' : waveLimit >= 55 ? 'A' : waveLimit >= 45 ? 'B' : 'C'
    });
  }
  
  // 按波次上限排序
  results.sort((a, b) => b.waveLimit - a.waveLimit);
  
  return results;
}

// ============ 输出格式化 ============
function formatResults(results) {
  console.log('\n='.repeat(80));
  console.log('卫戍协议：单机无限模式 - 大盟约组合数值分析报告');
  console.log('假设条件：盟约层数 = 9000 层，BOSS 击杀时限 = 50 秒');
  console.log('='.repeat(80));
  console.log('\n【完整排名】\n');
  
  console.log('排名 | 大盟约 | 小盟约组合 | DPS | 波次上限 | 评级');
  console.log('-'.repeat(80));
  
  results.forEach((r, idx) => {
    const rank = String(idx + 1).padStart(2);
    const major = r.major.padEnd(8);
    const minors = r.minors.padEnd(25);
    const dps = String(r.dps).padStart(12);
    const wave = `R${r.waveLimit}`.padStart(6);
    const tier = r.tier;
    
    console.log(`${rank}   | ${major} | ${minors} | ${dps} | ${wave} | ${tier}`);
  });
  
  // 分层统计
  console.log('\n\n【分层统计】\n');
  const tiers = { S: [], A: [], B: [], C: [] };
  results.forEach(r => tiers[r.tier].push(r));
  
  for (const [tier, combos] of Object.entries(tiers)) {
    const desc = {
      S: 'R70+ 超限突破',
      A: 'R55-69 高位竞技',
      B: 'R45-54 中位稳定',
      C: 'R44- 初期受限'
    };
    console.log(`\n${tier} 级（${desc[tier]}）：${combos.length} 种组合`);
    combos.forEach(c => {
      console.log(`  - ${c.major} + ${c.minors}：R${c.waveLimit}`);
    });
  }
  
  return results;
}

// 运行分析
const results = analyzeAllCombinations();
formatResults(results);

// ============ 弱势盟约强化建议 ============
console.log('\n\n' + '='.repeat(80));
console.log('【弱势盟约强化建议】');
console.log('='.repeat(80));

// 统计各大盟约的表现
const majorPerformance = {};
results.forEach(r => {
  if (!majorPerformance[r.major]) {
    majorPerformance[r.major] = { maxWave: 0, avgWave: 0, count: 0, combinations: [] };
  }
  majorPerformance[r.major].maxWave = Math.max(majorPerformance[r.major].maxWave, r.waveLimit);
  majorPerformance[r.major].avgWave += r.waveLimit;
  majorPerformance[r.major].count += 1;
  majorPerformance[r.major].combinations.push(r);
});

for (const major in majorPerformance) {
  majorPerformance[major].avgWave /= majorPerformance[major].count;
}

// 找出弱势盟约（平均波次 < R55）
const weakCovenants = Object.entries(majorPerformance)
  .filter(([_, perf]) => perf.avgWave < 55)
  .sort((a, b) => a[1].avgWave - b[1].avgWave);

weakCovenants.forEach(([major, perf]) => {
  console.log(`\n\n### ${major}（当前平均 R${Math.round(perf.avgWave)}，最高 R${perf.maxWave}）`);
  
  if (major === '阿戈尔') {
    console.log(`
**问题诊断**：
- 输出能力严重不足，仅依赖基础攻击
- 开战吞噬虽为必杀真伤，但后续输出无成长性
- 高生存无意义（无限模式靠输出，不靠坦）

**强化方案**：
1. **吞噬继承强化**：被吞噬干员的攻击力继承改为 300%（当前 100%）
2. **深渊适应被动**：每通过 1 个周期（5 回合），全员攻击力永久 +20%，可叠加
3. **复活反击机制**：复活时触发一次 "深渊之怒"，造成周围敌人最大生命值 15% 的真实伤害
4. **层数输出转化**：每 100 层提供 3% 攻击力、2% 攻速（解决输出天花板）

**预期提升**：R45 → R60+
    `);
  }
  
  if (major === '叙拉古') {
    console.log(`
**问题诊断**：
- 真伤数值 (5000 + 50×L) 在亿级血量面前微不足道
- 3% 触发率导致不稳定输出
- 隐匿机制在无限模式无意义（敌人无差别攻击）

**强化方案**：
1. **真伤比例化**：触发真伤改为 "造成目标当前生命值 8% + (50×L) 的真实伤害"
2. **暗影连击**：每次触发真伤后，下一次普攻必定触发（冷却 3 秒）
3. **恐惧增伤**：被恐惧的敌人受到的所有伤害提升 40%
4. **6 人暗杀者被动**：击杀敌人时，30% 概率重置一个随机干员的技能 CD

**预期提升**：R48 → R65+
    `);
  }
  
  if (major === '维多利亚') {
    console.log(`
**问题诊断**：
- 装备封顶 30 件（750 层）过早，后期成长乏力
- 超额转化仅 1.5% 攻防血/100 层，收益过低
- 缺乏爆发性伤害机制

**强化方案**：
1. **装备封顶提升**：最多累计 50 件重锤（对应 1250 层）
2. **超额转化增强**：溢出层数每 100 层提供 3% 攻击力、2% 暴击率、1% 暴击伤害
3. **重锤协同**：6 人效果添加 "每拥有 10 件装备，全员技能伤害 +15%"
4. **装备强化词条**：每 500 层获得一次装备词条升级（如穿甲、吸血、溅射）

**预期提升**：R52 → R68+
    `);
  }
  
  if (major === '拉特兰') {
    console.log(`
**问题诊断**：
- 600 层弹药封顶过早
- 超额转化仅 0.4% 破甲/100 层太弱
- 缺少与弹药量挂钩的爆发伤害

**强化方案**：
1. **弹药封顶延后**：封顶层数提升至 1000 层（约 16 倍弹药）
2. **超额转化增强**：溢出层数每 100 层提供 1% 无视防御、2% 攻击力、5% 技能伤害
3. **弹药爆发机制**：技能结束时，剩余弹药 >5 发，则引爆造成 (剩余弹药数 × 攻击力 × 200%) AOE 伤害
4. **6 人神圣裁决**：每消耗 10 发弹药，下一次攻击附带 30% 真实伤害

**预期提升**：R58 → R72+
    `);
  }
});

console.log('\n\n' + '='.repeat(80));
console.log('分析完成');
console.log('='.repeat(80) + '\n');
