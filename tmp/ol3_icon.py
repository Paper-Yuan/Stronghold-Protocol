# v3: v1 + purple material graded 粉紫 → 深紫 (temporary; deleted after delivery)
import numpy as np
from PIL import Image, ImageFilter

V1 = 'handoff/shots/ol-core-icon-v1.png'
SRC = 'public/assets/item/trap_1073_acarm073.png'
OUT = 'public/assets/item/trap_ol_core.png'

P = dict(
  H_TOP=0.800, H_BOT=0.755,     # 粉紫 → 深紫
  S_TOP=0.55, S_BOT=0.95,
  V_TOP=1.02, V_BOT=0.70,
  TILT=0.15,                    # 0 = pure vertical, 1 = horizontal contribution
  MASK_S=0.45,                  # purple material = saturated pixels
  BADGE=(86, 0, 128, 44),       # x0,y0,x1,y1 of the v1 SP badge: left alone
  MODE='hsv',                   # 'hsv' = H/S ramp + v1 value; 'ramp' = RGB ramp on (shade, spatial)
  PINK=(233, 168, 255), DEEP=(46, 10, 71),
  SHADE_W=0.55, SPATIAL_W=0.45, SHADE_LO=0.30, SHADE_HI=1.0,
)


def rgb_to_hsv(rgb):
  r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
  mx = rgb.max(-1); mn = rgb.min(-1); d = mx - mn + 1e-12
  h = np.zeros_like(mx)
  m = (mx == r) & (d > 0); h[m] = ((g - b) / d)[m] % 6
  m2 = (mx == g) & (d > 0) & ~m; h[m2] = ((b - r) / d + 2)[m2]
  m3 = (mx == b) & (d > 0) & ~m & ~m2; h[m3] = ((r - g) / d + 4)[m3]
  return h / 6.0, np.where(mx > 0, d / (mx + 1e-12), 0), mx


def hsv_to_rgb(h, s, v):
  i = np.floor(h * 6).astype(np.int32) % 6; f = h * 6 - np.floor(h * 6)
  p = v * (1 - s); q = v * (1 - f * s); t = v * (1 - (1 - f) * s)
  return np.stack([np.choose(i, [v, q, p, p, t, v]), np.choose(i, [t, v, v, q, p, p]),
                   np.choose(i, [p, p, t, v, v, q])], -1)


def render(**kw):
  p = dict(P); p.update(kw)
  im = Image.open(V1).convert('RGBA')
  a = np.array(im, np.float32) / 255.0
  rgb, al = a[..., :3], a[..., 3]
  h, s, v = rgb_to_hsv(rgb)
  hh, ww = al.shape
  yy, xx = np.mgrid[0:hh, 0:ww]

  purple = (s > p['MASK_S']) & (h > 0.68) & (h < 0.99) & (al > 0.2)
  bx0, by0, bx1, by1 = p['BADGE']
  purple[by0:by1, bx0:bx1] = False
  ys, xs = np.nonzero(purple)
  y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
  t = np.clip(((yy - y0) / max(1, y1 - y0)) * (1 - p['TILT']) + ((xx - x0) / max(1, x1 - x0)) * p['TILT'], 0, 1)
  soft = np.array(Image.fromarray((purple * 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(1.1)), np.float32) / 255.0

  H = p['H_TOP'] + (p['H_BOT'] - p['H_TOP']) * t
  S = p['S_TOP'] + (p['S_BOT'] - p['S_TOP']) * t
  V = np.clip(v * (p['V_TOP'] + (p['V_BOT'] - p['V_TOP']) * t), 0, 1)
  # keep a little of v1's own facet variation in the hue
  H = H + (h - 0.845) * 0.25
  if p['MODE'] == 'hsv':
    recol = hsv_to_rgb(H % 1.0, np.clip(S, 0, 1), V)
  else:
    shade = np.clip((v - p['SHADE_LO']) / (p['SHADE_HI'] - p['SHADE_LO']), 0, 1)
    u = np.clip(p['SHADE_W'] * shade + p['SPATIAL_W'] * t, 0, 1)
    deep = np.array(p['DEEP'], np.float32) / 255
    pink = np.array(p['PINK'], np.float32) / 255
    recol = deep + (pink - deep) * u[..., None]
    recol = np.clip(recol * (0.86 + 0.26 * v)[..., None], 0, 1)

  out = rgb * (1 - soft[..., None]) + recol * soft[..., None]
  res = np.dstack([np.clip(out, 0, 1), al])
  return Image.fromarray((res * 255).astype(np.uint8), 'RGBA')


if __name__ == '__main__':
  v1 = Image.open(V1).convert('RGBA')
  final = render(MODE='ramp', SHADE_W=0.35, SPATIAL_W=0.65, SHADE_LO=0.45, SHADE_HI=0.95,
                 TILT=0.25, PINK=(224, 124, 255), DEEP=(44, 8, 66))
  final.save(OUT)
  print('wrote', OUT, final.size)
  k = 4
  bg = (22, 18, 28, 255)
  imgs = [('v1', v1), ('v3', final)]
  sheet = Image.new('RGBA', (len(imgs) * (128 * k + 14) + 8, 160 * k + 20), bg)
  for i, (n, im) in enumerate(imgs):
    sheet.alpha_composite(im.resize((128 * k, 160 * k), Image.NEAREST), (8 + i * (128 * k + 14), 10))
  sheet.save('tmp/ol3_final.png')
  row = Image.new('RGBA', (240, 64), bg)
  for i, (n, im) in enumerate(imgs):
    row.alpha_composite(im.resize((round(im.width * 48 / im.height), 48), Image.LANCZOS), (14 + i * 70, 8))
  row.save('tmp/ol3_48final.png')
  print('ok')
