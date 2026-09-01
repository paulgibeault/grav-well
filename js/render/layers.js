/* layers.js — the cached bitmaps, the palette, and the one primitive that
 * draws a block.
 *
 * §6d is a battery contract rather than a style preference, and this file is
 * where it is paid: the background (field, shaft walls, grid, stars, dead
 * line) and the locked stack are each rendered once into an offscreen canvas
 * and blitted, so a settled well costs two drawImage calls a frame instead of
 * two hundred fills. The background is rebuilt on resize or a theme/settings
 * change; the stack only when the board actually changes.
 *
 * No colour appears literally below the FALLBACK table. Every value is read
 * back out of css/well.css through its custom properties, because the
 * stylesheet owns both palettes and this layer must not hold a second opinion
 * about them — the fallbacks exist for the one frame before the sheet has
 * loaded, and for a standalone embed that lost it entirely.
 */

import { COLS, VISIBLE_ROWS, HIDDEN_ROWS, ROWS, GARBAGE_ID, TYPES } from '../core/constants.js';

// ── Palette ──────────────────────────────────────────────────────────────

const PROP = {
    field: '--well-field', wall: '--well-wall', rim: '--well-rim',
    grid: '--well-grid', star: '--star', starDim: '--star-dim',
    ghost: '--ghost', garbage: '--garbage', accent: '--accent',
    fgDim: '--fg-dim', glow: '--glow', shaft: '--bg-shaft',
};

// Cell id order: TYPES is ['I','O','T','S','Z','J','L'] and id === index + 1.
const PIECE_PROPS = ['--p-i', '--p-o', '--p-t', '--p-s', '--p-z', '--p-j', '--p-l'];

// A getPropertyValue on a custom property answers '' until the stylesheet has
// applied, which on a cold load is a real frame — so both palettes are
// duplicated here, keyed the same way, and a miss falls through per property
// rather than all-or-nothing.
const FALLBACK = {
    dark: {
        field: '#0B1120', wall: '#161E33', rim: 'rgba(126,160,220,0.30)',
        grid: 'rgba(126,160,220,0.09)', star: '#DCE6FF', starDim: 'rgba(220,230,255,0.35)',
        ghost: 'rgba(200,216,255,0.22)', garbage: '#4A5570', accent: '#F0C46A',
        fgDim: '#9AA8C4', glow: 'rgba(126,190,255,0.35)', shaft: '#0D1425',
        pieces: ['#3FE0F0', '#F6C945', '#B57BFF', '#4BE08A', '#FF6B6B', '#5A8DFF', '#FF9A48'],
    },
    light: {
        field: '#DCD3C6', wall: '#C6B9A5', rim: 'rgba(92,72,48,0.38)',
        grid: 'rgba(92,72,48,0.12)', star: '#6E7EA0', starDim: 'rgba(110,126,160,0.35)',
        ghost: 'rgba(60,50,40,0.20)', garbage: '#8C8375', accent: '#7A4E12',
        fgDim: '#57545F', glow: 'rgba(150,116,66,0.28)', shaft: '#E3D9C9',
        pieces: ['#0B6472', '#6F5210', '#5B34A6', '#17633A', '#9C2415', '#23479F', '#8C4409'],
    },
};

export function readPalette(theme) {
    const key = theme === 'light' ? 'light' : 'dark';
    const fb = FALLBACK[key];
    let cs = null;
    try {
        if (typeof document !== 'undefined' && typeof getComputedStyle === 'function') {
            cs = getComputedStyle(document.documentElement);
        }
    } catch (_) { cs = null; }

    const pick = (prop, fallback) => {
        if (!cs) return fallback;
        const v = cs.getPropertyValue(prop);
        const t = v ? v.trim() : '';
        return t || fallback;
    };

    const p = { theme: key };
    for (const k of Object.keys(PROP)) p[k] = pick(PROP[k], fb[k]);

    // Indexed BY CELL ID so a board byte is its own colour lookup: byId[0] is
    // never read (0 means empty) and byId[GARBAGE_ID] is the hueless debris.
    p.byId = [null];
    for (let i = 0; i < PIECE_PROPS.length; i++) p.byId.push(pick(PIECE_PROPS[i], fb.pieces[i]));
    p.byId[GARBAGE_ID] = p.garbage;
    return p;
}

export function colorFor(palette, id) {
    return palette.byId[id] || palette.garbage;
}

