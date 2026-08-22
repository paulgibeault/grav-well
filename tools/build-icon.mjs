/* build-icon.mjs — draws Gravity Well's launcher card art and writes icon.png.
 *
 * Regenerate (one command, from the repo root):
 *
 *     PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/build-icon.mjs
 *
 * There is no ImageMagick, PIL or cairosvg here, and the art wants gradients,
 * shadow bloom and a seeded starfield — so the renderer is Canvas 2D inside
 * headless Chromium and the "export" is an element screenshot of a 512x512
 * <canvas>. The drawing runs entirely in the page (see draw() below); it takes
 * no arguments and reads nothing from this module, because Playwright ships it
 * across as source.
 *
 * Deterministic on purpose: the starfield comes from a fixed-seed mulberry32,
 * so re-running this produces the same PNG rather than a new arrangement of
 * dots. That is what makes the art reviewable in a diff.
 *
 * The subject, per DESIGN.md §1 and the catalog alt text: looking straight
 * down a stone-ringed well at a starfield, one glowing T-piece mid-fall.
 * It has to survive being shrunk to a ~64px tile, so it is three shapes —
 * dark square, bright stone ring, glowing purple T — and everything else is
 * depth cueing that is allowed to blur away at that size.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Must be set before playwright is imported — it reads this at module load.
process.env.PLAYWRIGHT_BROWSERS_PATH ||= '/opt/pw-browsers';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, '..', 'icon.png');
const SIZE = 512;

/* Playwright is installed globally in this environment, and ESM specifier
 * resolution ignores NODE_PATH — so fall back to resolving the global root
 * by hand rather than making the caller export NODE_PATH. */
async function loadPlaywright() {
    try { return (await import('playwright')).default ?? (await import('playwright')); }
    catch { /* not a local dependency; look in the global roots */ }

    const roots = [];
    try { roots.push(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()); }
    catch { /* npm not on PATH — the hard-coded fallbacks below still apply */ }
    roots.push('/opt/node22/lib/node_modules', '/usr/local/lib/node_modules', '/usr/lib/node_modules');

    for (const root of roots) {
        const entry = path.join(root, 'playwright', 'index.js');
        if (!existsSync(entry)) continue;
        const mod = await import(pathToFileURL(entry).href);
        return mod.default ?? mod;
    }
    throw new Error('playwright not found (tried: ' + roots.join(', ') + ')');
}

