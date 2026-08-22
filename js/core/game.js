/* game.js — the keystone: one fixed-step reducer over one seeded stream.
 *
 * PURE by contract (tests/repo-gates.test.js enforces it): no DOM, no window,
 * no Arcade, no timers, no Math.random. See docs/ARCHITECTURE.md.
 *
 * Wall time enters this module in exactly ONE place — the dtMs argument to
 * update() — and is converted immediately into whole TICK_MS steps. Every
 * timer below (DAS, ARR, gravity, lock delay, the run clock) counts those
 * steps and never milliseconds off a clock, which is what makes a run
 * replayable from seed + input log and a resumed snapshot identical to an
 * uninterrupted one.
 *
 * The public half of the state object is documented in ARCHITECTURE.md; the
 * fields after `seed` are this reducer's own bookkeeping. Everything on it
 * except `bag` is JSON-shaped, and serialize.js rebuilds `bag` from the seed
 * plus its saved state.
 */

import {
    COLS, ROWS, HIDDEN_ROWS, VISIBLE_ROWS, ID, GARBAGE_ID, ACTIONS, TICK_MS,
} from './constants.js';
import {
    createBoard, idx, collides, lockCells, fullRows, clearRows, isEmpty, highestRow,
} from './board.js';
import { absoluteCells, spawnPiece } from './piece.js';
import { tryRotate } from './srs.js';
import { detectTSpin } from './tspin.js';
import { LOCK_DELAY_MS, MAX_LOCK_RESETS, MAX_G, fallIntervalMs, levelFor } from './gravity.js';
import { scoreLock, dropPoints } from './score.js';
import { createBag } from './bag.js';
import { makeRng } from '../arcade-rng.js';

export { serialize, deserialize } from './serialize.js';

const QUEUE_LEN = 5;

/* How many whole ticks a single update() call may run.
 *
 * Twelve ticks is 200 ms of simulation: enough to swallow a real hitch (a GC
 * pause, two or three dropped frames) without the player losing the piece they
 * were placing, and short enough that a tab restored after thirty seconds
 * resumes instead of grinding through 1800 ticks — or, with a pathological
 * delta, half a million.
 *
 * Time past the cap is DROPPED rather than banked. Banking it would only move
 * the stall: the next call would fire another capped burst and the run would
 * chase the clock for as long as it was away. Dropping it costs the run wall
 * time (an Ultra clock does not tick while the tab is asleep) and costs the
 * state nothing — every step is a whole tick whether it runs or not, so a
 * clamped call leaves exactly the same shape of state as an unclamped one.
 */
const MAX_STEPS_PER_UPDATE = 12;

/* The app layer drains g.events every frame (ARCHITECTURE.md, "Two consumers,
 * one drain"). The cap is for the caller that forgets: it then loses cues
 * rather than growing an array without bound for the length of a run. */
const MAX_EVENTS = 1024;

/* "Instant" soft drop (§2.8) as a finite number. JSON turns Infinity into
 * null, and a snapshot has to survive JSON; 1200x reaches gravity.js's
 * twenty-rows-a-tick ceiling at level 1 — the slowest gravity in the game — so
 * naming it costs nothing and every faster setting is the same drop. */
const MAX_SDF = 1200;

const DEFAULT_SETTINGS = { das: 167, arr: 33, sdf: 20, ghost: true, lockdown: 'extended' };

export function createGame(opts) {
    const o = opts || {};
    const g = {
        // --- the contract's surface (ARCHITECTURE.md) ---
        mode: typeof o.mode === 'string' ? o.mode : 'marathon',
        phase: 'playing',
        board: createBoard(),
        active: null,
        ghostY: -1,
        hold: null,
        holdUsed: false,
        queue: [],
        score: 0, lines: 0, level: 1, combo: 0, b2b: false,
        tick: 0, elapsedMs: 0,
        goalLines: optCount(o.goalLines),
        timeLimitMs: optCount(o.timeLimitMs),
        topOutReason: null,
        stats: newStats(),
        events: [],
        settings: normalizeSettings(o.settings),
        seed: (typeof o.seed === 'number' || typeof o.seed === 'string') ? o.seed : 0,

        // --- the reducer's bookkeeping ---
        garbageRows: Math.min(Math.max(0, Math.floor(Number(o.garbageRows) || 0)), VISIBLE_ROWS),
        bag: null,          // live; serialize.js rebuilds it from seed + state
        leftoverMs: 0,      // sub-tick remainder of the last update()
        fallMs: 0,          // gravity accumulator
        lockMs: 0,          // lock-delay accumulator, only runs while grounded
        lockResets: 0,
        lowestY: 0,         // deepest row this piece has reached
        lastKickIndex: -1,  // the caller half of the T-spin rule (tspin.js)
        held: newHeld(),
        dir: 0,             // -1 / 0 / +1: the direction currently auto-shifting
        dasMs: 0,           // ms left before auto-shift engages
        arrMs: 0,           // ms left before the next auto-shift cell
    };
    startRun(g);
    return g;
}

