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
/* The quad answer. Longer than the collapse it rides on, deliberately: the
 * collapse is the rows going and is over when they are gone, and this is the
 * shaft reacting to it — which arrives after and outlasts it, exactly as the
 * `quad` cue does against `clear` in js/soundpack.js. */
const QUAD_MS = 420;
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
                    const combo = Math.max(1, (ev.combo | 0) || 1);
                    push({
                        kind: 'clear', t0: now, dur: CLEAR_MS, rows: rows,
                        count: ev.count || rows.length,
                        singular: !!ev.perfectClear,
                        combo: combo,
                        sparks: particlesAllowed() ? sparksFor(rows, combo) : null,
                    });
                    /* The quad, and its streak. NOT gated on particlesAllowed():
                     * this is feedback — it is how the well tells you a quad
                     * landed — and it is the same call the clear band and the
                     * lock flash already make. What it does drop under power
                     * saver is the sparks above, which are decoration. */
                    if ((ev.count || 0) >= 4) {
                        const streak = Math.max(1, (ev.quadStreak | 0) || 1);
                        push({
                            kind: 'quad', t0: now, rows: rows, streak: streak,
                            // A longer streak holds the screen longer, so the
                            // third in a row does not have to fight the fourth.
                            dur: QUAD_MS + 90 * Math.min(4, streak - 1),
                        });
                    }
                }
            } else if (ev.type === 'topout') {
                live = [];
            }
        }
    }

    /* Positions only; velocity is derived from the index so the whole thing
     * stays a pure function of elapsed time.
     *
     * The chain buys COUNT and REACH — more debris, thrown harder up the shaft
     * — rather than a longer effect: §5 caps the collapse at 250 ms and a chain
     * is a faster sequence, so stretching it would fight the thing it is
     * celebrating. Capped at a chain of 8 so a long one cannot walk the
     * per-frame particle count up without bound. */
    const SPARKS_PER_ROW = 14;
    const SPARKS_MAX_EXTRA = 10;

    function sparksFor(rows, combo) {
        const chain = Math.max(1, Math.min(8, (combo | 0) || 1));
        const n = SPARKS_PER_ROW + Math.round(SPARKS_MAX_EXTRA * (chain - 1) / 7);
        const lift = 1 + 0.11 * (chain - 1);
        const out = [];
        for (let i = 0; i < rows.length; i++) {
            for (let k = 0; k < n; k++) {
                const t = (k + 0.5) / n;
                out.push({
                    row: rows[i],
                    cx: t * COLS,
                    vx: (t - 0.5) * 7.5 * lift,                // cells / second, outward
                    vy: (-1.6 - ((k * 37) % 11) / 9) * lift,   // cells / second, up the shaft
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
            else if (e.kind === 'quad') drawQuad(ctx, metrics, palette, e, t);
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
        // A chain tints the band toward the accent and lifts it a little. Small
        // on purpose: the chain's loud channels are the pawl in the sound pack
        // and the banner, and the band still has to read as a row letting go.
        const chain = Math.max(1, Math.min(8, (e.combo | 0) || 1));
        const heat = (chain - 1) / 7;
        const tint = (e.singular || chain >= 5) ? palette.accent : palette.glow;
        for (let i = 0; i < e.rows.length; i++) {
            const y = rowTop(metrics, e.rows[i]);
            // The band contracts toward the row's midline as it fades: the
            // gravitational shimmer of §1, read as the row being pulled shut.
            const inset = (1 - ease) * cell * 0.42;
            const grad = ctx.createLinearGradient(0, y, 0, y + cell);
            grad.addColorStop(0, withAlpha(tint, 0));
            grad.addColorStop(0.5, withAlpha(tint, (0.95 + 0.05 * heat) * ease));
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

    /* THE QUAD, AND WHAT A STREAK BUYS IT.
     *
     * Three layers, and only the first is there on a lone quad:
     *
     *  1. THE WASH — the whole shaft lighting for an instant, ease-squared so
     *     it is a flash and not a fade. This is the quad itself.
     *  2. THE SHOCK — two edges leaving the cleared band, one up the shaft and
     *     one down it, at a reach the streak extends. The band is where the
     *     rows were, which is the same place drawClear is drawing, so the two
     *     read as one event rather than as two effects that happened to
     *     coincide.
     *  3. THE BEAM — from the THIRD quad in a row, a column of light standing
     *     in the shaft above the break. It is the visual half of the second
     *     `blast` the sound pack adds at the same streak, and it arrives for
     *     the same reason: at three in a row this stops being a trim on one
     *     effect and becomes its own event.
     *
     * Escalation is in REACH and COLOUR, barely in brightness — the same
     * decision §6 makes about the cue. A quad is already the brightest thing
     * on the screen; making it brighter four times over ends in white.
     */
    function drawQuad(ctx, metrics, palette, e, t) {
        const ease = 1 - t;
        const k = Math.min(1, Math.max(0, (e.streak - 1) / 4));
        const cell = metrics.cell;

        // The band the rows occupied, in field-local pixels. rowTop() maps a
        // board row, so a clear up in the spawn buffer lands above the clip and
        // the effect is simply cropped rather than drawn in the wrong place.
        let top = Infinity, bot = -Infinity;
        for (let i = 0; i < e.rows.length; i++) {
            const y = rowTop(metrics, e.rows[i]);
            if (y < top) top = y;
            if (y + cell > bot) bot = y + cell;
        }
        if (!isFinite(top)) return;
        const mid = (top + bot) / 2;

        ctx.save();
        ctx.globalCompositeOperation = palette.theme === 'dark' ? 'lighter' : 'source-over';

        // 1 — the wash.
        ctx.fillStyle = withAlpha(e.streak >= 3 ? palette.accent : palette.glow,
            (0.09 + 0.13 * k) * ease * ease);
        ctx.fillRect(0, 0, metrics.w, metrics.h);

        // 2 — the shock, out from the band in both directions.
        const reach = metrics.h * (0.42 + 0.38 * k) * t;
        const thick = Math.max(1.5, cell * (0.20 + 0.14 * k) * ease);
        ctx.fillStyle = withAlpha(palette.accent, 0.80 * ease * ease);
        ctx.fillRect(0, mid - reach - thick / 2, metrics.w, thick);
        ctx.fillRect(0, mid + reach - thick / 2, metrics.w, thick);

        // 3 — the beam, from three in a row.
        if (e.streak >= 3 && mid > 0) {
            const grad = ctx.createLinearGradient(0, mid, 0, 0);
            grad.addColorStop(0, withAlpha(palette.accent, 0.50 * ease));
            grad.addColorStop(1, withAlpha(palette.accent, 0));
            ctx.fillStyle = grad;
            const bw = metrics.w * (0.28 + 0.24 * k) * (0.55 + 0.45 * ease);
            ctx.fillRect((metrics.w - bw) / 2, 0, bw, mid);
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
