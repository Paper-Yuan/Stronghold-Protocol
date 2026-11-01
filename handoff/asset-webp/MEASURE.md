# 立绘 PNG → WebP 实测（体积 / 浏览器解码耗时 / 视觉对比）

只读实测：`public/assets/char/illust`、`char/illust/skin`、`char/illustration` 里 20 张立绘，PNG 原图 / WebP q90 /
WebP q80 三种格式各测体积与 headless Chrome 解码耗时，并做 1:1 像素视觉对比。**仓库素材未改动**（只读打开），
产物全部在 `handoff/asset-webp/`。

一句话结论：**体积降到 1/5，解码反而变慢（中位 +34 %）**——但慢的是 20–60 ms 的流水线延迟（不阻塞主线程、不掉帧），
省下的是 3–7 MB 的传输；本地/局域网首帧基本无感，真机弱网首帧明显更快。alpha 位级无损，q90 需要放大到 100% 才看得出。

- 体积：74.72 MB → **14.86 MB（19.9 %，q90）** / 10.68 MB（14.3 %，q80）
- 解码（主口径 `fetch` + `createImageBitmap`，中位）：59.7 ms → **79.8 ms（×1.48）** / 64.9 ms（×1.19）
- alpha：20 张全部 RGBA 带透明（28–86 % 透明像素），**alpha 通道最大差 0**；透明区 RGB 有轻微量化（平均 0.51/255），实测无可见影响
- 视觉：q90 中位 PSNR 39.47 dB / SSIM 0.9940；q80 36.92 dB / SSIM 0.9872
- 首帧：最大那张省 7161 KB 传输、多付 58 ms 解码；带宽低于 ≈123 MB/s（≈988 Mbps）时 WebP 更快
- 全量：图像 1.9 GB → 0.5 GB（q90）；audio 另算（Opus），口径见 §10

---

## 1. 方法与口径

### 1.1 环境

| 项 | 值 |
|---|---|
| OS / CPU | Windows，13th Gen Intel Core i9-13900HX（24 核 / 32 线程） |
| Chrome | 151.0.7922.109（`C:/Users/J1825/AppData/Local/Google/Chrome/Application/chrome.exe`） |
| 自动化 | `puppeteer-core` ^25.12（仓库 devDependency，与 `test/e2e/client.mjs`、`tools/perfbench.mjs` 同一套起法） |
| 转换 | Pillow 12.3.0（`C:\Users\J1825\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe`），WebP 编码走 libwebp |
| 页面 | `file://` 临时页 + `--allow-file-access-from-files`（让页面能 `fetch()` 本地文件），见 §1.5 |

### 1.2 采样

池子 = 三个目录下全部 PNG（**采样时 519 张 / 1657.6 MB**；素材仍在被别的会话下载，写这份报告时已增至
524 张 / 1661 MB，所以 §10 的全量清单比样本池略大）。按目录分层、在各自体积分布上取分位点，
再强制并入**池内最大**（`char_1046_sbell2.png`，8.44 MB）、**池内最小**（`char_1035_wisdel_game_9.png`，235 KB）与
**池内中位**（`char_4183_mortis.png`，3.33 MB），共 20 张：`illust` 8 张 / `illust/skin` 7 张 / `illustration` 5 张。

**20 张全部是 RGBA 带真实透明背景**（透明像素 28–86 %），满足“至少 3 张带 alpha”且远超要求——立绘本身就没有完全不透明的。

### 1.3 转换

```python
im.save(out, format='WEBP', quality=q, method=6, lossless=False, exact=True)   # q = 90 / 80
```

- `method=6`：libwebp 最慢最强的一档；`exact=True`：透明像素下面的 RGB 原样保留（默认会把它清成 0）。
- 保留 alpha：libwebp 有损模式把 alpha 单独存成**无损** VP8L 平面，所以有损只作用于彩色。
- 单张耗时（含 I/O）5–18 s，20 张 × 2 档合计约 8 分钟；产物在 `conv/`。

### 1.4 解码测量

两条口径，每条都跑 **10 次、丢掉第 1 次（冷缓存 / 冷解码）、取剩下 9 次的中位数**：

1. **主口径**（游戏里实际会走的路径）：`fetch(url)` → `arrayBuffer` → `new Blob` → `createImageBitmap(blob)`，
   用 `performance.now()` 扣出总时长，同时单独记 fetch 段与 decode 段。
2. **次口径**：`new Image()` + `img.decode()`（原生 loader，`src` 直接给 `file://` URL）。

抗偏置措施：

- **三格式交替**：每次迭代把 PNG / q90 / q80 连着做，起始格式按 `it % 3` 轮转（A-B-C、B-C-A、C-A-B…），
  任何格式都不会固定在“最热”或“最冷”的位置；
- 每次测量后 `globalThis.gc()`（`--js-flags=--expose-gc`），避免上一张大图堆在堆里影响下一张；
- 每次 `createImageBitmap` 后立刻 `bitmap.close()`，不累积 ImageBitmap；
- **自校验**：每张图每次测量都核对解码尺寸 `w×h` 与原图一致、`arrayBuffer.byteLength` 与磁盘字节一致，全程 0 处不符。

页面侧核心（完整脚本见 §11 复现说明）：

