/* celebration.test.js — the pinned level, and the two chains the celebration
 * is cut from.
 *
 * The rules here are about a SITUATION (a well one row short of four, a chain
 * already three deep), so the situation is built directly rather than played
 * into: a test that has to stack forty pieces to reach its assertion is
 * testing the script.
 *
 * Nothing below reaches past js/core/. What a quad streak SOUNDS like belongs
 * to js/soundpack.js and what it LOOKS like to js/render/fx.js; what it
 * COUNTS is core's, and it is the only half that can be pinned under
 * `node --test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ACTIONS, TICK_MS, COLS, ROWS, GARBAGE_ID } from '../js/core/constants.js';
import { fromStrings, collides } from '../js/core/board.js';
import { absoluteCells } from '../js/core/piece.js';
import { fallIntervalMs, levelFor } from '../js/core/gravity.js';
import {
    createGame, press, release, update, serialize, deserialize, MAX_PIN_LEVEL,
} from '../js/core/game.js';

const tap = (g, action) => { press(g, action); release(g, action); };
const events = (g, type) => g.events.filter((e) => e.type === type);
const clears = (g) => events(g, 'clear');

/* The stack: `n` rows complete but for column 9, with ONE stray block left on
 * a row above them.
 *
 * THE STRAY IS LOAD-BEARING, and it was a bug in the first draft of this file
 * without it. A well that is exactly n full rows is EMPTY once they clear, so
 * every quad below would have been a perfect clear — 800 + 2000 rather than
 * 800 — and `bestLock` would have been asserted against a Singularity while
 * claiming to be about a quad. The chain counters would have passed either
 * way, which is exactly what makes it worth writing down: the fixture was
 * silently testing a rarer event than the test names.
 */
function stackShortOf(n) {
    return ['..#.......'].concat(new Array(n).fill('#########.'));
}

// The reducer keeps ghostY for its own use and hardDrop reads it, so a
// hand-placed piece needs it set the way a real spawn would have.
function armIPiece(g, n) {
    g.active = { type: 'I', rot: 1, x: 7, y: 2 };   // vertical, over column 9
    g.lastKickIndex = -1;
    g.lowestY = g.active.y;
    let y = g.active.y;
    for (;;) {
        const probe = { type: 'I', rot: 1, x: 7, y: y + 1 };
        if (collides(g.board, absoluteCells(probe))) break;
        y++;
    }
    g.ghostY = y;
    return g;
}

/* A well one I-piece short of `n` complete rows. Hard-dropping clears exactly
 * n rows, which is the only thing any test below actually needs to do. */
function wellShortOf(n, opts) {
    const g = createGame(Object.assign({ seed: 1 }, opts));
    g.board = fromStrings(stackShortOf(n));
    armIPiece(g, n);
    g.events.length = 0;
    return g;
}

/* Clear each of `counts` in turn, rebuilding the stack under the SAME game
 * object between them — so the chain counters, which is the whole point, carry
 * across the way they do in a real run. */
function chain(g, counts) {
    for (const n of counts) {
        g.board = fromStrings(stackShortOf(n));
        armIPiece(g, n);
        tap(g, ACTIONS.HARD);
    }
    return g;
}

// ---------------------------------------------------------------------------
// the pinned level
// ---------------------------------------------------------------------------

test('a pinned run starts at its level instead of climbing to it', () => {
    // Picking the speed you want to play at forever is the mode; making you
    // grind ten levels to reach it would be a different one.
    for (const n of [1, 5, 8, 15, MAX_PIN_LEVEL]) {
        assert.equal(createGame({ seed: 1, pinLevel: n }).level, n, 'level ' + n);
    }
    assert.equal(createGame({ seed: 1 }).level, 1, 'unpinned still starts at 1');
    assert.equal(createGame({ seed: 1 }).pinLevel, null);
});

test('the pin is clamped to the range the curve actually distinguishes', () => {
    // Above MAX_PIN_LEVEL gravity.js has already bottomed out on the 20G floor,
    // so every level up there is the same game at the same speed. Offering
    // forty of them would be offering twenty-one identical choices.
    assert.equal(createGame({ seed: 1, pinLevel: 999 }).pinLevel, MAX_PIN_LEVEL);
    assert.equal(createGame({ seed: 1, pinLevel: 0 }).pinLevel, 1);
    assert.equal(createGame({ seed: 1, pinLevel: -4 }).pinLevel, 1);
    assert.equal(createGame({ seed: 1, pinLevel: 7.8 }).pinLevel, 7);
    // And the clamp really is where the curve stops moving.
    assert.equal(fallIntervalMs(MAX_PIN_LEVEL), fallIntervalMs(MAX_PIN_LEVEL + 40));
    for (const bad of [null, undefined, NaN, 'eight', {}]) {
        assert.equal(createGame({ seed: 1, pinLevel: bad }).pinLevel, null, String(bad));
    }
});

