/* Pointers → press/release edges: one gesture layer that serves a finger, a
 * pen and a mouse without ever asking which one it is.
 *
 * There is no device branch in this file and there must never be one. A
 * laptop with a touchscreen and a phone with a Bluetooth keyboard both exist,
 * so Pointer Events carry every input type down the SAME path and the
 * keyboard stays attached at the same time. The game is never in a mode where
 * one of them is off.
 *
 * Two schemes share the plumbing:
 *   'gesture' (default) — drag/tap/flick over a transparent surface.
 *   'buttons'           — the on-screen cluster: real <button>s with labels,
 *                         the precision path and the accessible one.
 *
 * THE STATE MACHINE (per pointer) is the whole file:
 *
 *   down ──── |dx| ≥ 0.5 cell ─────────────→ h     positional shift, cell-for-cell
 *     │
 *     ├────── dy ≤ −1.25 cell ─────────────→ dead  HOLD fired, gesture spent
 *     ├────── dy ≥ +0.75 cell ─────────────→ v     SOFT held; flick judged at lift
 *     └────── pointerup, still `down` ─────→ tap   rotate, in whichever
 *                                                     direction `tapRotate`
 *                                                     names (default CW)
 *
 * An axis, once committed, is committed for the life of the pointer. That is
 * what stops a rotate firing at the end of every drag (a tap is *defined* as a
 * pointer that never committed an axis) and what stops a downward wobble
 * during horizontal placement from hard-dropping a piece the player was still
 * aiming. The cost is that a shift and a drop are two gestures, not one; a
 * lost piece is more expensive than a second flick.
 *
 * Every threshold is in CELL WIDTHS, never in raw pixels — the same gesture
 * has to mean the same thing on a 320 px phone well and a 460 px laptop one.
 * (Deliberately NOT scaled by devicePixelRatio: CSS pixels are already
 * device-independent, so a DPR factor would double the slop on a hidpi screen
 * for the same physical distance — the opposite of the intent.)
 *
 * Repeat is core's job here too: a held direction emits ONE press and one
 * release. The horizontal drag never touches DAS/ARR at all — it is
 * positional, so the piece tracks the finger by moving a cell per cell of
 * travel, measured from the pointer-down origin so nothing drifts.
 */

import { ACTIONS, COLS } from '../core/constants.js';

// --- gesture tuning ---------------------------------------------------------
// Each is a ratio of the current cell width except the millisecond ones, and
// each is the smallest number that made the gesture unambiguous on a trackpad
// and a phone-sized emulated viewport.
const TAP_MS = 250;             // a resting finger is not a tap, it is a rest
const H_COMMIT = 0.5;           // = the first cell of Math.round(dx / cell): commit and move coincide
const DOWN_COMMIT = 0.75;       // soft drop asks for more travel than a shift, so it cannot steal a tap
const DOWN_RELEASE = 0.35;      // hysteresis: reversing back up releases SOFT
const UP_COMMIT = 1.25;         // hold swaps the piece — the most expensive accident, so the longest throw