// ── Colour arithmetic ────────────────────────────────────────────────────
//
// The stylesheet hands back hex or rgb()/rgba(), in either comma or slash
// syntax depending on how it was authored, so both are parsed. An
// unrecognised value is not an error: mix() hands the original string back
// and the block simply loses its bevel rather than the frame.

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };

function parseColor(css) {
    if (typeof css !== 'string') return null;
    const s = css.trim();
    if (s.charCodeAt(0) === 35) {   // '#'
        const h = s.slice(1);
        const short = h.length === 3 || h.length === 4;
        if (!short && h.length !== 6 && h.length !== 8) return null;
        const n = short ? 1 : 2;
        const at = (i) => {
            const part = h.substr(i * n, n);
            const v = parseInt(short ? part + part : part, 16);
            return Number.isNaN(v) ? null : v;
        };
        const r = at(0), g = at(1), b = at(2);
        if (r === null || g === null || b === null) return null;
        const a = (short ? h.length === 4 : h.length === 8) ? at(3) / 255 : 1;
        return { r, g, b, a };
    }
    const m = /^rgba?\(([^)]+)\)$/i.exec(s);
    if (!m) return null;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
    if (parts.length < 3 || parts.some(Number.isNaN)) return null;
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

function rgba(c) {
    const r = Math.round(Math.max(0, Math.min(255, c.r)));
    const g = Math.round(Math.max(0, Math.min(255, c.g)));
    const b = Math.round(Math.max(0, Math.min(255, c.b)));
    return 'rgba(' + r + ',' + g + ',' + b + ',' + (Math.round(c.a * 1000) / 1000) + ')';
}

// mix() is called a few dozen times a frame for the active piece and a few
// hundred on a stack rebuild, always with the same handful of arguments, so
// the results are memoised: a bounded map beats re-parsing '#3FE0F0' and
// rebuilding an rgba() string every single block.
const MIX_CACHE = new Map();
const MIX_CACHE_MAX = 256;

export function mix(css, toward, amount) {
    const key = css + '|' + toward + '|' + amount;
    const hit = MIX_CACHE.get(key);
    if (hit !== undefined) return hit;
    const c = parseColor(css);
    let out = css;
    if (c) {
        const t = toward === 'white' ? WHITE : BLACK;
        out = rgba({
            r: c.r + (t.r - c.r) * amount,
            g: c.g + (t.g - c.g) * amount,
            b: c.b + (t.b - c.b) * amount,
            a: c.a,
        });
    }
    if (MIX_CACHE.size > MIX_CACHE_MAX) MIX_CACHE.clear();
    MIX_CACHE.set(key, out);
    return out;
}

export function withAlpha(css, a) {
    const c = parseColor(css);
    if (!c) return css;
    return rgba({ r: c.r, g: c.g, b: c.b, a: c.a * a });
}

// ── Geometry ─────────────────────────────────────────────────────────────

// The visible field is 10 × 20 cells, letterboxed inside whatever box the
// canvas ended up with. index.js sizes the well to a 1:2 box so the letterbox
// is normally zero, but a caller that sizes it some other way gets a centred
// field instead of a stretched one.
export function fieldMetrics(cssW, cssH, scale) {
    const cell = Math.min(cssW / COLS, cssH / VISIBLE_ROWS);
    const w = cell * COLS;
    const h = cell * VISIBLE_ROWS;
    return {
        cssW, cssH, scale: scale || 1, cell,
        x: (cssW - w) / 2, y: (cssH - h) / 2, w, h,
    };
}

// Board row → y in field-local space. Rows 0..19 are the spawn buffer and
// land at a negative y, which is exactly what makes a straddling piece clip
// against the field rect instead of being special-cased.
export function rowTop(metrics, row) {
    return (row - HIDDEN_ROWS) * metrics.cell;
}

export function colLeft(metrics, col) {
    return col * metrics.cell;
}

export function makeSurface(wDev, hDev) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(wDev));
    c.height = Math.max(1, Math.round(hDev));
    return c;
}

// Every offscreen surface is device-sized and then scaled, so all drawing
// code downstream works in CSS pixels and nothing has to know the DPR.
function surfaceFor(cssW, cssH, scale) {
    const surf = makeSurface(cssW * scale, cssH * scale);
    const ctx = surf.getContext('2d');
    ctx.setTransform(surf.width / cssW, 0, 0, surf.height / cssH, 0, 0);
    return { surf, ctx };
}

// ── The block ────────────────────────────────────────────────────────────

