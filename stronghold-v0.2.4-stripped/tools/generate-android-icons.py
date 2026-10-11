#!/usr/bin/env python3
"""
Generate all Android launcher icon assets from chosen design (Option C: Crest & Horn).
Produces:
- Adaptive icon foregrounds: drawable-{m,h,xh,xxh,xxxh}dpi/ic_launcher_foreground.png
- Adaptive icon monochrome:  drawable-{m,h,xh,xxh,xxxh}dpi/ic_launcher_monochrome.png
- Legacy square icons:       mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher.png
- Legacy round icons:        mipmap-{m,h,xh,xxh,xxxh}dpi/ic_launcher_round.png
"""

import os
from PIL import Image, ImageDraw, ImageFilter

SOURCE_IMAGE = os.path.join("vibe_images", "icon-c-crest-horn_1791037259646_85328c26.png")
RES_DIR = os.path.join("android", "app", "src", "main", "res")

# Density configurations
ADAPTIVE_SIZES = {
    "drawable-mdpi": 108,
    "drawable-hdpi": 162,
    "drawable-xhdpi": 216,
    "drawable-xxhdpi": 324,
    "drawable-xxxhdpi": 432,
}

LEGACY_SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

def create_circular_mask(size, radius, supersample=4):
    """Create a high-quality anti-aliased circular alpha mask."""
    big_size = size * supersample
    big_radius = radius * supersample
    mask = Image.new("L", (big_size, big_size), 0)
    draw = ImageDraw.Draw(mask)
    cx, cy = big_size // 2, big_size // 2
    draw.ellipse((cx - big_radius, cy - big_radius, cx + big_radius, cy + big_radius), fill=255)
    return mask.resize((size, size), Image.Resampling.LANCZOS)

def create_rounded_rect_mask(size, radius, supersample=4):
    """Create a high-quality anti-aliased rounded rectangle alpha mask."""
    big_size = size * supersample
    big_radius = radius * supersample
    mask = Image.new("L", (big_size, big_size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, big_size, big_size), radius=big_radius, fill=255)
    return mask.resize((size, size), Image.Resampling.LANCZOS)

