# 卫戍协议 MOD 自动化创作规范（AI Agent 与 Skill 体系篇）

> 适用对象：Antigravity Agent、Subagents、Claude Code、Cursor 与大型代码模型  
> 核心目标：指导 AI 按照《卫戍协议·工坊》引擎严密规范，自主设计、推导、校验并交付 100% 零错误的 MOD 包。  
> 执笔：石井 | 安全架构与工程规范

---

## 一、 AI 创作者第一铁律：推导闭环体系

在《卫戍协议》工坊系统中，AI **严禁凭空捏造复合游戏数据**。必须遵守以下三条硬性约束：

1. **事实与推导严格分离（Facts vs. Derived）**：
   - AI 只写**事实 Spec**（干员星级、基础数值、技能描述、技能倍率、攻击范围名称）。
   - 衍生字段（如 `attrPower`, `params`, `cellCount`, `groundPaths`, `totalCount`, `sellPrice`）**一律由 `derive*` 工具自动推导**。手动写推导字段若不匹配，校验器会直接以 `STALE_DERIVED` 报错拒绝。
2. **闭环验证门禁（Validation Gate）**：
   AI 产出任何 MOD 文件后，必须在终端执行以下校验命令并解析 JSON 结果：
   ```powershell
   node tools/workshop-validate.mjs workshop/<packId> --json
   ```
   输出包含 `0 error(s)` 与 `VALID: the engine accepts this content` 才能宣告完成。若有错误，根据返回的 `field` 与 `code` 进行自愈修复。
3. **命名空间与前缀隔离**：
   自制干员 ID 必须以 `char_ws_` 开头；装备 ID 以 `chess_item_ws_` 开头；敌人 ID 以 `enemy_ws_` 开头；盟约 ID 以 `bondeffect_` 开头。

---

## 二、 官方推荐：Forge Mod Creator Skill 定义

在 Antigravity 环境下，可为 AI 注册专门的 Skill 模块：`~/.gemini/config/skills/forge-mod-creator/SKILL.md`。

### Skill 规范元数据

```markdown
---
name: forge-mod-creator
description: 卫戍协议（Stronghold Protocol）专业 MOD 创作者套件。用于全自动生成合规干员、装备、盟约、地图及行为层 Kit JavaScript 脚本，并通过工坊静态门禁自动校验。当用户要求「制作新干员」「做一个装备mod」「设计一张地图」「编写kit技能」时触发。
---

# 卫戍协议工坊创作规范

## 执行流程 (Pipeline)
1. 需求解析：明确用户想要的 MOD 种类 (Operator / Item / Bond / Stage / Kit)。
2. Spec 构造：在 `workshop/<packId>/<kind>-specs/<slug>.json` 生成纯事实数据。
3. 腳手架推导：执行 `node tools/workshop-scaffold.mjs <specPath> --pack <packId>`。
4. Kit 编写（若有）：在 `workshop/<packId>/kits/<chessId>.js` 编写行为钩子。
5. 门禁审计：执行 `node tools/workshop-validate.mjs workshop/<packId> --json`。
6. 打包交付：执行 `node tools/workshop-pack.mjs <packId>`。
```

---

## 三、 多 Subagent 角色分工与协作协议

当处理复杂大包（如包含多名干员、专属装备、全套盟约与定制地图的阵营包）时，建议通过 `invoke_subagent` 拆解为三名专业 Subagent 协同工作：

```mermaid
flowchart LR
    A["Subagent 1: ModArchitect\n(概念策划与平衡性仲裁)"] --> B["Subagent 2: SpecAuthor\n(数据推导与 JSON 编写)"]
    B --> C["Subagent 3: KitEngineer\n(行为层 JS 脚本编写)"]
    C --> D["Validation Gate\n(运行 workshop-validate.mjs 闭环验收)"]
    D -- 报错回退 -- B
```

### 1. `ModArchitect`（架构策划 Agent）
- **职责**：
  - 检查用户诉求，规划包 ID（如 `pack-abyss-hunters`）；
  - 定义干员的职业定位（如：快速狙击、重装铁卫），根据星级标准拟定普通/精锐两套数值基线；
  - 规划装备 Tier 等级与盟约 2/4/6 阶段阈值，避免数值膨胀（Power Creep）。

