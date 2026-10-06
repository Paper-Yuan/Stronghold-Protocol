明日方舟「卫戍协议：盟约」安卓端独立完全体 v0.1.1（基于上游 v0.1.1 修复版构建）

本版本完整同步上游 `v0.1.1` 核心战斗、敌人行为与机制修正，并深度优化安卓移动端触控体验、干员语音系统、视觉排版与工程合规门禁。

---

### 主要更新与改动

#### 1. 同步上游 v0.1.1 核心修复
- **战斗逻辑**：阵法术师 / 轰击术师真群攻；飞行敌人免疫推拉；深巡、雷蛇、号角、灰毫技能进范围自动触发；蒂比起飞、维娜·维多利亚、玛恩纳、烛煌技能判定修复；深水区禁用地面部署；战术家援军限制攻击范围。
- **敌人机制**：转译基底变身、深池逐火余烬击杀判定、暴鸰投弹、鸭爵圆仔不可阻挡、源石地板斜行逻辑。
- **对局与界面**：悬赏决策结构对齐官方实机、凯瑟琳/娜仁图亚装备显示、收起商店棋盘自适应放大。
- **AI 人机**：困难人机决策深度优化。

#### 2. 安卓移动端专项优化
- **干员人声完整链路**：恢复 120 条干员部署与点击专属语音映射，实现统一键解析与单通道并发限流，接入系统级 AudioFocus 焦点管控。
- **全新高清战徽图标**：集成方案 C 战角圆徽自适应高清矢量图标（覆盖 hdpi 至 xxxhdpi），告别原生绿方块。
- **移动端排版与碰撞消除**：
  - Briefing 战况行支持长关卡名（如 19 字水上平台）弹性自适应换行，设定物理字号下限（10px / 13px），彻底杜绝文字溢出重叠；
  - 盟约插槽扩大至 34px，盟约圆盘增大至 26px，字体下限 11px，中心对齐偏差控制在 8% 以内；
  - 剔除伪 44px 隐式命中区，消灭相邻 slot 间距过密引起的触摸冲突；
  - 干员详情面板与顶部盟约条避让，点击棋盘空白区域快速关闭；
  - 晋升奖励（rwtag）排版截断与字距留白优化。
- **内置原生运行时与局域网开黑**：
  - 采用 JNA 原生 C 级桥接与 64 位 Node.js 运行时，在应用进程内直接启动游戏模拟引擎，彻底绕开 Android 10+（API 29–34）SELinux W^X 权限拦截，点开即玩纯单机离线模式；
  - 服务端引擎监听全网卡（`0.0.0.0:3000`），支持手机做房主，与局域网内其他手机或电脑联机。
- **工程安全与合规门禁**：
  - 打包器升级为纯只读比对，彻底杜绝构建流程意外污染版本控制文件；
  - 原生依赖库（`libnode.so`、`libc++_shared.so`）强制 sha256 完整性校验；
  - 运行时资源包附带开源证书文件（GPL、Spine Runtimes、MIT 等完整清单）。

---

### 致谢与数据来源

本项目由衷感谢开源社区与上游项目的卓越贡献：
- **上游项目**：感谢 [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol) 的开源架构与对局复刻实现；
- **游戏数据**：感谢 [Kengxxiao/ArknightsGameData](https://github.com/Kengxxiao/ArknightsGameData)；
- **素材与解包支持**：感谢 [PRTS 明日方舟中文 Wiki](https://prts.wiki/)、[yuanyan3060/ArknightsGameResource](https://github.com/yuanyan3060/ArknightsGameResource)、[fexli/ArknightsResource](https://github.com/fexli/ArknightsResource)、[isHarryh/Ark-Models](https://github.com/isHarryh/Ark-Models) 以及 [isHarryh/Ark-Unpacker](https://github.com/isHarryh/Ark-Unpacker)；
- **核心组件库**：[PixiJS](https://pixijs.com/)、[pixi-spine](https://github.com/pixijs/spine)、[three.js](https://threejs.org/)、[Preact](https://preactjs.com/) + [htm](https://github.com/developit/htm)、[ws](https://github.com/websockets/ws)；
- **Android 原生运行时**：[Node.js](https://nodejs.org/) (libnode)、[JNA](https://github.com/java-native-access/jna)。

---

### 免责声明与开源许可

> **【重要声明】**
> 本项目为**非官方、非商业的同人复刻移植作品**，与鹰角网络 (Hypergryph) / Yostar 无关。
> 游戏内涉及的所有《明日方舟》相关美术、音乐、音效、文本及数据等内容，其版权均归原权利人所有，**不适用 GPL 许可证**。
> 本项目严禁任何形式的商业化售卖、付费分发、广告嵌入或任何形式的盈利行为。

- **代码许可**：本项目移植与新编写代码以 **GPL-3.0-or-later** 许可证发布，完整声明见仓库内 [LICENSE](LICENSE) 与 [NOTICE.md](NOTICE.md)。
