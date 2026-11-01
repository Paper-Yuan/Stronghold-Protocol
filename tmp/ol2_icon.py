# v2 derivation of the 万色悠滞之核 icon (temporary; deleted after delivery).
# Base: public/assets/item/trap_1073_acarm073.png (96x160). Output: public/assets/item/trap_ol_core.png (128x160).
import math
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

SRC = 'public/assets/item/trap_1073_acarm073.png'
OUT = 'public/assets/item/trap_ol_core.png'

DEFAULTS = dict(
  HUE_DEEP=0.895, HUE_WARM=0.945, HUE_VAR=0.10, HUE_SAT_PULL=0.85,
  SAT_GAIN=1.70, PEARL_SAT=0.14,
  VAL_GAIN=1.02, VAL_GAMMA=0.96, CONTRAST=1.28,
  WARM_MUL=(1.06, 0.84, 0.92), WARM_MUL_W=0.90,
  AMBIENT=(160, 62, 100), AMB=0.16,
  PEARL_RAMP=((62, 12, 40), (104, 30, 64), (160, 62, 104), (214, 120, 164), (248, 178, 210), (255, 238, 248)),
  PEARL_RAMP_W=0.90,
  HI_COLOR=(255, 232, 244), HI_MIX=0.55, HI_FROM=0.76,
  BLOOM_MIX=0.22,
  GLOW_COLOR=(255, 196, 228), GLOW_ALPHA=0.55, GLOW_WIDTH=5, GLOW_DIR=(-0.6, -0.8),
  IS_COLOR=(52, 10, 34), IS_ALPHA=0.58, IS_WIDTH=5, IS_DIR=(0.7, 0.6),
  CORE_COLOR=(255, 214, 236), CORE_ALPHA=0.16,
  RING_TOP=(255, 104, 184), RING_BOT=(224, 0, 110), RING_ALPHA=1.0, RING_BLUR=0.45,
  OUTER_ALPHA=0.22, OUTER_BLUR=3.2,
  MINT=(110, 255, 210), MINT_ALPHA=0.42, MINT_MODE='text',
  HEART_CX=107, HEART_CY=21, HEART_W=32, HEART_H=29,
)


def rgb_to_hsv(rgb):
  r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
  mx = rgb.max(-1)
  mn = rgb.min(-1)
  d = mx - mn + 1e-12
  h = np.zeros_like(mx)
  m = (mx == r) & (d > 0)
  h[m] = ((g - b) / d)[m] % 6
  m2 = (mx == g) & (d > 0) & ~m
  h[m2] = ((b - r) / d + 2)[m2]
  m3 = (mx == b) & (d > 0) & ~m & ~m2
  h[m3] = ((r - g) / d + 4)[m3]
  h = h / 6.0
  s = np.where(mx > 0, d / (mx + 1e-12), 0)
  return h, s, mx


def hsv_to_rgb(h, s, v):
  i = np.floor(h * 6).astype(np.int32) % 6
  f = h * 6 - np.floor(h * 6)
  p = v * (1 - s)
  q = v * (1 - f * s)
  t = v * (1 - (1 - f) * s)
  r = np.choose(i, [v, q, p, p, t, v])
  g = np.choose(i, [t, v, v, q, p, p])
  b = np.choose(i, [p, p, t, v, v, q])
  return np.stack([r, g, b], -1)


def smoothstep(x, a, b):
  t = np.clip((x - a) / (b - a + 1e-12), 0, 1)
  return t * t * (3 - 2 * t)


def lerp(a, b, t):
  t = t[..., None] if np.ndim(t) == np.ndim(a) - 1 else t
  return a * (1 - t) + b * t


def heart_points(cx, cy, w, h, k=8):
  pts = []
  for i in range(240):
    t = 2 * math.pi * i / 240
    x = 16 * math.sin(t) ** 3
    y = -(13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t))
    pts.append((x * k, y * k))
  xs = [p[0] for p in pts]
  ys = [p[1] for p in pts]
  sx = w / (max(xs) - min(xs))
  sy = h / (max(ys) - min(ys))
  return [(cx + (x - (max(xs) + min(xs)) / 2) * sx, cy + (y - (max(ys) + min(ys)) / 2) * sy) for x, y in pts]


