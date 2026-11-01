// public/js/ui/deviceTuning.js — 机型渲染策略（业主 2026-10-26）
//
// 背景：手机上三类常见问题，都不是「引擎写错了」，而是厂商 WebView 的实现差异：
//   1. 荣耀 / 华为（部分鸿蒙 WebView）：GPU 被标成 major performance caveat，严格探测判死 → 3D 棋盘不出现；
//      旧内核（Chromium < 110）上 WebGL2 的纹理上传偶发失败。**不能因此禁 WebGL2**：本作渲染器就是 WebGL2，
//      禁了会整屏黑；正确做法是降分辨率 / 关 MSAA / 限帧，探测彻底失败才回退 2D。
//   2. 小米 / 红米 + 天玑（Mali-G 系列）：scheduler 在高负载下掉帧、纹理上传偶发超时；同样靠降 pixelRatio、
//      限帧、关 MSAA 解决，而不是拒绝上下文。
//   3. 少数 WebView 真的拒绝 webgl/webgl2（企业策略、省电模式、驱动崩溃后）：此时才 force2d。
//
// 这些判断做成纯函数，输出一组**渲染参数**，由 app.js 读取；用户可在设置里用「机型兼容」覆盖（auto / smooth / hd）。

const MALI = /mali/i;
const ADRENO = /adreno/i;
const POWERVR = /powervr/i;
const APPLE = /apple gpu/i;

/** 一次性的 GPU 探测（创建临时上下文后立即释放）。返回小写 renderer 字符串，失败返回 ''。 */
let gpuCache = null;
export function probeGpu() {
  if (gpuCache != null) return gpuCache;
  gpuCache = '';
  try {
    if (typeof document === 'undefined') return gpuCache;
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl');
    if (!gl) return gpuCache;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) gpuCache = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '').toLowerCase();
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  } catch { /* 探测失败按未知处理 */ }
  return gpuCache;
}

/**
 * 机型 → 渲染参数（纯函数，便于单测）。
 * @param {{ ua?: string, gpu?: string, webgl2?: 'ok'|'slow'|'none'|'unknown', chrome?: number }} input
 * @returns {{ family: 'honor'|'xiaomi'|'apple'|'other', gpu: string, quality: 'high'|'medium'|'low',
 *   maxPixelRatio: number, antialias: boolean, frameCap: number, force2d: boolean, reasons: string[] }}
 */
export function detectDeviceTuning(input = {}) {
  const ua = String(input.ua ?? '');
  const gpu = String(input.gpu ?? '').toLowerCase();
  const webgl2 = input.webgl2 ?? 'unknown';
  const chrome = Number.isFinite(input.chrome) ? input.chrome : chromeOf(ua);
  const reasons = [];

  const isHonor = /Honor|HONOR|HUAWEI|HarmonyOS/i.test(ua);
  // 小米系 UA 常见三种写法：品牌名（Xiaomi/Redmi/POCO）、「Mi 13」，以及只有机型代号（2211133C、M2101K6G）。
  // [ASSUMED] 机型代号用「2 开头 6–8 位 + 可选字母」与「M + 4 位 + 字母数字」两种模式识别，其它厂商极少撞。
  const isXiaomi = /Xiaomi|Redmi|POCO|Mi\s+\d|Mi\s?\d{2}\b/i.test(ua)
    || /\b2\d{6,7}[A-Z]{0,2}\b/.test(ua) || /\bM2\d{3}[A-Z0-9]{2,4}\b/i.test(ua);
  const isDimensity = /Dimensity|MT\d{4}|Mali/i.test(ua) || MALI.test(gpu);
  const family = isHonor ? 'honor' : isXiaomi ? 'xiaomi' : APPLE.test(gpu) ? 'apple' : 'other';

  // 真的拿不到上下文：只有这一种情况回退 2D
  const force2d = webgl2 === 'none';
  if (force2d) reasons.push('webgl2-unavailable');

  let quality = 'high';
  let maxPixelRatio = 2;
  let antialias = true;
  let frameCap = 60;

  if (family === 'honor') {
    // 旧内核或 Mali：降分辨率、关 MSAA、限 30 帧；高版本 + 非 Mali 保持高画质
    if ((chrome > 0 && chrome < 110) || MALI.test(gpu)) {
      quality = 'low'; maxPixelRatio = 1; antialias = false; frameCap = 30;
      reasons.push(chrome > 0 && chrome < 110 ? 'honor-old-chromium' : 'honor-mali');
    } else {
      reasons.push('honor-modern');
    }
  } else if (family === 'xiaomi') {
    // 天玑 / Mali：中画质、1.25 倍像素、关 MSAA、45 帧
    if (isDimensity || MALI.test(gpu)) {
      quality = 'medium'; maxPixelRatio = 1.25; antialias = false; frameCap = 45;
      reasons.push('xiaomi-dimensity');
    } else if (!gpu) {
      // GPU 名读不到（部分 WebView 屏蔽 WEBGL_debug_renderer_info）：小米系两极分化，未知时取保守档
      quality = 'medium'; maxPixelRatio = 1.5; antialias = false; frameCap = 45;
      reasons.push('xiaomi-gpu-unknown');
    } else {
      reasons.push('xiaomi-other');
    }
  } else if (family === 'apple') {
    maxPixelRatio = 2; frameCap = 60; reasons.push('apple-gpu');
  }

  if (webgl2 === 'slow') {
    // 能开上下文但被标 caveat：再压一档，别直接判死
    if (quality === 'high') quality = 'medium';
    maxPixelRatio = Math.min(maxPixelRatio, 1.5);
    antialias = false;
    reasons.push('webgl2-caveat');
  }

  return { family, gpu, quality, maxPixelRatio, antialias, frameCap, force2d, reasons };
}

function chromeOf(ua) {
  const m = ua.match(/Chrome\/(\d+)/);
  return m ? Number(m[1]) : 0;
}

/**
 * 用户的「机型兼容」选择覆盖自动判断：
 *  - `auto`  ：用探测结果；
 *  - `smooth`：强制低画质（等同于荣耀/Mali 档）；
 *  - `hd`    ：强制高画质（用户明确要求，慢也认）。
 * @param {ReturnType<typeof detectDeviceTuning>} tuning
 * @param {'auto'|'smooth'|'hd'} mode
 */
export function resolveTuning(tuning, mode = 'auto') {
  if (mode === 'smooth') {
    return { ...tuning, quality: 'low', maxPixelRatio: 1, antialias: false, frameCap: 30, reasons: [...tuning.reasons, 'user-smooth'] };
  }
  if (mode === 'hd') {
    return { ...tuning, quality: 'high', maxPixelRatio: 2, antialias: true, frameCap: 60, force2d: false, reasons: [...tuning.reasons, 'user-hd'] };
  }
  return tuning;
}
