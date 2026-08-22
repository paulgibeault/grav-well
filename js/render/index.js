/* index.js — the renderer's only public surface.
 *
 *   createRenderer({ well, hold, next }, { theme, fontScale, reducedMotion, powerSaver })
 *     → { draw(g), notify(events), resize(), setOpts(partial), cellPx(), busy(), dispose() }
 *
 * Settings arrive as PLAIN VALUES. Nothing in js/render/* imports, references
 * or reads `Arcade` — the app layer owns that boundary, and this layer has to
 * stay callable from a bare test page with no SDK in sight.
 *
 * Two invariants are worth stating before the code:
 *
 * DPR is re-read, not remembered. Sizing a canvas to its CSS box and leaving
 * the backing store alone is the single most common canvas bug there is, and
 * it is invisible on the desktop where the code was written. Every surface
 * here is `cssPixels × devicePixelRatio` with the context scaled to match, the
 * ratio is re-read on every resize() AND cheaply on every frame, and a
 * resolution media query catches the case the frame check cannot: a window
 * dragged onto a second monitor while the loop is parked.
 *
 * draw(g) is correct for exactly one call. Nothing in here assumes a
 * continuous loop: effects are pure functions of elapsed wall time, the
 * layers are dirty-flagged rather than tweened, and a single kick() frame
 * with nothing animating paints a complete, final picture. draw() returns
 * whether it still needs frames, so the app can park the loop the moment it
 * does not.
 */

import { COLS, VISIBLE_ROWS, ID } from '../core/constants.js';
import { absoluteCells, cellsFor } from '../core/piece.js';
import {
    readPalette, colorFor, fieldMetrics, rowTop, colLeft,
    buildBackground, buildStars, buildLocked, drawBlock, drawGhostBlock,
} from './layers.js';
import { createFx } from './fx.js';
import { drawHold, drawQueue, previewSignature } from './preview.js';

// Beyond 3× the extra pixels are past what anyone can resolve and cost 78%
// more fill than 2×. Phones that report 4 exist; honouring them literally is
// a battery bill with no picture to show for it.
const MAX_DPR = 3;

// Cells per second the sky sinks past the well. It only advances on frames
// the game was already going to draw — DESIGN.md §5 is explicit that the
// starfield never justifies a frame of its own — so this is a decoration on
// motion that already exists, never a reason for motion.
const DRIFT_CELLS_PER_SEC = 0.09;

const QUEUE_LEN = 5;

