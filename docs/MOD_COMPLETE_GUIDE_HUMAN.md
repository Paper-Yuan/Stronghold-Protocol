# 卫戍协议 MOD 创作与多端全量适配全景指南（人类篇）

> 适用工具：Stronghold-Protocol-Forge 0.13.0  
> 适用端：卫戍协议 v0.2.2-fusion 升级版（PC 网页端 / Android 手机移动端 / 离线单人沙盒 / 无尽模式）  
> 执笔：石井 | 适合所有 MOD 创作者与玩家

---

## 目录
1. [生态概览与核心铁律](#一-生态概览与核心铁律)
2. [本地工坊编辑器启动与新建项目](#二-本地工坊编辑器启动与新建项目)
3. [干员制作：常规复用角色 vs. 独立原创角色](#三-干员制作常规复用角色-vs-独立原创角色)
4. [原创干员必须自带专属皮肤与语音（核心实操）](#四-原创干员必须自带专属皮肤与语音核心实操)
5. [装备与藏品制作：词条、配方与自备图标](#五-装备与藏品制作词条配方与自备图标)
6. [阵营盟约、地图与出怪波次搭建](#六-阵营盟约地图与出怪波次搭建)
7. [进阶玩法：编写行为层 Kit 原创机制代码](#七-进阶玩法编写行为层-kit-原创机制代码)
8. [多端适配防翻车指南（手机端与无尽模式必读）](#八-多端适配防翻车指南手机端与无尽模式必读)
9. [一键打包与手机/电脑双端导入实测](#九-一键打包与手机电脑双端导入实测)

---

## 一、 生态概览与核心铁律

1. **绝对零污染原则（非侵入式挂载）**：
   - 官方游戏文件（`data/*.json`、官方素材包）绝对只读，**严禁使用任何覆盖官方文件的旧式安装脚本**。
   - 任何 MOD 均以**数据叠加图层（Overlay）**形式在内存中合并。关掉或卸载 MOD，游戏瞬间变回纯净官方版，无需重装。
2. **多端标准包格式（.spmod / .zip）**：
   - 无论在电脑还是手机上，MOD 统一为标准 `.zip`（或 `.spmod`），解压后根目录第一层直接看到 `pack.json` 与 `README.md`。

---

## 二、 本地工坊编辑器启动与新建项目

1. **一键启动**：
   - 双击根目录下的 `启动工坊编辑器.bat`（或终端运行 `npm run editor`）；
   - 浏览器访问 `http://localhost:3001`，即可进入包含 9 大可视化工作台的 Forge 编辑器。
2. **新建项目**：
   - 打开顶部 **「模组信息与打包」**（`/pack.html`）-> 点击「新建模组」；
   - 填写包 ID（如 `pack-abyss-covenant`）、名称、作者、版本（1.0.0）与开源协议（如 CC-BY-NC-4.0）；
   - 保存后，本地 `workshop/<packId>/` 项目骨架自动就绪。

---

## 三、 干员制作：常规复用角色 vs. 独立原创角色

在干员工作台（`/`）捏人时，分为两种截然不同的路线：

| 类型 | 使用场景 | 模型与语音要求 | 制作难易度 |
|---|---|---|---|
| **A. 常规复用干员** | 为官方已有干员制作新形态，或借用已有干员的外观动作 | 直接在下拉框中选择官方现有的 112 名干员模型（如白铁、能天使）与官方语音 | ⭐ 极简单，只需填数值 |
| **B. 独立原创新干员** | **完全不在官方池中的角色**（全新原创干员、明日方舟未实装同人干员） | **必须全自包含（Self-Contained）**：MOD 包内必须自带专属 Spine 骨骼、立绘头像与 12 槽 MP3 语音 | ⭐⭐⭐ 需自备素材 |

---

## 四、 原创干员必须自带专属皮肤与语音（核心实操）

如果你制作的是**不在官方干员池的新角色**，必须按照以下流程在包内自带资源，否则进战斗小人会隐形变成空气，放技能完全静音！

### 1. 文件夹结构规划
在你的模组目录下创建 `assets/` 资源仓：
```text
workshop/my-pack/
├── pack.json
├── chess.json
└── assets/
    ├── char/
    │   ├── avatar_char_ws_myop.png        (180×180 正方形透明底头像)
    │   └── portrait_char_ws_myop.png      (半身或全身立绘大图)
    ├── spine/
    │   ├── char_ws_myop.atlas             (图集坐标描述文件)
    │   ├── char_ws_myop.png               (贴图大图，分辨率 ≤ 2048×2048)
    │   └── char_ws_myop.skel (或 .json)   (Spine 3.8/4.0 骨骼动作文件)
    └── voice/
        ├── jp/ (默认语种) -> 放入 start.mp3, select.mp3, place.mp3, skill1.mp3, resultFour.mp3 ...
        └── cn/ (国语配音) -> 放入 start.mp3, select.mp3, place.mp3, skill1.mp3, resultFour.mp3 ...
```

### 2. Spine 必备动作门禁（防隐形）
Spine 动作名必须包含：
- `Idle`（站立待机动作）
- `Attack`（普通攻击动作）
- `Die`（阵亡倒地动作）
- `Default`（默认基准姿态）

### 3. 语音 12 大战斗槽位（防静音）
音频必须是 **MP3 格式**（64~128kbps，单条 < 200KB），对应以下标准槽位：
- `start`（行动开始）、`faceEnemy`（接敌警告）、`select`（选中）、`place`（部署）
- `skill1` ~ `skill4`（技能 1 至 4 触发）
- `resultFour`（绝境胜利）、`resultThree`（险境胜利）、`resultTwo`（标准胜利）、`resultLose`（失败）

### 4. `pack.json` 自动绑定
在 Forge 编辑器中保存时，或手动在 `pack.json` 中绑定：
```json
{
  "skins": {
    "char_ws_myop": {
      "default": {
        "avatar": "assets/char/avatar_char_ws_myop.png",
        "portrait": "assets/char/portrait_char_ws_myop.png",
        "spine": {
          "atlas": "assets/spine/char_ws_myop.atlas",
          "texture": "assets/spine/char_ws_myop.png",
          "skeleton": "assets/spine/char_ws_myop.skel"
        }
      }
    }
  },
  "voices": {
    "char_ws_myop": {
      "start": ["assets/voice/jp/start.mp3"],
      "place": ["assets/voice/jp/place.mp3"],
      "skill1": ["assets/voice/jp/skill1.mp3"]
    }
  },
  "voiceLangs": {
    "cn": {
      "char_ws_myop": {
        "start": ["assets/voice/cn/start.mp3"],
        "place": ["assets/voice/cn/place.mp3"],
        "skill1": ["assets/voice/cn/skill1.mp3"]
      }
    }
  }
}
```

---

## 五、 装备与藏品制作：词条配方与自备图标

进入装备制作工作台（`/item.html`）：

1. **设置图标**：
   - **方式 A（用自己的图）**：做一张 128×128 正方形透明底 PNG，放入 `assets/item/my_sword.png`，页面下拉框直接勾选；
   - **方式 B（借用官方图）**：在「图标 trapId」下拉框直接搜索挑选官方几百种现成精美装置图标（如 `trap_1013_lhp`）。
2. **配置词条 Buff**：
   - 添加词条，如 `atk_ratio: 0.25`（攻击+25%）、`attack_speed: 20`（攻速+20）；
   - 设置售价（如 3 点）与偏好盟约标签。

---

## 六、 阵营盟约、地图与出怪波次搭建

- **盟约制作（`/bond.html`）**：
  - 设置阵营 ID、名字（2~6 汉字）、徽记图片（256×256 透明底 PNG）；
  - 配置梯级羁绊阈值（如 2人加闪避、4人加反伤、6人召唤助手）；
  - 勾选该阵营的干员名单。
- **地图绘制（`/stage.html`）**：
  - 挑选 19×21 棋盘尺寸；
  - 像画画一样涂抹高台、地面、不可通行深坑、放置阻挡箱；
  - 标定红门（`S` 出怪点）与蓝门（`E` 目标点），点击「测试寻路」自动推算陆空路线。
- **波次排布（`/wave.html`）**：
  - 编排第 1 回合第 3 秒刷 2 只猎狗，第 15 秒刷领袖 Boss。

---

## 七、 进阶玩法：编写行为层 Kit 原创机制代码

如果你想做出游戏原版没有的特异机制（如偷取防御、阵亡全图自爆、护盾转换）：

1. 打开 Kit 工作台（`/kit.html`），选中你的干员；
2. 编写纯 JavaScript 事件钩子：
   ```js
   export default function kit(bb, chess, def) {
     return {
       skill: {
         kind: 'manual',
         sp: 30,
         onCast(battle, unit) {
           battle.log(`${unit.name} 触发了狂暴！`);
         }
       },
       talents: [{
         name: '灵魂汲取',
         // 每次击杀敌人，永久提升自身 5% 攻击力（带防溢出上限）
         onKill(battle, attacker, victim) {
           if (attacker.atkBonusPct < 1.0) {
             attacker.atkBonusPct = (attacker.atkBonusPct || 0) + 0.05;
           }
         }
       }]
     };
   }
   ```
3. 点击「静态检查」，系统自动校验是否存在死循环或越权操作。

---

## 八、 多端适配防翻车指南（手机端与无尽模式必读）

为了保证你的 MOD 在手机端和无尽模式下不遮挡、不拉伸变形、不报错闪退，务必注意以下细节：

1. **描述文案不可太长**：技能说明在 **60 字以内**，天赋在 **40 字以内**。手机屏幕小，小作文会把部署按键顶出屏幕。
2. **装备与盟约图片必须是 1:1 正方形**：严禁上传长方形图片，否则在手机格子里会被硬性压扁畸变。
3. **禁止使用外部网络图床链接**：所有图片和音频必须打包在包内 `assets/`，否则玩家手机断网飞行模式下会全部变成裂图和静音。
4. **必须提供双阶段数值（Normal + Golden）**：不能只写普通形态，缺漏精锐形态会在干员升 2 星黄金时导致数值变 0。
5. **无尽模式防数值爆炸**：任何叠加属性必须设置上限封顶（如 `cap: 100%`），防止高回合运算出 `Infinity` 或 `NaN` 导致死局。
6. **Kit 脚本严禁调用 `Math.random()`**：所有概率必须使用 `battle.rng.next()`，否则联机时手机与电脑伤害计算不同步会直接断开对局。

---

## 九、 一键打包与手机/电脑双端导入实测

1. **导出 MOD 包**：
   - 进入 `/pack.html` -> 点击 **「导出模组包」**；
   - 系统自动打出规范的 `my-pack-1.0.0.zip`。
2. **电脑端与手机端导入**：
   - 启动游戏（浏览器访问 `http://localhost:3000` 或打开手机端 APK）；
   - 在游戏主页点击 **「模组」** 管理器；
   - 点击 **「选择本地模组包 (.zip)」**，选中刚才导出的 zip；
   - 客户端流式解压器瞬间解析并存入本地 IndexedDB 沙盒；
   - 进入单人模拟、无尽模式或联机房间，你的新干员、专属皮肤立绘、配音与装备全量生效！