```js
async function bitmap(url, type) {
  const t0 = performance.now();
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  const t1 = performance.now();                       // fetch + 读盘
  const bmp = await createImageBitmap(new Blob([buf], { type }));
  const t2 = performance.now();                       // 解码到可绘制位图
  const out = { fetchMs: t1 - t0, decodeMs: t2 - t1, totalMs: t2 - t0, w: bmp.width, h: bmp.height };
  bmp.close();
  return out;
}
```

### 1.5 为什么是 `file://`，以及它的偏差

按任务要求用 `file://` 加载临时页；Chrome 默认禁止 `file://` 页面 `fetch()` 其它本地文件，所以加了
`--allow-file-access-from-files`（只放宽同源文件读取，不联网）。这样测的是**无网络**条件下的纯“读盘 + 解码”。

偏差方向要记住：**真实网络下 WebP 的优势会更大**，因为这里的“传输”只有本地磁盘（最大那张 PNG 读盘 10.8 ms、
q90 2.6 ms）。所以本报告里 WebP 的耗时数字是**对 WebP 最不利**的一侧。

`file://` 下 `transferSize` 恒为 0（没有 HTTP），所以字节数一律取磁盘上的真实大小（Node `stat` + 页面内
`arrayBuffer.byteLength` 双校验）。

### 1.6 局限

- 单机单次会话；32 线程 CPU，headless 无 GPU 参与（纯解码，GPU 影响很小）。
- 只测了 Chrome/Blink。Safari/WebKit 的 WebP 解码器（libwebp 另一份集成）没有覆盖，iOS 上需另测。
- 只测了有损 WebP；无损 WebP 通常比 PNG 还大，不在本次范围。
- `createImageBitmap` 在 Chrome 里是在渲染线程之外解码的，因此这里的 ms 是**流水线延迟**而不是主线程阻塞时长
  （§7 用 rAF 帧间隔单独验证了这一点）。

---

## 2. 样本清单（20 张，全部带 alpha）

| 文件 | 目录 | 分辨率 | mode | 透明像素占比 |
|---|---|---|---|---|
| `char_1035_wisdel_game_9.png` | `char/illust/skin` | 860×1019 | RGBA | 37.3% 透明 |
| `char_4185_amoris_1.png` | `char/illustration` | 1176×1176 | RGBA | 86.4% 透明 |
| `char_183_skgoat.png` | `char/illust` | 1024×1024 | RGBA | 77.5% 透明 |
| `char_311_mudrok_ambienceSynesthesia_2.png` | `char/illust/skin` | 1024×1024 | RGBA | 45.9% 透明 |
| `char_4182_oblvns_1.png` | `char/illustration` | 1176×1176 | RGBA | 84.6% 透明 |
| `char_472_pasngr.png` | `char/illust` | 1024×1024 | RGBA | 56.1% 透明 |
| `char_173_slchan_wwf_1.png` | `char/illust/skin` | 1024×1024 | RGBA | 35.8% 透明 |
| `char_127_estell.png` | `char/illust` | 1177×1248 | RGBA | 59.6% 透明 |
| `char_4183_mortis.png` | `char/illust` | 1664×1664 | RGBA | 41.6% 透明 |
| `char_279_excu_boc_1.png` | `char/illust/skin` | 2096×1785 | RGBA | 45.1% 透明 |
| `char_1021_kroos2.png` | `char/illust` | 2136×2014 | RGBA | 37.9% 透明 |
| `char_1033_swire2_ambienceSynesthesia_4.png` | `char/illust/skin` | 2348×1955 | RGBA | 32.4% 透明 |
| `char_4079_haini.png` | `char/illust` | 2548×2256 | RGBA | 51.1% 透明 |
| `char_4184_dolris_skin1.png` | `char/illustration` | 2304×2304 | RGBA | 43.4% 透明 |
| `char_1014_nearl2_epoque_17.png` | `char/illust/skin` | 2057×1870 | RGBA | 28.2% 透明 |
| `char_4137_udflow.png` | `char/illust` | 2534×2034 | RGBA | 46.1% 透明 |
| `char_4186_tmoris_skin1.png` | `char/illustration` | 2560×2560 | RGBA | 40.2% 透明 |
| `char_1035_wisdel_sale_14.png` | `char/illust/skin` | 2550×2501 | RGBA | 58.5% 透明 |
| `char_4186_tmoris_2.png` | `char/illustration` | 2560×2560 | RGBA | 49.0% 透明 |
| `char_1046_sbell2.png` | `char/illust` | 2535×2406 | RGBA | 39.2% 透明 |

---

## 3. 体积

