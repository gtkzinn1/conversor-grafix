"""Gera os ícones do PWA a partir do símbolo oficial da Grafix.

Uso (na raiz do projeto, com Python 3.10+ e Pillow):
    python -I scripts/generate-brand-assets.py

Entrada:  src/assets/symbol-grafix-dark.png  (símbolo oficial para fundo escuro)
Saídas:   public/icons/*.png                  (ícones do PWA e favicon)

Os logos completos (src/assets/logo-grafix-*.png) são oficiais e não são gerados.
O script é determinístico: rodar de novo gera os mesmos arquivos.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SYMBOL = ROOT / "src/assets/symbol-grafix-dark.png"
ICONS = ROOT / "public/icons"

# Mesmo tom do fundo do app no tema escuro (src/styles/tokens.css, --bg).
ICON_BACKGROUND = (0x14, 0x14, 0x18, 255)

# Nome do arquivo: (tamanho em px, fração do lado ocupada pelo símbolo).
OUTPUTS: dict[str, tuple[int, float]] = {
    "icon-192.png": (192, 0.84),
    "icon-512.png": (512, 0.84),
    # Ícone "maskable": o sistema pode cortar até 20% das bordas.
    "icon-maskable-512.png": (512, 0.62),
    "apple-touch-icon-180.png": (180, 0.80),
    "favicon-32.png": (32, 0.94),
}


def make_icon(symbol: Image.Image, size: int, ratio: float) -> Image.Image:
    """Ícone quadrado com fundo escuro e o símbolo centralizado ocupando `ratio` do lado."""
    canvas = Image.new("RGBA", (size, size), ICON_BACKGROUND)
    box = int(size * ratio)
    scale = min(box / symbol.width, box / symbol.height)
    resized = symbol.resize(
        (round(symbol.width * scale), round(symbol.height * scale)), Image.Resampling.LANCZOS
    )
    offset = ((size - resized.width) // 2, (size - resized.height) // 2)
    canvas.alpha_composite(resized, offset)
    return canvas.convert("RGB")


def main() -> int:
    if not SYMBOL.exists():
        print(f"Símbolo não encontrado: {SYMBOL}", file=sys.stderr)
        return 1

    symbol = Image.open(SYMBOL).convert("RGBA")
    bbox = symbol.getbbox()
    if bbox is None:
        print("O símbolo está vazio (totalmente transparente).", file=sys.stderr)
        return 1
    symbol = symbol.crop(bbox)

    ICONS.mkdir(parents=True, exist_ok=True)
    for name, (size, ratio) in OUTPUTS.items():
        make_icon(symbol, size, ratio).save(ICONS / name, optimize=True)

    print("Ícones gerados:", *[f"public/icons/{name}" for name in OUTPUTS])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