/* --- the flick, and why it needed rebuilding -------------------------------
 *
 * PLAYTEST REPORT: "the swipe down to quick place seems hard to trigger."
 * The first cut judged a trailing-velocity EMA (alpha 0.4, ~3 samples) at the
 * moment of lift, against 0.04 cells/ms over 1.5 cells of travel. The number
 * was flagged in review as probably too PERMISSIVE. It was the opposite, and
 * the threshold was only half the reason:
 *
 *  1. AN EMA CANNOT CHARGE IN THE LENGTH OF A FLICK. A flick is 80–120 ms and
 *     lands 3–6 pointermove samples. At alpha 0.4 the average is still short
 *     of the true speed when the finger leaves the glass — the shorter and
 *     harder the flick, the further short it falls. The gesture that should
 *     be easiest to recognise was the hardest.
 *
 *  2. THE LAST SAMPLE IS A LIFT, AND A LIFT IS STATIONARY. `advance()` runs
 *     once more from `pointerup`, and a pointerup routinely carries the same
 *     clientY as the pointermove before it. That folds a zero into the EMA
 *     immediately before it is read: a flat 40% haircut applied at exactly the
 *     moment of judgment. Any real thumb also decelerates and rolls back a
 *     little as it leaves, so the terminal velocity of a flick is close to the
 *     WORST estimate of it available.
 *
 * So the smoothed terminal average is gone. What is judged instead:
 *
 *  · PEAK downward speed over the tail of the gesture (FLICK_WINDOW_MS), not
 *    the average and not the final value — a flick's speed is its peak, and a
 *    brief gesture reaches its peak even though it can never charge an
 *    average. The window is what keeps it "recent": a fast dab followed by two
 *    seconds of slow aiming is not a flick, and a peak over the whole gesture
 *    would call it one.
 *
 *  · …over `maxDy` rather than the displacement at lift, so the roll-back as
 *    the thumb leaves cannot disqualify the flick it just finished.
 *
 *  · OR a plain distance fallback: a downward gesture that ends FLICK_DROP
 *    cells or more from where it started is a drop request whether or not it
 *    was quick. Losing a slow, long, deliberate drag to soft-drop-only was the
 *    other half of the complaint, and there is nothing else a gesture that
 *    long could plausibly mean.
 *
 * What did NOT change, because it is the property that keeps the scheme
 * honest: the flick is still judged ONCE, AT LIFT, never mid-drag. A hurried
 * soft drop therefore still cannot turn itself into a hard drop while the
 * finger is down, and the distance fallback reads the displacement AT LIFT, so
 * reversing back up (which already releases SOFT through DOWN_RELEASE) also
 * cancels the drop. Nothing here can fire a rotate: a tap is still defined as
 * a pointer that never committed an axis, and this code runs only on one that
 * committed to 'v'.
 *
 * EVERY NUMBER BELOW IS A DEFAULT, NOT A CONSTANT. attachTouch's opts override
 * each one and js/app/store.js carries a `flick` sensitivity that scales them,
 * because how hard a flick is is a question about a thumb and a screen and no
 * amount of synthesised pointer events settles one. */
const FLICK_SPEED = 0.022;      // cells/ms of PEAK recent downward speed → hard drop
const FLICK_MIN = 1;            // …over at least this much travel, so a twitch is not a drop
const FLICK_DROP = 4;           // …or this much travel at lift, at any speed at all
const FLICK_WINDOW_MS = 120;    // "recent": how much of the gesture's tail is judged
const FLICK_MIN_SENS = 0.4;     // the sensitivity multiplier's range (1 = these defaults)
const FLICK_MAX_SENS = 3;

/* Trail granularity. Samples closer together than this are folded into the
 * current one instead of starting a new one, which is what stops a single
 * 1 ms pointermove pair — two pixels apart, 2 px/ms, off the top of the scale
 * — from reading as a peak. Roughly one frame at 120 Hz. */
const SAMPLE_MIN_MS = 8;
const TRAIL_MAX = 32;           // ~256 ms of history; the window is 120

const CELL_MIN = 14;            // clamps for the measured fallback below
const CELL_MAX = 80;
const CELL_FALLBACK = 28;

const SCHEMES = new Set(['gesture', 'buttons']);
const HANDS = new Set(['left', 'right']);
const TAP_ROTATIONS = new Set(['cw', 'ccw']);

