import numpy as np
from PIL import Image

base = Image.open('public/assets/item/trap_1073_acarm073.png').convert('RGBA')
v1 = Image.open('public/assets/item/trap_ol_core.png').convert('RGBA')
for name, im in (('base', base), ('v1', v1)):
    a = np.array(im)
    al = a[:, :, 3]
    ys, xs = np.nonzero(al > 8)
    print(name, im.size, 'bbox', xs.min(), ys.min(), xs.max(), ys.max(), 'opaque px', int((al > 128).sum()))
    hsv = np.array(im.convert('HSV'), dtype=np.float32) / 255.0
    m = al > 128
    h, s, v = hsv[:, :, 0][m], hsv[:, :, 1][m], hsv[:, :, 2][m]
    print('  hue pct', np.percentile(h, [5, 25, 50, 75, 95]).round(2))
    print('  sat pct', np.percentile(s, [5, 25, 50, 75, 95]).round(2))
    print('  val pct', np.percentile(v, [5, 25, 50, 75, 95]).round(2))
    # corner badge area colours
    corner = np.array(im.crop((88, 0, 128, 42)))
    print('  corner alpha mean', corner[:, :, 3].mean().round(1))

# zoom previews on dark bg
def zoom(im, k=4, bg=(18, 14, 22, 255)):
    big = im.resize((im.width * k, im.height * k), Image.NEAREST)
    out = Image.new('RGBA', big.size, bg)
    out.alpha_composite(big)
    return out

z = Image.new('RGBA', (base.width * 4 + v1.width * 4 + 24, 160 * 4), (18, 14, 22, 255))
z.alpha_composite(zoom(base), (0, 0))
z.alpha_composite(zoom(v1), (base.width * 4 + 24, 0))
z.save('tmp/ol2_probe.png')
print('wrote tmp/ol2_probe.png', z.size)
