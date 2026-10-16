#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
无限模式大盟约交叉分析工具
根据 INFINITE_MODE.md 的伤害基准表，计算所有合法盟约组合的波次上限
"""

import math
from typing import Dict, List, Tuple
from dataclasses import dataclass

@dataclass
class CovenantCombo:
    """盟约组合配置"""
    major: str  # 大盟约
    minors: List[str]  # 小盟约列表
    personnel: int  # 激活人数 (2/3/6)
    
    def __str__(self):
        minor_str = " + ".join(self.minors) if self.minors else "纯净"
        return f"{self.major} ({self.personnel}人) + {minor_str}"

# 基础伤害数据 (从 INFINITE_MODE.md 表格提取，单位：万)
BASE_DPS_DATA = {
    "炎国+3奥术": {
        15: 482, 25: 1232, 35: 2326, 40: 3000, 45: 3764, 50: 4610, 
        55: 5546, 60: 6564, 65: 7688, 70: 8861, 75: 10100, 80: 11500
    },
    "卡西米尔+不屈突袭": {
        15: 134.9, 25: 319.4, 35: 580.7, 40: 739.6, 45: 918.7, 50: 1115,
        55: 1333, 60: 1568, 65: 1824, 70: 2098, 75: 2391, 80: 2705
    },
    "维多利亚+2精准": {
        15: 37.3, 25: 91.5, 35: 178.4, 40: 234.3, 45: 299.6, 50: 374.0,
        55: 458.9, 60: 553.8, 65: 660.0, 70: 777.2, 75: 898.3, 80: 1048
    },
    "萨尔贡+灵巧2精准": {
        15: 171.0, 25: 258.6, 35: 355.5, 40: 407.2, 45: 461.7, 50: 518.1,
        55: 577.3, 60: 638.3, 65: 702.1, 70: 767.8, 75: 835.4, 80: 906.6
    },
    "拉特兰+3精准": {
        15: 84.5, 25: 196.6, 35: 281.3, 40: 325.8, 45: 372.2, 50: 419.8,
        55: 469.4, 60: 520.1, 65: 572.9, 70: 626.8, 75: 682.1, 80: 740.0
    },
    "叙拉古+迅捷2奥术": {
        15: 38.2, 25: 56.1, 35: 73.9, 40: 82.8, 45: 91.8, 50: 100.6,
        55: 109.6, 60: 118.5, 65: 127.5, 70: 136.3, 75: 145.2, 80: 154.2
    },
    "阿戈尔(本体)": {
        15: 15.0, 25: 15.0, 35: 15.0, 40: 15.0, 45: 15.0, 50: 15.0,
        55: 15.0, 60: 15.0, 65: 15.0, 70: 15.0, 75: 15.0, 80: 15.0
    }
}

# Boss血量数据 (单位：万)
BOSS_HP_DATA = {
    15: 30, 20: 53.8, 25: 101.8, 30: 181.3, 35: 345.6, 40: 636.9,
    45: 2346, 50: 4324, 55: 7969, 60: 14600, 65: 27000, 70: 49800,
    75: 91900, 80: 169000
}

# 小盟约效果系数 (相对于基准组合的增伤/减伤系数)
MINOR_COVENANT_EFFECTS = {
    "奥术": {"炎国": 1.0, "叙拉古": 1.0, "维多利亚": 0.85, "拉特兰": 0.9, "萨尔贡": 0.88, "卡西米尔": 0.82, "阿戈尔": 0.75},
    "精准": {"拉特兰": 1.0, "萨尔贡": 1.0, "维多利亚": 1.0, "炎国": 0.72, "卡西米尔": 0.78, "叙拉古": 0.65, "阿戈尔": 0.55},
    "灵巧": {"萨尔贡": 1.0, "卡西米尔": 0.92, "叙拉古": 0.88, "拉特兰": 0.85, "维多利亚": 0.75, "炎国": 0.68, "阿戈尔": 0.6},
    "突袭": {"卡西米尔": 1.0, "萨尔贡": 0.85, "叙拉古": 0.8, "维多利亚": 0.75, "拉特兰": 0.7, "炎国": 0.65, "阿戈尔": 0.5},
    "不屈": {"卡西米尔": 1.0, "阿戈尔": 0.95, "维多利亚": 0.88, "萨尔贡": 0.85, "拉特兰": 0.8, "炎国": 0.75, "叙拉古": 0.7},
    "迅捷": {"叙拉古": 1.0, "拉特兰": 0.92, "萨尔贡": 0.88, "炎国": 0.8, "卡西米尔": 0.75, "维多利亚": 0.7, "阿戈尔": 0.6}
}

# 合法组合规则：小盟约需要对应阵营的2/3人激活
VALID_COMBINATIONS = {
    "炎国": {
        6: [["3奥术"], ["2奥术", "精准"], ["2奥术", "灵巧"], ["奥术", "精准", "灵巧"]],
        3: [["2奥术"], ["奥术", "精准"], ["奥术", "灵巧"], ["奥术"]],
        2: [["奥术"], ["精准"], ["灵巧"], []]
    },
    "卡西米尔": {
        6: [["不屈", "突袭"], ["突袭", "灵巧"], ["突袭", "精准"], ["2突袭"]],
        3: [["突袭", "不屈"], ["突袭"], ["不屈"]],
        2: [["突袭"], ["不屈"], ["灵巧"], []]
    },
    "维多利亚": {
        6: [["2精准"], ["精准", "不屈"], ["精准", "灵巧"], ["精准", "奥术"]],
        3: [["精准", "不屈"], ["精准"], ["不屈"]],
        2: [["精准"], ["不屈"], []]
    },
    "萨尔贡": {
        6: [["灵巧", "2精准"], ["2灵巧", "精准"], ["灵巧", "突袭"], ["灵巧", "奥术"]],
        3: [["灵巧", "精准"], ["灵巧"], ["精准"]],
        2: [["灵巧"], ["精准"], ["突袭"], []]
    },
    "拉特兰": {
        6: [["3精准"], ["2精准", "灵巧"], ["2精准", "迅捷"], ["精准", "灵巧", "迅捷"]],
        3: [["2精准"], ["精准", "灵巧"], ["精准", "迅捷"], ["精准"]],
        2: [["精准"], ["灵巧"], ["迅捷"], []]
    },
    "叙拉古": {
        6: [["迅捷", "2奥术"], ["2迅捷", "奥术"], ["迅捷", "突袭"], ["迅捷", "灵巧"]],
        3: [["迅捷", "奥术"], ["迅捷", "2奥术"], ["迅捷"], ["奥术"]],
        2: [["迅捷"], ["奥术"], ["突袭"], []]
    },
    "阿戈尔": {
        6: [["不屈"], ["不屈", "奥术"], ["不屈", "精准"], []],
        3: [["不屈"], ["奥术"], ["精准"], []],
        2: [["不屈"], []]
    }
}

def calculate_dps_with_minors(major: str, minors: List[str], personnel: int, base_round: int = 15) -> float:
    """
    计算特定小盟约组合下的DPS
    基于基准组合进行系数修正
    """
    # 查找最接近的基准组合
    base_key = None
    for key in BASE_DPS_DATA.keys():
        if major in key:
            base_key = key
            break
    
    if not base_key:
        return 0.0
    
    base_dps = BASE_DPS_DATA[base_key].get(base_round, 0)
    
    # 根据小盟约调整系数
    multiplier = 1.0
    
    # 人数惩罚 (6人为基准)
    if personnel == 3:
        multiplier *= 0.65
    elif personnel == 2:
        multiplier *= 0.4
    
    # 小盟约协同效果
    if minors:
        # 解析小盟约的数量和类型
        minor_effects = []
        for minor_str in minors:
            count = 1
            if minor_str.startswith("3"):
                count, minor_name = 3, minor_str[1:]
            elif minor_str.startswith("2"):
                count, minor_name = 2, minor_str[1:]
            else:
                minor_name = minor_str
            
            if minor_name in MINOR_COVENANT_EFFECTS:
                effect = MINOR_COVENANT_EFFECTS[minor_name].get(major, 0.5)
                minor_effects.append(effect ** count)  # 多层叠加
        
        if minor_effects:
            # 多个小盟约乘法叠加
            for effect in minor_effects:
                multiplier *= (0.6 + 0.4 * effect)  # 基础60%效果 + 40%协同
    else:
        # 无小盟约惩罚
        multiplier *= 0.5
    
    return base_dps * multiplier

def extrapolate_dps(major: str, minors: List[str], personnel: int, target_round: int) -> float:
    """
    外推任意轮次的DPS
    使用已知数据点进行插值/外推
    """
    known_rounds = sorted(BOSS_HP_DATA.keys())
    
    # 计算已知点的DPS值
    dps_points = {}
    for r in known_rounds:
        if r <= 80:
            dps_points[r] = calculate_dps_with_minors(major, minors, personnel, r)
    
    if target_round in dps_points:
        return dps_points[target_round]
    
    # 线性外推
    if target_round < min(known_rounds):
        r1, r2 = known_rounds[0], known_rounds[1]
    elif target_round > max(known_rounds):
        r1, r2 = known_rounds[-2], known_rounds[-1]
    else:
        # 找到夹逼的两个点
        r1 = max([r for r in known_rounds if r <= target_round])
        r2 = min([r for r in known_rounds if r >= target_round])
    
    dps1, dps2 = dps_points[r1], dps_points[r2]
    
    # 线性插值
    if r1 == r2:
        return dps1
    
    slope = (dps2 - dps1) / (r2 - r1)
    return dps1 + slope * (target_round - r1)

def calculate_max_wave(major: str, minors: List[str], personnel: int, time_limit: float = 50.0) -> Tuple[int, str]:
    """
    计算组合能稳定通过的最高波次
    返回 (最高波次, 评级说明)
    """
    max_wave = 15
    
    for wave in range(20, 100, 5):  # 每5轮一个BOSS关口
        boss_hp = calculate_boss_hp(wave)
        dps = extrapolate_dps(major, minors, personnel, wave)
        
        time_to_kill = boss_hp / dps if dps > 0 else 999999
        
        if time_to_kill <= time_limit:
            max_wave = wave
        else:
            break
    
    # 评级
    if max_wave >= 70:
        tier = "S级 (主流竞速)"
    elif max_wave >= 55:
        tier = "A级 (高端可行)"
    elif max_wave >= 45:
        tier = "B级 (中期瓶颈)"
    elif max_wave >= 30:
        tier = "C级 (早期退场)"
    else:
        tier = "D级 (不可行)"
    
    return max_wave, tier

def calculate_boss_hp(round_num: int) -> float:
    """
    根据公式计算BOSS血量 (万)
    HP = BaseHP * (1.13)^n * (2 if R>=45 else 1)
    """
    if round_num in BOSS_HP_DATA:
        return BOSS_HP_DATA[round_num]
    
    n = round_num - 15
    base_hp = 30  # R15的BOSS血量
    hp = base_hp * (1.13 ** n)
    
    if round_num >= 45:
        hp *= 2  # 双BOSS
    
    return hp

def generate_all_combinations() -> List[CovenantCombo]:
    """生成所有合法的盟约组合"""
    combos = []
    
    for major, personnel_dict in VALID_COMBINATIONS.items():
        for personnel, minor_lists in personnel_dict.items():
            for minors in minor_lists:
                combos.append(CovenantCombo(major, minors, personnel))
    
    return combos

def analyze_all_combinations():
    """主分析函数"""
    combos = generate_all_combinations()
    
    results = []
    for combo in combos:
        max_wave, tier = calculate_max_wave(combo.major, combo.minors, combo.personnel)
        
        # 计算关键轮次的DPS和击杀时间
        checkpoints = {}
        for wave in [15, 25, 35, 45, 55, 65, 75]:
            dps = extrapolate_dps(combo.major, combo.minors, combo.personnel, wave)
            hp = calculate_boss_hp(wave)
            ttk = hp / dps if dps > 0 else 999
            checkpoints[wave] = (dps, ttk)
        
        results.append({
            "combo": combo,
            "max_wave": max_wave,
            "tier": tier,
            "checkpoints": checkpoints
        })
    
    # 按最高波次降序排序
    results.sort(key=lambda x: x["max_wave"], reverse=True)
    
    return results

def print_results(results: List[Dict]):
    """格式化输出结果"""
    print("=" * 120)
    print("卫戍协议：盟约 - 无限模式组合分析报告")
    print("=" * 120)
    print()
    
    print(f"{'组合配置':<50} {'最高波次':<10} {'评级':<20} {'R45 TTK':<12} {'R65 TTK':<12}")
    print("-" * 120)
    
    for result in results:
        combo = result["combo"]
        combo_str = str(combo)
        max_wave = result["max_wave"]
        tier = result["tier"]
        
        ttk_45 = result["checkpoints"][45][1]
        ttk_65 = result["checkpoints"][65][1]
        
        ttk_45_str = f"{ttk_45:.1f}s" if ttk_45 < 100 else "超时"
        ttk_65_str = f"{ttk_65:.1f}s" if ttk_65 < 100 else "超时"
        
        print(f"{combo_str:<50} {f'R{max_wave}':<10} {tier:<20} {ttk_45_str:<12} {ttk_65_str:<12}")
    
    print()
    print("=" * 120)
    print("详细数值检查点 (前10名)")
    print("=" * 120)
    
    for i, result in enumerate(results[:10]):
        combo = result["combo"]
        print(f"\n【{i+1}】{combo}")
        print(f"   最高稳定波次: R{result['max_wave']} ({result['tier']})")
        print(f"   关键DPS检查点:")
        
        for wave in [15, 25, 35, 45, 55, 65, 75]:
            dps, ttk = result["checkpoints"][wave]
            hp = calculate_boss_hp(wave)
            status = "✓" if ttk <= 50 else "✗"
            print(f"      R{wave}: DPS {dps:>8.1f}万 | BOSS血量 {hp:>8.1f}万 | 击杀时间 {ttk:>6.1f}s {status}")

def analyze_weak_covenants(results: List[Dict]):
    """分析弱势盟约并提出强化方案"""
    print("\n")
    print("=" * 120)
    print("弱势盟约分析与强化建议")
    print("=" * 120)
    
    # 按大盟约分组统计
    major_stats = {}
    for result in results:
        major = result["combo"].major
        max_wave = result["max_wave"]
        
        if major not in major_stats:
            major_stats[major] = {"max": 0, "avg": [], "best_combo": None}
        
        major_stats[major]["avg"].append(max_wave)
        if max_wave > major_stats[major]["max"]:
            major_stats[major]["max"] = max_wave
            major_stats[major]["best_combo"] = result["combo"]
    
    # 计算平均值
    for major in major_stats:
        major_stats[major]["avg"] = sum(major_stats[major]["avg"]) / len(major_stats[major]["avg"])
    
    # 排序
    sorted_majors = sorted(major_stats.items(), key=lambda x: x[1]["max"])
    
    print(f"\n{'大盟约':<15} {'最佳波次':<10} {'平均波次':<10} {'最佳组合':<50}")
    print("-" * 120)
    for major, stats in sorted_majors:
        print(f"{major:<15} {f'R{stats[\"max\"]}':<10} {f'R{stats[\"avg\"]:.1f}':<10} {str(stats['best_combo']):<50}")
    
    # 识别弱势盟约 (最高波次 < R55)
    weak_majors = [major for major, stats in sorted_majors if stats["max"] < 55]
    
    print(f"\n\n需要强化的盟约: {', '.join(weak_majors)}")
    print("\n" + "=" * 120)
    print("具体强化方案:")
    print("=" * 120)
    
    buffs = {
        "阿戈尔": """
