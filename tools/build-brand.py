"""Build the outlined Onbatang wordmark from the bundled, unmodified OFL font."""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
import shutil
import sys

root = Path(__file__).resolve().parents[1]
out = root / 'app' / 'brand'
out.mkdir(parents=True, exist_ok=True)
if len(sys.argv) > 1:
    source = Path(sys.argv[1])
    shutil.copyfile(source / 'noto-sans-kr.woff2', out / 'noto-sans-kr.woff2')
    shutil.copyfile(source / 'notosanskr-OFL.txt', out / 'OFL.txt')
font = instantiateVariableFont(TTFont(out / 'noto-sans-kr.woff2'), {'wght': 740})
glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
parts = []
x = 0
for letter in '온바탕':
    name = cmap[ord(letter)]
    pen = SVGPathPen(glyphs, ntos=lambda value: format(value, '.3f').rstrip('0').rstrip('.'))
    glyphs[name].draw(pen)
    parts.append(f'<path transform="translate({x} 0)" d="{pen.getCommands()}"/>')
    x += font['hmtx'][name][0] - 16
letters = ''.join(parts)

def mark(ink, warm):
    # ㅇ: warm sun; ㅗ: open ground; ㄴ: the foundation of a canvas.
    return f'<circle cx="48" cy="25" r="13" fill="none" stroke="{warm}" stroke-width="9"/><path d="M48 49v11M22 60h52M24 75v12h50" fill="none" stroke="{ink}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>'

def svg(body, box, label):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{box}" role="img" aria-label="{label}"><title>{label}</title>{body}</svg>\n'

for name, ink, warm in [('primary', '#1D2944', '#D68B43'), ('inverse', '#FFFFFF', '#F5C181'), ('mono', '#1D2944', '#1D2944')]:
    (out / f'wordmark-{name}.svg').write_text(svg(f'<g fill="{ink}" transform="translate(0 76) scale(.082 -.082)">{letters}</g>', '0 0 228 96', '온바탕'), encoding='utf-8', newline='\n')
    (out / f'logo-{name}.svg').write_text(svg(f'<g transform="translate(0 0) scale(.94)">{mark(ink, warm)}</g><g fill="{ink}" transform="translate(114 76) scale(.082 -.082)">{letters}</g>', '0 0 342 96', '온바탕'), encoding='utf-8', newline='\n')
(out / 'symbol.svg').write_text(svg(mark('#147D78', '#D68B43'), '0 0 96 96', '온바탕 심볼'), encoding='utf-8', newline='\n')
(out / 'app-icon.svg').write_text(svg('<rect width="128" height="128" rx="30" fill="#147D78"/><g transform="translate(16 10)">'+mark('#FFFFFF', '#F5C181')+'</g>', '0 0 128 128', '온바탕'), encoding='utf-8', newline='\n')
