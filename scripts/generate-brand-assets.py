"""Gera os arquivos de marca do Conversor a partir do logo original da Grafix.

Uso (na raiz do projeto, com Python 3.10+ e Pillow):
    python -I scripts/generate-brand-assets.py

Entrada:  src/assets/logo-grafix-dark.png  (logo original, nome "Grafix" em branco)
Saídas:   src/assets/logo-grafix-light.png (branco trocado por cinza-escuro, para o tema claro)
          public/icons/*.png                (ícones do PWA, baseados no "G")

O script é determinístico: rodar de novo gera os mesmos arquivos.
Os ícones são PROVISÓRIOS até o usuário aprovar o visual (ver docs/ESPECIFICACAO.md).
"""

from __future__ import annotations

import colorsys
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "src/assets/logo-grafix-dark.png"
LIGHT = ROOT / "src/assets/logo-grafix-light.png"
ICONS = ROOT / "public/icons"

# Cores que substituem o branco no tema claro:
# - texto "GRAFIX DIGITAL": cinza quase preto;
# - lateral 3D e rastros do "G": cinza médio, para o "G" continuar com volume.
LIGHT_THEME_INK = (0x1C, 0x1C, 0x1F)
LIGHT_THEME_MARK = (0xA3, 0xA4, 0xAB)
# Pixels com saturação abaixo disso e luminosidade acima disso são considerados "brancos".
MAX_SATURATION = 0.18
MIN_LIGHTNESS = 0.45
# Região do "G" (com lateral 3D e rastros) no logo original (x0, y0, x1, y1).
# O "R" começa em x≈596; há uma coluna vazia entre x=584 e x=594.
MARK_BOX = (0, 0, 590, 440)
# Fundo escuro: o "G" é preto com lateral branca, então precisa de fundo escuro para ler.
ICON_BACKGROUND = (0x14, 0x14, 0x18, 255)


def make_light_logo(logo: Image.Image) -> Image.Image:
    out = logo.copy()
    pixels = out.load()
    assert pixels is not None
    width, height = out.size
    for y in range(height):
        for x in range(width):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue
            _, lightness, saturation = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            if saturation < MAX_SATURATION and lightness > MIN_LIGHTNESS:
                in_mark = x < MARK_BOX[2] and y < MARK_BOX[3]
                pixels[x, y] = (*(LIGHT_THEME_MARK if in_mark else LIGHT_THEME_INK), a)
    return out


def make_icon(mark: Image.Image, size: int, safe_ratio: float) -> Image.Image:
    """Ícone quadrado com fundo escuro e o "G" centralizado ocupando `safe_ratio` do lado."""
    canvas = Image.new("RGBA", (size, size), ICON_BACKGROUND)
    box = int(size * safe_ratio)
    scale = min(box / mark.width, box / mark.height)
    resized = mark.resize(
        (round(mark.width * scale), round(mark.height * scale)), Image.Resampling.LANCZOS
    )
    offset = ((size - resized.width) // 2, (size - resized.height) // 2)
    canvas.alpha_composite(resized, offset)
    return canvas.convert("RGB")


def main() -> int:
    if not SOURCE.exists():
        print(f"Logo original não encontrado: {SOURCE}", file=sys.stderr)
        return 1

    logo = Image.open(SOURCE).convert("RGBA")
    make_light_logo(logo).save(LIGHT, optimize=True)

    mark = logo.crop(MARK_BOX)
    bbox = mark.getbbox()
    if bbox is None:
        print("Região do G está vazia; confira MARK_BOX.", file=sys.stderr)
        return 1
    mark = mark.crop(bbox)

    ICONS.mkdir(parents=True, exist_ok=True)
    outputs = {
        "icon-192.png": (192, 0.84),
        "icon-512.png": (512, 0.84),
        # Ícone "maskable": o sistema pode cortar até 20% das bordas.
        "icon-maskable-512.png": (512, 0.62),
        "apple-touch-icon-180.png": (180, 0.80),
        "favicon-32.png": (32, 0.94),
    }
    for name, (size, ratio) in outputs.items():
        make_icon(mark, size, ratio).save(ICONS / name, optimize=True)

    print("Arquivos gerados:", LIGHT.relative_to(ROOT), *[f"public/icons/{n}" for n in outputs])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