export function reset(g) {
    if (!g) return g;
    startRun(g);
    return g;
}

export function press(g, action) {
    if (!g || g.phase !== 'playing') return g;
    if (!Object.prototype.hasOwnProperty.call(g.held, action)) return g;
    /* "Idempotent while held" means a REPEATED PRESS WITH NO INTERVENING
     * RELEASE does nothing extra — a guard against key auto-repeat and against
     * a gesture layer re-asserting a state it has already sent.
     *
     * It is NOT a per-tick guard, and the distinction matters: a positional
     * drag translates finger travel into one press/release PAIR per cell, so
     * five pairs can arrive before update() runs again and each one has to
     * move the piece. Coalescing them — an "already moved this tick" flag, or
     * deferring the first shift to the next tick — would make the piece lag
     * the finger and read as input latency rather than as a logic bug. The
     * only thing suppressed here is a press against a key already down. */
    if (g.held[action]) return g;
    g.held[action] = true;
    switch (action) {
        case ACTIONS.LEFT: startShift(g, -1); break;
        case ACTIONS.RIGHT: startShift(g, 1); break;
        case ACTIONS.CW: rotate(g, 1); break;
        case ACTIONS.CCW: rotate(g, -1); break;
        case ACTIONS.HARD: hardDrop(g); break;
        case ACTIONS.HOLD: holdPiece(g); break;
        default: break;                 // SOFT acts through gravity, not on the edge
    }
    return g;
}

export function release(g, action) {
    if (!g || !Object.prototype.hasOwnProperty.call(g.held, action)) return g;
    g.held[action] = false;
    // Deliberately NOT gated on phase: a key let go while the game is paused
    // still has to drop its auto-shift, or the piece walks into the wall the
    // moment play resumes.
    if (action === ACTIONS.LEFT || action === ACTIONS.RIGHT) releaseShift(g, action);
    return g;
}

export function update(g, dtMs) {
    if (!g) return g;
    if (g.phase !== 'playing') {
        // Time spent paused, won or topped out is not the run's time; banking
        // it would fire a burst of ticks the instant play resumed.
        g.leftoverMs = 0;
        return g;
    }
    const dt = Number(dtMs);
    if (Number.isFinite(dt) && dt > 0) g.leftoverMs += dt;

    let steps = Math.floor(g.leftoverMs / TICK_MS);
    if (steps > MAX_STEPS_PER_UPDATE) steps = MAX_STEPS_PER_UPDATE;
    // Sub-tick phase is kept; whole ticks past the cap are the dropped time.
    g.leftoverMs %= TICK_MS;

    for (let i = 0; i < steps && g.phase === 'playing'; i++) step(g);
    return g;
}

// ---------------------------------------------------------------------------
// the tick
// ---------------------------------------------------------------------------

function step(g) {
    g.tick++;
    // The run clock is DERIVED from the tick count rather than summed from
    // dtMs: two runs fed the same input log have to agree about the clock as
    // exactly as they agree about the board.
    g.elapsedMs = g.tick * TICK_MS;
    autoShift(g);
    applyGravity(g);
    tickLockDelay(g);
    checkClock(g);
}

/* DAS then ARR (§2.8). The one-cell tap belongs to press(); this is only the
 * repeat behind it. */
function autoShift(g) {
    if (g.dir === 0 || !g.active) return;
    if (g.dasMs > 0) {
        g.dasMs -= TICK_MS;
        if (g.dasMs > 0) return;
        g.arrMs = 0;            // charge complete: the first repeat lands this tick
    }
    const arr = g.settings.arr;
    if (arr <= 0) {
        // ARR 0 is "as far as it goes, this tick" — the piece slams the wall.
        while (move(g, g.dir)) { /* until the wall or the stack refuses */ }
        return;
    }
    g.arrMs -= TICK_MS;
    // A sub-tick ARR moves more than one cell in a tick, which is the whole
    // reason the setting goes below 16 ms.
    while (g.arrMs <= 0) {
        if (!move(g, g.dir)) { g.arrMs = 0; break; }
        g.arrMs += arr;
    }
}