def heart_layer(size, cx, cy, w, h, fill, outline, width, text_fill):
  ss = 8
  big = Image.new('RGBA', (size[0] * ss, size[1] * ss), (0, 0, 0, 0))
  d = ImageDraw.Draw(big)
  pts = heart_points(cx * ss, cy * ss, w * ss, h * ss)
  d.polygon(pts, fill=fill)
  ring = Image.new('RGBA', big.size, (0, 0, 0, 0))
  ImageDraw.Draw(ring).line(pts + [pts[0]], fill=outline, width=int(round(width * ss)), joint='curve')
  big.alpha_composite(ring)
  if text_fill:
    f = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', int(round(8.5 * ss)))
    d.text((cx * ss, (cy + 2.2) * ss), 'SP', font=f, fill=text_fill, anchor='mm')
  # exact box downsample in float, premultiplied: no ringing, no uint8 rounding that turns into white specks
  arr = np.array(big, np.float32) / 255.0
  pre = arr.copy()
  pre[..., :3] *= arr[..., 3:4]
  pre = pre.reshape(size[1], ss, size[0], ss, 4).mean(axis=(1, 3))
  alpha = np.maximum(pre[..., 3:4], 1e-6)
  out = np.zeros_like(pre)
  out[..., :3] = np.clip(pre[..., :3] / alpha, 0, 1)
  out[..., 3] = pre[..., 3]
  out[pre[..., 3] < 2 / 255.0] = 0
  return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), 'RGBA')


