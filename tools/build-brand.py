"""Regenerate approved B SVG identity (Python standard library only)."""
from pathlib import Path
from brand_geometry import build
build(Path(__file__).resolve().parents[1] / 'app' / 'brand')
print('Built approved B symbol and custom Hangul outlines.')