/**
 * The two rotation gestures, given which way a plain TAP should turn.
 *
 * ONE FUNCTION, NOT TWO SETTINGS, and that is the point. The tap and the
 * secondary gesture (two-finger tap, or mouse button 2) are the only two
 * rotation gestures there are, and they must always be OPPOSITES — a player
 * who flips the toggle and ends up with both spellings turning the piece the
 * same way has lost counter-rotation entirely and has no way to notice except
 * by needing it. Deriving the second from the first makes that unrepresentable
 * rather than merely unlikely.
 *
 * Exported because it is the whole rule and it is worth pinning: this module
 * needs a DOM to test, `rotationPair` does not, so tests/touch.test.js states
 * the invariant directly under `node --test`.
 *
 * The keyboard is deliberately untouched by this. ↑/X = CW and Z/Ctrl = CCW is
 * the genre standard and js/input/keymap.js already lets a player move it;
 * this setting is about the TAP, which has no label on it to read.
 *
 * @param {string} tapRotate  'cw' | 'ccw'; anything else reads as 'cw'.
 * @returns {{tap: string, alt: string}} ACTIONS.CW / ACTIONS.CCW, never equal.
 */
export function rotationPair(tapRotate) {
    const tap = tapRotate === 'ccw' ? ACTIONS.CCW : ACTIONS.CW;
    return { tap: tap, alt: tap === ACTIONS.CW ? ACTIONS.CCW : ACTIONS.CW };
}

// Cluster layout. Order here is DOM order — which is also screen-reader order,
// so it reads movement first, then the piece verbs. css/well.css positions the
// two pads; handedness only ever swaps which side each one sits on.
const CLUSTER = [
    { pad: 'move', act: ACTIONS.LEFT, label: 'Move left', glyph: '◀' },
    { pad: 'move', act: ACTIONS.SOFT, label: 'Soft drop', glyph: '▼' },
    { pad: 'move', act: ACTIONS.RIGHT, label: 'Move right', glyph: '▶' },
    { pad: 'action', act: ACTIONS.CCW, label: 'Rotate counter-clockwise', glyph: '↺' },
    { pad: 'action', act: ACTIONS.CW, label: 'Rotate clockwise', glyph: '↻' },
    { pad: 'action', act: ACTIONS.HOLD, label: 'Hold piece', glyph: '⇄' },
    { pad: 'action', act: ACTIONS.HARD, label: 'Hard drop', glyph: '↧' },
];
const PAD_LABEL = { move: 'Move', action: 'Rotate, hold and drop' };

function pickScheme(v) {
    if (v === 'cluster') return 'buttons';      // the name this option shipped under first
    return SCHEMES.has(v) ? v : 'gesture';
}
function pickHand(v) { return HANDS.has(v) ? v : 'right'; }
function pickTapRotate(v) { return TAP_ROTATIONS.has(v) ? v : 'cw'; }
function pickCell(v) { return (typeof v === 'number' && v > 0 && isFinite(v)) ? v : 0; }

/* A tunable threshold from opts. Out-of-range and unusable values fall back to
 * the default rather than clamping: these arrive from a stored settings blob
 * that may have been hand-edited or written by another build, and a flick
 * threshold of 0 is a hard drop on every downward gesture — silently losing
 * pieces is worse than silently ignoring a setting. */
function pickNum(v, dflt, min, max) {
    const n = Number(v);
    return (Number.isFinite(n) && n >= min && n <= max) ? n : dflt;
}

// One clock for the whole gesture. ev.timeStamp is tempting, but its time
// origin is not Date's and browsers disagree about which they hand you —
// mixing the two inside a single gesture yields velocities off by orders of
// magnitude, i.e. a hard drop out of nowhere.
const now = (typeof performance !== 'undefined' && performance.now)
    ? () => performance.now()
    : () => Date.now();

