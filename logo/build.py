"""Build the Nerdplexity logo kit from the app's CSS geometry.

Geometry mirrors frontend/src/workspace/workspace.css (.np-brand*), in CSS px,
scaled by K. Letters are shaped with HarfBuzz (as Chrome does) and outlined from
Inter at the same weight and optical size, with overlaps removed.
"""
import io, json, os, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import uharfbuzz as hb

OUT = sys.argv[1]
FONT = 'node_modules/@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2'
K = 16  # 1 CSS px = 16 logo units

C = {
    'tile': '#b5df98', 'ink': '#141c10', 'dot': '#487130',
    'onDarkText': '#fafafa', 'onDarkMuted': '#a1a1aa',
    'onLightText': '#0a0a0a', 'onLightMuted': '#52525b',
}

woff = TTFont(FONT)
woff.flavor = None
_buf = io.BytesIO(); woff.save(_buf)
TTF = _buf.getvalue()
UPM = woff['head'].unitsPerEm
ASC, DESC = woff['hhea'].ascent, -woff['hhea'].descent
_instances = {}

def inst(wght, opsz):
    key = (wght, opsz)
    if key not in _instances:
        f = TTFont(io.BytesIO(TTF))
        _instances[key] = instancer.instantiateVariableFont(f, {'wght': wght, 'opsz': opsz}, overlap=instancer.OverlapMode.REMOVE)
    return _instances[key]

def fmt(v):
    s = f'{v:.2f}'.rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s

def run(text, size, wght, ls, x, baseline):
    """Outline one CSS text run. Returns (svg path d, advance width in CSS px incl. trailing letter-spacing)."""
    opsz = max(14, min(32, size))  # font-optical-sizing: auto
    face = hb.Face(TTF); font = hb.Font(face); font.set_variations({'wght': wght, 'opsz': opsz})
    buf = hb.Buffer(); buf.add_str(text); buf.guess_segment_properties()
    # Chrome turns off optional ligatures when letter-spacing is not zero.
    hb.shape(font, buf, {'kern': True, 'liga': ls == 0, 'clig': ls == 0})
    f = inst(wght, opsz); order = f.getGlyphOrder(); gs = f.getGlyphSet()
    s = size / UPM
    pen = SVGPathPen(gs, ntos=fmt)
    cursor = x
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        tp = TransformPen(pen, (s * K, 0, 0, -s * K, (cursor + pos.x_offset * s) * K, (baseline - pos.y_offset * s) * K))
        gs[order[info.codepoint]].draw(tp)
        cursor += pos.x_advance * s + ls
    return pen.getCommands(), cursor - x

def baseline(top, size, line_height):
    # Chrome rounds ascent and descent to whole pixels for line layout.
    a, d = round(ASC * size / UPM), round(DESC * size / UPM)
    return top + (line_height - (a + d)) / 2 + a

def measure(text, size, wght, ls):
    return run(text, size, wght, ls, 0, 0)[1]

# ---- mark: 35x35, radius 11, font 29/750. The "n." group is centred by its ink,
# with a small gap between the n and the dot (design revision, not the CSS layout).
TILE, RADIUS = 35, 11
DOT_GAP = 1.0  # CSS px between the n's right edge and the dot
from fontTools.pens.boundsPen import BoundsPen

def ink(char, size, wght):
    """Left side bearing, ink width, and advance of one glyph, in CSS px."""
    opsz = max(14, min(32, size)); f = inst(wght, opsz); gs = f.getGlyphSet()
    name = f.getBestCmap()[ord(char)]
    bp = BoundsPen(gs); gs[name].draw(bp)
    xmin, _, xmax, _ = bp.bounds; s = size / UPM
    return xmin * s, (xmax - xmin) * s

def mark_layout(ox, oy):
    n_lsb, n_w = ink('n', 29, 750); d_lsb, d_w = ink('.', 29, 750)
    left = ox + (TILE - (n_w + DOT_GAP + d_w)) / 2
    b = baseline(oy + (TILE - 29) / 2, 29, 29)
    return left - n_lsb, left + n_w + DOT_GAP - d_lsb, b