function now() {
    return (typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now();
}

function rawDpr() {
    return (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
}

function dpr() {
    return Math.max(1, Math.min(MAX_DPR, rawDpr()));
}

// getBoundingClientRect over clientWidth: the fractional size is the one the
// compositor is actually going to use, and rounding it ourselves is how a
// canvas ends up a half pixel adrift from its own CSS box.
function boxOf(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return { w: 0, h: 0 };
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height };
}

export function createRenderer(canvases, opts) {
    const src = opts || {};
    const cfg = {
        theme: src.theme === 'light' ? 'light' : 'dark',
        fontScale: Number(src.fontScale) > 0 ? Number(src.fontScale) : 1,
        reducedMotion: !!src.reducedMotion,
        powerSaver: !!src.powerSaver,
    };

    const well = (canvases && canvases.well) || null;
    const holdCanvas = (canvases && canvases.hold) || null;
    const nextCanvas = (canvases && canvases.next) || null;
    const wellCtx = well ? well.getContext('2d') : null;
    const holdCtx = holdCanvas ? holdCanvas.getContext('2d') : null;
    const nextCtx = nextCanvas ? nextCanvas.getContext('2d') : null;

    let palette = readPalette(cfg.theme);
    // The palette lives in css/well.css and the attribute that selects it
    // (`data-theme` on <html>) is stamped by somebody else — the SDK, via the
    // app layer. So a setOpts({theme}) can legitimately arrive a beat before
    // the custom properties underneath it have changed, and the same is true
    // of the very first frame if the stylesheet has not applied yet. The read
    // is therefore repeated for a few frames after construction and after
    // every theme change, and the cached bitmaps are thrown away if it comes
    // back different. It costs one getComputedStyle in those frames and
    // nothing at all in the other several thousand.
    let paletteChecks = 4;
    const fx = createFx(cfg);

    let metrics = null;          // field geometry in CSS px, plus the DPR it was built for
    let bg = null;               // cached background: field, walls, grid, dead line
    let stars = null;            // separate only while the drift is allowed to run
    let locked = null;           // the stack, redrawn on lock/clear
    let lockedKey = null;        // what `locked` was built from — see stackKey()
    let lockedBoard = null;
    let holdBox = { w: 0, h: 0 };
    let nextBox = { w: 0, h: 0 };
    let previewKey = null;
    let lastGame = null;         // read-only; kept so a DPR change can repaint while parked
    let disposed = false;
    let mq = null;

    // ── Geometry ─────────────────────────────────────────────────────────

    function fitWell() {
        if (!well || !wellCtx) return false;
        // Measure the WRAPPER, not the canvas. The canvas's own box is
        // derived from its backing store through css/well.css's aspect-ratio
        // rule, so measuring it and then resizing it is a feedback loop that
        // grows the well one step per resize until it hits the clamp.
        const host = well.parentElement || well;
        let box = boxOf(host);
        if (box.w < 2 || box.h < 2) box = boxOf(well);
        if (box.w < 2 || box.h < 2) return false;

        const scale = dpr();
        const cell = Math.min(box.w / COLS, box.h / VISIBLE_ROWS);
        const cssW = Math.max(COLS, Math.floor(cell * COLS));
        const cssH = Math.max(VISIBLE_ROWS, Math.floor(cell * VISIBLE_ROWS));
        const devW = Math.round(cssW * scale);
        const devH = Math.round(cssH * scale);

        if (metrics && metrics.cssW === cssW && metrics.cssH === cssH
            && metrics.scale === scale && well.width === devW && well.height === devH) {
            return false;
        }

        // Explicit inline size, which css/well.css anticipates ("If the
        // renderer sets explicit inline sizes, those win and this is inert").
        // It is also what breaks the intrinsic-size feedback described above.
        well.style.width = cssW + 'px';
        well.style.height = cssH + 'px';
        well.width = devW;
        well.height = devH;
        metrics = fieldMetrics(cssW, cssH, scale);
        // Separate x and y factors so a rounded backing store still maps CSS
        // pixels onto device pixels exactly, with no sub-pixel letterbox.
        wellCtx.setTransform(devW / cssW, 0, 0, devH / cssH, 0, 0);
        bg = null;
        stars = null;
        locked = null;
        lockedKey = null;
        return true;
    }

    // The previews are sized by the stylesheet (100% of the panel, height from
    // aspect-ratio), so unlike the well they can be measured directly: their
    // used size never depends on their backing store.
    function fitPreview(canvas, ctx, prev) {
        if (!canvas || !ctx) return prev;
        const box = boxOf(canvas);
        if (box.w < 2 || box.h < 2) return prev;
        const scale = dpr();
        const devW = Math.round(box.w * scale);
        const devH = Math.round(box.h * scale);
        if (canvas.width === devW && canvas.height === devH
            && Math.abs(prev.w - box.w) < 0.5 && Math.abs(prev.h - box.h) < 0.5) {
            return prev;
        }
        canvas.width = devW;
        canvas.height = devH;
        ctx.setTransform(devW / box.w, 0, 0, devH / box.h, 0, 0);
        previewKey = null;   // resizing a canvas clears it; the content must be redrawn
        return { w: box.w, h: box.h };
    }

    function resize() {
        if (disposed) return;
        fitWell();
        holdBox = fitPreview(holdCanvas, holdCtx, holdBox);
        nextBox = fitPreview(nextCanvas, nextCtx, nextBox);
        watchDpr();
        // Resizing a canvas wipes it, so a resize while the loop is parked
        // would otherwise leave a blank well until the next state change.
        if (lastGame) draw(lastGame);
    }

    // The frame check catches a DPR that changed while the loop was running;
    // this catches the one that changed while it was parked. Re-armed on every
    // resize because the query has to name the ratio it is watching.
    function watchDpr() {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        // The RAW ratio, not the clamped one: a device that reports 4 and
        // then drops to 2 needs the same sizing as any other change, and a
        // query pinned to the clamp would never notice it happened.
        const want = '(resolution: ' + rawDpr() + 'dppx)';
        if (mq && mq.query === want) return;
        unwatchDpr();
        try {
            const m = window.matchMedia(want);
            const onChange = () => { if (!disposed) resize(); };
            if (m.addEventListener) m.addEventListener('change', onChange);
            else if (m.addListener) m.addListener(onChange);
            mq = { m: m, query: want, onChange: onChange };
        } catch (_) { mq = null; }
    }

    function unwatchDpr() {
        if (!mq) return;
        try {
            if (mq.m.removeEventListener) mq.m.removeEventListener('change', mq.onChange);
            else if (mq.m.removeListener) mq.m.removeListener(mq.onChange);
        } catch (_) { /* a detached media query is not worth a throw */ }
        mq = null;
    }

    // ── The cached layers ────────────────────────────────────────────────

    // Under powerSaver or reducedMotion the sky is baked into the background
    // and the drift is gone: one blit a frame instead of three, which is the
    // actual saving those two settings are asking for.
    function driftAllowed() {
        return !cfg.reducedMotion && !cfg.powerSaver;
    }

    function ensureLayers() {
        if (!metrics) return false;
        if (!bg) {
            bg = buildBackground(metrics, palette, {
                fontScale: cfg.fontScale,
                bakeStars: !driftAllowed(),
            });
            stars = driftAllowed() ? buildStars(metrics, palette) : null;
        }
        return true;
    }

    // Identity for "what the stack looks like". The board reference catches a
    // deserialize or a reset that swapped the array; lines and the piece count
    // catch every mutation core can make to it, since a lock always bumps
    // stats.pieces and a clear always bumps lines. notify() short-circuits
    // both by invalidating directly — this is the belt to that pair of braces,
    // and it costs two number comparisons a frame.
    function stackKey(g) {
        const st = g.stats || null;
        return (g.lines | 0) + ':' + (st ? st.pieces | 0 : -1);
    }

    function ensureLocked(g) {
        const key = stackKey(g);
        if (locked && lockedKey === key && lockedBoard === g.board) return;
        locked = buildLocked(g.board, metrics, palette);
        lockedKey = key;
        lockedBoard = g.board;
    }

    function invalidateStack() {
        lockedKey = null;
    }

    function paletteSignature(p) {
        return p.field + '|' + p.rim + '|' + p.star + '|' + p.byId.join(',');
    }

    function recheckPalette() {
        if (paletteChecks <= 0) return;
        paletteChecks--;
        const fresh = readPalette(cfg.theme);
        if (paletteSignature(fresh) === paletteSignature(palette)) return;
        palette = fresh;
        bg = null;
        stars = null;
        locked = null;
        lockedKey = null;
        previewKey = null;
    }

    function rebuildAll() {
        palette = readPalette(cfg.theme);
        paletteChecks = 4;
        bg = null;
        stars = null;
        locked = null;
        lockedKey = null;
        previewKey = null;
    }

    // ── Per-frame drawing ────────────────────────────────────────────────

    function drawPiecePreviewLayers(g) {
        if (!holdCtx && !nextCtx) return;
        const key = previewSignature(g.hold, g.holdUsed, g.queue, QUEUE_LEN)
            + '|' + palette.theme;
        if (key === previewKey) return;
        previewKey = key;
        if (holdCtx && holdBox.w > 1) drawHold(holdCtx, holdBox, g.hold, !!g.holdUsed, palette);
        if (nextCtx && nextBox.w > 1) drawQueue(nextCtx, nextBox, g.queue, palette, QUEUE_LEN);
    }

    function drawActive(ctx, g) {
        const piece = g.active;
        if (!piece || !piece.type || !ID[piece.type]) return;
        const color = colorFor(palette, ID[piece.type]);
        const cell = metrics.cell;

        // The ghost is keyed off the SETTING, never off ghostY: ghostY is
        // populated for every piece whether or not the ghost is shown, because
        // other layers derive a landing cue from it.
        const wantGhost = !g.settings || g.settings.ghost !== false;
        if (wantGhost && Number.isFinite(g.ghostY) && g.ghostY > piece.y) {
            const cells = cellsFor(piece.type, piece.rot);
            for (let i = 0; i < cells.length; i++) {
                drawGhostBlock(ctx,
                    colLeft(metrics, piece.x + cells[i][0]),
                    rowTop(metrics, g.ghostY + cells[i][1]),
                    cell, color, palette);
            }
        }

        const cells = absoluteCells(piece);
        for (let i = 0; i < cells.length; i++) {
            drawBlock(ctx, colLeft(metrics, cells[i][0]), rowTop(metrics, cells[i][1]), cell, color);
        }
    }

    function draw(g) {
        if (disposed || !g || !wellCtx) return false;
        lastGame = g;

        // The geometry check runs every frame: a DPR read is free and a
        // getBoundingClientRect against a clean layout is nearly so, and
        // between them a monitor swap or a launcher-iframe reflow self-heals
        // instead of waiting for somebody to remember to call resize().
        if (fitWell()) watchDpr();
        holdBox = fitPreview(holdCanvas, holdCtx, holdBox);
        nextBox = fitPreview(nextCanvas, nextCtx, nextBox);

        recheckPalette();
        if (!ensureLayers()) return false;
        ensureLocked(g);

        const t = now();
        const ctx = wellCtx;
        ctx.clearRect(0, 0, metrics.cssW, metrics.cssH);
        ctx.drawImage(bg, 0, 0, metrics.cssW, metrics.cssH);

        ctx.save();
        // Everything below is in field-local coordinates and clipped to the
        // visible 20 rows, which is what lets a piece straddling the spawn
        // buffer clip at the dead line instead of being drawn over the rail.
        ctx.beginPath();
        ctx.rect(metrics.x, metrics.y, metrics.w, metrics.h);
        ctx.clip();
        ctx.translate(metrics.x, metrics.y);

        if (stars) {
            const off = (t / 1000) * DRIFT_CELLS_PER_SEC * metrics.cell % metrics.h;
            ctx.drawImage(stars, 0, off, metrics.w, metrics.h);
            ctx.drawImage(stars, 0, off - metrics.h, metrics.w, metrics.h);
        }
        ctx.drawImage(locked, 0, 0, metrics.w, metrics.h);
        drawActive(ctx, g);
        const animating = fx.draw(ctx, metrics, palette, t);
        ctx.restore();

        drawPiecePreviewLayers(g);
        return animating;
    }

    // ── Public surface ───────────────────────────────────────────────────

    resize();

    return {
        draw: draw,

        // Read-only. The app owns the drain (`g.events.length = 0`) precisely
        // because there are two consumers; clearing it here would silently
        // starve the audio layer of every event it shares with us.
        notify: function (events) {
            if (disposed || !events || !events.length) return;
            for (let i = 0; i < events.length; i++) {
                const type = events[i] && events[i].type;
                if (type === 'lock' || type === 'clear' || type === 'topout') invalidateStack();
            }
            fx.notify(events, now());
        },

        resize: resize,

        setOpts: function (partial) {
            if (disposed || !partial) return;
            let repaint = false;
            if ('theme' in partial) {
                const theme = partial.theme === 'light' ? 'light' : 'dark';
                if (theme !== cfg.theme) { cfg.theme = theme; repaint = true; }
            }
            if ('fontScale' in partial) {
                const fs = Number(partial.fontScale) > 0 ? Number(partial.fontScale) : 1;
                if (fs !== cfg.fontScale) { cfg.fontScale = fs; repaint = true; }
            }
            if ('reducedMotion' in partial) {
                const rm = !!partial.reducedMotion;
                if (rm !== cfg.reducedMotion) { cfg.reducedMotion = rm; repaint = true; }
            }
            if ('powerSaver' in partial) {
                const ps = !!partial.powerSaver;
                if (ps !== cfg.powerSaver) { cfg.powerSaver = ps; repaint = true; }
            }
            if (!repaint) return;
            fx.setOpts(cfg);
            // The theme changed the custom properties out from under every
            // cached bitmap, and reducedMotion/powerSaver changed whether the
            // sky is baked into one. Both mean: build them again.
            rebuildAll();
            if (lastGame) draw(lastGame);
        },

        // The well's current cell size in CSS pixels — the unit every gesture
        // threshold in js/input/touch.js is a ratio of. Exposed because this
        // module is the one that actually knows it, after a resize and after a
        // DPR change alike; a second independent computation of the same
        // number drifts the first time the layout gains a padding. 0 before
        // the first successful measure.
        cellPx: function () {
            return metrics ? metrics.cell : 0;
        },

        // "Does the renderer still need frames?" — the FX layer, and only the
        // FX layer. Gameplay motion is the app's own business, and the
        // starfield deliberately never answers yes (§5: it rides frames that
        // already exist, it does not ask for them). draw() returns the same
        // boolean, so the app can use either.
        busy: function () {
            return !disposed && fx.alive(now());
        },

        dispose: function () {
            disposed = true;
            unwatchDpr();
            fx.clear();
            bg = null;
            stars = null;
            locked = null;
            lockedBoard = null;
            lastGame = null;
        },
    };
}
