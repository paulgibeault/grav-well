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
 *     └────── pointerup, still `down` ─────→ tap   rotate CW
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
// Starting points, not measured feel: see the report. Each is a ratio of the
// current cell width except TAP_MS, and each is the smallest number that made
// the gesture unambiguous on a trackpad and a phone-sized emulated viewport.
const TAP_MS = 250;             // a resting finger is not a tap, it is a rest
const H_COMMIT = 0.5;           // = the first cell of Math.round(dx / cell): commit and move coincide
const DOWN_COMMIT = 0.75;       // soft drop asks for more travel than a shift, so it cannot steal a tap
const DOWN_RELEASE = 0.35;      // hysteresis: reversing back up releases SOFT
const UP_COMMIT = 1.25;         // hold swaps the piece — the most expensive accident, so the longest throw
const FLICK_SPEED = 0.04;       // cells/ms ≈ 40 cells/s at lift → hard drop
const FLICK_MIN = 1.5;          // …and at least this much travel, so a fast twitch is not a drop
const VELOCITY_ALPHA = 0.4;     // EMA over ~3 samples ≈ the last 30-40 ms

const CELL_MIN = 14;            // clamps for the measured fallback below
const CELL_MAX = 80;
const CELL_FALLBACK = 28;

const SCHEMES = new Set(['gesture', 'buttons']);
const HANDS = new Set(['left', 'right']);

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
function pickCell(v) { return (typeof v === 'number' && v > 0 && isFinite(v)) ? v : 0; }

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

    const state = {
        scheme: pickScheme(opts && opts.scheme),
        handedness: pickHand(opts && opts.handedness),
        cellPx: pickCell(opts && opts.cellPx),
    };

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

    // Folds one sample into a gesture: velocity, the axis commitment, and
    // whatever the committed axis does with the displacement. Called from
    // pointermove AND from pointerup, because a fast flick can be delivered as
    // down+up with no move in between and must not land as a tap.
    function advance(p, ev) {
        const cell = cellPx();
        const dx = ev.clientX - p.x0;
        const dy = ev.clientY - p.y0;

        const t = now();
        const dt = t - p.lastT;
        if (dt > 0) {
            const v = (ev.clientY - p.lastY) / dt;      // CSS px per ms, + is down
            p.vy = p.samples === 0 ? v : p.vy + (v - p.vy) * VELOCITY_ALPHA;
            p.samples++;
            p.lastT = t;
            p.lastY = ev.clientY;
        }

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
        // trackpad two-finger tap arrives as button 2 — so counter-clockwise
        // is one gesture with two spellings rather than a touch-only feature.
        if (ev.button === 2) { ev.preventDefault(); tap(ACTIONS.CCW); return; }
        if (ev.button > 0) return;      // middle-click and friends are not ours

        // Suppresses the compatibility mouse events and the click that trail a
        // touch tap, the iOS selection callout, and the drag image. It does NOT
        // suppress scrolling — that is touch-action's job, above.
        ev.preventDefault();

        const primary = pointers.values().next().value;
        if (primary) {
            // A second finger while the first has committed nothing is the
            // deliberate two-finger tap → CCW, and it spends both pointers so
            // neither fires its own gesture on the way up. A second finger
            // DURING a committed drag is a palm or a fidget: ignored outright,
            // so it cannot fight the finger that is placing the piece.
            if (primary.phase === 'down') { tap(ACTIONS.CCW); primary.phase = 'dead'; }
            return;
        }

        capture(ev.pointerId);
        const t = now();
        pointers.set(ev.pointerId, {
            x0: ev.clientX, y0: ev.clientY, t0: t,
            lastY: ev.clientY, lastT: t,
            phase: 'down', cells: 0, soft: false, vy: 0, samples: 0,
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
            // A flick is a gesture still moving fast at the moment of lift.
            // Judging it here instead of mid-drag is what keeps a hurried soft
            // drop from becoming a hard drop nobody asked for — and it costs
            // nothing in feel, because SOFT was already pressed on the way
            // down, so the piece has been falling since the gesture began.
            const cell = cellPx();
            if (p.vy >= FLICK_SPEED * cell && (ev.clientY - p.y0) >= FLICK_MIN * cell) {
                tap(ACTIONS.HARD);
            }
        } else if (p.phase === 'down' && (now() - p.t0) <= TAP_MS) {
            tap(ACTIONS.CW);
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
