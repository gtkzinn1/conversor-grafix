"""Gera as imagens de teste de tests/samples/ (sintéticas, sem dados de clientes).

Uso (na raiz do projeto, Python 3.10+ e Pillow 12):
    python scripts/samples/generate_images.py

Cada arquivo imita uma situação que o "Converter imagens" precisa tratar.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent.parent
OUT = ROOT / "tests" / "samples"


def photo_with_exif() -> None:
    """Foto 400×200 guardada deitada, com EXIF mandando girar 90° (orientação 6), 300 DPI."""
    image = Image.new("RGB", (400, 200), (220, 30, 30))
    ImageDraw.Draw(image).rectangle((200, 0, 399, 199), fill=(30, 30, 220))
    exif = Image.Exif()
    exif[0x0112] = 6
    image.save(OUT / "foto-girada.jpg", quality=90, dpi=(300, 300), exif=exif)


def transparent_logo() -> None:
    """Logo 200×200 com círculo opaco e cantos transparentes, 300 DPI."""
    image = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
    ImageDraw.Draw(image).ellipse((20, 20, 180, 180), fill=(0, 185, 242, 255))
    image.save(OUT / "logo-transparente.png", dpi=(300, 300))


def cmyk_jpeg() -> None:
    """JPEG CMYK 100×100 (como os do Photoshop)."""
    Image.new("CMYK", (100, 100), (0, 100, 255, 0)).save(OUT / "cmyk.jpg", quality=90)


def webp() -> None:
    """WebP 120×80 com transparência."""
    image = Image.new("RGBA", (120, 80), (255, 242, 0, 128))
    image.save(OUT / "imagem.webp", lossless=True)


if __name__ == "__main__":
    photo_with_exif()
    transparent_logo()
    cmyk_jpeg()
    webp()