【阿戈尔 - 深海吞噬者】当前问题:
  • DPS固定在15万,完全不随层数增长
  • R45后即使击杀时间超时,缺乏后期爆发
  • 超高生存能力无法转化为输出

强化方案 A: 吞噬血量转攻击 (激进)
  • 6人效果追加: 每吞噬1次,永久获得被吞噬者最大生命值2%的攻击力加成
  • 开战吞噬触发时,额外获得全场已击杀敌人总血量0.5%的攻击力
  • 预期效果: R45可达80万DPS,R65可达250万DPS

强化方案 B: 层数攻击成长 (保守)
  • 基础攻击力改为 (1 + 0.015 × L),在9999层可达150倍
  • 6人效果: 每200层,普攻附带3%最大生命值真实伤害
  • 预期效果: R45可达120万DPS,R65可达420万DPS

推荐: 方案B,保持肉盾定位但补足输出短板
        """,
        
        "叙拉古": """
【叙拉古 - 暗影刺客】当前问题:
  • 3%触发率的固定真伤(5000+50L)在亿级血量面前可忽略
  • 迅捷的SP回复机制依赖技能,但技能倍率跟不上血量膨胀
  • 恐惧控制在BOSS霸体机制下价值有限

强化方案 A: 真伤百分比化 (推荐)
  • 3%伪随机普攻触发改为: 造成(5000+50L) + 目标最大生命值5%的真实伤害
  • 6人效果: 每300层,普攻真伤触发率+1%,伤害倍率+0.5%最大生命值
  • 预期效果: R45可达180万DPS,R65可达520万DPS