def mark_paths(ox, oy):
    xn, xd, b = mark_layout(ox, oy)
    n, _ = run('n', 29, 750, 0, xn, b)
    d, _ = run('.', 29, 750, 0, xd, b)
    return n, d

def tile(ox, oy, fill, id_='tile'):
    return f'<rect id="{id_}" x="{fmt(ox*K)}" y="{fmt(oy*K)}" width="{TILE*K}" height="{TILE*K}" rx="{RADIUS*K}" fill="{fill}"/>'

# ---- wordmark: name 17/600 ls -0.6, line-height 1.6; tagline 7/500 ls 1.55, margin-top 3, line-height 1.6
NAME, TAG = 'Nerdplexity', 'INDEPENDENT INTELLIGENCE'
NAME_LH, TAG_LH, GAP = 17 * 1.6, 7 * 1.6, 10

def svg(w, h, body, title='Nerdplexity'):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{fmt(w*K)}" height="{fmt(h*K)}" viewBox="0 0 {fmt(w*K)} {fmt(h*K)}">\n'
            f'  <title>{title}</title>\n' + '\n'.join('  ' + line for line in body) + '\n</svg>\n')

def write(rel, content):
    path = os.path.join(OUT, rel); os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, 'w').write(content)

# Colour mark
n, d = mark_paths(0, 0)
write('svg/nerdplexity-mark.svg', svg(TILE, TILE, [tile(0, 0, C['tile']), f'<path id="n" d="{n}" fill="{C["ink"]}"/>', f'<path id="dot" d="{d}" fill="{C["dot"]}"/>']))

# One-colour marks: letters knocked out of the tile, as one clean path.
import pathops
def to_pathops(d_list):
    from fontTools.svgLib.path import parse_path
    from fontTools.pens.recordingPen import RecordingPen
    p = pathops.Path()
    pen = p.getPen()
    for dd in d_list:
        parse_path(dd, pen)
    return p

def rounded_rect(x, y, w, h, r):
    k = 0.5522847498 * r
    p = pathops.Path(); pen = p.getPen()
    pen.moveTo((x + r, y)); pen.lineTo((x + w - r, y)); pen.curveTo((x + w - r + k, y), (x + w, y + r - k), (x + w, y + r))
    pen.lineTo((x + w, y + h - r)); pen.curveTo((x + w, y + h - r + k), (x + w - r + k, y + h), (x + w - r, y + h))
    pen.lineTo((x + r, y + h)); pen.curveTo((x + r - k, y + h), (x, y + h - r + k), (x, y + h - r))
    pen.lineTo((x, y + r)); pen.curveTo((x, y + r - k), (x + r - k, y), (x + r, y)); pen.closePath()
    return p

def pathops_d(p):
    from fontTools.pens.svgPathPen import SVGPathPen as P
    pen = P(None, ntos=fmt); p.draw(pen); return pen.getCommands()

knock = pathops.op(rounded_rect(0, 0, TILE * K, TILE * K, RADIUS * K), to_pathops([n, d]), pathops.PathOp.DIFFERENCE)
for name, fill in (('black', '#000000'), ('white', '#ffffff')):
    write(f'svg/nerdplexity-mark-{name}.svg', svg(TILE, TILE, [f'<path id="mark" d="{pathops_d(knock)}" fill="{fill}"/>']))

# Lockups
w_name = measure(NAME, 17, 600, -0.6); w_tag = measure(TAG, 7, 500, 1.55)
text_x = TILE + GAP
full_h = NAME_LH + 3 + TAG_LH
full_w = text_x + max(w_name, w_tag)
compact_w = text_x + w_name

def lockup(variant, compact):
    h = TILE if compact else full_h
    my = (h - TILE) / 2
    n, d = mark_paths(0, my)
    name_top = (TILE - NAME_LH) / 2 if compact else 0
    name_d, _ = run(NAME, 17, 600, -0.6, text_x, baseline(name_top, 17, NAME_LH))
    body = [tile(0, my, C['tile']), f'<path id="n" d="{n}" fill="{C["ink"]}"/>', f'<path id="dot" d="{d}" fill="{C["dot"]}"/>',
            f'<path id="wordmark" d="{name_d}" fill="{C[variant + "Text"]}"/>']
    if not compact:
        tag_d, _ = run(TAG, 7, 500, 1.55, text_x, baseline(NAME_LH + 3, 7, TAG_LH))
        body.append(f'<path id="tagline" d="{tag_d}" fill="{C[variant + "Muted"]}"/>')
    return svg(compact_w if compact else full_w, h, body)

