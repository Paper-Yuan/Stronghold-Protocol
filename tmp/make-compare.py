# Throwaway: composes handoff/shots/desktop-launcher-compare.png (design mock vs implementation, two size tiers).
# Not part of the product.
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = r"E:\Workbox\系统"
SHOTS = os.path.join(ROOT, "handoff", "shots")
TMP = os.path.join(ROOT, "tmp")

BG = (12, 15, 14)
PANEL = (18, 22, 20)
LINE = (47, 58, 53)
MINT = (78, 216, 175)
TEXT = (242, 242, 242)
DIM = (138, 148, 143)
MUTED = (93, 104, 99)

FONT = r"C:\Windows\Fonts\msyh.ttc"
F_TITLE = ImageFont.truetype(FONT, 34)
F_SUB = ImageFont.truetype(FONT, 19)
F_LABEL = ImageFont.truetype(FONT, 20)
F_TAG = ImageFont.truetype(FONT, 17)

MARGIN = 24
GAP = 24
HEADER = 92
FOOTER = 46

rows = [
    {
        "size": "1280×720",
        "left": (os.path.join(TMP, "mock-1280x720.png"), "设计稿 mock-choice.html"),
        "right": (os.path.join(SHOTS, "desktop-launcher-design-1280x720.png"), "实现 desktop/launcher.html"),
        "left_note": "01 本机（mint 主档）· 02 服务器",
    },
    {
        "size": "792×360",
        "left": (os.path.join(TMP, "mock-792x360.png"), "设计稿 mock-choice.html"),
        "right": (os.path.join(SHOTS, "desktop-launcher-design-792x360.png"), "实现 desktop/launcher.html"),
        "left_note": "同一档窄/矮窗口",
    },
]

# Row 1 defines the canvas width: two 1280 panels side by side.
width = 1280 * 2 + GAP + MARGIN * 2
label_h = 30
height = HEADER + label_h + 720 + GAP + label_h + 360 + FOOTER
canvas = Image.new("RGB", (width, height), BG)
draw = ImageDraw.Draw(canvas)

draw.text((MARGIN, 20), "桌面启动页 · 设计稿 vs 实现", font=F_TITLE, fill=TEXT)
draw.text((MARGIN, 62), "左＝已确认的设计稿（静态视觉稿）    右＝打包后的真实启动页（Stronghold Protocol.exe）    两档均为实机截图", font=F_SUB, fill=DIM)
draw.line([(MARGIN, HEADER - 10), (width - MARGIN, HEADER - 10)], fill=LINE, width=1)

y = HEADER
for i, row in enumerate(rows):
    lpath, lname = row["left"]
    rpath, rname = row["right"]
    limg = Image.open(lpath).convert("RGB")
    rimg = Image.open(rpath).convert("RGB")
    pw, ph = limg.size
    # same width on both sides; row 2 centres the narrower pair
    x0 = MARGIN + (1280 - pw) // 2
    x1 = MARGIN + 1280 + GAP + (1280 - pw) // 2
    for img, x, name, accent in ((limg, x0, lname, DIM), (rimg, x1, rname, MINT)):
        draw.text((x + 2, y + 4), f"{name}  ·  {row['size']}", font=F_LABEL, fill=accent)
        canvas.paste(img, (x, y + label_h))
        draw.rectangle([x - 1, y + label_h - 1, x + pw, y + label_h + ph], outline=LINE)
        if accent == MINT:
            draw.rectangle([x - 1, y + label_h - 1, x + pw, y + label_h + 3], fill=MINT)
    y += label_h + ph + GAP

draw.text((MARGIN, height - FOOTER + 6), "两侧同宽、同一浏览器引擎（Edge/Chromium）渲染；实现页 1280×720 采用设计稿原尺度，792×360 走紧凑档（字号与 32px 点击下限）以确保可读与可点。", font=F_TAG, fill=MUTED)

out = os.path.join(SHOTS, "desktop-launcher-compare.png")
canvas.save(out, optimize=True)
print(out, canvas.size, os.path.getsize(out))