/* Gravity, in ROWS per tick — never a boolean (ARCHITECTURE.md, "Gravity above
 * 1G is real"). From level 14 the interval is shorter than a tick and one tick
 * owes the piece several rows. */
function applyGravity(g) {
    if (!g.active) return;
    const base = fallIntervalMs(g.level);
    const soft = g.held[ACTIONS.SOFT];
    const interval = soft ? base / g.settings.sdf : base;

    // The accumulator has been filling against whatever interval was in force
    // last tick. Soft drop shortens it under a nearly-full accumulator, so
    // clamp before adding: without this, tapping soft drop after a second of
    // level-1 gravity would cash a full second in at the fast rate and
    // teleport the piece twenty rows.
    if (g.fallMs > interval) g.fallMs = interval;
    g.fallMs += TICK_MS;

    let rows;
    if (interval > 0) {
        rows = Math.floor(g.fallMs / interval);
        g.fallMs -= rows * interval;     // the true remainder, before the cap
    } else {
        rows = MAX_G;                    // an instant SDF leaves nothing to accumulate
        g.fallMs = 0;
    }
    // MAX_G is gravity.js's ceiling. Rows past it are dropped rather than
    // banked — the remainder above already went back to zero, so a stalled
    // frame cannot fire a second full-speed tick behind itself.
    if (rows > MAX_G) rows = MAX_G;

    let fell = 0;
    while (fell < rows && stepDown(g)) fell++;
    if (fell < rows) g.fallMs = 0;       // landed: a banked accumulator would
                                         // fire the moment it is nudged off a ledge
    if (fell === 0) return;

    // A drop is not a rotation. This is the caller's half of the 3-corner rule
    // (tspin.js): only a rotation may leave a spin claim standing.
    g.lastKickIndex = -1;
    updateGhost(g);
    reachedNewLow(g);
    if (soft) {
        g.score += dropPoints(fell, 'soft');
        emit(g, { type: 'softdrop', rows: fell });
    }
}

/* Extended Placement (§2.7). The timer only runs while the piece is on a
 * surface; the RESET BUDGET, though, survives being airborne — only falling to
 * a new lowest row buys it back. */
function tickLockDelay(g) {
    if (!g.active) return;
    if (canFall(g)) { g.lockMs = 0; return; }
    g.lockMs += TICK_MS;
    if (g.lockMs >= LOCK_DELAY_MS) lockPiece(g);
}

function checkClock(g) {
    if (g.phase !== 'playing') return;
    if (g.timeLimitMs != null && g.elapsedMs >= g.timeLimitMs) reachGoal(g);
}

function reachGoal(g) {
    // Ultra's clock or Sprint's line goal. The active piece is left where it
    // is rather than nulled: a frozen final frame reads as an ending, a piece
    // that vanishes reads as a bug.
    g.phase = 'won';
    emit(g, { type: 'goal' });
}

// ---------------------------------------------------------------------------
// moving the active piece
// ---------------------------------------------------------------------------

function shifted(p, dx, dy) {
    return { type: p.type, rot: p.rot, x: p.x + dx, y: p.y + dy };
}

function fits(g, p) {
    return !collides(g.board, absoluteCells(p));
}

function canFall(g) {
    return !!g.active && fits(g, shifted(g.active, 0, 1));
}

function stepDown(g) {
    const p = shifted(g.active, 0, 1);
    if (!fits(g, p)) return false;
    g.active = p;
    return true;
}

function move(g, dx) {
    if (!g.active) return false;
    const p = shifted(g.active, dx, 0);
    if (!fits(g, p)) return false;      // a FAILED move is not a maneuver: it
    g.active = p;                       // neither resets the timer nor clears
    g.lastKickIndex = -1;               // a standing spin claim
    emit(g, { type: 'move' });
    updateGhost(g);
    afterManeuver(g);
    return true;
}

function rotate(g, dir) {
    if (!g.active) return false;
    const r = tryRotate(g.board, g.active, dir);
    if (!r) return false;
    // r.kick is the published +y-up table entry and is diagnostic only; r.piece
    // already carries the y-down result. r.kickIndex is the half of the T-spin
    // rule this module owns — it rides with the piece until something that is
    // not a rotation succeeds.
    g.active = r.piece;
    g.lastKickIndex = r.kickIndex;
    emit(g, { type: 'rotate', kickIndex: r.kickIndex });
    updateGhost(g);
    afterManeuver(g);
    return true;
}

