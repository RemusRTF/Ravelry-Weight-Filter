"""Generates the extension icons: a pink fluffy yarn ball, gray disabled variants,
and spin-up animation frames (gray spinning fast, turning pink while slowing down)."""
from PIL import Image, ImageDraw, ImageFilter
import math
import os

SIZES = [16, 32, 48, 128, 512]
DISABLED_SIZES = [16, 32, 48, 128]
ANIM_SIZES = [16, 32, 48, 128]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")

ACTIVE = {
    "shadow": (214, 150, 180),
    "dark": (205, 98, 156),
    "mid": (236, 143, 189),
    "light": (248, 194, 221),
    "strand": (255, 236, 245),
    "fluff": (246, 178, 210),
    "tail": (205, 98, 156),
}

DISABLED = {
    "shadow": (200, 200, 200),
    "dark": (128, 128, 128),
    "mid": (178, 178, 178),
    "light": (214, 214, 214),
    "strand": (238, 238, 238),
    "fluff": (196, 196, 196),
    "tail": (138, 138, 138),
}

# frames played by the service worker: gray fast spin (phase 0) then
# decelerating spin while lerping to the pink palette (t = color blend)
ANIM_FRAMES = [
    ("n01", 90, 0.0, 55),
    ("n02", 180, 0.0, 55),
    ("n03", 270, 0.0, 55),
    ("n04", 360, 0.0, 55),
    ("n05", 440, 1 / 9, 80),
    ("n06", 500, 2 / 9, 80),
    ("n07", 550, 3 / 9, 80),
    ("n08", 590, 4 / 9, 80),
    ("n09", 622, 5 / 9, 80),
    ("n10", 648, 6 / 9, 80),
    ("n11", 670, 7 / 9, 80),
    ("n12", 695, 8 / 9, 80),
    ("n13", 720, 1.0, 80),
]


def lerp_palette(a, b, t):
    return {k: tuple(int(round(a[k][i] + (b[k][i] - a[k][i]) * t)) for i in range(3)) for k in a}


def draw_icon(size, c, spin=0.0):
    def sc(v):
        return v

    cx, cy = size * 0.5, size * 0.46
    r = size * 0.40

    def ball_mask(grow=0.0):
        m = Image.new("L", (size, size), 0)
        ImageDraw.Draw(m).ellipse(
            [sc(cx - r - grow), sc(cy - r - grow), sc(cx + r + grow), sc(cy + r + grow)],
            fill=255,
        )
        return m

    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # soft drop shadow
    d.ellipse(
        [sc(cx - r * 0.85), sc(cy + r * 0.82), sc(cx + r * 0.95), sc(cy + r * 1.08)],
        fill=c["shadow"] + (110,),
    )

    # fluffy haze halo
    halo = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    m = r * 1.14
    pad = size * 0.02
    hd.ellipse(
        [sc(cx - m - pad), sc(cy - m - pad), sc(cx + m + pad), sc(cy + m + pad)],
        fill=c["fluff"] + (105,),
    )
    halo = halo.filter(ImageFilter.GaussianBlur(size * 0.04))
    img = Image.alpha_composite(img, halo)

    # ball body
    d = ImageDraw.Draw(img)
    d.ellipse([sc(cx - r), sc(cy - r), sc(cx + r), sc(cy + r)], fill=c["mid"] + (255,))

    # wrapped strands: ovals crossing the face, rotated (base tilt + spin), clipped to ball
    strands = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    for i, dy in enumerate((-0.42, 0.0, 0.42)):
        col = (c["strand"] if i % 2 == 0 else c["dark"]) + (245,)
        layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        w = max(1, int(round(sc(5.2))))
        ry = r * 0.5
        ld.ellipse(
            [sc(cx - r * 0.92), sc(cy + dy * r - ry), sc(cx + r * 0.92), sc(cy + dy * r + ry)],
            outline=col, width=w,
        )
        layer = layer.rotate((i - 1) * 12 + spin, center=(sc(cx), sc(cy)), resample=Image.BICUBIC)
        strands = Image.alpha_composite(strands, layer)

    # fluffy wisps poking past the edge (also rotate with the spin)
    wisps = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    wd = ImageDraw.Draw(wisps)
    for k in range(12):
        a = (k / 12.0) * 2 * math.pi + 0.26
        r1 = r * (1.06 + 0.03 * ((k * 29) % 3) / 2.0)
        x0, y0 = cx + r * 0.96 * math.cos(a), cy + r * 0.96 * math.sin(a)
        x1, y1 = cx + r1 * math.cos(a + 0.12), cy + r1 * math.sin(a + 0.12)
        wd.line([sc(x0), sc(y0), sc(x1), sc(y1)], fill=c["fluff"] + (215,), width=max(1, int(round(sc(2.6)))))
    wisps = wisps.filter(ImageFilter.GaussianBlur(max(0.4, size * 0.006)))
    if spin % 360:
        wisps = wisps.rotate(spin, center=(sc(cx), sc(cy)), resample=Image.BICUBIC)

    strands.putalpha(Image.composite(strands.split()[3], Image.new("L", (size, size), 0), ball_mask()))
    wisps.putalpha(Image.composite(wisps.split()[3], Image.new("L", (size, size), 0), ball_mask(grow=size * 0.02)))
    img = Image.alpha_composite(img, strands)
    img = Image.alpha_composite(img, wisps)

    # wavy yarn tail with a little curl at the end (static anchor, lower right)
    d = ImageDraw.Draw(img)
    pts = [(sc(cx + r * 0.55), sc(cy + r * 0.62))]
    for t in range(1, 61):
        f = t / 60.0
        x = cx + r * 0.55 + (size * 0.86 - (cx + r * 0.55)) * f
        y = cy + r * 0.62 + (size * 0.8 - (cy + r * 0.62)) * f
        x += math.sin(f * math.pi * 3) * size * 0.035
        y -= math.sin(f * math.pi * 2) * size * 0.025
        pts.append((sc(x), sc(y)))
    d.line(pts, fill=c["tail"] + (255,), width=max(1, int(round(sc(2.6)))), joint="curve")
    curl_r = size * 0.06
    d.arc(
        [sc(size * 0.76), sc(size * 0.72), sc(size * 0.76 + curl_r * 2), sc(size * 0.72 + curl_r * 2)],
        210, 150, fill=c["tail"] + (255,), width=max(1, int(round(sc(2.6)))),
    )

    # highlight
    d.ellipse(
        [sc(cx - r * 0.58), sc(cy - r * 0.66), sc(cx - r * 0.14), sc(cy - r * 0.32)],
        fill=(255, 255, 255, 100),
    )
    return img


def main():
    os.makedirs(OUT, exist_ok=True)
    anim_dir = os.path.join(OUT, "anim")
    os.makedirs(anim_dir, exist_ok=True)
    for size in SIZES:
        draw_icon(size, ACTIVE).save(os.path.join(OUT, "icon%d.png" % size))
    for size in DISABLED_SIZES:
        draw_icon(size, DISABLED).save(os.path.join(OUT, "icon%d-disabled.png" % size))
    for name, spin, t, _ms in ANIM_FRAMES:
        c = DISABLED if t <= 0 else lerp_palette(DISABLED, ACTIVE, t)
        for size in ANIM_SIZES:
            draw_icon(size, c, spin=spin).save(os.path.join(anim_dir, "%s-%d.png" % (name, size)))
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