for variant, label in (('onDark', 'on-dark'), ('onLight', 'on-light')):
    write(f'svg/nerdplexity-lockup-{label}.svg', lockup(variant, False))
    write(f'svg/nerdplexity-lockup-compact-{label}.svg', lockup(variant, True))

# Editable file for Figma: live Inter text and a real rectangle, same geometry.
def text_el(id_, text, size, wght, ls, x, base, fill):
    return (f'<text id="{id_}" x="{fmt(x*K)}" y="{fmt(base*K)}" font-family="Inter" font-size="{fmt(size*K)}" font-weight="{wght}" '
            f'letter-spacing="{fmt(ls*K)}" fill="{fill}">{text}</text>')

def editable_group(id_, ox, oy, variant, bg):
    my = (full_h - TILE) / 2
    xn, xd, b = mark_layout(0, my)
    pad = 24
    return [f'<g id="{id_}" transform="translate({fmt(ox*K)} {fmt(oy*K)})">',
            f'  <rect id="background" x="{fmt(-pad*K)}" y="{fmt(-pad*K)}" width="{fmt((full_w + 2*pad)*K)}" height="{fmt((full_h + 2*pad)*K)}" rx="{8*K}" fill="{bg}"/>',
            '  ' + tile(0, my, C['tile']),
            '  ' + text_el('n', 'n', 29, 750, 0, xn, b, C['ink']),
            '  ' + text_el('dot', '.', 29, 750, 0, xd, b, C['dot']),
            '  ' + text_el('wordmark', NAME, 17, 600, -0.6, text_x, baseline(0, 17, NAME_LH), C[variant + 'Text']),
            '  ' + text_el('tagline', TAG, 7, 500, 1.55, text_x, baseline(NAME_LH + 3, 7, TAG_LH), C[variant + 'Muted']),
            '</g>']

pad = 24
ew, eh = full_w + 2 * pad, full_h + 2 * pad
body = editable_group('Lockup on dark', pad, pad, 'onDark', '#000000') + editable_group('Lockup on light', pad, eh + 2 * pad, 'onLight', '#ffffff')
write('figma/nerdplexity-editable.svg', svg(ew + 2 * pad, 2 * eh + 3 * pad, body, 'Nerdplexity (editable text)'))

tokens = {
    'colors': {'tile': C['tile'], 'letter': C['ink'], 'dot': C['dot'],
               'wordmarkOnDark': C['onDarkText'], 'taglineOnDark': C['onDarkMuted'],
               'wordmarkOnLight': C['onLightText'], 'taglineOnLight': C['onLightMuted'], 'appBackground': '#000000'},
    'typeface': 'Inter (SIL Open Font License 1.1)',
    'mark': {'sizePx': TILE, 'cornerRadiusPx': RADIUS, 'glyphs': 'n.', 'fontSizePx': 29, 'fontWeight': 750, 'layout': 'n and dot centred by ink', 'dotGapPx': DOT_GAP},
    'wordmark': {'text': NAME, 'fontSizePx': 17, 'fontWeight': 600, 'letterSpacingPx': -0.6},
    'tagline': {'text': TAG, 'fontSizePx': 7, 'fontWeight': 500, 'letterSpacingPx': 1.55, 'marginTopPx': 3},
    'gapPx': GAP,
    'svgUnitsPerCssPx': K,
}
write('tokens.json', json.dumps(tokens, indent=2) + '\n')
print(json.dumps({'fullLockupPx': [round(full_w, 2), round(full_h, 2)], 'compactLockupPx': [round(compact_w, 2), TILE], 'nameWidthPx': round(w_name, 2), 'taglineWidthPx': round(w_tag, 2)}))