test('a pinned run never levels up, however many lines it clears', () => {
    const g = wellShortOf(1, { pinLevel: 6 });
    chain(g, new Array(24).fill(1));       // 24 lines: level 3 on the curve
    assert.equal(g.lines, 24);
    assert.equal(levelFor(g.lines), 3, 'the curve would have said 3');
    assert.equal(g.level, 6, 'the pin holds');
    assert.deepEqual(events(g, 'levelup'), [], 'and says nothing about it');
});

test('an unpinned run still climbs, and still emits the cue', () => {
    // The guard is `pinLevel == null`, so this is the half that proves the new
    // branch did not swallow the old behaviour.
    const g = wellShortOf(1);
    chain(g, new Array(10).fill(1));
    assert.equal(g.lines, 10);
    assert.equal(g.level, 2);
    assert.deepEqual(events(g, 'levelup').map((e) => e.level), [2]);
});

test('the pin governs the score multiplier, not just gravity', () => {
    // §2.9 awards table x level. A pinned level-9 run scores like a level-9
    // run from its first line, which is the honest reading of "pin the level"
    // — and the reason a pinned board cannot share a ranking with Arcade.
    const pinned = wellShortOf(1, { pinLevel: 9 });
    tap(pinned, ACTIONS.HARD);
    assert.equal(pinned.level, 9);
    assert.equal(clears(pinned)[0].points, 100 * 9);

    const plain = wellShortOf(1);
    tap(plain, ACTIONS.HARD);
    assert.equal(clears(plain)[0].points, 100 * 1);
});

test('a pinned run survives the snapshot it is resumed from', () => {
    // pinLevel is in PLAIN_KEYS, so a resumed Marathon comes back pinned. A
    // snapshot that lost it would resume as Arcade wearing Marathon's name and
    // file its score to the pinned board.
    const g = wellShortOf(1, { pinLevel: 12 });
    update(g, TICK_MS * 5);
    const back = deserialize(serialize(g));
    assert.equal(back.pinLevel, 12);
    assert.equal(back.level, 12);
});

// ---------------------------------------------------------------------------
// the two chains
// ---------------------------------------------------------------------------

test('the quad streak counts consecutive quads and nothing else', () => {
    const g = wellShortOf(4);
    chain(g, [4, 4, 4]);
    assert.deepEqual(clears(g).map((e) => e.quadStreak), [1, 2, 3]);
    assert.equal(g.stats.maxQuadStreak, 3);
    assert.equal(g.stats.quads, 3);
});

test('a non-quad clear ends the quad streak but the peak is kept', () => {
    const g = wellShortOf(4);
    chain(g, [4, 4, 2, 4]);
    assert.deepEqual(clears(g).map((e) => e.quadStreak), [1, 2, 0, 1]);
    assert.equal(g.stats.maxQuadStreak, 2, 'the peak survives the break');
});

test('the back-to-back chain and the quad streak break differently', () => {
    /* This is why they are two counters and not one. A T-spin double extends
     * the b2b chain — it is a chaining clear — and ends the quad streak, which
     * is specifically about quads. A single ends both. */
    const g = wellShortOf(4);
    chain(g, [4, 4]);
    assert.deepEqual(clears(g).map((e) => [e.b2bChain, e.quadStreak]), [[1, 1], [2, 2]]);

    chain(g, [1]);                          // a plain single cuts both
    const cut = clears(g)[2];
    assert.deepEqual([cut.b2bChain, cut.quadStreak], [0, 0]);
    assert.equal(g.stats.maxB2b, 2);
    assert.equal(g.stats.maxQuadStreak, 2);
});

test('a lock that clears nothing breaks neither chain', () => {
    // The B2B flag survives a quiet lock (§2.9) and so must the chain that
    // counts it — otherwise every piece placed between two quads would reset a
    // streak the player never lost.
    const g = wellShortOf(4);
    chain(g, [4]);
    assert.equal(g.b2bChain, 1);
    assert.equal(g.quadStreak, 1);

    g.board = fromStrings(['..........']);   // nothing to clear
    armIPiece(g, 0);                         // …and an I with nowhere to complete a row
    tap(g, ACTIONS.HARD);
    assert.equal(g.b2bChain, 1, 'the chain is not broken by a quiet lock');
    assert.equal(g.quadStreak, 1);
});