| # | 文件 | 目录 | 分辨率 | PNG 体积 | WebP q90 | WebP q80 | q90 占比 | q80 占比 |
|---|---|---|---|---|---|---|---|---|
| 1 | `char_1046_sbell2.png` | `char/illust` | 2535×2406 | 8.44 MB | 1.61 MB | 1.17 MB | 19.1% | 13.9% |
| 2 | `char_4186_tmoris_2.png` | `char/illustration` | 2560×2560 | 8.36 MB | 1.53 MB | 1.03 MB | 18.3% | 12.3% |
| 3 | `char_1035_wisdel_sale_14.png` | `char/illust/skin` | 2550×2501 | 7.95 MB | 1.91 MB | 1.50 MB | 24.0% | 18.8% |
| 4 | `char_4186_tmoris_skin1.png` | `char/illustration` | 2560×2560 | 6.48 MB | 0.95 MB | 671 KB | 14.7% | 9.9% |
| 5 | `char_4137_udflow.png` | `char/illust` | 2534×2034 | 6.15 MB | 1.22 MB | 936 KB | 19.8% | 14.5% |
| 6 | `char_1014_nearl2_epoque_17.png` | `char/illust/skin` | 2057×1870 | 5.76 MB | 1.08 MB | 770 KB | 18.7% | 12.8% |
| 7 | `char_4184_dolris_skin1.png` | `char/illustration` | 2304×2304 | 5.71 MB | 1.25 MB | 936 KB | 22.0% | 15.6% |
| 8 | `char_4079_haini.png` | `char/illust` | 2548×2256 | 4.89 MB | 876 KB | 649 KB | 17.1% | 12.7% |
| 9 | `char_1033_swire2_ambienceSynesthesia_4.png` | `char/illust/skin` | 2348×1955 | 4.75 MB | 915 KB | 641 KB | 18.4% | 12.9% |
| 10 | `char_1021_kroos2.png` | `char/illust` | 2136×2014 | 3.65 MB | 590 KB | 431 KB | 15.4% | 11.3% |
| 11 | `char_279_excu_boc_1.png` | `char/illust/skin` | 2096×1785 | 3.48 MB | 669 KB | 452 KB | 18.3% | 12.4% |
| 12 | `char_4183_mortis.png` | `char/illust` | 1664×1664 | 3.33 MB | 759 KB | 534 KB | 21.7% | 15.3% |
| 13 | `char_127_estell.png` | `char/illust` | 1177×1248 | 1.62 MB | 407 KB | 316 KB | 24.0% | 18.6% |
| 14 | `char_173_slchan_wwf_1.png` | `char/illust/skin` | 1024×1024 | 929 KB | 280 KB | 196 KB | 30.1% | 21.1% |
| 15 | `char_472_pasngr.png` | `char/illust` | 1024×1024 | 809 KB | 254 KB | 185 KB | 31.4% | 22.9% |
| 16 | `char_4182_oblvns_1.png` | `char/illustration` | 1176×1176 | 656 KB | 195 KB | 146 KB | 29.7% | 22.2% |
| 17 | `char_311_mudrok_ambienceSynesthesia_2.png` | `char/illust/skin` | 1024×1024 | 653 KB | 194 KB | 134 KB | 29.7% | 20.5% |
| 18 | `char_183_skgoat.png` | `char/illust` | 1024×1024 | 637 KB | 222 KB | 171 KB | 34.9% | 26.8% |
| 19 | `char_4185_amoris_1.png` | `char/illustration` | 1176×1176 | 431 KB | 133 KB | 96 KB | 30.8% | 22.3% |
| 20 | `char_1035_wisdel_game_9.png` | `char/illust/skin` | 860×1019 | 240 KB | 75 KB | 57 KB | 31.1% | 23.9% |
| — | **合计 20 张** | — | — | **74.72 MB** | **14.86 MB** | **10.68 MB** | **19.9%** | **14.3%** |

压缩比随原图体积单调下降：< 1 MB 的小图 30–35 %，1–2 MB 约 24 %，4 MB 以上 15–24 %（最大那张 8.44 MB → 19.1 %）。
原因是小 PNG 本身已经被压得较狠（少色/调色板化），WebP 的空间就小；大立绘像素多、同色域比例高，反而更好压。

---

## 4. 解码耗时（主口径：`fetch` + `createImageBitmap`）

列说明：
- **ms/MB** = 该格式中位解码 ms ÷ **该格式自身**的文件体积（MB）。它衡量“每传 1 MB 要付多少解码”，
  WebP 文件小，这个数天然被放大，**不能**用它跨格式比效率；
- **ms/MP** = 该格式中位解码 ms ÷ 解码后的像素数（MP）。这才是**跨格式可比**的解码效率；
- 最后一列 = 同一张图 q90 相对 PNG 的耗时倍数。