/* The hard-drop landing row.
 *
 * COMPUTED UNCONDITIONALLY, and settings.ghost does not gate it: js/app/audio.js
 * derives its landing cue by edge-triggering on `active.y === ghostY`, so this
 * is load-bearing game state and not a rendering hint. Skipping it when the
 * ghost is switched off would silently kill that cue for exactly the players
 * who turned the ghost off. The renderer is the only layer that reads
 * settings.ghost. */
function updateGhost(g) {
    if (!g.active) { g.ghostY = -1; return; }
    const p = g.active;
    const probe = { type: p.type, rot: p.rot, x: p.x, y: p.y };
    let y = p.y;
    while (y < ROWS) {
        probe.y = y + 1;
        if (collides(g.board, absoluteCells(probe))) break;
        y++;
    }
    g.ghostY = y;
}

/* Called after any successful move or rotation — the Extended Placement
 * bookkeeping in one place. */
function afterManeuver(g) {
    if (reachedNewLow(g)) return;   // downward progress pays for itself
    if (canFall(g)) return;         // airborne: there is no timer to reset
    const budget = resetBudget(g);
    if (g.lockResets < budget) {
        g.lockResets++;
        g.lockMs = 0;
    }
    // Budget spent: the move still HAPPENED (it is already applied above) —
    // only the timer stops being refreshed. That is what makes Extended
    // Placement finite instead of an infinity spin.
}

/* §2.7: falling to a new lowest row restores the whole reset budget. Measured
 * on the piece's box row, which is monotone under gravity and is the quantity
 * "lowest row reached" is about. */
function reachedNewLow(g) {
    if (!g.active || g.active.y <= g.lowestY) return false;
    g.lowestY = g.active.y;
    g.lockResets = 0;
    g.lockMs = 0;
    return true;
}

function resetBudget(g) {
    // 'classic' refreshes the timer only on a step down, 'infinite' never runs
    // out, and the guideline default is Extended Placement's fifteen (§2.7,
    // persisted per DESIGN.md §8).
    const mode = g.settings.lockdown;
    if (mode === 'classic') return 0;
    if (mode === 'infinite') return Infinity;
    return MAX_LOCK_RESETS;
}

function startShift(g, dir) {
    // The tap moves one cell NOW, synchronously inside press(): both the
    // keyboard layer and the positional drag gesture depend on it. DAS starts
    // charging behind it.
    g.dir = dir;
    g.dasMs = g.settings.das;
    g.arrMs = 0;
    move(g, dir);
}

function releaseShift(g, action) {
    const dir = action === ACTIONS.LEFT ? -1 : 1;
    if (g.dir !== dir) return;      // it was not the one auto-shifting
    const opposite = action === ACTIONS.LEFT ? ACTIONS.RIGHT : ACTIONS.LEFT;
    if (g.held[opposite]) {
        // Both directions were down and the newer one just went up, so the
        // survivor takes over — the thing hand-rolled versions forget. It gets
        // a FRESH charge and no free cell: the one-cell tap belongs to a key
        // going DOWN, and nothing went down here.
        g.dir = -dir;
        g.dasMs = g.settings.das;
        g.arrMs = 0;
    } else {
        g.dir = 0;
    }
}

function hardDrop(g) {
    if (!g.active) return;
    const rows = g.ghostY - g.active.y;
    if (rows > 0) {
        g.active = { type: g.active.type, rot: g.active.rot, x: g.active.x, y: g.ghostY };
        // Only a drop that actually TRAVELLED clears the spin claim: rotate,
        // then hard drop, is how every T-spin in the game is finished, and the
        // piece in a T-slot has nowhere left to fall.
        g.lastKickIndex = -1;
        g.score += dropPoints(rows, 'hard');
    }
    emit(g, { type: 'harddrop', rows: rows > 0 ? rows : 0 });
    lockPiece(g);   // bypasses the lock delay entirely (§2.7)
}

// ---------------------------------------------------------------------------
// locking, clearing, scoring
// ---------------------------------------------------------------------------