/* THE ACCESSIBILITY GLYPHS (DESIGN.md §2.2): "a distinct engraved rune so
 * color is never the only channel."
 *
 * The rune is the piece's OWN LETTER. The seven pieces are named after the
 * shapes of letters and have been for forty years, so the mark a player has to
 * learn is one they already know — and unlike an arbitrary rune set, seven
 * letters are guaranteed distinct from each other at a glance. I is drawn as a
 * bar rather than a serif "I" because a bare vertical stroke at 24 px is
 * indistinguishable from noise.
 *
 * Paths are polylines in a unit box, scaled to the block. Kept as data rather
 * than as seven draw functions so the engrave pass below is written once.
 */
const GLYPHS = {
    I: [[[0.16, 0.50], [0.84, 0.50]]],
    O: [[[0.30, 0.30], [0.70, 0.30], [0.70, 0.70], [0.30, 0.70], [0.30, 0.30]]],
    T: [[[0.22, 0.28], [0.78, 0.28]], [[0.50, 0.28], [0.50, 0.74]]],
    S: [[[0.74, 0.28], [0.36, 0.28], [0.36, 0.50], [0.64, 0.50], [0.64, 0.72], [0.26, 0.72]]],
    Z: [[[0.26, 0.28], [0.74, 0.28], [0.28, 0.72], [0.74, 0.72]]],
    J: [[[0.66, 0.26], [0.66, 0.68], [0.34, 0.68], [0.34, 0.54]]],
    L: [[[0.36, 0.26], [0.36, 0.72], [0.74, 0.72]]],
};

/* Below this the groove is thinner than the stroke that would draw it and the
 * mark reads as dirt on the block rather than as a letter. A phone well at
 * --font-scale 1.5 lands around 22 px a cell, so this only bites on a
 * genuinely tiny preview — where the piece's whole SHAPE is visible anyway,
 * which is the same information the glyph is carrying. */
const GLYPH_MIN_PX = 11;

// Cut into the surface rather than painted on it: the dark pass sits in the
// groove and the light pass is the lip catching the light from above, offset
// by the same direction the block's own top band is lit from.
function engrave(ctx, x, y, s, color, type) {
    const paths = GLYPHS[type];
    if (!paths || s < GLYPH_MIN_PX) return;
    const lw = Math.max(1, s * 0.11);
    const prevCap = ctx.lineCap;
    const prevJoin = ctx.lineJoin;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = lw;
    for (const pass of [
        { dx: lw * 0.45, dy: lw * 0.45, stroke: mix(color, 'white', 0.40) },
        { dx: 0, dy: 0, stroke: mix(color, 'black', 0.52) },
    ]) {
        ctx.strokeStyle = pass.stroke;
        ctx.beginPath();
        for (const path of paths) {
            for (let i = 0; i < path.length; i++) {
                const px2 = x + path[i][0] * s + pass.dx;
                const py2 = y + path[i][1] * s + pass.dy;
                if (i === 0) ctx.moveTo(px2, py2);
                else ctx.lineTo(px2, py2);
            }
        }
        ctx.stroke();
    }
    ctx.lineCap = prevCap;
    ctx.lineJoin = prevJoin;
}

/* Salvage, not a flat square: a lit top edge, a shaded bottom edge and a seam
 * between neighbours so a solid row still reads as ten separate blocks.
 *
 * `glyph` is the piece type ('I'..'L') when the player has the §2.2 glyph mode
 * on, and undefined otherwise. Garbage never carries one — it is not a piece,
 * and stamping it with a letter would be a lie about where it came from. */
export function drawBlock(ctx, px, py, size, color, alpha, glyph) {
    const a = alpha === undefined ? 1 : alpha;
    if (a <= 0) return;
    const seam = size * 0.07;
    const s = size - seam;
    const x = px + seam * 0.5;
    const y = py + seam * 0.5;
    const prev = ctx.globalAlpha;
    if (a !== 1) ctx.globalAlpha = prev * a;

    ctx.fillStyle = color;
    ctx.fillRect(x, y, s, s);

    const band = Math.max(0.75, s * 0.19);
    ctx.fillStyle = mix(color, 'white', 0.42);
    ctx.fillRect(x, y, s, band);
    ctx.fillStyle = mix(color, 'black', 0.34);
    ctx.fillRect(x, y + s - band, s, band);

    const lw = Math.max(0.6, size * 0.045);
    ctx.strokeStyle = mix(color, 'black', 0.55);
    ctx.lineWidth = lw;
    ctx.strokeRect(x + lw / 2, y + lw / 2, s - lw, s - lw);

    if (glyph) engrave(ctx, x, y, s, color, glyph);

    if (a !== 1) ctx.globalAlpha = prev;
}

