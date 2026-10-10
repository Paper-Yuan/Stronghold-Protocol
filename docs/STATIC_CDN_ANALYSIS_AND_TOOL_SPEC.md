# 卫戍协议静态素材 CDN 托管服务研究报告与集成方案

> 目标系统：`https://downcdn.jiangjiangze.icu/admin`  
> 认证密钥：`x-admin-key: mod325`  
> 核心定位：**第三方 MOD 静态素材云端托管池（服务器免发静态素材 + 自动 SHA-256 查重 + 只增不删）**  
> 执笔：石井 | 安全架构与协议逆向研究

---

## 一、 系统架构与运转全貌

通过逆向分析其前端页面、接口契约及底层发布流水线，该托管服务是**专为《卫戍协议：盟约》量身打造的高可靠静态资产分发系统**：

```text
┌────────────────────────────┐          ┌──────────────────────────────────────┐
│  开发者 / MOD 创作者 / AI   │          │  游戏客户端 (PC 浏览器 / Android 手机) │
└─────────────┬──────────────┘          └──────────────────▲───────────────────┘
              │ 上传新素材 (带 sha256)                      │ 直接并发极速拉取
              ▼                                            │ (免自建服务器带宽)
┌────────────────────────────┐                  ┌──────────┴───────────┐
│     上传管理后台 (API)     │                  │  公共全球加速 CDN 节点  │
│ downcdn.jiangjiangze.icu   │                  │ weishucdn.jiangjiangze.icu
└─────────────┬──────────────┘                  └──────────▲───────────┘
              │ 暂存 (Staging)                             │ 触发式原子同步
              ▼                                            │
┌────────────────────────────┐                  ┌──────────┴───────────┐
│ S3 / R2 暂存桶 (Incoming)  ├─────────────────►│  GitHub Actions 发布机   │
│   流式核对 SHA-256 签名    │ (Promote Actions)│ (写入 hosted.json 索引)│
└────────────────────────────┘                  └──────────────────────┘
```

### 1. 域名与服务角色分离
- **管理与上传端点**：`https://downcdn.jiangjiangze.icu`
  - 接口鉴权：请求头 `x-admin-key: mod325`
  - 负责接收暂存、校验大小、调度发布轮。
- **公共对外 CDN 加速端点**：`https://weishucdn.jiangjiangze.icu`
  - 真正对外分发静态素材的节点，开启全域 CORS 跨域（`Access-Control-Allow-Origin: *`）。
  - 带不可变强缓存：`Cache-Control: public, max-age=31536000, immutable`。

---

## 二、 核心机制剖析（三大硬核设计）

### 1. 自动查重与秒传机制 (Automatic Deduplication)
- **原理**：系统维护了全局静态索引 `https://weishucdn.jiangjiangze.icu/cdn/v1/hosted-index.json` 与 `tree.json`，每个文件记录唯一的 `size` 与 `sha256`。
- **效果**：
  - 上传前先计算本地文件的 SHA-256 哈希；
  - 若哈希在远程索引中已存在，**自动跳过上传，零重复占用存储与带宽**；
  - 即使不同的 MOD 引用了相同的官方头像或音效，也能瞬间实现“秒传命中”。

### 2. 绝对安全：只增不删与防 XSS 注入
- **不可覆盖与只增不删（Append-Only）**：
  - 后台严禁覆盖已有键、严禁随意删除已上线文件；
  - 避免某个 MOD 覆盖资源导致其他 MOD 或官方原版游戏贴图异常。
- **拒绝可执行文件（XSS 免疫）**：
  - 仅接收纯静态素材扩展名：`png`, `jpg`, `jpeg`, `webp`, `gif`, `atlas`, `skel`, `json`, `txt`, `mp3`, `ogg`, `wav`, `woff`, `woff2`, `ttf`, `zip` 等；
  - **严禁 `.html`, `.svg`, `.js`**：因 CDN 开启了全开放跨域，禁止任何可执行文件上传，杜绝 XSS 注入风险。

### 3. 服务器带宽彻底解脱（Server-Offloaded）
- 自建 Node.js 游戏服务端**完全不需要负责发送庞大的图片与音频**；
- 无论是 PC 端还是 Android 手机端，全部从该 CDN 高速节点拉取素材，自建服务器只处理对局同步与 WebSocket 消息，1 核 1G 小服务器也能稳定承载多人联机。

---

## 三、 目录归类标准（与游戏底层 100% 对齐）

上传路径必须严格遵循游戏标准目录结构，严禁自定义根目录：

| 目标前缀 | 存放内容与规范 |
|---|---|
| `assets/char/avatar/` | 干员常规头像 |
| `assets/char/portrait/` | 干员半身/全身立绘大图 |
| `assets/char/skin_avatar/` | 皮肤专用头像 |
| `assets/spine/op/` | 干员 Spine 骨骼三件套（`.atlas` + `.skel` + `.png`） |
| `assets/spine/enemy/` | 敌人 Spine 骨骼三件套 |
| `assets/audio/voice/` | 作战语音（`cn/` 或 `jp/`，单条 MP3 < 200KB） |
| `assets/audio/sfx/` | 战斗音效 |
| `assets/audio/bgm/` | 背景音乐 |
| `assets/item/` | 装备与藏品图标（正方形透明底 PNG） |
| `assets/bond/` | 盟约阵营徽记图标 |
| `assets/skill/` | 技能图标 |
| `packs/` | 第三方 MOD 发布的标准分发 zip |

---

## 四、 本地工程集成工具 (`tools/cdn-upload.mjs`)

已在仓库内直接落地专用同步工具：[tools/cdn-upload.mjs](file:///E:/Workbox/sp-upgrade-2.1/tools/cdn-upload.mjs)。

### 常用命令指令集：

```bash
# 1. 检查 CDN 状态与待发布队列
node tools/cdn-upload.mjs --status

# 2. 上传单个素材并立即触发发布
node tools/cdn-upload.mjs \
  --file=./my_sword.png \
  --to=assets/item/chess_item_ws_my_sword.png \
  --source=kazdel-pack \
  --what="卡兹戴尔自制装备图标" \
  --kick

# 3. 全目录自动查重批量上传（重复文件自动秒传跳过）
node tools/cdn-upload.mjs \
  --dir=./workshop/my-pack/assets/item \
  --to=assets/item/ \
  --source=my-pack

# 4. 手动催促发布轮上线（通常 1~2 分钟落到 weishucdn）
node tools/cdn-upload.mjs --kick
```

---

## 五、 与 MOD 体系的联动最佳实践

1. **瘦身 90%**：制作包含大量立绘与 MP3 语音的重型 MOD 时，先把 `assets/` 批量同步到该 CDN；
2. **免打包静态图**：MOD 的 `pack.json` 或 `assets.json` 直接引用 CDN 上的相对路径或标准键名；
3. **极速分发**：MOD 分发包从原先的 50MB+ 缩减至几百 KB（只包含数据 JSON），玩家下载秒完成，进入游戏自动走 CDN 流畅加载！