| # | 文件 | 解码像素 | PNG 中位 ms | q90 中位 ms | q80 中位 ms | ms/MB PNG | ms/MB q90 | ms/MB q80 | ms/MP PNG | ms/MP q90 | ms/MP q80 | q90/PNG |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `char_1046_sbell2.png` | 6.10 MP | 108.6 | 166.6 | 130.5 | 12.9 | 103.4 | 111.4 | 17.8 | 27.3 | 21.4 | 1.53× |
| 2 | `char_4186_tmoris_2.png` | 6.55 MP | 124.5 | 161.0 | 125.3 | 14.9 | 105.2 | 122.1 | 19.0 | 24.6 | 19.1 | 1.29× |
| 3 | `char_1035_wisdel_sale_14.png` | 6.38 MP | 113.2 | 176.4 | 145.7 | 14.2 | 92.4 | 97.2 | 17.7 | 27.7 | 22.8 | 1.56× |
| 4 | `char_4186_tmoris_skin1.png` | 6.55 MP | 108.1 | 124.7 | 101.3 | 16.7 | 131.2 | 158.2 | 16.5 | 19.0 | 15.5 | 1.15× |
| 5 | `char_4137_udflow.png` | 5.15 MP | 87.5 | 123.2 | 97.9 | 14.2 | 101.1 | 109.6 | 17.0 | 23.9 | 19.0 | 1.41× |
| 6 | `char_1014_nearl2_epoque_17.png` | 3.85 MP | 77.8 | 114.4 | 87.4 | 13.5 | 106.4 | 119.1 | 20.2 | 29.7 | 22.7 | 1.47× |
| 7 | `char_4184_dolris_skin1.png` | 5.31 MP | 99.4 | 138.2 | 111.8 | 17.4 | 110.2 | 125.2 | 18.7 | 26.0 | 21.1 | 1.39× |
| 8 | `char_4079_haini.png` | 5.75 MP | 83.6 | 107.3 | 91.7 | 17.1 | 128.5 | 148.2 | 14.5 | 18.7 | 16.0 | 1.28× |
| 9 | `char_1033_swire2_ambienceSynesthesia_4.png` | 4.59 MP | 70.6 | 100.9 | 83.7 | 14.9 | 115.6 | 136.8 | 15.4 | 22.0 | 18.2 | 1.43× |
| 10 | `char_1021_kroos2.png` | 4.30 MP | 64.7 | 78.1 | 65.9 | 17.7 | 138.8 | 160.2 | 15.0 | 18.2 | 15.3 | 1.21× |
| 11 | `char_279_excu_boc_1.png` | 3.74 MP | 54.7 | 81.4 | 63.9 | 15.7 | 127.7 | 148.2 | 14.6 | 21.8 | 17.1 | 1.49× |
| 12 | `char_4183_mortis.png` | 2.77 MP | 53.4 | 77.4 | 62.4 | 16.0 | 107.0 | 122.5 | 19.3 | 28.0 | 22.5 | 1.45× |
| 13 | `char_127_estell.png` | 1.47 MP | 25.9 | 37.8 | 31.5 | 16.0 | 97.3 | 104.5 | 17.6 | 25.7 | 21.4 | 1.46× |
| 14 | `char_173_slchan_wwf_1.png` | 1.05 MP | 15.2 | 28.9 | 24.0 | 17.2 | 108.4 | 128.5 | 14.5 | 27.6 | 22.9 | 1.90× |
| 15 | `char_472_pasngr.png` | 1.05 MP | 14.1 | 27.4 | 22.0 | 18.3 | 113.0 | 124.4 | 13.4 | 26.1 | 21.0 | 1.94× |
| 16 | `char_4182_oblvns_1.png` | 1.38 MP | 16.7 | 25.6 | 22.1 | 26.7 | 137.5 | 158.7 | 12.1 | 18.5 | 16.0 | 1.53× |
| 17 | `char_311_mudrok_ambienceSynesthesia_2.png` | 1.05 MP | 13.5 | 22.0 | 17.7 | 21.7 | 118.8 | 138.8 | 12.9 | 21.0 | 16.9 | 1.63× |
| 18 | `char_183_skgoat.png` | 1.05 MP | 13.2 | 23.8 | 20.0 | 21.7 | 112.3 | 122.9 | 12.6 | 22.7 | 19.1 | 1.80× |
| 19 | `char_4185_amoris_1.png` | 1.38 MP | 13.1 | 19.7 | 17.3 | 31.9 | 155.7 | 188.5 | 9.5 | 14.2 | 12.5 | 1.50× |
| 20 | `char_1035_wisdel_game_9.png` | 0.88 MP | 8.3 | 13.9 | 13.1 | 36.2 | 195.2 | 239.3 | 9.5 | 15.9 | 14.9 | 1.67× |
| — | **20 张合计 / 中位** | — | **59.7** | **79.8** | **64.9** | **16.9** | **112.7** | **126.9** | **15.2** | **23.3** | **19.0** | **1.34×** |

读法：

- **逐张看，q90 在 20/20 张上都比 PNG 慢**（×1.15–×1.94，中位 ×1.34）；
  q80 只慢一点（中位 ×1.09），20 张里有 1 张甚至更快。
- 按像素算：PNG 15.2 ms/MP → q90 23.3 ms/MP（+53 %）
  → q80 19.0 ms/MP（+25 %）。
- **q80 比 q90 解码更快**：同样的像素数，q80 的码流更短，熵解码少干活（q90 23.3 → q80 19.0 ms/MP，−18 %）。
  这条经常被忽略：**降质量不只省带宽，也省解码**。
- 分解：fetch 段 PNG 10.8 ms → q90 2.6 ms（省 8.2 ms 读盘）；
  纯解码段 PNG 48.9 ms → q90 77.3 ms / q80 63.0 ms（多付 28.4 / 14.1 ms）。
  **解码多付的钱，正好被“文件更小”抵掉一部分**。
- 20 张一次性解码：PNG 1166 ms → q90 1649 ms（+483 ms）/ q80 1335 ms（+169 ms）。

## 5. 解码耗时（次口径：`new Image()` + `img.decode()`）

