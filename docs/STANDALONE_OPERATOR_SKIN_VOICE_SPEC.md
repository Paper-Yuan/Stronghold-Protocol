# 卫戍协议 MOD 原创独立干员（全自带皮肤与语音）专项规范

> 适用场景：MOD 引入的干员**不在官方已有的 112 名干员池中**（完全原创角色 / 未收录角色 / 同人特供角色）  
> 核心要求：**全自给自足（Self-Contained）**，MOD 包内必须全量自带专属 Spine 骨骼模型、头像、立绘与 12 槽战斗语音。  
> 执笔：石井 | 架构与多端沙盒工程

---

## 一、 为什么这类干员必须“全自包含”？

在常规 MOD 中，如果干员复用官方现有角色，只需声明 `assetsSpine: "char_1038_whitw2"` 即可直接借用官方资源。

但当干员为**全新的非官方池角色**时：
1. 客户端与服务端的原版资产库中**完全不存在她的模型、立绘与音频**；
2. 如果 MOD 仅提供数值（`chess.json`），而缺少自带美术与音频，游戏引擎在部署时会因为找不到 Spine 资产而**显示为空白隐形单位**，播放技能时**完全静音**。
3. 因此，此类 MOD 必须遵循**全自包含契约（Standalone Operator Bundle）**。

---

## 二、 独立干员标准包体目录结构

一个包含自备皮肤与自备语音的完整独立干员包结构必须如下：

```text
my-custom-operator.zip (或 .spmod)
├── pack.json                       [必选] 声明清单、语音槽位与皮肤清单
├── README.md                       [必选] 干员背景简介、技能机制说明
├── chess.json                      [必选] 干员双形态基础面板、职业、攻击范围与技能
├── records.json                    [可选] 绑定的专属装备或词条
│
└── assets/                         [核心资产仓]
    ├── char/                       [头像与半身立绘]
    │   ├── avatar_char_ws_alice.png       (180×180 方形头像，用于编队与调配)
    │   └── portrait_char_ws_alice.png     (高清立绘，用于图鉴与选人详情)
    │
    ├── spine/                      [战斗小人 Spine 骨骼三件套]
    │   ├── char_ws_alice.atlas            (纹理图集坐标文件)
    │   ├── char_ws_alice.png              (贴图材质大图，上限 2048×2048)
    │   └── char_ws_alice.skel (或 .json)  (动作骨骼二进制/JSON 文件)
    │
    └── voice/                      [12 大战术槽位作战音频 (MP3)]
        ├── jp/ (或默认 voice/)     [默认语种]
        │   ├── start.mp3, select.mp3, place.mp3, faceEnemy.mp3
        │   ├── skill1.mp3, skill2.mp3, skill3.mp3, skill4.mp3
        │   └── resultFour.mp3, resultThree.mp3, resultTwo.mp3, resultLose.mp3
        │
        └── cn/                     [国语配音]
            ├── start.mp3, select.mp3, place.mp3, faceEnemy.mp3
            ├── skill1.mp3, skill2.mp3, skill3.mp3, skill4.mp3
            └── resultFour.mp3, resultThree.mp3, resultTwo.mp3, resultLose.mp3
```

---

## 三、 `pack.json` 专属自包含元数据声明

在 `pack.json` 中，必须完整绑定自带的皮肤与多语言语音：