function lockPiece(g) {
    const p = g.active;
    if (!p) return;
    const cells = absoluteCells(p);
    // Read the corners BEFORE the piece joins the stack, and hand tspin.js the
    // kickIndex of the rotation that placed it (-1 if the last thing that
    // worked was a move or a drop).
    const tspin = detectTSpin(g.board, p, g.lastKickIndex);

    lockCells(g.board, cells, ID[p.type] || GARBAGE_ID);
    g.active = null;
    g.ghostY = -1;
    g.stats.pieces++;
    if (tspin !== 'none') g.stats.tspins++;
    // tspin travels ON the lock event, not only on the clear: audio seats the
    // twist under the lock and a no-line T-spin has no clear to ride.
    emit(g, { type: 'lock', tspin: tspin, cells: cells });

    // Lock Out (§2.10): nothing of the piece reached the visible well.
    let aboveField = true;
    for (let i = 0; i < cells.length; i++) {
        if (cells[i][1] >= HIDDEN_ROWS) { aboveField = false; break; }
    }

    const rows = fullRows(g.board);
    const count = rows.length;
    if (count > 0) clearRows(g.board, rows);
    // Perfect clear is asked of the board AFTER the rows are gone — before
    // them, the well is never empty.
    const perfect = count > 0 && isEmpty(g.board);

    // scoreLock takes the count of PRIOR consecutive clearing locks, so the
    // first clear of a chain adds nothing and the second adds 50 x level.
    const prior = g.combo;
    const res = scoreLock({
        lines: count, tspin: tspin, perfectClear: perfect,
        level: g.level, combo: prior, b2b: g.b2b,
    });
    g.score += res.points;
    g.b2b = res.b2b;            // the flag is score.js's to decide, ours to keep

    if (count > 0) {
        g.combo = prior + 1;    // the chain length, which is what a HUD shows
        if (g.combo > g.stats.maxCombo) g.stats.maxCombo = g.combo;
        g.lines += count;
        if (count === 4) g.stats.quads++;
        if (perfect) g.stats.perfectClears++;
        emit(g, {
            type: 'clear', rows: rows, count: count, label: res.label,
            points: res.points, b2b: res.b2b, combo: g.combo, perfectClear: perfect,
        });
        const next = levelFor(g.lines);
        if (next > g.level) {
            g.level = next;
            emit(g, { type: 'levelup', level: next });
        }
    } else {
        g.combo = 0;
    }

    g.holdUsed = false;         // hold re-arms on the LOCK, never on the hold (§2.5)

    if (aboveField) {
        // Zen never ends (§3): the well SINKS instead. Everywhere else this is
        // the run.
        if (g.mode === 'zen') sinkStack(g, () => highestRow(g.board) >= HIDDEN_ROWS);
        else { topOut(g, 'lock'); return; }
    }
    if (g.goalLines != null && g.lines >= g.goalLines) { reachGoal(g); return; }
    spawnFromBag(g);
}

// ---------------------------------------------------------------------------
// the piece stream
// ---------------------------------------------------------------------------

function spawnFromBag(g) {
    const type = g.bag.next();
    g.queue = g.bag.peek(QUEUE_LEN);
    enterPiece(g, type);
}

function enterPiece(g, type) {
    const p = spawnPiece(type);
    if (collides(g.board, absoluteCells(p))) {
        /* Zen softens Block Out the same way it softens Lock Out (§3): the
         * bottom rows drop away and the stack follows them down until the
         * piece fits, and play continues. It diverges from every other mode on
         * purpose — Zen's whole promise is that you can keep stacking, and a
         * top-out is the one thing that would break it. The sink only ever
         * moves the stack DOWNWARD, so it can never push a piece past row 0,
         * where collides() would refuse it. It emits nothing: the frozen event
         * vocabulary has no 'sink', and the 'lock' that preceded it has already
         * told the renderer to redraw its locked-cell layer. */
        if (g.mode === 'zen') sinkStack(g, () => !collides(g.board, absoluteCells(p)));
        else { topOut(g, 'block'); return; }
    }
    g.active = p;
    g.lastKickIndex = -1;
    g.fallMs = 0;
    g.lockMs = 0;
    g.lockResets = 0;
    g.lowestY = p.y;
    // DAS is deliberately untouched here. The charge belongs to the KEY, not to
    // the piece, so a direction held across a lock keeps auto-shifting — what
    // the classic ruleset carried over was a charge that survived the key
    // itself, and that is the quirk §1 disclaims.
    updateGhost(g);
}

function sinkStack(g, fits) {
    // Drop the floor row away and let the stack follow it down, one row at a
    // time, until the predicate is satisfied. Bounded by the height of the
    // well — an empty well satisfies both callers.
    for (let i = 0; i < ROWS && !fits(); i++) clearRows(g.board, [ROWS - 1]);
}

function topOut(g, reason) {
    g.phase = 'over';
    g.topOutReason = reason;
    g.active = null;
    g.ghostY = -1;
    g.dir = 0;
    emit(g, { type: 'topout', reason: reason });
}

