// public/js/ui/deviceTier.js — 设备档位探测（业主 2026-10-21）
//
// 一次启动只探一次：内存（navigator.deviceMemory）与 GPU 型号（WEBGL_debug_renderer_info）。
// 结果放在 window.__GAME_QUALITY__ = { isLowEnd, memory, gpu, honor }，渲染层读它来降 DPR。
//
// 与之前那份内联补丁的区别（评审结论）：
//   · 探测用的 canvas 与 WebGL 上下文**用完立刻释放**（WEBGL_lose_context），
//     以前丢着不管 —— 浏览器同时活跃的 WebGL 上下文只有 2–4 个，多占一个就可能把战场的挤掉（自己造出黑屏）。
//   · 判据放宽：内存 < 4GB 或明显的老 GPU 才算低端。以前 < 8GB 一律算，骁龙 7 系 + 6GB 这种也跟着糊。
//   · 不再改 HTMLCanvasElement.prototype.getContext（那是全局副作用，preserveDrawingBuffer 每帧都要多一次
//     全屏拷贝，全站掉帧）。荣耀/华为需要的话由战场那一次创建自己传参数，见 fieldHost.js。

/** 明显跑不动的老 GPU（字符串来自 WEBGL_debug_renderer_info 的小写结果）。 */
const OLD_GPU = /mali-4|mali-t[0-9]|mali-g51|mali-g52|adreno \(tm\) ?[345]|adreno [345]\d\d|powervr sgx|intel hd graphics [23]/;

/** 探测一次。失败就当高端（宁可画质好，也不要误伤）。 */
export function detectDeviceTier() {
  const out = { isLowEnd: false, memory: 0, gpu: '', honor: false };
  if (typeof window === 'undefined' || typeof document === 'undefined') return out;
  try {
    out.memory = Number(navigator.deviceMemory) || 0;
    out.honor = /Honor|HONOR|Huawei|HUAWEI/i.test(navigator.userAgent || '');
    let gl = null;
    let canvas = null;
    try {
      canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        if (info) out.gpu = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || '').toLowerCase();
      }
    } finally {
      // 立刻把上下文还回去：这一个只是用来读型号的
      try { gl?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ }
      if (canvas) { canvas.width = canvas.height = 0; }
    }
    const lowRam = out.memory > 0 && out.memory < 4;
    out.isLowEnd = lowRam || OLD_GPU.test(out.gpu);
  } catch { /* 任何异常都当高端 */ }
  return out;
}

/** 写入 window.__GAME_QUALITY__（main.js 启动时调一次）。 */
export function installDeviceTier() {
  if (typeof window === 'undefined') return null;
  if (window.__GAME_QUALITY__ && typeof window.__GAME_QUALITY__.isLowEnd === 'boolean') return window.__GAME_QUALITY__;
  window.__GAME_QUALITY__ = detectDeviceTier();
  return window.__GAME_QUALITY__;
}

/** 是不是低端机（渲染层读这个）。 */
export const isLowEndDevice = () => (typeof window !== 'undefined' && window.__GAME_QUALITY__
  ? !!window.__GAME_QUALITY__.isLowEnd
  : false);