| # | 文件 | PNG `img.decode()` | q90 | q80 | q90/PNG |
|---|---|---|---|---|---|
| 1 | `char_1046_sbell2.png` | 100.1 | 177.5 | 150.4 | 1.77× |
| 2 | `char_4186_tmoris_2.png` | 106.1 | 176.2 | 135.3 | 1.66× |
| 3 | `char_1035_wisdel_sale_14.png` | 91.7 | 182.0 | 149.1 | 1.98× |
| 4 | `char_4186_tmoris_skin1.png` | 95.3 | 133.3 | 105.4 | 1.40× |
| 5 | `char_4137_udflow.png` | 75.7 | 128.8 | 110.4 | 1.70× |
| 6 | `char_1014_nearl2_epoque_17.png` | 69.5 | 134.9 | 107.2 | 1.94× |
| 7 | `char_4184_dolris_skin1.png` | 81.7 | 138.6 | 112.2 | 1.70× |
| 8 | `char_4079_haini.png` | 70.7 | 114.8 | 94.8 | 1.62× |
| 9 | `char_1033_swire2_ambienceSynesthesia_4.png` | 64.2 | 109.1 | 89.5 | 1.70× |
| 10 | `char_1021_kroos2.png` | 58.8 | 79.9 | 68.9 | 1.36× |
| 11 | `char_279_excu_boc_1.png` | 49.4 | 94.1 | 72.0 | 1.90× |
| 12 | `char_4183_mortis.png` | 45.0 | 79.1 | 60.9 | 1.76× |
| 13 | `char_127_estell.png` | 20.6 | 37.7 | 31.7 | 1.83× |
| 14 | `char_173_slchan_wwf_1.png` | 14.0 | 30.6 | 25.5 | 2.19× |
| 15 | `char_472_pasngr.png` | 13.6 | 30.4 | 26.0 | 2.24× |
| 16 | `char_4182_oblvns_1.png` | 15.3 | 25.8 | 23.3 | 1.69× |
| 17 | `char_311_mudrok_ambienceSynesthesia_2.png` | 11.2 | 22.4 | 18.1 | 2.00× |
| 18 | `char_183_skgoat.png` | 11.6 | 25.3 | 21.0 | 2.18× |
| 19 | `char_4185_amoris_1.png` | 14.1 | 21.3 | 20.2 | 1.51× |
| 20 | `char_1035_wisdel_game_9.png` | 6.8 | 13.1 | 12.3 | 1.93× |
| — | **20 张合计 / 中位** | **54.1** | **87.0** | **70.5** | **1.61×** |

两种口径给出一致的结论（q90 中位 ×1.61 vs 主口径 ×1.34），但**相对差更大**：PNG 在这条路上略快
（54.1 vs 59.7 ms），q90 反而更慢（87.0 vs 79.8 ms）。原因是原生 loader 那条路
多了“样式 / 布局 / 可绘制”的等待，而这部分对两种格式并不对称（大文件读盘更久，能盖住其中一部分），噪声也更大
（同一文件 10 次极差可达 20 %）。**建议以主口径为准**，因为它才是“拿到可绘制位图”的那条路径。

---

## 6. 视觉保真

PSNR / SSIM 都算在**白底合成后的可见结果**上（先按 alpha 合成到白，再比），也就是玩家真正看到的像素；
最大误差与“>2/255 占比”同样在这个合成图上统计；最后一列 `透明区 RGB 平均差` 单独看 `exact=True` 在 alpha=0 区域的效果。

| 文件 | q90 PSNR | q90 SSIM | q80 PSNR | q80 SSIM | q90 最大误差 | q90 >2/255 占比 | alpha 最大差 | 透明区 RGB 平均差 |
|---|---|---|---|---|---|---|---|---|
| `char_1046_sbell2.png` | 38.22 dB | 0.9933 | 35.92 dB | 0.9854 | 94 | 23.7% | 0 | 0.74 |
| `char_4186_tmoris_2.png` | 37.03 dB | 0.9935 | 34.98 dB | 0.9842 | 105 | 22.8% | 0 | 0.89 |
| `char_1035_wisdel_sale_14.png` | 40.78 dB | 0.9950 | 37.87 dB | 0.9878 | 105 | 16.7% | 0 | 0.14 |
| `char_4186_tmoris_skin1.png` | 41.05 dB | 0.9920 | 38.00 dB | 0.9823 | 111 | 13.6% | 0 | 0.52 |
| `char_4137_udflow.png` | 33.45 dB | 0.9929 | 32.48 dB | 0.9843 | 178 | 23.5% | 0 | 0.42 |
| `char_1014_nearl2_epoque_17.png` | 37.50 dB | 0.9924 | 35.13 dB | 0.9808 | 105 | 27.0% | 0 | 0.99 |
| `char_4184_dolris_skin1.png` | 38.96 dB | 0.9935 | 36.86 dB | 0.9867 | 89 | 18.3% | 0 | 2.60 |
| `char_4079_haini.png` | 42.00 dB | 0.9944 | 39.25 dB | 0.9897 | 54 | 12.7% | 0 | 0.19 |
| `char_1033_swire2_ambienceSynesthesia_4.png` | 39.55 dB | 0.9947 | 36.98 dB | 0.9884 | 95 | 18.2% | 0 | 0.30 |
| `char_1021_kroos2.png` | 42.66 dB | 0.9926 | 40.03 dB | 0.9860 | 77 | 11.3% | 0 | 0.51 |
| `char_279_excu_boc_1.png` | 37.12 dB | 0.9950 | 35.21 dB | 0.9884 | 104 | 18.7% | 0 | 0.02 |
| `char_4183_mortis.png` | 35.39 dB | 0.9936 | 33.92 dB | 0.9853 | 131 | 23.6% | 0 | 5.20 |
| `char_127_estell.png` | 36.71 dB | 0.9955 | 35.40 dB | 0.9914 | 127 | 17.8% | 0 | 1.44 |
| `char_173_slchan_wwf_1.png` | 39.38 dB | 0.9933 | 36.19 dB | 0.9842 | 63 | 24.3% | 0 | 0.14 |
| `char_472_pasngr.png` | 39.10 dB | 0.9955 | 36.40 dB | 0.9891 | 82 | 19.1% | 0 | 0.46 |
| `char_4182_oblvns_1.png` | 45.01 dB | 0.9982 | 42.68 dB | 0.9967 | 92 | 5.3% | 0 | 3.01 |
| `char_311_mudrok_ambienceSynesthesia_2.png` | 42.30 dB | 0.9912 | 38.94 dB | 0.9805 | 57 | 15.0% | 0 | 0.32 |
| `char_183_skgoat.png` | 41.72 dB | 0.9981 | 38.92 dB | 0.9951 | 57 | 11.0% | 0 | 0.69 |
| `char_4185_amoris_1.png` | 45.02 dB | 0.9988 | 43.20 dB | 0.9975 | 76 | 3.6% | 0 | 4.12 |
| `char_1035_wisdel_game_9.png` | 40.88 dB | 0.9974 | 39.28 dB | 0.9936 | 75 | 5.9% | 0 | 0.00 |

