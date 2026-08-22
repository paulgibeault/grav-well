/* fx.js — the only layer that is allowed to move on its own, and the only
 * reason draw() ever answers "still animating".
 *
 * Every effect is stored in BOARD coordinates and converted to pixels at
 * draw time, so a resize mid-collapse relocates the effect instead of
 * stranding it where the well used to be. Every effect is also a pure
 * function of (now - t0): nothing integrates a dt, which is what lets the
 * loop be parked for ten seconds and resumed with the FX in a coherent state
 * rather than a decade behind.
 *
 * The board is already collapsed by the time a 'clear' event reaches us —
 * core clears rows inside the locking tick — so the collapse effect is a
 * light band where the rows WERE, not a simulation of them falling. That is
 * the honest version of the shimmer in DESIGN.md §5, and it is why the effect
 * never needs to hold a copy of the board.
 */

import { COLS } from '../core/constants.js';
import { rowTop, colLeft, withAlpha } from './layers.js';

const CLEAR_MS = 250;      // §5: the collapse is capped at 250 ms
const LOCK_MS = 130;
const TRAIL_MS = 180;
const MAX_EFFECTS = 24;    // an app that notifies without ever drawing cannot grow this

export function createFx(opts) {
    let reducedMotion = !!opts.reducedMotion;
    let powerSaver = !!opts.powerSaver;
    let live = [];

    function push(e) {
        if (live.length >= MAX_EFFECTS) live.shift();
        live.push(e);
    }

    // Decorative particle work is what powerSaver drops (the brief, and §5's
    // ambient-effects gate). The clear band and the lock flash are feedback —
    // they tell the player what just happened — so they survive power saver
    // and die only under reducedMotion, where a line clear is specified to be
    // an instant removal.
    const particlesAllowed = () => !reducedMotion && !powerSaver;

    function notify(events, now) {
        if (reducedMotion || !events) return;
        let pendingDrop = 0;
        for (let i = 0; i < events.length; i++) {
            const ev = events[i];
            if (!ev) continue;
            if (ev.type === 'harddrop') {
                pendingDrop = ev.rows | 0;
            } else if (ev.type === 'lock') {
                const cells = Array.isArray(ev.cells) ? ev.cells.map((c) => [c[0], c[1]]) : [];
                if (cells.length) {
                    push({ kind: 'lock', t0: now, dur: LOCK_MS, cells: cells });
                    // A hard drop is reported by the drop event and locked by
                    // the one behind it in the same batch; pairing them here
                    // is what gives the trail a place to be drawn.
                    if (pendingDrop > 1 && particlesAllowed()) {
                        push({ kind: 'trail', t0: now, dur: TRAIL_MS, cells: cells, rows: pendingDrop });
                    }
                }
                pendingDrop = 0;
            } else if (ev.type === 'clear') {
                const rows = Array.isArray(ev.rows) ? ev.rows.slice() : [];
                if (rows.length) {
                    push({
                        kind: 'clear', t0: now, dur: CLEAR_MS, rows: rows,
                        count: ev.count || rows.length,
                        singular: !!ev.perfectClear,
                        sparks: particlesAllowed() ? sparksFor(rows) : null,
                    });
                }
            } else if (ev.type === 'topout') {
                live = [];
            }
        }
    }

    // Positions only; velocity is derived from the index so the whole thing
    // stays a pure function of elapsed time.
    function sparksFor(rows) {
        const out = [];
        for (let i = 0; i < rows.length; i++) {
            for (let k = 0; k < 14; k++) {
                const t = (k + 0.5) / 14;
                out.push({
                    row: rows[i],
                    cx: t * COLS,
                    vx: (t - 0.5) * 7.5,                       // cells / second, outward
                    vy: -1.6 - ((k * 37) % 11) / 9,            // cells / second, up the shaft
                    seed: ((k * 61 + i * 17) % 100) / 100,
                });
            }
        }
        return out;
    }

    function alive(now) {
        for (let i = 0; i < live.length; i++) {
            if (now - live[i].t0 < live[i].dur) return true;
        }
        return false;
    }

    // Reaping happens here rather than in alive() so that alive() stays a
    // predicate the app can call as often as it likes.
    function draw(ctx, metrics, palette, now) {
        if (!live.length) return false;
        let running = false;
        const keep = [];
        for (let i = 0; i < live.length; i++) {
            const e = live[i];
            const t = (now - e.t0) / e.dur;
            if (t >= 1) continue;
            keep.push(e);
            running = true;
            if (e.kind === 'clear') drawClear(ctx, metrics, palette, e, t);
            else if (e.kind === 'lock') drawLock(ctx, metrics, palette, e, t);
            else if (e.kind === 'trail') drawTrail(ctx, metrics, palette, e, t);
        }
        live = keep;
        return running;
    }

    function drawClear(ctx, metrics, palette, e, t) {
        const cell = metrics.cell;
        const ease = 1 - t;
        ctx.save();
        ctx.globalCompositeOperation = palette.theme === 'dark' ? 'lighter' : 'source-over';
        const tint = e.singular ? palette.accent : palette.glow;
        for (let i = 0; i < e.rows.length; i++) {
            const y = rowTop(metrics, e.rows[i]);
            // The band contracts toward the row's midline as it fades: the
            // gravitational shimmer of §1, read as the row being pulled shut.
            const inset = (1 - ease) * cell * 0.42;
            const grad = ctx.createLinearGradient(0, y, 0, y + cell);
            grad.addColorStop(0, withAlpha(tint, 0));
            grad.addColorStop(0.5, withAlpha(tint, 0.95 * ease));
            grad.addColorStop(1, withAlpha(tint, 0));
            ctx.fillStyle = grad;
            ctx.fillRect(0, y + inset, metrics.w, cell - inset * 2);
        }
        if (e.sparks) {
            const secs = (t * e.dur) / 1000;
            ctx.fillStyle = withAlpha(palette.star, 0.9 * ease * ease);
            for (let i = 0; i < e.sparks.length; i++) {
                const s = e.sparks[i];
                const px = colLeft(metrics, s.cx + s.vx * secs);
                const py = rowTop(metrics, s.row) + cell * 0.5
                    + (s.vy * secs + 5.5 * secs * secs) * cell;   // cells/s², up then falling back
                const r = cell * (0.05 + s.seed * 0.05) * ease;
                if (r <= 0) continue;
                ctx.fillRect(px - r, py - r, r * 2, r * 2);
            }
        }
        ctx.restore();
    }

    function drawLock(ctx, metrics, palette, e, t) {
        const cell = metrics.cell;
        const ease = 1 - t * t;
        ctx.save();
        ctx.lineWidth = Math.max(1, cell * 0.09);
        for (let i = 0; i < e.cells.length; i++) {
            const c = e.cells[i];
            const x = colLeft(metrics, c[0]);
            const y = rowTop(metrics, c[1]);
            ctx.strokeStyle = withAlpha(palette.star, 0.85 * ease);
            ctx.strokeRect(x + cell * 0.06, y + cell * 0.06, cell * 0.88, cell * 0.88);
        }
        ctx.restore();
    }

    // Where the piece came from, not where it went: one soft column per
    // occupied column of the locked piece, from the drop origin down to it.
    function drawTrail(ctx, metrics, palette, e, t) {
        const cell = metrics.cell;
        const ease = (1 - t) * 0.55;
        const cols = new Map();
        for (let i = 0; i < e.cells.length; i++) {
            const c = e.cells[i];
            const top = cols.get(c[0]);
            if (top === undefined || c[1] < top) cols.set(c[0], c[1]);
        }
        ctx.save();
        ctx.globalCompositeOperation = palette.theme === 'dark' ? 'lighter' : 'source-over';
        cols.forEach((topRow, col) => {
            const x = colLeft(metrics, col);
            const yEnd = rowTop(metrics, topRow);
            const yStart = yEnd - e.rows * cell;
            const grad = ctx.createLinearGradient(0, yStart, 0, yEnd);
            grad.addColorStop(0, withAlpha(palette.glow, 0));
            grad.addColorStop(1, withAlpha(palette.glow, ease));
            ctx.fillStyle = grad;
            ctx.fillRect(x + cell * 0.2, yStart, cell * 0.6, yEnd - yStart);
        });
        ctx.restore();
    }

    return {
        notify: notify,
        draw: draw,
        alive: alive,
        clear: function () { live = []; },
        setOpts: function (partial) {
            if ('reducedMotion' in partial) reducedMotion = !!partial.reducedMotion;
            if ('powerSaver' in partial) powerSaver = !!partial.powerSaver;
            if (reducedMotion) live = [];
        },
    };
}