function holdPiece(g) {
    if (!g.active || g.holdUsed) return;
    const incoming = g.hold;
    g.hold = g.active.type;
    g.holdUsed = true;
    g.stats.holds++;
    emit(g, { type: 'hold' });
    // The held piece re-enters at spawn orientation and spawn position, and can
    // top out on arrival like any other piece.
    if (incoming) enterPiece(g, incoming);
    else spawnFromBag(g);
}

// ---------------------------------------------------------------------------
// run setup
// ---------------------------------------------------------------------------

function startRun(g) {
    // Mutates in place and keeps the identity of `board` and `events`: the app
    // and the renderer hold references to both, and a retry must not orphan
    // them.
    g.board.fill(0);
    g.active = null;
    g.ghostY = -1;
    g.hold = null;
    g.holdUsed = false;
    g.queue = [];
    g.score = 0; g.lines = 0; g.level = 1; g.combo = 0; g.b2b = false;
    g.tick = 0; g.elapsedMs = 0;
    g.phase = 'playing'; g.topOutReason = null;
    g.stats = newStats();
    g.events.length = 0;
    g.leftoverMs = 0; g.fallMs = 0; g.lockMs = 0; g.lockResets = 0;
    g.lowestY = 0; g.lastKickIndex = -1;
    g.held = newHeld(); g.dir = 0; g.dasMs = 0; g.arrMs = 0;

    // One generator per run, owned by the bag, its state travelling in the
    // snapshot (§2.11).
    g.bag = createBag(makeRng(g.seed));
    if (g.garbageRows > 0) seedGarbage(g);
    spawnFromBag(g);
}

/* Daily Well debris (§3).
 *
 * THE STREAM DECISION: the debris is drawn from a SEPARATE generator derived
 * from the same seed, not from the bag's. Drawing it off the bag's generator
 * would make the piece stream a function of how many rows of debris the mode
 * asked for — change the row count, or the shape of this loop, and every
 * player's bag silently forks. Deriving keeps the two independent and both
 * reproducible from the one seed, which is exactly the promise §3 makes:
 * "Same debris, same bag stream, for every player."
 */
function seedGarbage(g) {
    const rng = makeRng(String(g.seed) + '|garbage');
    let hole = rng.int(0, COLS - 1);
    for (let i = 0; i < g.garbageRows; i++) {
        const y = ROWS - 1 - i;
        for (let x = 0; x < COLS; x++) {
            if (x !== hole) g.board[idx(x, y)] = GARBAGE_ID;
        }
        // The next row's hole is anywhere but this one: a column repeated up
        // the stack is a free chimney, and the mode is "dig it clear".
        const step9 = rng.int(0, COLS - 2);
        hole = step9 >= hole ? step9 + 1 : step9;
    }
}

// ---------------------------------------------------------------------------
// plumbing
// ---------------------------------------------------------------------------

function emit(g, event) {
    if (g.events.length < MAX_EVENTS) g.events.push(event);
}

function newStats() {
    return { pieces: 0, quads: 0, tspins: 0, perfectClears: 0, maxCombo: 0, holds: 0 };
}

function newHeld() {
    return {
        LEFT: false, RIGHT: false, CW: false, CCW: false,
        SOFT: false, HARD: false, HOLD: false,
    };
}

function normalizeSettings(s) {
    const o = s || {};
    return {
        // The upper clamps are JSON-safety as much as sanity: a snapshot has to
        // survive a stringify, and Infinity does not.
        das: numOr(o.das, DEFAULT_SETTINGS.das, 0, 5000),
        arr: numOr(o.arr, DEFAULT_SETTINGS.arr, 0, 1000),
        sdf: numOr(o.sdf, DEFAULT_SETTINGS.sdf, 1, MAX_SDF),
        ghost: o.ghost == null ? DEFAULT_SETTINGS.ghost : !!o.ghost,
        lockdown: (o.lockdown === 'classic' || o.lockdown === 'infinite')
            ? o.lockdown : DEFAULT_SETTINGS.lockdown,
    };
}

function numOr(v, dflt, min, max) {
    if (v == null) return dflt;
    const n = Number(v);
    if (Number.isNaN(n)) return dflt;
    return n < min ? min : (n > max ? max : n);
}

// Absent is null, never undefined: undefined does not survive JSON, and these
// two are what tell a resumed Sprint or Ultra that it still has a goal.
function optCount(v) {
    if (v == null) return null;
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? n : null;
}