- q90：PSNR 中位 **39.47 dB**（33.45–45.02），SSIM 中位 **0.9940**（最低 0.9912）。
- q80：PSNR 中位 36.92 dB，SSIM 中位 0.9872（最低 0.9805）。
- 最差的是 `char_4137_udflow.png`（q90 33.45 dB、
  q80 32.48 dB）——高频噪点/锐利笔触密集；
  最好的是 `char_4185_amoris_1.png`（45.02 dB），大面积平滑色块。
- **alpha**：q90 / q80 的 alpha 通道最大差都是 **0 / 0**，>2/255 的 alpha 像素占比 0.000 % / 0.000 % →
  **位级无损**（libwebp 把 alpha 存成独立的无损 VP8L 平面）。
- **透明区 RGB**：`exact=True` 保证了透明像素下的颜色**不被清零**，但**有损编码仍会量化它**——透明区 RGB 平均差
  中位 0.51/255（q80 0.72），个别边界像素最大差可达 255。
  这只在“有人把透明像素的颜色取样出来用”时才有意义，所以直接测了最坏路径：**把 RGBA 用 LANCZOS 直接缩到 25 %
  （滤镜会采样到 alpha=0 的像素）再合成**，PNG 版 vs WebP 版 PSNR 中位 **47.6 dB**
  （最低 44.7 dB）——**没有出现描边/毛边**。浏览器里更安全：Chrome 解码出来的是预乘位图，
  缩放/滤波不会碰到透明区的隐藏颜色。

对比图（`handoff/asset-webp/`）：

- `compare-full-char_1046_sbell2.png`、`compare-full-char_4186_tmoris_2.png`、`compare-full-char_1035_wisdel_game_9.png`
  —— 左 PNG / 右 q90，**同一缩放系数**并排（面板缩到 1100 px 宽，标注了缩放百分比），透明区合成在深色卡片底上；
- `compare-crop-char_1046_sbell2.png`、`compare-crop-char_4186_tmoris_2.png`、`compare-crop-char_1035_wisdel_game_9.png`
  —— **1:1 像素、无任何重采样**的面部/发丝裁切（512×512），坐标写在图头。

---

## 7. 结论 A：WebP 会不会拖慢首帧？

**解码确实变慢，但它不是首帧的瓶颈；在网络条件下 WebP 明显更快。**

1. **解码**：q90 中位 +34 %（最大那张 109 ms → 167 ms，多 58 ms）。
2. **不阻塞主线程**：`createImageBitmap` 在渲染线程之外解码。同一文件解码期间，页面 rAF 的帧间隔没有出现 >32 ms 的断档
   —— 见下表（三次取中位，`>32 ms 的帧数` 是解码窗口内掉帧的数量）：

| 文件 | 像素 | 格式 | 解码 ms | 期间最长帧间隔 ms | >32 ms 的帧数 |
|---|---|---|---|---|---|
| `char_1046_sbell2.png` | 6.1 MP | PNG | 103.3 | 8.3 | 0 |
| `char_1046_sbell2.png` | 6.1 MP | q90 | 140.3 | 4.3 | 0 |
| `char_1046_sbell2.png` | 6.1 MP | q80 | 114.3 | 4.3 | 0 |
| `char_4186_tmoris_2.png` | 6.55 MP | PNG | 95 | 8.3 | 0 |
| `char_4186_tmoris_2.png` | 6.55 MP | q90 | 210 | 8.1 | 0 |
| `char_4186_tmoris_2.png` | 6.55 MP | q80 | 160.5 | 8.2 | 0 |
| `char_1035_wisdel_sale_14.png` | 6.38 MP | PNG | 101 | 12.4 | 0 |
| `char_1035_wisdel_sale_14.png` | 6.38 MP | q90 | 173.3 | 8.3 | 0 |
| `char_1035_wisdel_sale_14.png` | 6.38 MP | q80 | 148 | 8.4 | 0 |

   换句话说：这几十毫秒是**这张图可用时间的推迟**，不是掉帧。它和后面的绘制/上传可以重叠。

