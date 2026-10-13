"""Approved B identity: shared surfaces and original Hangul outline geometry."""
from pathlib import Path

INK, TEAL, APRICOT, PAPER, LIGHT = '#24322D', '#286F62', '#E5AF70', '#F5F2E9', '#EEEADD'
SURFACES = [
    'M8 17C12 7 23 3 36 3C49 3 55 10 58 22C61 34 71 37 80 44C91 53 89 64 81 72C73 81 56 81 42 81H23C10 81 4 77 3 67C1 53 2 31 8 17Z',
    'M66 5C78 3 99 4 110 9C124 15 128 27 128 43V49C128 53 125 54 122 50C113 39 101 34 86 30C72 27 66 20 63 11C62 8 63 6 66 5Z',
    'M62 29C68 37 77 39 90 44C104 50 113 59 113 69C113 78 104 82 89 81H83C93 74 98 65 96 56C94 45 81 41 71 36C67 34 64 32 62 29Z',
]

def mark(colors):
    return ''.join(f'<path fill="{color}" d="{path}"/>' for color, path in zip(colors, SURFACES))

def rr(x, y, w, h, radius=4):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{radius}"/>'

def letters(color):
    # Approved rounded wordmark. ㅂ has one enclosed counter, with an open top.
    on = '<path fill-rule="evenodd" d="M25 0H68C84 0 96 11 96 24S84 47 68 47H25C10 47 0 37 0 24S10 0 25 0ZM27 16C22 16 19 19 19 24S22 31 27 31H66C71 31 75 29 75 24S71 16 66 16Z"/>' + rr(38, 41, 20, 21, 3) + rr(-3, 56, 103, 15, 3) + '<path d="M9 77H25Q29 77 29 81V88Q29 92 34 92H89Q94 92 94 96V103Q94 107 89 107H32Q9 107 9 88Z"/>'
    ba = '<path fill-rule="evenodd" d="M4 13Q4 9 8 9H20Q24 9 24 13V23Q24 27 28 27H45Q49 27 49 23V16Q49 12 53 12H64Q68 12 68 16V73Q68 78 63 78H9Q4 78 4 73ZM27 44Q23 44 23 48V57Q23 61 27 61H45Q49 61 49 57V48Q49 44 45 44Z"/>' + rr(78, 2, 20, 105, 3) + rr(92, 37, 24, 18, 3)
    tang = '<path d="M6 6H61Q65 6 65 10V17Q65 21 61 21H25V28H56Q60 28 60 32V37Q60 41 56 41H25V48H61Q65 48 65 52V58Q65 62 61 62H14Q6 62 6 54Z"/>' + rr(76, 2, 19, 60, 3) + rr(90, 25, 23, 18, 3) + '<path fill-rule="evenodd" d="M28 70H69C86 70 97 78 97 90S86 108 69 108H28C11 108 1 101 1 90S11 70 28 70ZM28 83C22 83 20 85 20 90S23 96 28 96H68C74 96 77 94 77 90S74 83 68 83Z"/>'
    return f'<g fill="{color}"><g transform="translate(3 0)">{on}</g><g transform="translate(119 0)">{ba}</g><g transform="translate(250 0)">{tang}</g></g>'

def build(out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    def save(name, body, box, label='온바탕'):
        svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{box}" role="img" aria-label="{label}"><title>{label}</title>{body}</svg>\n'
        (out / name).write_text(svg, encoding='utf-8', newline='\n')
    for name, ink, colors in [
        ('primary', INK, [TEAL, APRICOT, LIGHT]),
        ('inverse', PAPER, [PAPER]*3),
        ('mono', INK, [INK]*3),
    ]:
        save(f'wordmark-{name}.svg', letters(ink), '0 0 365 112')
        save(f'logo-{name}.svg', f'<g transform="translate(0 15) scale(1.03)">{mark(colors)}</g><g transform="translate(154 0)">{letters(ink)}</g>', '0 0 520 112')
        save(f'symbol-{name}.svg', mark(colors), '0 0 132 86', '온바탕 · 모여서 한 작품')
    save('symbol.svg', mark([TEAL, APRICOT, LIGHT]), '0 0 132 86', '온바탕 · 모여서 한 작품')
    save('app-icon.svg', f'<rect width="128" height="128" rx="29" fill="{PAPER}"/><g transform="translate(17 33) scale(.72)">{mark([TEAL, APRICOT, LIGHT])}</g>', '0 0 128 128')
    save('app-icon-dark.svg', f'<rect width="128" height="128" rx="29" fill="{INK}"/><g transform="translate(17 33) scale(.72)">{mark([PAPER]*3)}</g>', '0 0 128 128')