// The ghost is the landing site, not a piece: a translucent slab in the
// theme's neutral --ghost with the piece's own hue only on the outline, which
// keeps it legible against a busy stack without competing with the real one.
export function drawGhostBlock(ctx, px, py, size, color, palette) {
    const seam = size * 0.07;
    const s = size - seam;
    const x = px + seam * 0.5;
    const y = py + seam * 0.5;
    const lw = Math.max(0.75, size * 0.07);
    ctx.fillStyle = palette.ghost;
    ctx.fillRect(x, y, s, s);
    ctx.strokeStyle = withAlpha(color, 0.55);
    ctx.lineWidth = lw;
    ctx.strokeRect(x + lw / 2, y + lw / 2, s - lw, s - lw);
}

// ── Stars ────────────────────────────────────────────────────────────────

// Fixed seed, normalised coordinates: the same sky survives a resize and a
// theme flip, so the well does not appear to have been carried somewhere else
// when the player rotates their phone.
function starSeed(count) {
    let s = 0x9E3779B9 >>> 0;
    const step = () => {
        s ^= s << 13; s >>>= 0;
        s ^= s >>> 17;
        s ^= s << 5; s >>>= 0;
        return (s >>> 8) / 0x1000000;
    };
    const out = [];
    for (let i = 0; i < count; i++) out.push([step(), step(), step()]);
    return out;
}

const STARS = starSeed(140);