3. **传输 vs 解码的盈亏平衡**：最大那张省 7.16 MB 传输、多付 58 ms 解码，
   平衡点在 **≈123 MB/s（≈988 Mbps）**：

| 带宽 | PNG 8.44 MB 传输 | q90 1.61 MB 传输 | 省下传输 | 多付解码 | 净省（最大那张，首帧） |
|---|---|---|---|---|---|
| 10 Mbps | 7080 ms | 1351 ms | 5728 ms | +58 ms | 省 5670 ms |
| 50 Mbps | 1416 ms | 270 ms | 1146 ms | +58 ms | 省 1088 ms |
| 100 Mbps | 708 ms | 135 ms | 573 ms | +58 ms | 省 515 ms |

   也就是说：**只有 ≈1 Gbps 以上的内网 / 纯本地读盘时，WebP 才在“首帧”上吃亏**；而本报告的 `file://` 数据正好就是那个极端情形
   （读盘 10.8 ms vs 2.6 ms）。玩家真机（4G/家庭宽带，10–50 Mbps）上，一张 8.4 MB 的立绘
   PNG 要多等 1.3–6.8 s，q90 只要 0.26–1.3 s，多出来的 58 ms 解码基本看不出来。

4. **实机建议**：如果在意局域网内的首帧毫秒数，用 **q80**（解码中位只比 PNG 慢 9 %，体积仍只有 PNG 的 14 %）。
   q90 适合对画质有要求、且能接受 +34 % 解码的场合。

5. **一个必须一起改的点**：WebP 默认不是渐进式（progressive），PNG 也不是——两者都“整张到齐才出图”，所以
   **本次实测不改变渐进显示的体验**；但如果以后想让立绘“先糊后清”，WebP 需要显式做渐进编码/占位图，这次没有做。

---

## 8. 结论 B：alpha 正常吗？

**正常，而且是无损的。**

- 20 张原图全是 RGBA + 真实透明背景（透明像素 28.2–86.4 %）；
- 转出的 WebP 仍是带 alpha 的有损 WebP（alpha 存成无损 VP8L 平面），Pillow 读回 mode 全部 `RGBA`；
- **alpha 通道最大差 0**，>2/255 的 alpha 像素 0 个 → 透明边缘的形状逐像素一致，不会发白/发黑；
  在 Chrome 里把解码位图 `drawImage` 到 canvas 再读回 24 个采样点，alpha 差也是 **0 / 0**。
- 透明区（alpha=0，中位 38 % 的像素）的 **RGB** 是唯一有损的地方：平均差 0.51/255、个别像素最大
  255（`exact=True` 只保证不被清零，不保证不被量化）。实测这条**不影响观感**：naive 25 % 缩小 + 合成后
  PSNR 47.6 dB（见 §6）。
- 唯一要提醒的是**文件体积**：alpha 无损，所以透明面积大的图（如头像小图、chibi 贴纸）压缩比不如满幅插画——
  见 §3，`char_1035_wisdel_game_9.png`（62 % 不透明）只有 31 %。

---

## 9. 结论 C：q90 肉眼可辨吗？

**在 100 % 像素下几乎不可辨；缩放到屏幕尺寸后完全不可辨。**

- 客观：q90 中位 PSNR 39.47 dB、SSIM 0.9940；q80 36.92 dB、SSIM 0.9872。
  参考：一般 PSNR > 38 dB / SSIM > 0.98 视为“透明压缩”。
- 主观（见 3 张 1:1 裁切）：q90 的差别集中在**极细发丝的高频边缘**和**大面积渐变天空/辉光的轻微色阶**，
  需要把同区域并排放大到 100 % 才看得出；q80 在这些位置开始出现轻微的色块/边缘软化（`char_4137_udflow` 这类
  噪点插画最明显）。
- 结论：**立绘页/看板用 q90 可直接上线**；q80 适合列表缩略图、头像、卡片这类显示尺寸远小于原始分辨率的场景。

---

## 10. 全量换算预估

口径：不用“20 张的平均压缩比”硬乘（那样会把小图的 31 % 套到大图上），而是把 20 个 (体积 → 压缩比) 点做成
**按原图体积的对数分段线性映射**，再逐文件套到真实清单上求和。这样大图按大图的比率、小图按小图的比率。

| 资产 | 文件数 | 现在 | q90 | q90 占比 | q80 | 省下 (q90) |
|---|---|---|---|---|---|---|
| char 立绘（illust + illust/skin + illustration） | 524 | 1661.3 MB | 329.0 MB | 19.8% | 237.4 MB | 1332.3 MB |
| char 头像 / 半身立绘 PNG | 1521 | 133.7 MB | 41.5 MB | 31.1% | 31.9 MB | 92.1 MB |
| spine 图集 PNG | 1119 | 149.8 MB | 46.6 MB | 31.1% | 35.5 MB | 103.2 MB |
| **图像小计** | — | **1944.8 MB** | **417.1 MB** | **21.4%** | **304.8 MB** | **1527.6 MB** |