### 2. `SpecAuthor`（数据规范 Agent）
- **职责**：
  - 产出严格符合规范的 `operator-spec`、`item-spec`、`bond-spec` JSON 文件；
  - 示例模板（干员 Spec）：
    ```json
    {
      "id": "char_ws_glacier_guard",
      "name": "极地守卫",
      "tier": 5,
      "profession": "DEFENDER",
      "subProfessionId": "protector",
      "position": "MELEE",
      "traitDesc": "能够阻挡三个敌人",
      "assetsSpine": "char_1028_bison",
      "stats": {
        "normal": { "maxHp": 2400, "atk": 420, "def": 580, "res": 10, "cost": 19, "blockCnt": 3, "bat": 1.2 },
        "golden": { "maxHp": 3200, "atk": 560, "def": 780, "res": 15, "cost": 19, "blockCnt": 3, "bat": 1.2 }
      },
      "skill": {
        "name": "冰甲屏障",
        "desc": "防御力+80%，每次受击回复 1 点技力",
        "skillType": "MANUAL",
        "spType": "INCREASE_WHEN_TAKEN_DAMAGE",
        "spData": { "spCost": 25, "initSp": 10 },
        "blackboard": { "def": 0.8 }
      }
    }
    ```

### 3. `KitEngineer`（行为层脚本 Agent）
- **职责**：
  - 编写 `kits/<chessId>.js`；
  - 遵循 **Kit 四条硬规则**：
    1. **确定性原则**：严禁使用 `Math.random()` 或非确定性定时器，随机事件必须调用 `battle.rng.next()`；
    2. **纯粹性原则**：严禁操作 DOM、网络或外部文件；
    3. **自闭环依赖**：严禁使用绝对路径 import，仅允许使用相对路径或标准 SDK 钩子；
    4. **事件钩子白名单**：只能监听官方 36 个合法事件（`onCast`, `onHit`, `onKilled`, `onHeal`, `tick` 等）。
  - 示例代码：
    ```javascript
    export default function kit(bb, chess, def) {
      return {
        skill: {
          kind: 'manual',
          sp: 25,
          onCast(battle, unit) {
            battle.addBuff(unit, {
              key: 'ice_shield',
              duration: 15,
              mods: { defPct: bb.def || 0.8 }
            });
          }
        },
        talents: [{
          name: '寒霜荆棘',
          description: '受击时对攻击者施加减速',
          onDamaged(battle, victim, attacker, damage) {
            if (attacker && !attacker.isDead) {
              battle.addBuff(attacker, {
                key: 'frost_slow',
                duration: 3,
                mods: { moveSpeedPct: -0.3 }
              });
            }
          }
        }]
      };
    }
    ```

---

## 四、 AI 创作常见错误排查索引 (Error Code Runbook)

| 错误代码 | 根本原因 | AI 自愈动作 |
|---|---|---|
| `STALE_DERIVED` | AI 手动填写了推导字段且与推导器计算结果不符 | 从 Spec 中彻底删除该字段，重新运行 `scaffold` 脚本自动生成 |
| `HOOK_UNKNOWN_EVENT` | Kit 中监听了不存在的事件名称 | 核对 `shared/kitAuthoring.js` 中的 36 个 `HOOK_EVENTS` 标准事件名 |
| `VOICE_SLOT_UNKNOWN` | 语音槽位名称写错 | 只能使用 `start`, `select`, `place`, `skill1~4`, `resultFour~Lose` |
| `ASSETS_NEED_LICENSE` | 在 `assets/` 放入了图片/音频，但 `pack.json` 缺少 `license` 声明 | 在 `pack.json` 补齐 `"license": "CC-BY-NC-4.0"` |
| `SUPPORT_FOREIGN_OPERATOR`| 把官方干员写进了助战池声明 | 助战池只能写自己模组新增的 `char_ws_*` 干员 |

---
*本文档为 AI Agent 在《卫戍协议》项目下编写 MOD 的权威执行手册。*
