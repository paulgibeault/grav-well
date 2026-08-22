/* game.test.js — the reducer.
 *
 * Where a rule is about a SITUATION (a T-slot, a piece with fifteen resets
 * spent, a well filled to the skyline), the situation is built directly:
 * board.fromStrings for the stack and a hand-placed piece. Playing into those
 * positions would test the script, not the rule.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    COLS, ROWS, HIDDEN_ROWS, ACTIONS, TICK_MS, GARBAGE_ID,
} from '../js/core/constants.js';
import { fromStrings, idx, collides, isEmpty, highestRow } from '../js/core/board.js';
import { absoluteCells, spawnPiece, BOX } from '../js/core/piece.js';
import { MAX_G, MAX_LOCK_RESETS, LOCK_DELAY_MS } from '../js/core/gravity.js';
import { createGame, press, release, update, reset, serialize } from '../js/core/game.js';
import { makeRng, hashU32 } from '../js/arcade-rng.js';

// One whole tick per call, so no float dust survives between assertions.
function runTicks(g, n) {
    for (let i = 0; i < n; i++) update(g, TICK_MS);
    return g;
}

const tap = (g, action) => { press(g, action); release(g, action); };

const events = (g, type) => g.events.filter((e) => e.type === type);

// The hard-drop landing row, computed here rather than read off the game, so
// the ghost assertions are not the implementation agreeing with itself.
function landing(board, p) {
    let y = p.y;
    while (!collides(board, absoluteCells({ type: p.type, rot: p.rot, x: p.x, y: y + 1 }))) y++;
    return y;
}

// Fixture: an ASCII stack (bottom-aligned by fromStrings) and a piece placed
// by hand, with the per-piece bookkeeping a real spawn would have set.
function scenario(rows, piece, opts) {
    const g = createGame(Object.assign({ seed: 1 }, opts));
    if (rows) g.board = fromStrings(rows);
    if (piece) setPiece(g, piece);
    g.events.length = 0;
    return g;
}

function setPiece(g, piece) {
    g.active = { type: piece.type, rot: piece.rot || 0, x: piece.x, y: piece.y };
    g.ghostY = landing(g.board, g.active);
    g.lastKickIndex = -1;
    g.fallMs = 0;
    g.lockMs = 0;
    g.lockResets = 0;
    g.lowestY = g.active.y;
    return g;
}

// ---------------------------------------------------------------------------
// the run, the queue, the ghost
// ---------------------------------------------------------------------------

test('a new run spawns from the seeded bag with a five-deep preview', () => {
    const g = createGame({ seed: 42 });
    // Seed 42's opening is pinned by tests/bag.test.js and the PRNG's published
    // known-answer vectors; the reducer must consume it in order.
    assert.equal(g.active.type, 'S');
    assert.deepEqual(g.queue, ['O', 'I', 'J', 'L', 'T']);
    assert.equal(g.phase, 'playing');
    assert.equal(g.level, 1);
    assert.equal(g.hold, null);
    assert.equal(g.holdUsed, false);
    assert.equal(g.active.y, HIDDEN_ROWS - 2);
    assert.equal(g.topOutReason, null);
});

test('ghostY is the hard-drop landing row and follows every move and rotation', () => {
    const g = createGame({ seed: 42 });
    assert.equal(g.ghostY, landing(g.board, g.active));
    tap(g, ACTIONS.LEFT);
    assert.equal(g.ghostY, landing(g.board, g.active));
    tap(g, ACTIONS.CW);
    assert.equal(g.ghostY, landing(g.board, g.active));
    tap(g, ACTIONS.RIGHT);
    assert.equal(g.ghostY, landing(g.board, g.active));
});

test('ghostY is computed even with the ghost switched off (audio reads it)', () => {
    // js/app/audio.js edge-triggers its landing cue on active.y === ghostY, so
    // this field is game state, not a rendering hint.
    const g = createGame({ seed: 42, settings: { ghost: false } });
    assert.equal(g.settings.ghost, false);
    assert.equal(g.ghostY, landing(g.board, g.active));
    tap(g, ACTIONS.LEFT);
    assert.equal(g.ghostY, landing(g.board, g.active));
});

// ---------------------------------------------------------------------------
// DAS / ARR / soft drop  (§2.8)
// ---------------------------------------------------------------------------

test('press moves one cell at once, then waits out DAS before auto-shifting', () => {
    const g = scenario(null, { type: 'O', x: 4, y: 18 }, { settings: { das: 167, arr: 33 } });
    press(g, ACTIONS.LEFT);
    assert.equal(g.active.x, 3, 'the tap is immediate and synchronous');
    runTicks(g, 9);                     // 150 ms — still charging
    assert.equal(g.active.x, 3);
    runTicks(g, 2);                     // past 167 ms — the first repeat lands
    assert.equal(g.active.x, 2);
    runTicks(g, 2);                     // ARR 33 ms/cell
    assert.equal(g.active.x, 1);
});

test('ARR 0 shifts as far as it goes in a single tick', () => {
    const g = scenario(null, { type: 'O', x: 4, y: 18 }, { settings: { das: 0, arr: 0 } });
    press(g, ACTIONS.LEFT);
    runTicks(g, 1);
    assert.equal(g.active.x, 0);
});

test('holding both directions: the newest wins, and releasing it falls back', () => {
    const g = scenario(null, { type: 'O', x: 4, y: 18 }, { settings: { das: 0, arr: 0 } });
    press(g, ACTIONS.LEFT);
    runTicks(g, 1);
    assert.equal(g.active.x, 0, 'left first');

    press(g, ACTIONS.RIGHT);            // newest press takes the direction
    runTicks(g, 1);
    assert.equal(g.active.x, COLS - BOX.O, 'right overrides the still-held left');

    release(g, ACTIONS.RIGHT);          // ...and left, still held, takes it back
    runTicks(g, 1);
    assert.equal(g.active.x, 0);

    release(g, ACTIONS.LEFT);           // nothing held: nothing moves
    runTicks(g, 5);
    assert.equal(g.active.x, 0);
    assert.equal(g.dir, 0);
});

test('a release while paused still drops the auto-shift', () => {
    const g = scenario(null, { type: 'O', x: 4, y: 18 }, { settings: { das: 0, arr: 0 } });
    press(g, ACTIONS.RIGHT);
    g.phase = 'paused';
    release(g, ACTIONS.RIGHT);
    g.phase = 'playing';
    const x = g.active.x;
    runTicks(g, 5);
    assert.equal(g.active.x, x, 'the piece must not walk into the wall on resume');
});

test('five press/release pairs in one frame move five cells (positional drag)', () => {
    // A horizontal drag is positional: the gesture layer emits one complete
    // press/release PAIR per cell of finger travel, all before update() runs
    // again. Coalescing them would make the piece lag the finger.
    const g = scenario(null, { type: 'O', x: 0, y: 18 });
    for (let i = 0; i < 5; i++) tap(g, ACTIONS.RIGHT);
    assert.equal(g.active.x, 5);
    assert.equal(events(g, 'move').length, 5);
});

test('a repeated press with no release in between does nothing extra', () => {
    const g = scenario(null, { type: 'O', x: 4, y: 18 });
    press(g, ACTIONS.LEFT);
    press(g, ACTIONS.LEFT);
    press(g, ACTIONS.LEFT);
    assert.equal(g.active.x, 3);
    assert.equal(events(g, 'move').length, 1);
});

// ---------------------------------------------------------------------------
// gravity  (§2.6 — rows per tick, never a boolean)
// ---------------------------------------------------------------------------

function fallInOneTick(level) {
    const g = createGame({ seed: 42 });
    g.level = level;
    const y0 = g.active.y;
    update(g, TICK_MS);
    return g.active.y - y0;
}

test('above 1G a single tick drops several rows', () => {
    // The regression this whole file exists to prevent: gravity treated as
    // "did the piece move this tick" silently caps the game at 1G, and the
    // curve crosses 1G at level 14.
    assert.ok(fallInOneTick(13) <= 1, 'still under 1G');
    assert.equal(fallInOneTick(15), 2);
    assert.equal(fallInOneTick(19), MAX_G, 'the curve reaches true 20G at 19');
});

test('rows per tick are capped at MAX_G', () => {
    // From the top of the buffer there is more than MAX_G of room below, so
    // the cap is observable rather than hidden by the floor of the well.
    const g = scenario(null, { type: 'O', x: 4, y: 0 });
    g.level = 30;                       // far past the 20G floor
    update(g, TICK_MS);
    assert.equal(g.active.y, MAX_G);
});

test('soft drop multiplies gravity and pays a point a row', () => {
    const g = scenario(null, { type: 'O', x: 4, y: 18 }, { settings: { sdf: 20 } });
    const y0 = g.active.y;
    press(g, ACTIONS.SOFT);
    runTicks(g, 10);                    // 166 ms at 50 ms/row
    const fell = g.active.y - y0;
    assert.equal(fell, 3);
    assert.equal(g.score, 3);
    assert.equal(events(g, 'softdrop').reduce((n, e) => n + e.rows, 0), fell);
});

test('soft drop does not cash in gravity banked at the slow rate', () => {
    // The accumulator has been filling against a one-second interval; pressing
    // soft drop must not release all of it at 50 ms a row.
    const g = scenario(null, { type: 'O', x: 4, y: 18 }, { settings: { sdf: 20 } });
    runTicks(g, 55);                    // ~917 ms of level-1 gravity, no row yet
    assert.equal(g.active.y, 18);
    press(g, ACTIONS.SOFT);
    update(g, TICK_MS);
    assert.equal(g.active.y, 19, 'one row, not eighteen');
});

test('hard drop teleports to the ghost, pays two a row and locks at once', () => {
    const g = createGame({ seed: 42 });
    const rows = g.ghostY - g.active.y;
    press(g, ACTIONS.HARD);
    assert.equal(g.score, 2 * rows);
    assert.equal(g.stats.pieces, 1);
    assert.equal(events(g, 'harddrop')[0].rows, rows);
    assert.equal(events(g, 'lock').length, 1, 'no lock delay was consulted');
    assert.equal(g.active.type, 'O', 'and the next piece is already in');
});

// ---------------------------------------------------------------------------
// lock delay — Extended Placement  (§2.7), one test per rule
// ---------------------------------------------------------------------------

const LOCK_TICKS = Math.ceil(LOCK_DELAY_MS / TICK_MS);   // 30

test('a piece resting on a surface locks after 500 ms', () => {
    const g = scenario(null, { type: 'O', x: 4, y: 38 });
    runTicks(g, LOCK_TICKS - 1);
    assert.equal(g.stats.pieces, 0, 'still placeable');
    runTicks(g, 2);
    assert.equal(g.stats.pieces, 1);
});

test('a successful move or rotation resets the timer', () => {
    const g = scenario(null, { type: 'O', x: 4, y: 38 });
    runTicks(g, 20);
    assert.ok(g.lockMs > 0);
    tap(g, ACTIONS.LEFT);
    assert.equal(g.lockMs, 0);
    assert.equal(g.lockResets, 1);
    runTicks(g, 20);                    // 40 ticks in total — past 500 ms without the reset
    assert.equal(g.stats.pieces, 0);
    tap(g, ACTIONS.CW);                 // an O rotation succeeds in place, and counts
    assert.equal(g.lockResets, 2);
    assert.equal(g.lockMs, 0);
    runTicks(g, LOCK_TICKS + 1);
    assert.equal(g.stats.pieces, 1);
});

test('the reset budget is fifteen, and after that the timer runs out anyway', () => {
    const g = scenario(null, { type: 'O', x: 4, y: 38 });
    for (let i = 0; i < MAX_LOCK_RESETS; i++) { tap(g, ACTIONS.CW); runTicks(g, 1); }
    assert.equal(g.lockResets, MAX_LOCK_RESETS);
    assert.equal(g.stats.pieces, 0);

    // Spent. The move still HAPPENS — it just stops refreshing the timer.
    const before = g.lockMs;
    const x = g.active.x;
    tap(g, ACTIONS.LEFT);
    assert.equal(g.active.x, x - 1, 'the move still works');
    assert.equal(g.lockMs, before, 'it simply no longer buys time');

    let ticks = 0;
    while (g.stats.pieces === 0 && ticks < 200) { tap(g, ACTIONS.CW); runTicks(g, 1); ticks++; }
    assert.equal(g.stats.pieces, 1, 'it locked despite constant input');
    assert.ok(ticks <= LOCK_TICKS + 1, 'and on schedule: ' + ticks + ' ticks');
});

test('falling to a new lowest row restores the whole budget', () => {
    // A ledge over the left half: the piece rests on it, spends resets, then
    // walks off the edge and falls.
    const g = scenario(['#####.....'], { type: 'O', x: 3, y: 37 });
    for (let i = 0; i < 3; i++) tap(g, ACTIONS.CW);
    assert.equal(g.lockResets, 3);

    tap(g, ACTIONS.RIGHT);              // still on the ledge: spends a fourth
    assert.equal(g.lockResets, 4);
    tap(g, ACTIONS.RIGHT);              // off the edge: airborne, so nothing is spent
    assert.equal(g.lockResets, 4, 'the budget survives being airborne');

    let n = 0;
    while (g.active && g.active.y < 38 && n < 300) { runTicks(g, 1); n++; }
    assert.equal(g.active.y, 38, 'it fell to a new lowest row');
    assert.equal(g.lockResets, 0, 'and got the full fifteen back');
});

test('hard drop bypasses lock delay entirely', () => {
    const g = scenario(null, { type: 'O', x: 4, y: 18 });
    press(g, ACTIONS.HARD);
    assert.equal(g.stats.pieces, 1, 'locked in the same call, no ticks elapsed');
    assert.equal(g.tick, 0);
});

test('the lockdown setting picks how generous Extended Placement is', () => {
    const classic = scenario(null, { type: 'O', x: 4, y: 38 }, { settings: { lockdown: 'classic' } });
    for (let i = 0; i < LOCK_TICKS + 1; i++) { tap(classic, ACTIONS.CW); runTicks(classic, 1); }
    assert.equal(classic.stats.pieces, 1, 'classic buys no time with a move');
    assert.equal(classic.lockResets, 0);

    const forever = scenario(null, { type: 'O', x: 4, y: 38 }, { settings: { lockdown: 'infinite' } });
    for (let i = 0; i < LOCK_TICKS * 3; i++) { tap(forever, ACTIONS.CW); runTicks(forever, 1); }
    assert.equal(forever.stats.pieces, 0, 'infinite never runs out');
    assert.ok(forever.lockResets > MAX_LOCK_RESETS);
});

test('the settings defaults are the ones the contract names', () => {
    assert.deepEqual(createGame({ seed: 1 }).settings,
        { das: 167, arr: 33, sdf: 20, ghost: true, lockdown: 'extended' });
    // Nonsense is replaced rather than propagated into the timers.
    const odd = createGame({ seed: 1, settings: { das: 'x', arr: -5, sdf: Infinity, lockdown: 'nope' } });
    assert.equal(odd.settings.das, 167);
    assert.equal(odd.settings.arr, 0);
    assert.equal(odd.settings.lockdown, 'extended');
    assert.ok(Number.isFinite(odd.settings.sdf),
        'an "instant" soft drop is a finite number: a snapshot has to survive JSON');
});

// ---------------------------------------------------------------------------
// T-spins  (§2.9) — the caller's half of the 3-corner rule
// ---------------------------------------------------------------------------

// A T-slot at columns 3..5: the overhang on the left is what makes the twist
// necessary, and it is the third occupied corner.
const T_SLOT = [
    '####..####',   // row 37
    '###...####',   // row 38
    '####.#####',   // row 39
];

test('a T rotated into the slot scores a T-spin double', () => {
    const g = scenario(T_SLOT, { type: 'T', rot: 3, x: 4, y: 36 });
    press(g, ACTIONS.CCW);
    assert.equal(g.active.rot, 2);
    assert.deepEqual([g.active.x, g.active.y], [3, 37], 'kicked down into the slot');
    assert.equal(g.lastKickIndex, 2);

    press(g, ACTIONS.HARD);
    assert.equal(events(g, 'lock')[0].tspin, 'full', 'tspin rides the lock event');
    const clear = events(g, 'clear')[0];
    assert.equal(clear.count, 2);
    assert.equal(clear.label, 'T-SPIN DOUBLE');
    assert.equal(g.score, 1200);
    assert.equal(g.stats.tspins, 1);
    assert.equal(g.b2b, true);
});

test('a move that FAILS does not cancel the spin claim', () => {
    // Only a successful maneuver changes what the last one was; a shift into a
    // wall is not a maneuver.
    const g = scenario(T_SLOT, { type: 'T', rot: 3, x: 4, y: 36 });
    press(g, ACTIONS.CCW);
    const x = g.active.x;
    tap(g, ACTIONS.LEFT);
    assert.equal(g.active.x, x, 'the slot has no room to the left');
    assert.equal(g.lastKickIndex, 2, 'so the rotation is still the last thing that worked');
    press(g, ACTIONS.HARD);
    assert.equal(events(g, 'lock')[0].tspin, 'full');
});

test('the same two rows, arrived at without a rotation, are a plain double', () => {
    const g = scenario(T_SLOT, { type: 'T', rot: 2, x: 3, y: 37 });
    press(g, ACTIONS.HARD);
    assert.equal(events(g, 'lock')[0].tspin, 'none');
    assert.equal(events(g, 'clear')[0].label, 'DOUBLE');
    assert.equal(g.score, 300);
    assert.equal(g.stats.tspins, 0);
});

// ---------------------------------------------------------------------------
// scoring integration  (§2.9)
// ---------------------------------------------------------------------------

test('the combo counter is the caller\'s: the first clear of a chain adds nothing', () => {
    const g = scenario(['####..####', '####..####', '####..####'], { type: 'O', x: 4, y: 38 });
    press(g, ACTIONS.HARD);
    assert.equal(g.combo, 1);
    assert.equal(g.score, 300, 'a double, with no combo bonus on the first clear');

    release(g, ACTIONS.HARD);
    setPiece(g, { type: 'O', x: 4, y: 38 });
    press(g, ACTIONS.HARD);
    assert.equal(g.combo, 2);
    assert.equal(g.score, 300 + 100 + 50, 'single + 50 x one prior clear x level 1');
    assert.equal(g.stats.maxCombo, 2);
    assert.equal(events(g, 'clear').pop().combo, 2);

    release(g, ACTIONS.HARD);
    setPiece(g, { type: 'O', x: 0, y: 38 });
    press(g, ACTIONS.HARD);
    assert.equal(g.combo, 0, 'a lock that clears nothing ends the chain');
});

test('back-to-back is kept across locks and multiplies the second quad', () => {
    const rows = ['#.........'].concat(new Array(8).fill('#########.'));
    const g = scenario(rows, { type: 'I', rot: 1, x: 7, y: 36 });
    press(g, ACTIONS.HARD);
    assert.equal(g.score, 800);
    assert.equal(g.b2b, true);
    assert.equal(g.stats.quads, 1);

    release(g, ACTIONS.HARD);
    setPiece(g, { type: 'I', rot: 1, x: 7, y: 36 });
    press(g, ACTIONS.HARD);
    const clear = events(g, 'clear').pop();
    assert.equal(clear.label, 'B2B QUAD');
    assert.equal(clear.b2b, true);
    assert.equal(g.score, 800 + 1200 + 50, 'quad x1.5, plus one combo step');
    assert.equal(g.lines, 8);
});

test('a perfect clear is detected on the board AFTER the rows are gone', () => {
    const g = scenario(new Array(4).fill('#########.'), { type: 'I', rot: 1, x: 7, y: 36 });
    press(g, ACTIONS.HARD);
    assert.ok(isEmpty(g.board));
    const clear = events(g, 'clear')[0];
    assert.equal(clear.perfectClear, true);
    assert.equal(clear.label, 'QUAD PERFECT CLEAR');
    assert.equal(g.score, 800 + 2000);
    assert.equal(g.stats.perfectClears, 1);
});

test('ten lines is a level, and the level-up is announced once', () => {
    const g = scenario(['####..####'], { type: 'O', x: 4, y: 38 });
    g.lines = 9;
    press(g, ACTIONS.HARD);
    assert.equal(g.lines, 10);
    assert.equal(g.level, 2);
    assert.deepEqual(events(g, 'levelup'), [{ type: 'levelup', level: 2 }]);
});

// ---------------------------------------------------------------------------
// hold  (§2.5)
// ---------------------------------------------------------------------------

test('hold swaps once per piece and re-arms on the lock, not on the hold', () => {
    const g = createGame({ seed: 42 });        // opening: S O I J L T Z ...
    press(g, ACTIONS.HOLD);
    assert.equal(g.hold, 'S');
    assert.equal(g.active.type, 'O', 'an empty hold pulls the next piece');
    assert.equal(g.holdUsed, true);
    assert.equal(g.stats.holds, 1);
    assert.equal(events(g, 'hold').length, 1);

    release(g, ACTIONS.HOLD);
    press(g, ACTIONS.HOLD);
    assert.equal(g.hold, 'S', 'a second hold on the same piece does nothing');
    assert.equal(g.active.type, 'O');
    assert.equal(g.stats.holds, 1);

    release(g, ACTIONS.HOLD);
    press(g, ACTIONS.HARD);
    assert.equal(g.holdUsed, false, 'the lock re-arms it');
});

test('a held piece re-enters at spawn orientation and position, and costs no preview', () => {
    const g = createGame({ seed: 42 });
    tap(g, ACTIONS.HOLD);                      // hold S, take O
    press(g, ACTIONS.HARD);                    // lock O, take I
    release(g, ACTIONS.HARD);
    tap(g, ACTIONS.CW);
    tap(g, ACTIONS.LEFT);
    const queue = g.queue.slice();

    press(g, ACTIONS.HOLD);
    assert.equal(g.hold, 'I');
    assert.deepEqual(g.active, spawnPiece('S'), 'spawn orientation, spawn position');
    assert.deepEqual(g.queue, queue, 'a swap draws nothing from the bag');
    assert.equal(g.lastKickIndex, -1, 'and arrives with no spin claim');
});

test('holding into a piece that cannot spawn is a Block Out like any other', () => {
    const g = createGame({ seed: 42 });
    for (let x = 0; x < COLS; x++) {
        g.board[idx(x, 18)] = GARBAGE_ID;
        g.board[idx(x, 19)] = GARBAGE_ID;
    }
    g.hold = 'O';
    g.holdUsed = false;
    press(g, ACTIONS.HOLD);
    assert.equal(g.phase, 'over');
    assert.equal(g.topOutReason, 'block');
});

// ---------------------------------------------------------------------------
// top-out  (§2.10), and the way Zen refuses it  (§3)
// ---------------------------------------------------------------------------

// A well filled to the skyline. Column 9 is left open everywhere so nothing
// clears and the stack stays where the fixture put it.
const TO_THE_CEILING = new Array(20).fill('#########.');

// The same, with the mouth of the well at rows 19-20: a piece locking here
// reaches the visible field (so it is not a Lock Out) but seals the spawn.
const SEALED_SPAWN = ['...#..#...', '####..###.'].concat(new Array(19).fill('#########.'));

test('Block Out: a piece that cannot spawn ends the run', () => {
    const g = scenario(null, null);
    g.board = fromStrings(SEALED_SPAWN, { fromRow: 19 });
    setPiece(g, { type: 'O', x: 4, y: 19 });
    press(g, ACTIONS.HARD);
    assert.equal(g.phase, 'over');
    assert.equal(g.topOutReason, 'block');
    assert.equal(g.active, null);
    assert.deepEqual(events(g, 'topout'), [{ type: 'topout', reason: 'block' }]);
});

test('Lock Out: a piece that locks entirely above the field ends the run', () => {
    const g = scenario(TO_THE_CEILING, { type: 'O', x: 4, y: 18 });
    press(g, ACTIONS.HARD);
    assert.equal(g.phase, 'over');
    assert.equal(g.topOutReason, 'lock');
    assert.deepEqual(events(g, 'topout'), [{ type: 'topout', reason: 'lock' }]);
});

test('Zen sinks the well instead of topping out on a Lock Out', () => {
    const g = scenario(TO_THE_CEILING, { type: 'O', x: 4, y: 18 }, { mode: 'zen' });
    press(g, ACTIONS.HARD);
    assert.equal(g.phase, 'playing');
    assert.equal(g.topOutReason, null);
    assert.equal(events(g, 'topout').length, 0);
    assert.ok(highestRow(g.board) >= HIDDEN_ROWS, 'the stack fits in the visible well again');
    assert.ok(g.active, 'and play carries on');
});

test('Zen sinks the well instead of topping out on a Block Out', () => {
    const g = scenario(null, null, { mode: 'zen' });
    g.board = fromStrings(SEALED_SPAWN, { fromRow: 19 });
    setPiece(g, { type: 'O', x: 4, y: 19 });
    const before = highestRow(g.board);
    press(g, ACTIONS.HARD);
    assert.equal(g.phase, 'playing');
    assert.ok(g.active, 'the piece that could not spawn now can');
    assert.ok(highestRow(g.board) > before, 'because the stack came down');
});

// ---------------------------------------------------------------------------
// modes  (§3)
// ---------------------------------------------------------------------------

test('Sprint: the line goal wins the run', () => {
    const g = scenario(['####..####'], { type: 'O', x: 4, y: 38 }, { mode: 'sprint', goalLines: 1 });
    press(g, ACTIONS.HARD);
    assert.equal(g.phase, 'won');
    assert.equal(g.lines, 1);
    assert.deepEqual(events(g, 'goal'), [{ type: 'goal' }]);
    const tick = g.tick;
    update(g, 1000);
    assert.equal(g.tick, tick, 'a won run does not keep simulating');
});

test('Ultra: the clock wins the run', () => {
    const g = createGame({ seed: 42, mode: 'ultra', timeLimitMs: 200 });
    runTicks(g, 11);
    assert.equal(g.phase, 'playing');
    runTicks(g, 2);
    assert.equal(g.phase, 'won');
    assert.ok(g.elapsedMs >= 200);
    assert.deepEqual(events(g, 'goal'), [{ type: 'goal' }]);
});

test('Daily Well: one seed gives the same debris AND the same bag to everyone', () => {
    const a = createGame({ seed: 2024, mode: 'daily', garbageRows: 8 });
    const b = createGame({ seed: 2024, mode: 'daily', garbageRows: 8 });
    assert.deepEqual(Array.from(a.board), Array.from(b.board));
    assert.deepEqual([a.active.type].concat(a.queue), [b.active.type].concat(b.queue));

    // The debris comes off a stream DERIVED from the seed rather than off the
    // bag's, so asking for more or fewer rows cannot shift the piece stream.
    const clean = createGame({ seed: 2024, garbageRows: 0 });
    const shallow = createGame({ seed: 2024, garbageRows: 3 });
    assert.deepEqual([a.active.type].concat(a.queue), [clean.active.type].concat(clean.queue));
    assert.deepEqual([a.active.type].concat(a.queue), [shallow.active.type].concat(shallow.queue));

    const tomorrow = createGame({ seed: 2025, mode: 'daily', garbageRows: 8 });
    assert.notDeepEqual(Array.from(a.board), Array.from(tomorrow.board));
});

// Eight rows of stacked pieces with their gap in column 9, over two rows of
// debris with THEIRS in column 0. The two columns are the whole point: they
// make "eight lines cleared" and "the debris is gone" different events, which
// is what a line count cannot tell apart.
const DIG_WELL = new Array(8).fill('OOOOOOOOO.').concat(['.GGGGGGGGG', '.GGGGGGGGG']);

// A vertical I hard-dropped down one column. x is the box origin, so the bar
// itself lands in column x + 2.
function dropVertical(g, x) {
    release(g, ACTIONS.HARD);
    setPiece(g, { type: 'I', rot: 1, x: x, y: 18 });
    press(g, ACTIONS.HARD);
}

// garbageRows is 8 so the run is not won before the fixture board is laid
// down; the board is then replaced wholesale by the fixture.
const digGame = (opts) => scenario(DIG_WELL, null, Object.assign(
    { mode: 'daily', goal: 'garbage', garbageRows: 8 }, opts));

test('Daily Well: the dig is won when the last debris cell goes, not before', () => {
    const g = digGame({ timeLimitMs: 600000 });
    assert.equal(g.phase, 'playing');

    dropVertical(g, 7);
    assert.equal(g.lines, 4);
    assert.equal(g.phase, 'playing');

    dropVertical(g, 7);
    assert.equal(g.lines, 8, 'eight lines cleared...');
    assert.equal(g.phase, 'playing', '...and the well is still dirty');
    assert.equal(events(g, 'goal').length, 0);

    dropVertical(g, -2);        // down the debris' own column, at last
    assert.equal(g.lines, 10);
    assert.equal(g.phase, 'won');
    assert.deepEqual(events(g, 'goal'), [{ type: 'goal' }]);
    assert.ok(!Array.from(g.board).includes(GARBAGE_ID), 'the well is clean');
});

test('...which is the thing a line count gets wrong', () => {
    // The same well, won on lines instead: this is the bug goal:'garbage'
    // exists to close, pinned so it cannot come back as an approximation.
    const g = digGame({ goal: null, goalLines: 8 });
    dropVertical(g, 7);
    dropVertical(g, 7);
    assert.equal(g.phase, 'won', 'a line goal fires here');
    assert.ok(Array.from(g.board).includes(GARBAGE_ID),
        'with the debris still sitting at the bottom of the well');
});

test('a dig with nothing to dig is won on the spot', () => {
    const g = createGame({ seed: 1, mode: 'daily', goal: 'garbage', garbageRows: 0 });
    assert.equal(g.phase, 'won');
    assert.deepEqual(g.events, [{ type: 'goal' }]);

    const real = createGame({ seed: 1, mode: 'daily', goal: 'garbage', garbageRows: 8 });
    assert.equal(real.phase, 'playing');
    assert.equal(real.events.length, 0);

    // An unrecognised goal is dropped rather than kept: a typo must not make a
    // run that quietly never ends.
    assert.equal(createGame({ seed: 1, goal: 'gargage' }).goal, null);
    assert.equal(createGame({ seed: 1 }).goal, null);
});

test('a dig under a clock ends whichever way comes first', () => {
    const g = digGame({ timeLimitMs: 200 });
    runTicks(g, 13);
    assert.equal(g.phase, 'won', 'the clock can end an unfinished dig');
    assert.ok(Array.from(g.board).includes(GARBAGE_ID));
    assert.deepEqual(events(g, 'goal'), [{ type: 'goal' }], 'and only one goal is announced');
});

test('the debris is diggable: one hole a row, never twice in the same column', () => {
    const g = createGame({ seed: 7, garbageRows: 8 });
    assert.equal(highestRow(g.board), ROWS - 8);
    const holes = [];
    for (let y = ROWS - 1; y >= ROWS - 8; y--) {   // bottom up, the order it was built in
        const empty = [];
        for (let x = 0; x < COLS; x++) {
            const v = g.board[idx(x, y)];
            if (v === 0) empty.push(x);
            else assert.equal(v, GARBAGE_ID);
        }
        assert.equal(empty.length, 1, 'row ' + y + ' must have exactly one hole');
        holes.push(empty[0]);
    }
    for (let i = 1; i < holes.length; i++) {
        assert.notEqual(holes[i], holes[i - 1], 'a repeated hole is a free chimney');
    }
});

// ---------------------------------------------------------------------------
// the fixed timestep  (§2.11)
// ---------------------------------------------------------------------------

test('update banks the remainder and runs only whole ticks', () => {
    const g = createGame({ seed: 42 });
    update(g, 10);
    assert.equal(g.tick, 0);
    update(g, 10);
    assert.equal(g.tick, 1, '20 ms is one tick with 3.3 ms left over');
    update(g, TICK_MS * 3);
    assert.equal(g.tick, 4);
});

test('a tab returning after thirty seconds resumes instead of spinning', () => {
    const g = createGame({ seed: 42 });
    update(g, 30000);
    assert.equal(g.tick, 12, 'clamped to MAX_STEPS_PER_UPDATE');
    update(g, TICK_MS);
    assert.equal(g.tick, 13, 'and the dropped time is not banked into the next call');
    assert.equal(g.phase, 'playing');
});

test('a paused run neither ticks nor banks the time it was paused for', () => {
    const g = createGame({ seed: 42 });
    g.phase = 'paused';
    update(g, 5000);
    assert.equal(g.tick, 0);
    g.phase = 'playing';
    update(g, TICK_MS);
    assert.equal(g.tick, 1);
});

// ---------------------------------------------------------------------------
// determinism  (§2.11) — the property the whole design is for
// ---------------------------------------------------------------------------

const ACTION_NAMES = ['LEFT', 'RIGHT', 'CW', 'CCW', 'SOFT', 'HARD', 'HOLD'];

// A scripted input log: [tick, action, 'press'|'release'].
function inputLog(seed, count) {
    const rng = makeRng(seed);
    const log = [];
    let t = 0;
    for (let i = 0; i < count; i++) {
        t += rng.int(1, 9);
        const action = ACTION_NAMES[rng.int(0, ACTION_NAMES.length - 1)];
        log.push([t, action, 'press']);
        log.push([t + rng.int(1, 12), action, 'release']);
    }
    return log;
}

function playLog(g, log, ticks) {
    const byTick = new Map();
    for (const entry of log) {
        if (!byTick.has(entry[0])) byTick.set(entry[0], []);
        byTick.get(entry[0]).push(entry);
    }
    for (let t = 0; t < ticks; t++) {
        const due = byTick.get(t);
        if (due) for (const [, action, kind] of due) {
            (kind === 'press' ? press : release)(g, ACTIONS[action]);
        }
        update(g, TICK_MS);
        g.events.length = 0;        // the app owns the drain (ARCHITECTURE.md)
    }
    return g;
}

const hash = (g) => hashU32(JSON.stringify(serialize(g)));

test('a seed plus an input log determines the run exactly', () => {
    const log = inputLog(99, 300);
    const a = playLog(createGame({ seed: 7 }), log, 1500);
    const b = playLog(createGame({ seed: 7 }), log, 1500);
    assert.equal(hash(a), hash(b));
    assert.equal(a.tick, b.tick);
    // Random input stacks badly and tops out, which is itself part of what has
    // to agree: the two runs end for the same reason on the same tick.
    assert.ok(a.stats.pieces >= 15, 'the log played a real game: ' + a.stats.pieces + ' pieces');
    assert.equal(a.phase, 'over');
    assert.equal(a.topOutReason, b.topOutReason);

    // ...and the test can fail: a different seed must not agree with it.
    const c = playLog(createGame({ seed: 8 }), log, 1500);
    assert.notEqual(hash(a), hash(c));
});

test('the same holds for a long Zen run, which never stops to top out', () => {
    // Zen keeps playing, so this trace is ten times the pieces and puts the
    // stack-sinking path under the same determinism requirement.
    const log = inputLog(1234, 700);
    const a = playLog(createGame({ seed: 11, mode: 'zen' }), log, 3000);
    const b = playLog(createGame({ seed: 11, mode: 'zen' }), log, 3000);
    assert.equal(a.phase, 'playing');
    assert.ok(a.stats.pieces > 60, a.stats.pieces + ' pieces');
    assert.equal(hash(a), hash(b));
    assert.notEqual(hash(a), hash(playLog(createGame({ seed: 12, mode: 'zen' }), log, 3000)));
});

test('reset replays the same seed from the top', () => {
    const g = createGame({ seed: 42, garbageRows: 4 });
    const board = g.board;
    const bus = g.events;
    const debris = Array.from(g.board);
    playLog(g, inputLog(3, 60), 400);
    assert.ok(g.stats.pieces > 0);

    reset(g);
    assert.equal(g.tick, 0);
    assert.equal(g.score, 0);
    assert.equal(g.lines, 0);
    assert.equal(g.stats.pieces, 0);
    assert.equal(g.active.type, 'S');
    assert.deepEqual(g.queue, ['O', 'I', 'J', 'L', 'T']);
    assert.deepEqual(Array.from(g.board), debris, 'the same well, dug fresh');
    assert.equal(g.board, board, 'the board array keeps its identity for the renderer');
    assert.equal(g.events, bus, 'and so does the event bus');
});