test('bestLock is the biggest single award, and ignores drop points', () => {
    /* Drop points are a function of how far the piece fell, not of what the
     * player built — a 20-row hard drop is 40 points and would out-rank a
     * T-spin on a shallow well. */
    const g = wellShortOf(4);
    tap(g, ACTIONS.HARD);
    const e = clears(g)[0];
    assert.equal(e.perfectClear, false, 'the fixture leaves a stray block — see stackShortOf');
    assert.equal(e.points, 800, 'a plain quad at level 1');
    assert.equal(g.stats.bestLock, 800);
    assert.ok(g.score > 800, 'the run scored the drop as well');

    chain(g, [1]);                          // a smaller award does not replace it
    assert.equal(g.stats.bestLock, 800);
});

test('the chains are carried by the snapshot, mid-chain', () => {
    // A run evicted between the second and third quad has to come back holding
    // the streak, or resuming quietly costs the player their escalation.
    const g = wellShortOf(4);
    chain(g, [4, 4]);
    const back = deserialize(serialize(g));
    assert.equal(back.b2bChain, 2);
    assert.equal(back.quadStreak, 2);
    assert.equal(back.stats.maxQuadStreak, 2);

    chain(back, [4]);
    assert.equal(clears(back).at(-1).quadStreak, 3, 'the resumed run continues it');
});

test('every clear event carries what the celebration reads', () => {
    // The three layers that escalate — banner, FX and audio — all read these
    // off the event and none of them recompute anything. A field dropped here
    // is three silent regressions.
    const g = wellShortOf(4);
    tap(g, ACTIONS.HARD);
    const e = clears(g)[0];
    for (const k of ['count', 'label', 'points', 'b2b', 'combo', 'perfectClear',
        'b2bChain', 'quadStreak']) {
        assert.notEqual(e[k], undefined, 'clear event carries ' + k);
    }
});

test('an emptied well is still a Singularity, and outscores the quad alone', () => {
    // The inverse of the fixture note above: with nothing left behind, the same
    // quad is worth 800 + 2000. Pinned here so the stray block in stackShortOf
    // can never be quietly dropped without a test noticing.
    const g = createGame({ seed: 1 });
    g.board = fromStrings(new Array(4).fill('#########.'));
    armIPiece(g, 4);
    g.events.length = 0;
    tap(g, ACTIONS.HARD);
    const e = clears(g)[0];
    assert.equal(e.perfectClear, true);
    assert.equal(e.points, 800 + 2000);
    assert.ok(e.label.includes('PERFECT CLEAR'));
});

test('release() is still symmetric after a hard drop into a new run', () => {
    // Guards the fixture above as much as the reducer: chain() taps HARD over
    // and over on one game object, and a press left held would make every
    // assertion after the first one meaningless.
    const g = wellShortOf(1);
    chain(g, [1, 1, 1]);
    assert.equal(g.held[ACTIONS.HARD], false);
    release(g, ACTIONS.HARD);
    assert.equal(g.held[ACTIONS.HARD], false);
});

// ---------------------------------------------------------------------------
// the board revision — the Zen sink's only signal
// ---------------------------------------------------------------------------

test('every structural change to the board bumps boardRev', () => {
    /* Three consumers watch this counter instead of enumerating the events
     * that ought to accompany a board change: the renderer's cached stack
     * bitmap, the shell's danger vignette and eviction snapshot, and the audio
     * bed's depth band. A mutation that forgets to bump it is stale pixels. */
    const g = wellShortOf(4);
    const seen = [g.boardRev];
    const bump = (label) => {
        assert.ok(g.boardRev > seen[seen.length - 1], label + ' must bump boardRev');
        seen.push(g.boardRev);
    };

    tap(g, ACTIONS.HARD);          // a lock AND a clear
    bump('locking and clearing');

    g.board = fromStrings(['..........']);
    armIPiece(g, 0);
    tap(g, ACTIONS.HARD);          // a lock with no clear
    bump('a lock that clears nothing');

    const dig = createGame({ seed: 3, mode: 'daily', goal: 'garbage', garbageRows: 4 });
    assert.ok(dig.boardRev > 0, 'seeded debris bumps it');
});

