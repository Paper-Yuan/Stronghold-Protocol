# three-panel comparison: base 变形同构体 | v1 | v2 (temporary; deleted after delivery)
from PIL import Image, ImageDraw, ImageFont

BG = (20, 16, 24, 255)
CARD = (32, 26, 38, 255)
K = 4
FONT = 'C:/Windows/Fonts/msyhbd.ttc'
FONT_R = 'C:/Windows/Fonts/msyh.ttc'

base = Image.open('public/assets/item/trap_1073_acarm073.png').convert('RGBA')
v1 = Image.open('handoff/shots/ol-core-icon-v1.png').convert('RGBA')
v2 = Image.open('public/assets/item/trap_ol_core.png').convert('RGBA')
panels = [
  ('① 变形同构体 · 原图', 'trap_1073_acarm073.png · 96×160 · 未改', base),
  ('② v1 · 冷紫 + mint 环 + SP 圆牌', '旧版：hue 0.855 / s×1.35 / v×1.02', v1),
  ('③ v3 · 粉紫 → 深紫渐变（以 v1 为基础）', '只改紫色部分：#EE8AFF → #320A48 渐变', v2),
]
PAD, GAP = 28, 22
cols = []
for _, _, im in panels:
  w, h = im.width * K, im.height * K
  cols.append((w, h))
card_w = [max(c[0], 300) + PAD * 2 for c in cols]
card_h = max(c[1] for c in cols) + PAD * 2 + 118
W = sum(card_w) + GAP * (len(card_w) - 1) + 48
H = 130 + card_h + 96
out = Image.new('RGBA', (W, H), BG)
d = ImageDraw.Draw(out)
title = ImageFont.truetype(FONT, 30)
sub = ImageFont.truetype(FONT_R, 16)
lab = ImageFont.truetype(FONT, 21)
lab2 = ImageFont.truetype(FONT_R, 15)
small = ImageFont.truetype(FONT_R, 14)

d.text((24, 24), '万色悠滞之核 trap_ol_core · 图标 v3（紫部粉紫→深紫渐变）三联对比', font=title, fill=(255, 226, 240, 255))
d.text((24, 66), '同一缩放 ×4 · 以 v1 为基础，只重映射紫色部分的颜色 · 轮廓 / 明暗 / 尺寸 / alpha 不变', font=sub, fill=(214, 186, 204, 255))

x = 24
for i, ((name, note, im), cw, (pw, ph)) in enumerate(zip(panels, card_w, cols)):
  top = 108
  d.rounded_rectangle([x, top, x + cw, top + card_h], radius=14, fill=CARD)
  ix = x + (cw - pw) // 2
  out.alpha_composite(im.resize((pw, ph), Image.NEAREST), (ix, top + PAD - 6))
  ty = top + PAD + ph + 2
  d.text((x + PAD, ty), name, font=lab, fill=(255, 214, 232, 255))
  d.text((x + PAD, ty + 28), note, font=lab2, fill=(198, 172, 190, 255))
  # actual 48 px
  s48 = im.resize((round(im.width * 48 / im.height), 48), Image.LANCZOS)
  d.text((x + PAD, ty + 56), '48 px 实际大小（手牌）', font=small, fill=(176, 152, 170, 255))
  d.rounded_rectangle([x + PAD + 172, ty + 52, x + PAD + 172 + 64, ty + 52 + 56], radius=8, fill=(46, 36, 52, 255))
  out.alpha_composite(s48, (x + PAD + 172 + (64 - s48.width) // 2, ty + 56))
  s24 = im.resize((round(im.width * 24 / im.height), 24), Image.LANCZOS)
  d.rounded_rectangle([x + PAD + 246, ty + 62, x + PAD + 246 + 36, ty + 62 + 36], radius=6, fill=(46, 36, 52, 255))
  out.alpha_composite(s24, (x + PAD + 246 + (36 - s24.width) // 2, ty + 68))
  x += cw + GAP

fy = 108 + card_h + 22
d.text((24, fy), 'v1 → v3 的唯一改动：紫色部分从单一洋红换成「粉紫 → 深紫」渐变（亮面/上方偏粉紫，暗面/右下偏深紫）；mint 环、SP 圆牌、轮廓与明暗全部沿用 v1',
       font=small, fill=(206, 176, 194, 255))
d.text((24, fy + 26), '约束：基底唯一（无新画美术）· 轮廓与明暗不变 · 128×160 不变 · alpha 干净（无白边、无贴边裁切）',
       font=small, fill=(206, 176, 194, 255))

out.save('handoff/shots/ol-core-icon-v2-compare.png')
print('wrote handoff/shots/ol-core-icon-v2-compare.png', out.size)
