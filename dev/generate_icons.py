"""Generate all platform icons from logo/q3_logo.png for Q3 IDE."""
import os
from PIL import Image
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / "logo" / "q3_logo.png"

def generate_windows_icons():
    """Generate Windows .ico and .bmp files."""
    img = Image.open(LOGO).convert("RGBA")
    
    # Main app icon (multi-size ICO)
    ico_sizes = [(256, 256), (128, 128), (96, 96), (64, 64), (48, 48), (32, 32), (24, 24), (16, 16)]
    for quality in ["stable", "insider"]:
        dest = ROOT / "src" / quality / "resources" / "win32" / "code.ico"
        dest.parent.mkdir(parents=True, exist_ok=True)
        img_resized = img.resize((256, 256), Image.LANCZOS)
        img_resized.save(str(dest), format="ICO", sizes=ico_sizes)
        print(f"Generated: {dest}")
        
        # VisualElementsManifest images
        for size, name in [(70, "code_70x70.png"), (150, "code_150x150.png")]:
            dest = ROOT / "src" / quality / "resources" / "win32" / name
            img_resized = img.resize((size, size), Image.LANCZOS)
            img_resized.save(str(dest))
            print(f"Generated: {dest}")
        
        # Inno Setup installer bitmaps
        inno_sizes = {
            "inno-big-100.bmp": (164, 314),
            "inno-big-125.bmp": (192, 386),
            "inno-big-150.bmp": (246, 459),
            "inno-big-175.bmp": (273, 556),
            "inno-big-200.bmp": (328, 604),
            "inno-big-225.bmp": (355, 700),
            "inno-big-250.bmp": (410, 797),
            "inno-small-100.bmp": (55, 55),
            "inno-small-125.bmp": (64, 68),
            "inno-small-150.bmp": (83, 80),
            "inno-small-175.bmp": (92, 97),
            "inno-small-200.bmp": (110, 106),
            "inno-small-225.bmp": (119, 123),
            "inno-small-250.bmp": (138, 140),
        }
        for name, (w, h) in inno_sizes.items():
            dest = ROOT / "src" / quality / "resources" / "win32" / name
            # Create white background, center the logo
            bg = Image.new("RGBA", (w, h), (255, 255, 255, 255))
            logo_size = min(w, h) * 3 // 4
            logo_resized = img.resize((logo_size, logo_size), Image.LANCZOS)
            offset = ((w - logo_size) // 2, (h - logo_size) // 2)
            bg.paste(logo_resized, offset, logo_resized)
            bg.convert("RGB").save(str(dest), format="BMP")
            print(f"Generated: {dest}")
        
        # MSI WiX bitmaps
        msi_dir = ROOT / "build" / "windows" / "msi" / "resources" / quality
        msi_dir.mkdir(parents=True, exist_ok=True)
        
        # wix-banner: 493x58
        banner = Image.new("RGBA", (493, 58), (255, 255, 255, 255))
        logo_resized = img.resize((50, 50), Image.LANCZOS)
        banner.paste(logo_resized, (438, 4), logo_resized)
        banner.convert("RGB").save(str(msi_dir / "wix-banner.bmp"), format="BMP")
        print(f"Generated: {msi_dir / 'wix-banner.bmp'}")
        
        # wix-dialog: 493x312
        dialog = Image.new("RGBA", (493, 312), (255, 255, 255, 255))
        logo_resized = img.resize((120, 120), Image.LANCZOS)
        dialog.paste(logo_resized, (22, 152), logo_resized)
        dialog.convert("RGB").save(str(msi_dir / "wix-dialog.bmp"), format="BMP")
        print(f"Generated: {msi_dir / 'wix-dialog.bmp'}")

def generate_linux_icons():
    """Generate Linux .png and .xpm files."""
    img = Image.open(LOGO).convert("RGBA")
    
    for quality in ["stable", "insider"]:
        # Main Linux icon
        dest = ROOT / "src" / quality / "resources" / "linux" / "code.png"
        dest.parent.mkdir(parents=True, exist_ok=True)
        img_resized = img.resize((512, 512), Image.LANCZOS)
        img_resized.save(str(dest))
        print(f"Generated: {dest}")
        
        # RPM XPM - Pillow doesn't support XPM, write manually
        xpm_dest = ROOT / "src" / quality / "resources" / "linux" / "rpm" / "code.xpm"
        xpm_dest.parent.mkdir(parents=True, exist_ok=True)
        img_small = img.resize((48, 48), Image.LANCZOS).convert("RGBA")
        pixels = list(img_small.getdata())
        w, h = 48, 48
        # Build color map
        color_map = {}
        hex_pixels = []
        for r, g, b, a in pixels:
            if a < 128:
                key = "None"
            else:
                key = f"#{r:02x}{g:02x}{b:02x}"
            if key not in color_map:
                color_map[key] = len(color_map)
            hex_pixels.append(color_map[key])
        ncolors = len(color_map)
        chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/"
        def c(i):
            if ncolors <= 1:
                return "  "
            return chars[i // len(chars)] + chars[i % len(chars)]
        lines = [f"/* XPM */", f"static char *code_xpm[] = {{", f'"{w} {h} {ncolors} 2",']
        for key, idx in sorted(color_map.items(), key=lambda x: x[1]):
            lines.append(f'"{c(idx)} c {key}",')
        for row in range(h):
            row_pixels = hex_pixels[row * w:(row + 1) * w]
            line = "".join(c(p) for p in row_pixels)
            lines.append(f'"{line}"' + ("," if row < h - 1 else ""))
        lines.append("};")
        with open(xpm_dest, "w") as f:
            f.write("\n".join(lines))
        print(f"Generated: {xpm_dest}")

def generate_macos_icons():
    """Generate macOS .icns files."""
    img = Image.open(LOGO).convert("RGBA")
    
    for quality in ["stable", "insider"]:
        dest = ROOT / "src" / quality / "resources" / "darwin" / "code.icns"
        dest.parent.mkdir(parents=True, exist_ok=True)
        
        # ICNS with multiple sizes
        sizes = [1024, 512, 256, 128, 64, 32, 16]
        images = []
        for s in sizes:
            resized = img.resize((s, s), Image.LANCZOS)
            images.append(resized)
        
        # Save as ICNS (Pillow supports this on macOS, fallback to PNG-based approach)
        try:
            images[0].save(str(dest), format="ICNS", append_images=images[1:])
            print(f"Generated: {dest}")
        except Exception as e:
            print(f"Warning: Could not generate ICNS ({e}), copying 1024x1024 PNG instead")
            img_resized = img.resize((1024, 1024), Image.LANCZOS)
            png_dest = dest.with_suffix(".png")
            img_resized.save(str(png_dest))
            print(f"Generated: {png_dest}")

def generate_server_icons():
    """Generate server/web icons."""
    img = Image.open(LOGO).convert("RGBA")
    
    for quality in ["stable", "insider"]:
        server_dir = ROOT / "src" / quality / "resources" / "server"
        server_dir.mkdir(parents=True, exist_ok=True)
        
        # favicon.ico
        ico_sizes = [(256, 256), (128, 128), (64, 64), (32, 32), (16, 16)]
        img_resized = img.resize((256, 256), Image.LANCZOS)
        img_resized.save(str(server_dir / "favicon.ico"), format="ICO", sizes=ico_sizes)
        print(f"Generated: {server_dir / 'favicon.ico'}")
        
        # code-192.png
        img_192 = img.resize((192, 192), Image.LANCZOS)
        img_192.save(str(server_dir / "code-192.png"))
        print(f"Generated: {server_dir / 'code-192.png'}")
        
        # code-512.png
        img_512 = img.resize((512, 512), Image.LANCZOS)
        img_512.save(str(server_dir / "code-512.png"))
        print(f"Generated: {server_dir / 'code-512.png'}")

def generate_in_app_icon():
    """Generate the in-app SVG icon (code-icon.svg)."""
    for quality in ["stable", "insider"]:
        dest = ROOT / "src" / quality / "src" / "vs" / "workbench" / "browser" / "media" / "code-icon.svg"
        dest.parent.mkdir(parents=True, exist_ok=True)
        
        # Create an SVG that embeds the PNG as base64
        import base64
        with open(LOGO, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()
        
        svg_content = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0" y="0" width="1024" height="1024" viewBox="0, 0, 1024, 1024">
  <image width="1024" height="1024" xlink:href="data:image/png;base64,{b64}"/>
</svg>
'''
        with open(dest, "w") as f:
            f.write(svg_content)
        print(f"Generated: {dest}")

def generate_letterpress():
    """Generate letterpress SVGs (empty/placeholder for now)."""
    for quality in ["stable", "insider"]:
        media_dir = ROOT / "src" / quality / "src" / "vs" / "workbench" / "browser" / "parts" / "editor" / "media"
        media_dir.mkdir(parents=True, exist_ok=True)
        
        for variant in ["letterpress-dark.svg", "letterpress-light.svg", "letterpress-hcDark.svg", "letterpress-hcLight.svg"]:
            dest = media_dir / variant
            if not dest.exists():
                # Simple placeholder SVG
                svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0, 0, 100, 100">
  <rect width="100" height="100" fill="transparent"/>
</svg>
'''
                with open(dest, "w") as f:
                    f.write(svg)
                print(f"Generated: {dest}")

if __name__ == "__main__":
    print("Generating Q3 IDE icons from logo/q3_logo.png...")
    print()
    generate_windows_icons()
    print()
    generate_linux_icons()
    print()
    generate_macos_icons()
    print()
    generate_server_icons()
    print()
    generate_in_app_icon()
    print()
    generate_letterpress()
    print()
    print("All icons generated successfully!")