def render(**kw):
  p = dict(DEFAULTS)
  p.update(kw)
  src = Image.open(SRC).convert('RGBA')
  base = np.array(src, dtype=np.float32) / 255.0
  rgb, alpha = base[..., :3], base[..., 3]
  h, s, v = rgb_to_hsv(rgb)

  a_v = 1 - smoothstep(v, 0.30, 1.0)
  a_s = smoothstep(s, 0.30, 0.80) * p['HUE_SAT_PULL']
  t_hue = np.clip(a_v + (1 - a_v) * a_s, 0, 1)
  hue = p['HUE_WARM'] + (p['HUE_DEEP'] - p['HUE_WARM']) * t_hue + (h - 0.5) * p['HUE_VAR']
  s2 = np.clip(s * p['SAT_GAIN'] + p['PEARL_SAT'] * (1 - s) ** 1.5, 0, 1)
  v2 = np.clip((v ** p['VAL_GAMMA']) * p['VAL_GAIN'], 0, 1)
  v2 = np.clip(0.5 + (v2 - 0.5) * p['CONTRAST'], 0, 1)
  out = hsv_to_rgb(hue % 1.0, s2, v2)

  # warm multiply: the low-saturation pearl body turns blush without flattening its shading
  w_s = (1 - s) ** 1.5
  mul = 1 + (np.array(p['WARM_MUL'], np.float32) - 1) * (w_s * p['WARM_MUL_W'])[..., None]
  out = out * mul
  # a little rose ambient light in the shadows (no grey holes under the pearl)
  amb = ((1 - v2) ** 1.5) * p['AMB']
  out = out + (np.array(p['AMBIENT'], np.float32) / 255) * amb[..., None]
  out = np.clip(out, 0, 1)
  hi = (smoothstep(v, p['HI_FROM'], 1.0) ** 1.3) * p['HI_MIX'] * (1 - 0.45 * s)
  out = lerp(out, np.array(p['HI_COLOR'], np.float32) / 255, hi)

  # pearl ramp: a rose duotone applied to the low-saturation body only (kills the grey, keeps every fold)
  if p['PEARL_RAMP_W'] > 0:
    xp = [0.0, 0.25, 0.50, 0.72, 0.88, 1.0]
    ramp = np.stack([np.interp(v2, xp, [c[i] / 255 for c in p['PEARL_RAMP']]) for i in range(3)], -1).astype(np.float32)
    w = (1 - smoothstep(s, 0.30, 0.62)) * p['PEARL_RAMP_W']
    out = out * (1 - w[..., None]) + ramp * w[..., None]

  lum = out.max(-1)
  bright = out * smoothstep(lum, 0.55, 0.98)[..., None]
  bloom = np.array(Image.fromarray((np.clip(bright, 0, 1) * 255).astype(np.uint8), 'RGB')
                   .filter(ImageFilter.GaussianBlur(2.2)), np.float32) / 255.0
  out = 1 - (1 - out) * (1 - bloom * p['BLOOM_MIX'])

  graded = Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), 'RGB')
  graded.putalpha(src.getchannel('A'))

  H = 134
  w2 = round(graded.width * H / graded.height)
  pre = np.array(graded, np.float32) / 255.0
  pre[..., :3] *= pre[..., 3:4]
  pre_img = Image.fromarray((pre * 255).astype(np.uint8), 'RGBA').resize((w2, H), Image.LANCZOS)
  a2 = np.array(pre_img, np.float32) / 255.0
  safe = np.maximum(a2[..., 3:4], 1e-4)
  a2[..., :3] = np.clip(a2[..., :3] / safe, 0, 1)
  inner = Image.fromarray((a2 * 255).astype(np.uint8), 'RGBA')

  canvas = Image.new('RGBA', (128, 160), (0, 0, 0, 0))
  canvas.alpha_composite(inner, ((128 - w2) // 2, (160 - H) // 2))

  al = canvas.getchannel('A')
  solid = al.point(lambda x: 255 if x > 40 else 0)
  yy, xx = np.mgrid[0:160, 0:128]
  n = np.stack([(xx - 64) / 64.0, (yy - 80) / 80.0], -1)

  def dir_weight(vec):
    if not vec:
      return np.ones((160, 128), np.float32)
    d = np.clip(n[..., 0] * vec[0] + n[..., 1] * vec[1], 0, 1)
    return (d ** 1.0).astype(np.float32)

  # inner rim shadow on the side away from the light: depth, so the glow has something to glow against
  if p['IS_ALPHA'] > 0:
    sh = ImageChops.subtract(solid, solid.filter(ImageFilter.MinFilter(p['IS_WIDTH'] * 2 + 1)))
    sh_np = np.array(sh.filter(ImageFilter.GaussianBlur(2.8)), np.float32) / 255.0
    sh_np *= np.array(al, np.float32) / 255.0
    sh_np *= dir_weight(p['IS_DIR']) * p['IS_ALPHA']
    layer = np.dstack([np.broadcast_to(np.array(p['IS_COLOR'], np.float32) / 255, sh_np.shape + (3,)), sh_np])
    canvas.alpha_composite(Image.fromarray((np.clip(layer, 0, 1) * 255).astype(np.uint8), 'RGBA'))

  band = ImageChops.subtract(solid, solid.filter(ImageFilter.MinFilter(p['GLOW_WIDTH'] * 2 + 1)))
  glow = ImageChops.multiply(band.filter(ImageFilter.GaussianBlur(2.6)), al)
  glow_np = np.array(glow, np.float32) / 255.0
  glow_np *= (0.30 + 0.70 * dir_weight(p['GLOW_DIR'])) if p['GLOW_DIR'] else 1.0
  glow = Image.fromarray((glow_np * 255).astype(np.uint8), 'L')
  glow_img = Image.new('RGBA', canvas.size, p['GLOW_COLOR'] + (0,))
  glow_img.putalpha(glow.point(lambda x: int(x * p['GLOW_ALPHA'])))
  canvas.alpha_composite(glow_img)

  spot = np.exp(-(((xx - 61) ** 2) / (2 * 26.0 ** 2) + ((yy - 110) ** 2) / (2 * 22.0 ** 2)))
  spot_img = Image.new('RGBA', canvas.size, p['CORE_COLOR'] + (0,))
  spot_img.putalpha(Image.fromarray((spot * 255 * p['CORE_ALPHA']).astype(np.uint8), 'L'))
  spot_img = Image.composite(spot_img, Image.new('RGBA', canvas.size, (0, 0, 0, 0)), al)
  canvas.alpha_composite(spot_img)

  ring = ImageChops.subtract(solid.filter(ImageFilter.MaxFilter(9)), solid).filter(ImageFilter.GaussianBlur(p['RING_BLUR']))
  halo = ImageChops.subtract(solid.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(p['OUTER_BLUR'])), solid)
  if p['OUTER_ALPHA'] > 0:
    halo_img = Image.new('RGBA', canvas.size, p['RING_TOP'] + (0,))
    halo_img.putalpha(halo.point(lambda x: int(x * p['OUTER_ALPHA'])))
    canvas.alpha_composite(halo_img)
  ring_np = np.array(ring, np.float32) / 255.0
  t = (yy / 159.0)[..., None] * 0.85 + (xx / 127.0)[..., None] * 0.15
  ring_rgb = (np.array(p['RING_TOP'], np.float32) / 255) * (1 - t) + (np.array(p['RING_BOT'], np.float32) / 255) * t
  ring_layer = np.dstack([ring_rgb, ring_np * p['RING_ALPHA']])
  canvas.alpha_composite(Image.fromarray((np.clip(ring_layer, 0, 1) * 255).astype(np.uint8), 'RGBA'))

  inner_line = ImageChops.subtract(solid, solid.filter(ImageFilter.MinFilter(3))).filter(ImageFilter.GaussianBlur(0.4))
  if p['MINT_MODE'] == 'outer':
    inner_line = ImageChops.subtract(solid.filter(ImageFilter.MaxFilter(11)), solid.filter(ImageFilter.MaxFilter(9)))
  if p['MINT_MODE'] in ('inner', 'outer'):
    il = np.array(inner_line.filter(ImageFilter.GaussianBlur(0.35)), np.float32) / 255.0
    theta = np.arctan2(yy - 76.0, xx - 64.0)
    # only a bottom arc (±32° around straight down): one mint breath, not a second ring
    arc = smoothstep(np.sin(theta), 0.84, 0.94)
    mint_layer = np.dstack([np.broadcast_to(np.array(p['MINT'], np.float32) / 255, il.shape + (3,)),
                            il * arc * p['MINT_ALPHA']])
    canvas.alpha_composite(Image.fromarray((np.clip(mint_layer, 0, 1) * 255).astype(np.uint8), 'RGBA'))

  badge = heart_layer(canvas.size, p['HEART_CX'], p['HEART_CY'], p['HEART_W'], p['HEART_H'],
                      (39, 10, 30, 232), (255, 143, 200, 255), 2.4,
                      p['MINT'] + (255,) if p['MINT_MODE'] == 'text' else (255, 218, 238, 255))
  canvas.alpha_composite(badge)
  return canvas


def sheet(items, path, bg=(22, 18, 28, 255), k=3):
  cols = len(items)
  cw, ch = 128 * k, 160 * k
  out = Image.new('RGBA', (cols * cw + (cols - 1) * 12 + 16, ch + 120), bg)
  d = ImageDraw.Draw(out)
  f = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 18)
  for i, (label, im) in enumerate(items):
    x = 8 + i * (cw + 12)
    out.alpha_composite(im.resize((cw, ch), Image.NEAREST), (x, 8))
    small = im.resize((round(im.width * 48 / im.height), 48), Image.LANCZOS)
    out.alpha_composite(small, (x + 10, ch + 24))
    small2 = im.resize((round(im.width * 24 / im.height), 24), Image.LANCZOS)
    out.alpha_composite(small2, (x + 90, ch + 48))
    d.text((x + 4, ch + 84), label, font=f, fill=(235, 220, 235, 255))
  out.save(path)
  print('wrote', path, out.size)


if __name__ == '__main__':
  final = render()
  final.save(OUT)
  print('wrote', OUT, final.size)
  v1 = Image.open('handoff/shots/ol-core-icon-v1.png').convert('RGBA')
  sheet([('v1', v1), ('v2', final)], 'tmp/ol2_final.png')
  bgs = [(22, 18, 28, 255), (48, 38, 52, 255), (232, 226, 232, 255)]
  prev = Image.new('RGBA', (300, 64 * len(bgs)), (0, 0, 0, 255))
  for i, bg in enumerate(bgs):
    row = Image.new('RGBA', (300, 64), bg)
    for j, im in enumerate((v1, final)):
      row.alpha_composite(im.resize((round(im.width * 48 / im.height), 48), Image.LANCZOS), (12 + j * 60, 8))
    prev.alpha_composite(row, (0, 64 * i))
  prev.save('tmp/ol2_48px.png')
  print('wrote tmp/ol2_48px.png')