强化方案 B: 暗影标记机制 (创新)
  • 普攻和技能命中目标施加"暗影标记",持续8秒
  • 6人效果: 每100层,对标记目标伤害提升2%,击杀标记目标恢复10SP
  • 标记目标被击杀时爆炸,对周围造成其最大生命值30%的真伤
  • 预期效果: R45可达160万DPS,R65可达480万DPS,兼具AOE清场

推荐: 方案A,简单直接有效
        """,
        
        "维多利亚": """
【维多利亚 - 重装工业】当前问题:
  • 装备系统30件封顶后,超额转化(1.5%攻防/100层)增长过缓
  • 缺乏独立乘区,与精准的协同有限
  • 中期(R45-R55)有竞争力但后期乏力

强化方案 A: 装备强化系统 (推荐)
  • 6人效果追加: 每击杀1个敌人,随机强化1件装备,最多强化10层
  • 每层强化: 攻击+10%、防御+8%、生命+5%
  • 携带强化装备的干员额外获得0.5%全伤害提升/强化层
  • 预期效果: R55可达720万DPS,R70可达1450万DPS

强化方案 B: 工业产能爆发 (激进)
  • 超过750层后,每100层: 全员攻击+3%、防御+3%、生命+2%
  • 6人效果: 每500层,全队获得1次"工业超载"充能(最多5层)
  • 超载消耗: 10秒内全员攻击+200%、攻速+100、技能CD-50%
  • 预期效果: 爆发期R65可达1200万DPS,但持续输出仍受限

推荐: 方案A,平滑增长曲线
        """
    }
    
    for major in weak_majors:
        if major in buffs:
            print(f"\n{buffs[major]}")

if __name__ == "__main__":
    print("正在分析所有盟约组合...")
    results = analyze_all_combinations()
    print_results(results)
    analyze_weak_covenants(results)
    
    print("\n\n分析完成!")
    print(f"共评估 {len(results)} 种合法组合")