- `char` 立绘（3 个目录，524 张 / 1661 MB）→ q90 **329 MB**，
  省 **1332 MB**。
- `char` 其它 PNG（头像/半身，1521 张，普遍 < 1 MB）→ 比率 31 %，省 92 MB。
- `spine`：**只有 1119 张图集 PNG（150 MB）能转**，
  另有 2234 个 `.skel`/`.atlas` 共 291 MB **不受益于图片格式**
  （`.skel` 是二进制骨骼，要省它得走另一条路：打包时 brotli/gzip，或改二进制格式）。
  spine 的 PNG 多为 216–512 px 的稀疏图集，和“小头像”同档，所以套 31 % 那一档；若图集里大片透明区（`exact=False` 时能压得更狠），
  实际可能更低——**这一档是保守估计**。
- 图像合计：**1945 MB → 417 MB（q90，21 %）/ 305 MB（q80）**。

### audio（另一套口径，只能粗估）

音频不能套图片压缩比，必须按**码率 × 时长**算。时长是实测的：mp3 读 400 个文件的帧头（56k×379 / 64k×22 / 96k×7），
m4a 读 `mvhd` 的 timescale/duration。

| 音频 | 文件数 | 现在 | 实测码率 | 时长 | 目标 | 转换后 | 占原体积 | 省下 |
|---|---|---|---|---|---|---|---|---|
| 语音 mp3 | 17510 | 607.3 MB | 57 kbps（单声道 403/408） | 24.8 h | Opus 32 kbps 单声道 | 339.9 MB | 56% | 267.3 MB |
| 语音 mp3 | 17510 | 607.3 MB | 同上 | 同上 | Opus 48 kbps 单声道 | 509.9 MB | 84% | 97.3 MB |
| BGM / 长音频 m4a | 37 | 227.6 MB | 227 kbps | 2.33 h | Opus 96 kbps | 95.9 MB | 42% | 131.6 MB |
| BGM / 长音频 m4a | 37 | 227.6 MB | 同上 | 同上 | Opus 128 kbps | 127.9 MB | 56% | 99.6 MB |

- 语音 mp3 **已经压得很狠**（实测均 57 kbps、403/408 为单声道），Opus 能挤的空间有限：
  32 kbps 目标才到原体积的 56 %（−44 %），
  48 kbps 就只剩 −16 %。
- 真正的肥肉是 37 个 **m4a（227.6 MB / 2.33 h，均 227 kbps）**——BGM/长音频，
  降到 Opus 96 kbps 只剩原体积的 42 %。
- 口径提醒：**有损转有损是有代差的**（56 kbps 的 mp3 再编成 32 kbps Opus，音质会掉），实际落地建议
  先用 3–5 首人工听测；另外 Opus 需要 `.opus`/`webm` 容器，Safari 15+ 才支持，比图片格式风险高。

**总计**（q90 图像 + Opus 音频）：`public/assets` 现在约 3.4 GB，
图像省 ≈1.49 GB，音频省 ≈0.39 GB。

---

## 11. 产物与保留说明

| 路径 | 内容 | 保留？ |
|---|---|---|
| `handoff/asset-webp/MEASURE.md` | 本文件 | 保留 |
| `handoff/asset-webp/conv/*.webp` | 20 张 × q90/q80 共 40 个转换产物 | 保留（体积见下） |
| `handoff/asset-webp/conv/convert.json` | 每张的字节数 + 编码耗时 | 保留 |
| `handoff/asset-webp/conv/metrics.json` | 每张的 PSNR/SSIM/alpha/透明区指标（原始数据） | 保留 |
| `handoff/asset-webp/compare-full-*.png` | 3 张并排全图对比 | 保留 |
| `handoff/asset-webp/compare-crop-*.png` | 3 张 1:1 裁切对比 | 保留 |
| `handoff/asset-webp/work/` | 采样/转换/测量/作图脚本 + 原始测量 JSON | **临时，已删**（方法与代码见下） |

`conv/` 一共约 26 MB。
**这些 WebP 只是本次实测的证据，不是要入库的素材**；真要全量转换，应该由 `tools/` 下的脚本重新生成，
而不是把 40 个样本文件塞进仓库。删掉 `conv/` 不影响本报告的可读性（所有数字都在表里）。

## 12. 复现

```bash
# 1) 转换（Pillow，注意 exact=True 与 method=6）
python -c "from PIL import Image; im=Image.open('public/assets/char/illust/char_1046_sbell2.png'); im.save('out.webp', format='WEBP', quality=90, method=6, exact=True)"

# 2) 测量：puppeteer-core + 本机 Chrome，file:// 临时页
#    Chrome 参数：--allow-file-access-from-files --js-flags=--expose-gc
#    页面：fetch -> arrayBuffer -> Blob -> createImageBitmap，performance.now() 差值
#    每格式 10 次、丢第 1 次、取中位；三格式按 it%3 轮转顺序交替；每次后 gc()
```

临时页与脚本已按纪律删除；上面两段等价于删除前的 `work/convert.py` 与 `work/measure.mjs` 的核心。

## 13. 纪律与副作用

- 未执行任何 git 写操作；未修改 `public/**`、`data/**`、`server/**`、`test/**`（原素材只读打开）。
- 唯一写入位置：`handoff/asset-webp/`。
