"""Акварельная иконка: мордочка рыжего котика на кремовом круге."""
import random
from PIL import Image, ImageDraw, ImageFilter, ImageChops

S = 1024
random.seed(5)
k = S / 256


def wash(mask, color, edge=(150, 80, 35), grain=0.16):
    """Заливка по маске с тёмным краем и зерном."""
    base = Image.new('RGBA', mask.size, color + (255,))
    blur = mask.filter(ImageFilter.GaussianBlur(S / 70))
    band = ImageChops.subtract(mask, blur)
    edge_l = Image.new('RGBA', mask.size, edge + (0,))
    edge_l.putalpha(band.point(lambda v: min(255, v * 2)))
    img = Image.alpha_composite(base, edge_l)
    noise = Image.effect_noise(mask.size, 60).point(lambda v: int(v * grain))
    dark = Image.new('RGBA', mask.size, (40, 25, 15, 0))
    dark.putalpha(noise)
    img = Image.alpha_composite(img, dark)
    img.putalpha(mask.filter(ImageFilter.GaussianBlur(2)))
    return img


def poly_mask(pts, wob=4):
    m = Image.new('L', (S, S), 0)
    pts = [(x * k + random.uniform(-wob, wob), y * k + random.uniform(-wob, wob)) for x, y in pts]
    ImageDraw.Draw(m).polygon(pts, fill=255)
    return m.filter(ImageFilter.GaussianBlur(5)).point(lambda v: 255 if v > 128 else 0)


def ellipse_mask(box):
    m = Image.new('L', (S, S), 0)
    ImageDraw.Draw(m).ellipse([c * k for c in box], fill=255)
    return m


img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
img = Image.alpha_composite(img, wash(ellipse_mask((8, 8, 248, 248)), (250, 238, 214), edge=(215, 180, 140), grain=0.1))

head = ImageChops.lighter(ellipse_mask((44, 74, 212, 214)), poly_mask([(52, 120), (58, 30), (112, 82)]))
head = ImageChops.lighter(head, poly_mask([(204, 120), (198, 30), (144, 82)]))
img = Image.alpha_composite(img, wash(head, (232, 161, 96)))
d = ImageDraw.Draw(img)
# внутренность ушей
d.polygon([(66 * k, 92 * k), (68 * k, 48 * k), (100 * k, 80 * k)], fill=(242, 178, 166, 200))
d.polygon([(190 * k, 92 * k), (188 * k, 48 * k), (156 * k, 80 * k)], fill=(242, 178, 166, 200))
# полоски на лбу
for x0, x1 in ((112, 114), (128, 128), (144, 142)):
    d.line([(x0 * k, 84 * k), (x1 * k, 110 * k)], fill=(178, 93, 36, 170), width=int(5 * k))
# белая мордочка
muz = ellipse_mask((92, 150, 164, 200))
img = Image.alpha_composite(img, wash(muz, (255, 250, 242), edge=(230, 210, 190), grain=0.05))
d = ImageDraw.Draw(img)
for cx in (98, 158):
    d.ellipse([(cx - 15) * k, 120 * k, (cx + 15) * k, 148 * k], fill=(212, 177, 58, 255), outline=(107, 58, 31, 255), width=int(2 * k))
    d.ellipse([(cx - 4) * k, 121 * k, (cx + 4) * k, 147 * k], fill=(29, 21, 18, 255))
    d.ellipse([(cx + 4) * k, 125 * k, (cx + 9) * k, 130 * k], fill=(255, 255, 255, 230))
d.polygon([(120 * k, 156 * k), (136 * k, 156 * k), (128 * k, 166 * k)], fill=(217, 135, 124, 255))
d.line([(128 * k, 166 * k), (128 * k, 174 * k)], fill=(107, 58, 31, 200), width=int(2 * k))
d.arc([116 * k, 166 * k, 128 * k, 180 * k], 20, 160, fill=(107, 58, 31, 200), width=int(2 * k))
d.arc([128 * k, 166 * k, 140 * k, 180 * k], 20, 160, fill=(107, 58, 31, 200), width=int(2 * k))

img.resize((256, 256), Image.LANCZOS).save('build/icon.png')
img.save('build/icon.ico', sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
img.resize((32, 32), Image.LANCZOS).save('assets/tray.png')
print('icons ok')