test('Zen: a hold that sinks the stack is visible to the shell', () => {
    /* THE BUG THIS PINS. In Zen, a hold whose incoming piece cannot fit at
     * spawn sinks the stack — and emits nothing but 'hold', because the event
     * vocabulary is frozen and the sink is not in it. The renderer keyed its
     * bitmap on `lines:pieces` and the shell keyed the danger vignette on
     * lock/clear/topout, so both held still while the well dropped rows away:
     * the stack was drawn above where it actually was until the next lock.
     *
     * Reproduced the way it happens: row 18 full and row 19 open only at
     * columns 3..6, so an I fits at spawn and nothing else does. */
    let z = null;
    for (let seed = 0; seed < 400; seed++) {
        const cand = createGame({ seed, mode: 'zen' });
        if (cand.active.type !== 'I' || cand.queue[0] === 'I') continue;
        z = cand;
        break;
    }
    assert.ok(z, 'need a seed spawning an I with a non-I next');

    for (let x = 0; x < COLS; x++) z.board[18 * COLS + x] = GARBAGE_ID;
    for (let x = 0; x < COLS; x++) if (x < 3 || x > 6) z.board[19 * COLS + x] = GARBAGE_ID;
    for (let y = 20; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) z.board[y * COLS + x] = GARBAGE_ID;
    }
    const revBefore = z.boardRev;
    const before = z.board.slice();
    const pieces = z.stats.pieces;
    const lines = z.lines;
    z.events.length = 0;

    tap(z, ACTIONS.HOLD);

    assert.ok(!before.every((v, i) => v === z.board[i]), 'the well really did sink');
    assert.deepEqual(z.events.map((e) => e.type), ['hold'], 'and said nothing about it');
    assert.equal(z.stats.pieces, pieces, 'no lock, so the old key held still…');
    assert.equal(z.lines, lines, '…on both halves');
    assert.ok(z.boardRev > revBefore, 'but the revision moved, which is the signal');
    assert.equal(z.phase, 'playing', 'and Zen carries on, as Zen does');
});

// ---------------------------------------------------------------------------
// deserialize is as paranoid as createGame
// ---------------------------------------------------------------------------

test('a snapshot cannot restore settings the constructor would refuse', () => {
    /* `settings` carries { sync: true }, so it arrives from the player's other
     * devices, an imported save, or a hand edit. A restored `sdf: -1` makes the
     * fall interval negative, which falls through game.js's `interval > 0`
     * guard into twenty rows a tick; `das: 'banana'` makes `dasMs > 0` false
     * forever so DAS never charges. Both silent, both only for the player
     * holding the bad save. */
    const snap = serialize(createGame({ seed: 1 }));
    snap.settings = { das: 'banana', arr: -50, sdf: -1, ghost: 'yes', lockdown: 'wat' };
    const g = deserialize(snap);
    /* Note the two different repairs, which are createGame()'s own and are
     * deliberately not reconsidered here — matching the constructor exactly is
     * the whole point of the fix. An UNREADABLE value ('banana', 'wat') falls
     * back to the default; an out-of-RANGE number is clamped to the nearest
     * legal one, because ARR 0 and SDF 1 are both real settings a player could
     * have chosen and the stored intent was plainly "as low as it goes". */
    assert.deepEqual(g.settings,
        { das: 167, arr: 0, sdf: 1, ghost: true, lockdown: 'extended' });

    // And the repair is observable, not just tidier: a soft drop falls at the
    // clamped rate rather than teleporting the piece twenty rows in one tick.
    press(g, ACTIONS.SOFT);
    const y0 = g.active.y;
    update(g, TICK_MS);
    assert.ok(g.active && g.active.y - y0 <= 1, 'one tick, at most one row');
});

test('a snapshot cannot restore stats that become NaN in the stats sheet', () => {
    // A missing counter restored as `undefined` reaches Arcade.stats as
    // `undefined + 1` — NaN, in a row nobody can fix afterwards.
    const snap = serialize(createGame({ seed: 1 }));
    snap.stats = { pieces: 4, quads: 'three', maxCombo: -9 };
    const g = deserialize(snap);
    assert.equal(g.stats.pieces, 4, 'a good counter survives');
    assert.equal(g.stats.quads, 0);
    assert.equal(g.stats.maxCombo, 0);
    for (const [k, v] of Object.entries(g.stats)) {
        assert.ok(Number.isInteger(v) && v >= 0, k + ' is a usable count');
    }
});

test('a corrupt cell id encodes to empty rather than to something unrenderable', () => {
    // 9 is not an id: charFor() spells it '#', colorFor() falls back to the
    // garbage hue, and the Daily Well's dig goal would never count it — so a
    // single corrupt cell became permanent debris in a well that can never be
    // cleared. Losing the cell is the smaller lie.
    const g = createGame({ seed: 1 });
    g.board[ROWS * COLS - 1] = 200;
    const back = deserialize(serialize(g));
    assert.equal(back.board[ROWS * COLS - 1], 0);
    for (let i = 0; i < back.board.length; i++) {
        assert.ok(back.board[i] <= GARBAGE_ID, 'every restored cell is a real id');
    }
});