def generate_icons():
    print(f"Loading source: {SOURCE_IMAGE}")
    src = Image.open(SOURCE_IMAGE).convert("RGBA")
    w, h = src.size
    assert w == 1024 and h == 1024, f"Expected 1024x1024, got {w}x{h}"

    # The badge ring outer edge is at r ≈ 446 in 1024x1024 (center is 512, 512).
    # Cut out the badge cleanly with a smooth circle mask at r=448.
    circle_mask_1024 = create_circular_mask(1024, 448)
    badge_clean = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    badge_clean.paste(src, (0, 0), circle_mask_1024)

    # 1. Generate Adaptive Foregrounds
    # Android adaptive icon standard: Canvas is 108dp, safe circle is 72dp (~66.7%).
    # We target badge diameter = 70% of canvas size to fit snugly inside safe area.
    print("\n--- Generating Adaptive Foregrounds ---")
    for density, size in ADAPTIVE_SIZES.items():
        out_dir = os.path.join(RES_DIR, density)
        os.makedirs(out_dir, exist_ok=True)
        out_path = os.path.join(out_dir, "ic_launcher_foreground.png")

        # Badge size on canvas:
        # Since badge has diameter 896 in 1024, if we scale badge_clean:
        # badge_target_diameter = size * 0.70
        # scale_factor = badge_target_diameter / 896
        # scaled_1024_size = 1024 * scale_factor
        target_badge_d = int(size * 0.70)
        scale = target_badge_d / 896.0
        scaled_w = int(round(1024 * scale))
        scaled_h = int(round(1024 * scale))

        scaled_badge = badge_clean.resize((scaled_w, scaled_h), Image.Resampling.LANCZOS)

        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        offset_x = (size - scaled_w) // 2
        offset_y = (size - scaled_h) // 2
        canvas.paste(scaled_badge, (offset_x, offset_y), scaled_badge)

        canvas.save(out_path, "PNG", optimize=True)
        print(f"Saved {out_path} ({size}x{size}, badge d={target_badge_d}px)")

    # 2. Generate Adaptive Monochrome Icons
    # Material You themed icon: pure white with alpha variations matching luminosity.
    print("\n--- Generating Adaptive Monochrome Icons ---")
    for density, size in ADAPTIVE_SIZES.items():
        fg_path = os.path.join(RES_DIR, density, "ic_launcher_foreground.png")
        mono_path = os.path.join(RES_DIR, density, "ic_launcher_monochrome.png")
        fg_img = Image.open(fg_path).convert("RGBA")

        # Extract brightness as alpha, set RGB to white
        mono = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        fg_data = fg_img.load()
        mono_data = mono.load()

        for y in range(size):
            for x in range(size):
                r, g, b, a = fg_data[x, y]
                if a > 0:
                    lum = int(0.299 * r + 0.587 * g + 0.114 * b)
                    # boost contrast for crisp monochrome theme icon
                    alpha = min(255, int((lum / 255.0) ** 0.85 * a * 1.3))
                    mono_data[x, y] = (255, 255, 255, alpha)

        mono.save(mono_path, "PNG", optimize=True)
        print(f"Saved {mono_path} ({size}x{size})")

    # 3. Generate Legacy Round Icons
    # Round icon fits badge inside a full circle with subtle 2px breathing margin.
    print("\n--- Generating Legacy Round Icons ---")
    for density, size in LEGACY_SIZES.items():
        out_dir = os.path.join(RES_DIR, density)
        os.makedirs(out_dir, exist_ok=True)
        round_path = os.path.join(out_dir, "ic_launcher_round.png")

        # Diameter fills ~94% of canvas
        target_d = int(size * 0.94)
        scale = target_d / 896.0
        scaled_w = int(round(1024 * scale))
        scaled_h = int(round(1024 * scale))
        scaled_badge = badge_clean.resize((scaled_w, scaled_h), Image.Resampling.LANCZOS)

        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        offset_x = (size - scaled_w) // 2
        offset_y = (size - scaled_h) // 2
        canvas.paste(scaled_badge, (offset_x, offset_y), scaled_badge)

        canvas.save(round_path, "PNG", optimize=True)
        print(f"Saved {round_path} ({size}x{size})")

    # 4. Generate Legacy Square Icons (Squircle)
    # Background #06080D, rounded rectangle with 18% corner radius, containing badge.
    print("\n--- Generating Legacy Square Icons ---")
    for density, size in LEGACY_SIZES.items():
        out_dir = os.path.join(RES_DIR, density)
        os.makedirs(out_dir, exist_ok=True)
        sq_path = os.path.join(out_dir, "ic_launcher.png")

        # Rounded rectangle background
        sq_mask = create_rounded_rect_mask(size, radius=int(size * 0.18))
        sq_canvas = Image.new("RGBA", (size, size), (6, 8, 13, 255))

        # Put badge centered inside, slightly padded (~82% of size)
        target_d = int(size * 0.82)
        scale = target_d / 896.0
        scaled_w = int(round(1024 * scale))
        scaled_h = int(round(1024 * scale))
        scaled_badge = badge_clean.resize((scaled_w, scaled_h), Image.Resampling.LANCZOS)

        offset_x = (size - scaled_w) // 2
        offset_y = (size - scaled_h) // 2
        sq_canvas.paste(scaled_badge, (offset_x, offset_y), scaled_badge)

        # Apply rounded corner mask to the entire squircle canvas
        final_sq = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        final_sq.paste(sq_canvas, (0, 0), sq_mask)

        final_sq.save(sq_path, "PNG", optimize=True)
        print(f"Saved {sq_path} ({size}x{size})")

    print("\nAll Android icons generated successfully!")

if __name__ == "__main__":
    generate_icons()