```json
{
  "id": "standalone-alice",
  "name": "原创干员：爱丽丝",
  "version": "1.0.0",
  "app": ">=0.2.0",
  "author": "Rhodes Research",
  "license": "CC-BY-NC-4.0",
  "content": ["chess"],
  "standaloneOperators": ["char_ws_alice"],

  "skins": {
    "char_ws_alice": {
      "default": {
        "name": "默认着装",
        "avatar": "assets/char/avatar_char_ws_alice.png",
        "portrait": "assets/char/portrait_char_ws_alice.png",
        "spine": {
          "atlas": "assets/spine/char_ws_alice.atlas",
          "texture": "assets/spine/char_ws_alice.png",
          "skeleton": "assets/spine/char_ws_alice.skel"
        }
      }
    }
  },

  "voices": {
    "char_ws_alice": {
      "start": ["assets/voice/jp/start.mp3"],
      "select": ["assets/voice/jp/select.mp3"],
      "place": ["assets/voice/jp/place.mp3"],
      "skill1": ["assets/voice/jp/skill1.mp3"],
      "resultFour": ["assets/voice/jp/resultFour.mp3"],
      "resultLose": ["assets/voice/jp/resultLose.mp3"]
    }
  },

  "voiceLangs": {
    "cn": {
      "char_ws_alice": {
        "start": ["assets/voice/cn/start.mp3"],
        "select": ["assets/voice/cn/select.mp3"],
        "place": ["assets/voice/cn/place.mp3"],
        "skill1": ["assets/voice/cn/skill1.mp3"],
        "resultFour": ["assets/voice/cn/resultFour.mp3"],
        "resultLose": ["assets/voice/cn/resultLose.mp3"]
      }
    }
  }
}
```

---

## 四、 对我们客户端运行时的改造适配要求

要让手机端和 PC 端在**没有网络、完全断网的情况下**也能正常显示自带皮肤、播放自带语音，我们的客户端需要打通以下两条运行时通道：

### 1. 动态 Spine 内存挂载管道 (In-Memory Spine Resolver)
- **挑战**：PixiJS-Spine 默认是通过服务端 HTTP URL 加载。在手机端离线沙盒下，文件存在 IndexedDB 中。
- **要求**：
  1. 解包时将 `char_ws_*.png` 与 `*.skel` 存为 Blob；
  2. 游戏渲染干员时，渲染器（`public/js/render/`）通过 `URL.createObjectURL(blob)` 动态创建临时内存链接；
  3. 挂接进 PixiJS Texture 缓存，确保战场小人正常播放 `Idle` 与 `Attack` 骨骼动画。

### 2. 动态音频回退播放器 (Dynamic Voice Fallback Player)
- **挑战**：`audio.js` 在根据 `charId` 寻找音频时，如果官方音频清单 `assets.audio.voice` 中没有该干员，默认会直接放弃播放。
- **要求**：
  1. `public/js/audio.js` 的 `voiceLinesFor()` 增加第二段查找逻辑：
     ```javascript
     // 若官方资产清单未命中，检查当前激活的本地 MOD 语音注册表
     if (!lines && globalThis.__MOD_VOICE_REGISTRY__) {
       lines = globalThis.__MOD_VOICE_REGISTRY__[lang]?.[charId]?.[slot] 
            || globalThis.__MOD_VOICE_REGISTRY__['default']?.[charId]?.[slot];
     }
     ```
  2. 音频通过已转换为 Blob URL 的临时链接使用 HTML5 Audio 播放。

---

## 五、 自带资源规格硬性门禁

为了防止创作者随意塞入未经优化的超大资源拖垮移动端：

| 资产类型 | 格式硬性要求 | 尺寸与体积门禁 | 关键动作/槽位 |
|---|---|---|---|
| **战斗小人 Spine** | Spine 3.8 / 4.0 导出的 `.atlas` + `.png` + `.skel` | `.png` 贴图上限 **2048×2048**，总大小 **< 3 MB** | 必须具备 `Idle`（待机）、`Attack`（攻击）、`Die`（阵亡） |
| **方形头像** | 透明底 PNG | **180×180 px**，**< 150 KB** | 头部居中，用于调配栏与战局血条 |
| **半身/全身立绘** | 透明底 PNG 或 WebP | 高度 **1024 px** 左右，**< 1.5 MB** | 用于干员详情大图展示 |
| **作战语音 (12 槽)** | **MP3** (96kbps / 128kbps) | 单条语音 **< 200 KB**，整套 **< 2 MB** | 至少包含 `start`, `place`, `skill1`, `resultFour` |

---
*遵循此规范的原创干员 MOD，在完全脱离官方原版干员池的情况下，亦能在手机端与 PC 端实现 100% 独立的视听与战斗体验。*