/* Everything below runs in the browser. No closures over module scope. */
function draw() {
    const S = 512;
    const C = S / 2;
    const ctx = document.getElementById('icon').getContext('2d');
    const TAU = Math.PI * 2;

    // Fixed-seed mulberry32: the same stars, the same stone mottling, forever.
    let seed = 0x9E3779B9 >>> 0;
    const rnd = () => {
        seed = (seed + 0x6D2B79F5) >>> 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const between = (a, b) => a + rnd() * (b - a);

    // Radii, outermost first. 202 is the outer edge of the stone: the manifest
    // declares the icon "maskable", and a maskable safe zone is the centre 80%
    // circle — r <= 204.8 — so the rim survives a circular crop intact.
    const R_RIM_OUT = 204, R_RIM_IN = 168;
    const R_C2_OUT = 168, R_C2_IN = 148;
    const R_C3_OUT = 148, R_C3_IN = 134;
    const R_VOID = 134;

    const annulus = (rOut, rIn) => {
        ctx.beginPath();
        ctx.arc(C, C, rOut, 0, TAU);
        ctx.arc(C, C, rIn, 0, TAU, true);
        ctx.closePath();
    };

    // ── The ground around the well ──────────────────────────────────────
    let g = ctx.createRadialGradient(C, C * 0.8, 30, C, C, S * 0.8);
    g.addColorStop(0, '#141C31');
    g.addColorStop(0.55, '#0A0F1E');
    g.addColorStop(1, '#03050B');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);

    // ── Course 1: the rim, lit from above and the brightest thing here ──
    annulus(R_RIM_OUT, R_RIM_IN);
    g = ctx.createLinearGradient(0, C - R_RIM_OUT, 0, C + R_RIM_OUT);
    g.addColorStop(0, '#E2D7BF');
    g.addColorStop(0.42, '#A79C86');
    g.addColorStop(0.78, '#6E6753');
    g.addColorStop(1, '#4C4638');
    ctx.fillStyle = g;
    ctx.fill();

    // Per-block tone variation, then the mortar. Clipped to the annulus so the
    // strokes stop dead at the stone's edges instead of spraying across the void.
    const BLOCKS = 18;
    ctx.save();
    annulus(R_RIM_OUT, R_RIM_IN);
    ctx.clip();
    for (let i = 0; i < BLOCKS; i++) {
        const a0 = (i / BLOCKS) * TAU, a1 = ((i + 1) / BLOCKS) * TAU;
        ctx.beginPath();
        ctx.moveTo(C, C);
        ctx.arc(C, C, R_RIM_OUT + 4, a0, a1);
        ctx.closePath();
        ctx.fillStyle = rnd() < 0.5
            ? 'rgba(255,248,230,' + between(0.03, 0.10).toFixed(3) + ')'
            : 'rgba(0,0,0,' + between(0.04, 0.13).toFixed(3) + ')';
        ctx.fill();
    }
    ctx.strokeStyle = 'rgba(10,8,6,0.72)';
    ctx.lineWidth = 4.5;
    for (let i = 0; i < BLOCKS; i++) {
        const a = (i / BLOCKS) * TAU + 0.07;
        ctx.beginPath();
        ctx.moveTo(C + Math.cos(a) * (R_RIM_IN - 6), C + Math.sin(a) * (R_RIM_IN - 6));
        ctx.lineTo(C + Math.cos(a) * (R_RIM_OUT + 6), C + Math.sin(a) * (R_RIM_OUT + 6));
        ctx.stroke();
    }
    ctx.restore();

    // The lip: a hard dark line where the wall drops away.
    annulus(R_RIM_IN + 5, R_RIM_IN - 1);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fill();

    // ── Courses 2 and 3: the shaft receding. Darker and thinner each step —
    // this is the part that makes it a well rather than a ring. ───────────
    annulus(R_C2_OUT, R_C2_IN);
    g = ctx.createLinearGradient(0, C - R_C2_OUT, 0, C + R_C2_OUT);
    g.addColorStop(0, '#4A4F63');
    g.addColorStop(1, '#191D28');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    annulus(R_C2_OUT, R_C2_IN);
    ctx.clip();
    ctx.strokeStyle = 'rgba(6,8,14,0.7)';
    ctx.lineWidth = 4;
    for (let i = 0; i < BLOCKS; i++) {           // offset half a block: courses stagger
        const a = ((i + 0.5) / BLOCKS) * TAU + 0.07;
        ctx.beginPath();
        ctx.moveTo(C + Math.cos(a) * (R_C2_IN - 6), C + Math.sin(a) * (R_C2_IN - 6));
        ctx.lineTo(C + Math.cos(a) * (R_C2_OUT + 6), C + Math.sin(a) * (R_C2_OUT + 6));
        ctx.stroke();
    }
    ctx.restore();

    annulus(R_C3_OUT, R_C3_IN);
    g = ctx.createLinearGradient(0, C - R_C3_OUT, 0, C + R_C3_OUT);
    g.addColorStop(0, '#252A38');
    g.addColorStop(1, '#0B0E17');
    ctx.fillStyle = g;
    ctx.fill();

    // ── The void, and the sky at the bottom of it ───────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.arc(C, C, R_VOID, 0, TAU);
    ctx.clip();

    g = ctx.createRadialGradient(C, C, 0, C, C, R_VOID);
    g.addColorStop(0, '#0A0F23');
    g.addColorStop(1, '#02030A');
    ctx.fillStyle = g;
    ctx.fillRect(C - R_VOID, C - R_VOID, R_VOID * 2, R_VOID * 2);

    const lip = ctx.createRadialGradient(C, C, R_VOID * 0.55, C, C, R_VOID);
    lip.addColorStop(0, 'rgba(0,0,0,0)');
    lip.addColorStop(1, 'rgba(0,0,0,0.85)');

    for (let i = 0; i < 190; i++) {
        const a = rnd() * TAU;
        const r = Math.sqrt(rnd()) * (R_VOID - 3);
        const x = C + Math.cos(a) * r, y = C + Math.sin(a) * r;
        const size = between(0.6, 2.0);
        ctx.beginPath();
        ctx.arc(x, y, size, 0, TAU);
        ctx.fillStyle = 'rgba(226,236,255,' + between(0.34, 1).toFixed(3) + ')';
        ctx.fill();
    }
    ctx.fillStyle = lip;
    ctx.fillRect(C - R_VOID, C - R_VOID, R_VOID * 2, R_VOID * 2);

    // A handful of near stars, each with a soft halo so the field has depth.
    for (let i = 0; i < 8; i++) {
        const a = rnd() * TAU;
        const r = Math.sqrt(rnd()) * (R_VOID - 20);
        const x = C + Math.cos(a) * r, y = C + Math.sin(a) * r;
        const halo = ctx.createRadialGradient(x, y, 0, x, y, 10);
        halo.addColorStop(0, 'rgba(235,242,255,0.85)');
        halo.addColorStop(0.25, 'rgba(180,205,255,0.30)');
        halo.addColorStop(1, 'rgba(150,180,255,0)');
        ctx.fillStyle = halo;
        ctx.fillRect(x - 10, y - 10, 20, 20);
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, TAU);
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
    }

    // Daylight spilling over the near lip — the only cue for which way is up.
    g = ctx.createLinearGradient(0, C - R_VOID, 0, C + R_VOID * 0.3);
    g.addColorStop(0, 'rgba(150,180,255,0.13)');
    g.addColorStop(1, 'rgba(150,180,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(C - R_VOID, C - R_VOID, R_VOID * 2, R_VOID * 2);

    // A second piece, small and dim, already far down: the alt text says
    // "blocks", plural, and one distant O sells the scale of the drop.
    drawPiece(ctx, [[0, 0], [1, 0], [0, 1], [1, 1]], 2, 2, 300, 318, 15, 0.34,
        '#7FD8E8', '#2E7C93', 0.5, false);

    // ── The hero: one T, mid-fall, tilted just enough to be tumbling ─────
    const TX = 256, TY = 228, CELL = 52;
    const T_CELLS = [[1, 0], [0, 1], [1, 1], [2, 1]];   // nub up, flat side down

    // The trail: three fading copies back up the shaft. Low contrast on
    // purpose — at tile size it reads as a smear of light, not as clutter.
    const trail = [[44, 0.93, 0.26]];
    for (const [dy, scale, alpha] of trail) {
        ghostPiece(ctx, T_CELLS, 3, 2, TX, TY - dy, CELL * scale, -0.10, alpha);
    }

    const glow = ctx.createRadialGradient(TX, TY, 4, TX, TY, 118);
    glow.addColorStop(0, 'rgba(196,144,255,0.46)');
    glow.addColorStop(0.38, 'rgba(150,96,235,0.15)');
    glow.addColorStop(1, 'rgba(130,80,225,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, S, S);

    drawPiece(ctx, T_CELLS, 3, 2, TX, TY, CELL, -0.10, '#F3E4FF', '#9440F2', 1, true);
    ctx.restore();

    // ── Vignette, starting outside the stone so the rim keeps its punch ──
    g = ctx.createRadialGradient(C, C, R_RIM_OUT + 6, C, C, S * 0.76);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);

    /* The after-image: the same footprint as an outline. Deliberately not a
       faded drawPiece — a translucent fill reads as a box of haze laid over
       the starfield, an outline reads as somewhere the piece has just been. */
    function ghostPiece(c, cells, w, h, cx, cy, cell, rot, alpha) {
        c.save();
        c.globalAlpha = alpha;
        c.translate(cx, cy);
        c.rotate(rot);
        c.translate(-(w * cell) / 2, -(h * cell) / 2);
        const gap = Math.max(1.5, cell * 0.06);
        c.strokeStyle = 'rgba(198,150,255,0.85)';
        c.lineWidth = Math.max(1.2, cell * 0.035);
        for (const [col, row] of cells) {
            const x = col * cell + gap / 2, y = row * cell + gap / 2;
            const s2 = cell - gap;
            c.beginPath();
            c.roundRect(x, y, s2, s2, Math.max(2, s2 * 0.16));
            c.stroke();
        }
        c.restore();
    }

    /* One tetromino. `cells` are [col,row] inside a w x h box; the box is
       centred on (cx, cy), rotated by `rot` radians, and every cell is a
       rounded tile with a lit top face and a dark base. */
    function drawPiece(c, cells, w, h, cx, cy, cell, rot, light, dark, alpha, bloom) {
        c.save();
        c.globalAlpha = alpha;
        c.translate(cx, cy);
        c.rotate(rot);
        c.translate(-(w * cell) / 2, -(h * cell) / 2);
        if (bloom) {
            c.shadowColor = 'rgba(176,120,255,0.95)';
            c.shadowBlur = 30;
        }
        const gap = Math.max(1.5, cell * 0.06);
        for (const [col, row] of cells) {
            const x = col * cell + gap / 2, y = row * cell + gap / 2;
            const s = cell - gap, r = Math.max(2, s * 0.16);
            const face = c.createLinearGradient(x, y, x, y + s);
            face.addColorStop(0, light);
            face.addColorStop(0.55, dark);
            face.addColorStop(1, dark);
            c.beginPath();
            c.roundRect(x, y, s, s, r);
            c.fillStyle = face;
            c.fill();
        }
        c.shadowBlur = 0;
        // A second pass for the inner facet — separate so the bloom above is
        // cast by the silhouette, not by every internal highlight.
        for (const [col, row] of cells) {
            const x = col * cell + gap / 2, y = row * cell + gap / 2;
            const s = cell - gap, inset = s * 0.17;
            c.beginPath();
            c.roundRect(x + inset, y + inset, s - inset * 2, s - inset * 2, Math.max(1, s * 0.1));
            c.fillStyle = 'rgba(255,255,255,0.20)';
            c.fill();
            c.beginPath();
            c.roundRect(x + 0.75, y + 0.75, s - 1.5, s - 1.5, Math.max(2, s * 0.15));
            c.strokeStyle = 'rgba(255,255,255,0.42)';
            c.lineWidth = Math.max(1, s * 0.045);
            c.stroke();
        }
        c.restore();
    }
}

const playwright = await loadPlaywright();
const browser = await playwright.chromium.launch();
try {
    const page = await browser.newPage({
        viewport: { width: SIZE, height: SIZE },
        deviceScaleFactor: 1,
    });
    await page.setContent(
        '<body style="margin:0;background:#000">'
        + '<canvas id="icon" width="' + SIZE + '" height="' + SIZE + '"'
        + ' style="display:block;width:' + SIZE + 'px;height:' + SIZE + 'px"></canvas>'
        + '</body>');
    await page.evaluate(draw);
    await page.locator('#icon').screenshot({ path: OUT });
    console.log('wrote ' + OUT);
} finally {
    await browser.close();
}