function paintStars(ctx, w, h, palette, density) {
    const n = Math.max(24, Math.min(STARS.length, Math.round((w * h) / 2600 * density)));
    for (let i = 0; i < n; i++) {
        const st = STARS[i];
        const r = 0.4 + st[2] * 1.3;
        ctx.fillStyle = st[2] > 0.72 ? palette.star : palette.starDim;
        ctx.globalAlpha = 0.35 + st[2] * 0.45;
        ctx.beginPath();
        ctx.arc(st[0] * w, st[1] * h, r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.globalAlpha = 1;
}

// A separate, tileable sky — only built when the drift is allowed to run.
// Under powerSaver or reducedMotion the stars are baked into the background
// instead and this surface never exists, which is the whole saving: one blit
// a frame rather than three.
export function buildStars(metrics, palette) {
    const { surf, ctx } = surfaceFor(metrics.w, metrics.h, metrics.scale);
    paintStars(ctx, metrics.w, metrics.h, palette, 1);
    return surf;
}

// ── The background ───────────────────────────────────────────────────────

export function buildBackground(metrics, palette, opts) {
    const { surf, ctx } = surfaceFor(metrics.cssW, metrics.cssH, metrics.scale);
    const { x, y, w, h, cell } = metrics;
    const hair = Math.max(0.5, 1 / metrics.scale);   // one device pixel, in CSS px

    ctx.fillStyle = palette.field;
    ctx.fillRect(0, 0, metrics.cssW, metrics.cssH);

    // Lit from above: the mouth of the shaft catches the sky, the floor does
    // not. Both themes read the same way — the light just changes colour.
    const shaft = ctx.createLinearGradient(0, y, 0, y + h);
    shaft.addColorStop(0, withAlpha(palette.shaft, 0.85));
    shaft.addColorStop(0.45, withAlpha(palette.shaft, 0));
    ctx.fillStyle = shaft;
    ctx.fillRect(x, y, w, h);

    if (opts.bakeStars) {
        ctx.save();
        ctx.translate(x, y);
        paintStars(ctx, w, h, palette, 1);
        ctx.restore();
    }

    // The stone ring, seen edge-on: the shaft wall wrapping the two sides.
    const wallW = Math.max(2, cell * 0.42);
    const left = ctx.createLinearGradient(x, 0, x + wallW, 0);
    left.addColorStop(0, withAlpha(palette.wall, 0.9));
    left.addColorStop(1, withAlpha(palette.wall, 0));
    ctx.fillStyle = left;
    ctx.fillRect(x, y, wallW, h);
    const right = ctx.createLinearGradient(x + w, 0, x + w - wallW, 0);
    right.addColorStop(0, withAlpha(palette.wall, 0.9));
    right.addColorStop(1, withAlpha(palette.wall, 0));
    ctx.fillStyle = right;
    ctx.fillRect(x + w - wallW, y, wallW, h);

    // Grid. Snapped to whole device pixels and drawn a device pixel wide, or
    // it turns into a grey haze at fractional cell sizes.
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = hair;
    ctx.beginPath();
    for (let c = 1; c < COLS; c++) {
        const gx = snap(x + c * cell, metrics.scale, hair);
        ctx.moveTo(gx, y);
        ctx.lineTo(gx, y + h);
    }
    for (let r = 1; r < VISIBLE_ROWS; r++) {
        const gy = snap(y + r * cell, metrics.scale, hair);
        ctx.moveTo(x, gy);
        ctx.lineTo(x + w, gy);
    }
    ctx.stroke();

    drawDeadLine(ctx, metrics, palette, opts);

    ctx.strokeStyle = palette.rim;
    ctx.lineWidth = hair;
    ctx.strokeRect(x + hair / 2, y + hair / 2, w - hair, h - hair);

    return surf;
}

function snap(v, scale, hair) {
    return Math.round(v * scale) / scale + hair / 2;
}

// The dead line: the mouth of the well, and the only boundary in the game
// that ends a run (§2.10 — a piece that locks entirely above it is a lock
// out). It is baked into the background, so the marker costs nothing per
// frame; the CSS-owned danger vignette is what reacts to the stack.
function drawDeadLine(ctx, metrics, palette, opts) {
    const { x, y, w, cell } = metrics;
    const lw = Math.max(1, cell * 0.06);
    const glow = ctx.createLinearGradient(0, y, 0, y + cell * 1.2);
    glow.addColorStop(0, withAlpha(palette.accent, 0.20));
    glow.addColorStop(1, withAlpha(palette.accent, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(x, y, w, cell * 1.2);

    ctx.save();
    ctx.strokeStyle = withAlpha(palette.accent, 0.75);
    ctx.lineWidth = lw;
    ctx.setLineDash([cell * 0.34, cell * 0.26]);
    ctx.beginPath();
    ctx.moveTo(x, y + lw / 2);
    ctx.lineTo(x + w, y + lw / 2);
    ctx.stroke();
    ctx.restore();

    // Small caps under the line, and the one piece of text this renderer
    // draws — so fontScale has something to scale. Suppressed outright when
    // the well is too narrow for it to be anything but clutter.
    const px = cell * 0.30 * (opts.fontScale || 1);
    if (px < 7 || px > cell * 0.9) return;
    ctx.save();
    ctx.font = px.toFixed(2) + 'px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    const label = 'DEAD LINE';
    if (ctx.measureText(label).width < w * 0.62) {
        ctx.fillStyle = withAlpha(palette.fgDim, 0.55);
        ctx.fillText(label, x + w - cell * 0.22, y + lw + cell * 0.12);
    }
    ctx.restore();
}

// ── The locked stack ─────────────────────────────────────────────────────

// Field-sized and transparent, so it blits over the background without
// repainting it. Rebuilt only when the board changes — see index.js.
export function buildLocked(board, metrics, palette, glyphs) {
    const { surf, ctx } = surfaceFor(metrics.w, metrics.h, metrics.scale);
    const cell = metrics.cell;
    let any = false;

    for (let row = HIDDEN_ROWS; row < ROWS; row++) {
        const base = row * COLS;
        const py = rowTop(metrics, row);
        for (let col = 0; col < COLS; col++) {
            const id = board[base + col];
            if (id === 0) continue;
            any = true;
            // TYPES[id - 1] is undefined for GARBAGE_ID, which is exactly right:
            // debris is not a piece and carries no letter.
            drawBlock(ctx, colLeft(metrics, col), py, cell, colorFor(palette, id),
                1, glyphs ? TYPES[id - 1] : undefined);
        }
    }

    // "The stack glows faintly against the dark" (§1). One scaled additive
    // blit of the surface onto itself is a halo for the price of a single
    // draw call — cheap enough to afford on every lock, which a shadowBlur
    // pass over two hundred cells would not be. Dark theme only: in the dawn
    // well the same pass would just bleach the salvage.
    if (any && palette.theme === 'dark') {
        const k = cell * 0.16;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.11;
        ctx.drawImage(surf, -k, -k, metrics.w + k * 2, metrics.h + k * 2);
        ctx.restore();
    }
    return surf;
}