export function attachTouch(root, handlers, opts) {
    const doc = root && root.ownerDocument;
    if (!doc) return { detach() {}, setOpts() {} };

    const h = handlers || {};
    const press = typeof h.press === 'function' ? h.press : () => {};
    const release = typeof h.release === 'function' ? h.release : () => {};

    const o0 = opts || {};
    const state = {
        scheme: pickScheme(o0.scheme),
        handedness: pickHand(o0.handedness),
        cellPx: pickCell(o0.cellPx),
        // §4 — which way a tap turns the piece. The secondary gesture always
        // takes the other direction; see rotationPair().
        tapRotate: pickTapRotate(o0.tapRotate),
        /* The flick thresholds, settable so this can be tuned on a real device
         * without a code change. `flick` is the player-facing sensitivity —
         * one number, 1 = the defaults above — and it DIVIDES all three
         * thresholds together, so turning it up makes the gesture easier by
         * every route at once rather than trading one off against another. */
        flickSpeed: pickNum(o0.flickSpeed, FLICK_SPEED, 0.001, 1),
        flickMin: pickNum(o0.flickMin, FLICK_MIN, 0, 20),
        flickDrop: pickNum(o0.flickDrop, FLICK_DROP, 0.5, 40),
        flickWindowMs: pickNum(o0.flickWindowMs, FLICK_WINDOW_MS, 16, 2000),
        flick: pickNum(o0.flick, 1, FLICK_MIN_SENS, FLICK_MAX_SENS),
    };

    // Read per gesture, never captured, so flipping the setting mid-run takes
    // effect on the next tap rather than on the next attach.
    const rot = () => rotationPair(state.tapRotate);

    // The three distance/speed gates as the current sensitivity leaves them.
    const speedGate = () => state.flickSpeed / state.flick;
    const travelGate = () => state.flickMin / state.flick;
    const dropGate = () => state.flickDrop / state.flick;

    // ---- held-action bookkeeping ------------------------------------------
    // Refcounted, because two thumbs can hold the same button and the release
    // belongs to the last one to lift, not the first.
    const heldCount = new Map();

    function beginHold(action) {
        const n = (heldCount.get(action) || 0) + 1;
        heldCount.set(action, n);
        if (n === 1) press(action);
    }
    function endHold(action) {
        const n = heldCount.get(action) || 0;
        if (!n) return;
        if (n > 1) { heldCount.set(action, n - 1); return; }
        heldCount.delete(action);
        release(action);
    }
    function tap(action) { beginHold(action); endHold(action); }
    function releaseHeld() {
        const actions = [...heldCount.keys()];
        heldCount.clear();
        for (const a of actions) release(a);
    }

    // ---- DOM ---------------------------------------------------------------
    const surface = doc.createElement('div');
    surface.className = 'touch-gesture';
    // A transparent pointer target with no content of its own: everything it
    // does is also on the keyboard (always attached) and in the button scheme,
    // so exposing it to a screen reader would only add a mystery region.
    surface.setAttribute('aria-hidden', 'true');
    // css/well.css owns `.touch-gesture { touch-action: none }`. It is set
    // here as well because it is behavior, not styling: without it the browser
    // keeps the drag for scrolling / pull-to-refresh and the gesture simply
    // never arrives, which looks like a dead game rather than a missing rule.
    surface.style.touchAction = 'none';

    const cluster = doc.createElement('div');
    cluster.className = 'touch-cluster';
    const buttons = [];
    for (const pad of ['move', 'action']) {
        const padEl = doc.createElement('div');
        padEl.className = 'touch-pad';
        padEl.dataset.pad = pad;
        padEl.setAttribute('role', 'group');
        padEl.setAttribute('aria-label', PAD_LABEL[pad]);
        for (const spec of CLUSTER) {
            if (spec.pad !== pad) continue;
            const btn = doc.createElement('button');
            btn.type = 'button';
            btn.className = 'touch-btn';
            btn.dataset.act = spec.act;
            btn.setAttribute('aria-label', spec.label);
            btn.draggable = false;
            btn.style.touchAction = 'none';
            const glyph = doc.createElement('span');
            glyph.className = 'touch-glyph';
            glyph.setAttribute('aria-hidden', 'true');   // the label already says it
            glyph.textContent = spec.glyph;
            btn.append(glyph);
            padEl.append(btn);
            buttons.push([btn, spec.act]);
        }
        cluster.append(padEl);
    }
    root.append(surface, cluster);

    // ---- listener bookkeeping ----------------------------------------------
    const bound = [];
    function on(t, type, fn, opt) {
        if (!t || typeof t.addEventListener !== 'function') return;
        t.addEventListener(type, fn, opt);
        bound.push([t, type, fn, opt]);
    }

    // ---- gesture scheme ------------------------------------------------------
    const pointers = new Map();     // pointerId → gesture record; at most one drives

    function cellPx() {
        if (state.cellPx > 0) return state.cellPx;
        // The surface is stretched over the playfield by the stylesheet, so its
        // width across the 10 columns IS the cell width. Clamped because a
        // surface that has not been laid out yet reports 0, and a full-bleed
        // one on a desktop monitor would claim a 190 px "cell".
        const w = surface.clientWidth || root.clientWidth || 0;
        if (w > 0) return Math.min(CELL_MAX, Math.max(CELL_MIN, w / COLS));
        return CELL_FALLBACK;
    }

    function capture(id) {
        // Keeps the drag alive when the finger leaves the surface — the well is
        // narrow and a shift to the far column routinely ends up off it.
        try { surface.setPointerCapture(id); } catch { /* pointer already gone */ }
    }
    function uncapture(id) {
        try {
            if (surface.hasPointerCapture && surface.hasPointerCapture(id)) {
                surface.releasePointerCapture(id);
            }
        } catch { /* already released */ }
    }

    /* One position sample onto the gesture's trail.
     *
     * The trail is the raw material the flick is judged from, so it is kept
     * whatever the phase is — a gesture that spends its first 40 ms deciding
     * which axis it is on has still been moving, and that motion is part of
     * the flick. Two rules shape it:
     *
     *  · trail[0] is the POINTERDOWN and is never folded away, so a flick
     *    delivered as down + one move + up is still a measurable pair.
     *  · anything arriving less than SAMPLE_MIN_MS after the current tail
     *    EXTENDS that sample rather than appending a new one, so the trail is
     *    ~8 ms-grained however fast the browser coalesces pointermoves. This
     *    is the de-noising: peak-of-adjacent-pairs on a raw 1 ms-grained trail
     *    would be dominated by whichever pair happened to straddle a jitter.
     */
    function sample(p, t, y) {
        const tail = p.trail[p.trail.length - 1];
        if (p.trail.length < 2 || (t - tail.t) >= SAMPLE_MIN_MS) {
            p.trail.push({ t: t, y: y });
            if (p.trail.length > TRAIL_MAX) p.trail.shift();
        } else {
            tail.t = t;
            tail.y = y;
        }
    }

    /* Peak downward speed, in px/ms, over the tail of the gesture.
     *
     * Downward only: an upward pair contributes a negative slope and can never
     * raise the peak, which is what makes "flick down, then drag back up to
     * cancel" work — the reversal pushes every in-window pair negative and the
     * peak decays to 0 as the flick scrolls out of the window.
     *
     * The pair STRADDLING the window edge counts (the test is on the newer
     * sample, not the older one). That is deliberate: without it a gesture
     * whose only two samples are the pointerdown and a pointerup 200 ms later
     * would report no speed at all, and a sparsely-sampled flick is precisely
     * the case this rewrite exists for.
     */
    function peakSpeed(p, tEnd) {
        const cutoff = tEnd - state.flickWindowMs;
        let peak = 0;
        for (let i = 1; i < p.trail.length; i++) {
            const a = p.trail[i - 1], b = p.trail[i];
            if (b.t <= cutoff) continue;        // wholly behind the window
            const dt = b.t - a.t;
            if (dt <= 0) continue;
            const v = (b.y - a.y) / dt;         // CSS px per ms, + is down
            if (v > peak) peak = v;
        }
        return peak;
    }

    // Folds one sample into a gesture: the trail, the axis commitment, and
    // whatever the committed axis does with the displacement. Called from
    // pointermove AND from pointerup, because a fast flick can be delivered as
    // down+up with no move in between and must not land as a tap.
    function advance(p, ev) {
        const cell = cellPx();
        const dx = ev.clientX - p.x0;
        const dy = ev.clientY - p.y0;

        sample(p, now(), ev.clientY);
        // The FARTHEST down the gesture ever got, not where it ended. A thumb
        // leaving the glass rolls back a few pixels, and the flick it just
        // completed must not be disqualified by its own lift.
        if (dy > p.maxDy) p.maxDy = dy;

        if (p.phase === 'down') {
            const ax = Math.abs(dx), ay = Math.abs(dy);
            // Ties go horizontal: column placement is the precise half of this
            // game, and it is also the cheapest gesture to undo.
            if (ax >= ay && ax >= H_COMMIT * cell) p.phase = 'h';
            else if (ay > ax) {
                if (dy <= -UP_COMMIT * cell) { tap(ACTIONS.HOLD); p.phase = 'dead'; return; }
                if (dy >= DOWN_COMMIT * cell) p.phase = 'v';
            }
        }

        if (p.phase === 'h') {
            // POSITIONAL, and measured from the origin every time: per-event
            // deltas would round away a fraction of a cell per move and the
            // piece would fall behind the finger over a long drag. Rounding
            // (not truncating) puts the first cell exactly at the commit
            // threshold and carries the remainder for free.
            const want = Math.round(dx / cell);
            while (p.cells < want) { tap(ACTIONS.RIGHT); p.cells++; }
            while (p.cells > want) { tap(ACTIONS.LEFT); p.cells--; }
        } else if (p.phase === 'v') {
            if (!p.soft && dy >= DOWN_COMMIT * cell) { p.soft = true; beginHold(ACTIONS.SOFT); }
            else if (p.soft && dy < DOWN_RELEASE * cell) { p.soft = false; endHold(ACTIONS.SOFT); }
        }
    }

    function onPointerDown(ev) {
        if (state.scheme !== 'gesture') return;

        // The secondary button IS the mouse and trackpad's two-finger tap — a
        // trackpad two-finger tap arrives as button 2 — so the counter-rotation
        // is one gesture with two spellings rather than a touch-only feature.
        // `alt`, not a hard-coded CCW: it has to follow the tap's direction, or
        // flipping the setting leaves both gestures turning the same way.
        if (ev.button === 2) { ev.preventDefault(); tap(rot().alt); return; }
        if (ev.button > 0) return;      // middle-click and friends are not ours

        // Suppresses the compatibility mouse events and the click that trail a
        // touch tap, the iOS selection callout, and the drag image. It does NOT
        // suppress scrolling — that is touch-action's job, above.
        ev.preventDefault();

        const primary = pointers.values().next().value;
        if (primary) {
            // A second finger while the first has committed nothing is the
            // deliberate two-finger tap → the OPPOSITE of a one-finger tap, and
            // it spends both pointers so neither fires its own gesture on the
            // way up. A second finger
            // DURING a committed drag is a palm or a fidget: ignored outright,
            // so it cannot fight the finger that is placing the piece.
            if (primary.phase === 'down') { tap(rot().alt); primary.phase = 'dead'; }
            return;
        }

        capture(ev.pointerId);
        const t = now();
        pointers.set(ev.pointerId, {
            x0: ev.clientX, y0: ev.clientY, t0: t,
            phase: 'down', cells: 0, soft: false, maxDy: 0,
            trail: [{ t: t, y: ev.clientY }],
        });
    }

    function onPointerMove(ev) {
        const p = pointers.get(ev.pointerId);
        if (!p || p.phase === 'dead') return;
        advance(p, ev);
    }

    function onPointerUp(ev) {
        const p = pointers.get(ev.pointerId);
        if (!p) return;
        pointers.delete(ev.pointerId);
        uncapture(ev.pointerId);

        if (p.phase !== 'dead') advance(p, ev);
        if (p.soft) { p.soft = false; endHold(ACTIONS.SOFT); }

        if (p.phase === 'v') {
            /* Judged HERE — once, at lift — and not mid-drag. That is what
             * keeps a hurried soft drop from becoming a hard drop nobody asked
             * for, and it costs nothing in feel: SOFT was pressed on the way
             * down, so the piece has been falling since the gesture began and
             * the drop only finishes what the player already started.
             *
             * Two independent ways to ask for it, because a flick and a long
             * deliberate shove are both unambiguous and neither implies the
             * other. See the tuning block above for why it is a peak rather
             * than an average. */
            const cell = cellPx();
            const dy = ev.clientY - p.y0;
            const tEnd = p.trail[p.trail.length - 1].t;
            /* The flick: peak speed over `maxDy` of travel — but only if the
             * finger is still BELOW the point where SOFT lets go. DOWN_RELEASE
             * is reused on purpose rather than picked: it is already the
             * visible boundary, because crossing back over it stops the piece
             * dropping fast. So "pull back until the piece stops falling and
             * it won't lock" is one rule the player can see, not two. Below
             * that line the roll-back a thumb makes as it leaves the glass —
             * a handful of pixels — cannot disqualify the flick it just
             * finished, which is why the travel test reads maxDy. */
            const flicked = peakSpeed(p, tEnd) >= speedGate() * cell
                && p.maxDy >= travelGate() * cell
                && dy >= DOWN_RELEASE * cell;
            // The shove reads where the gesture ENDED for the same reason.
            const shoved = dy >= dropGate() * cell;
            if (flicked || shoved) tap(ACTIONS.HARD);
        } else if (p.phase === 'down' && (now() - p.t0) <= TAP_MS) {
            tap(rot().tap);
        }
    }

    function onPointerCancel() {
        // The browser fires this the moment it decides the gesture was really a
        // system scroll, a palm, or an incoming call — and the pointerup never
        // comes. A missed cancel leaves SOFT held and the piece slams down.
        abortAll();
    }

    function onLostCapture(ev) {
        // Normal lifts already removed the record, so anything still here lost
        // its capture mid-gesture and will never be finished properly.
        if (pointers.has(ev.pointerId)) abortAll();
    }

    function onContextMenu(ev) { ev.preventDefault(); }   // long-press menu, and button 2 is ours

    on(surface, 'pointerdown', onPointerDown);
    on(surface, 'pointermove', onPointerMove);
    on(surface, 'pointerup', onPointerUp);
    on(surface, 'pointercancel', onPointerCancel);
    on(surface, 'lostpointercapture', onLostCapture);
    on(surface, 'contextmenu', onContextMenu);

    // ---- button scheme -------------------------------------------------------
    const btnPointers = new Map();      // pointerId → action
    const btnKeys = new Set();          // buttons currently held by Enter/Space

    for (const [btn, action] of buttons) {
        on(btn, 'pointerdown', (ev) => {
            if (ev.button > 0) return;
            ev.preventDefault();
            // The opposite choice from the gesture surface, deliberately: a
            // pad button releases when the finger slides off it, so pointer
            // capture (which touch applies implicitly at pointerdown) has to
            // be handed straight back or the pointerleave never fires.
            uncaptureFrom(btn, ev.pointerId);
            if (btnPointers.has(ev.pointerId)) return;
            btnPointers.set(ev.pointerId, action);
            beginHold(action);
        });
        const endBtnPointer = (ev) => {
            const a = btnPointers.get(ev.pointerId);
            if (a === undefined) return;
            btnPointers.delete(ev.pointerId);
            endHold(a);
        };
        on(btn, 'pointerup', endBtnPointer);
        on(btn, 'pointerleave', endBtnPointer);
        on(btn, 'pointercancel', endBtnPointer);

        // Keyboard fallback. The cluster is focusable, so it has to answer the
        // keyboard — and answer it INSTEAD of the global key map, or Space on a
        // focused "Move left" would hard-drop. Hence stopPropagation.
        on(btn, 'keydown', (ev) => {
            if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
            ev.preventDefault();
            ev.stopPropagation();
            if (ev.repeat || btnKeys.has(btn)) return;   // OS repeat is not ARR here either
            btnKeys.add(btn);
            beginHold(action);
        });
        on(btn, 'keyup', (ev) => {
            if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
            ev.preventDefault();
            ev.stopPropagation();
            if (!btnKeys.delete(btn)) return;
            endHold(action);
        });
        on(btn, 'blur', () => { if (btnKeys.delete(btn)) endHold(action); });
        on(btn, 'click', (ev) => {
            // A real pointer already emitted its edges and preventDefault above
            // suppressed the click that would have followed. What reaches here
            // is a synthesized activation — a screen reader's "activate"
            // gesture — which carries no pointer detail. Answer it as a tap.
            if (ev.detail > 0 || btnKeys.has(btn)) return;
            tap(action);
        });
    }

    function uncaptureFrom(el, id) {
        try {
            if (el.hasPointerCapture && el.hasPointerCapture(id)) el.releasePointerCapture(id);
        } catch { /* nothing captured */ }
    }

    // ---- shared lifecycle ----------------------------------------------------
    function abortAll() {
        for (const id of pointers.keys()) uncapture(id);
        pointers.clear();
        btnPointers.clear();
        btnKeys.clear();
        releaseHeld();
    }

    const win = doc.defaultView;
    on(win, 'blur', abortAll);
    on(win, 'pagehide', abortAll);
    on(doc, 'visibilitychange', () => { if (doc.visibilityState === 'hidden') abortAll(); });

    function applyScheme(v) {
        state.scheme = pickScheme(v);
        root.dataset.scheme = state.scheme;
        // `hidden` rather than a class: it takes the inactive scheme out of hit
        // testing AND out of the accessibility tree in one attribute. NOTE for
        // css/well.css — a bare `.touch-cluster { display: … }` rule outranks
        // [hidden] and would resurrect it; keep the display rule scoped, or
        // restate `[hidden] { display: none !important }`.
        surface.hidden = state.scheme !== 'gesture';
        cluster.hidden = state.scheme !== 'buttons';
        abortAll();     // never carry a held action across a scheme change
    }

    function applyHandedness(v) {
        state.handedness = pickHand(v);
        // THE hook: css/well.css keys layout off #touch[data-handedness].
        // 'right' (the default) means the right thumb gets the rotate/drop pad.
        root.dataset.handedness = state.handedness;
    }

    applyHandedness(state.handedness);
    applyScheme(state.scheme);

    return {
        setOpts(partial) {
            if (!partial || typeof partial !== 'object') return;
            if ('handedness' in partial) applyHandedness(partial.handedness);
            // cellPx before scheme: the gesture thresholds should already be
            // right the first time the surface is asked for a measurement.
            if ('cellPx' in partial) state.cellPx = pickCell(partial.cellPx);
            if ('tapRotate' in partial) state.tapRotate = pickTapRotate(partial.tapRotate);
            // Live-tunable, and read per gesture rather than captured, so a
            // sensitivity slider takes effect on the very next flick instead
            // of on the next run.
            if ('flick' in partial) state.flick = pickNum(partial.flick, 1, FLICK_MIN_SENS, FLICK_MAX_SENS);
            if ('flickSpeed' in partial) state.flickSpeed = pickNum(partial.flickSpeed, FLICK_SPEED, 0.001, 1);
            if ('flickMin' in partial) state.flickMin = pickNum(partial.flickMin, FLICK_MIN, 0, 20);
            if ('flickDrop' in partial) state.flickDrop = pickNum(partial.flickDrop, FLICK_DROP, 0.5, 40);
            if ('flickWindowMs' in partial) {
                state.flickWindowMs = pickNum(partial.flickWindowMs, FLICK_WINDOW_MS, 16, 2000);
            }
            if ('scheme' in partial) applyScheme(partial.scheme);
        },
        detach() {
            for (const [t, type, fn, opt] of bound) t.removeEventListener(type, fn, opt);
            bound.length = 0;
            abortAll();
            surface.remove();
            cluster.remove();
            delete root.dataset.scheme;
            delete root.dataset.handedness;
        },
    };
}
