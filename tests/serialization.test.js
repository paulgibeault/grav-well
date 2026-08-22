/* serialization.test.js — the mid-run snapshot.
 *
 * The launcher evicts iframes, so every session ends in a restore whether the
 * player asked for one or not. The acceptance test is the last one in this
 * file: a run interrupted, saved, restored and resumed has to play out
 * identically to one that was never touched, given the same later inputs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { COLS, ROWS, ACTIONS, TICK_MS, GARBAGE_ID } from '../js/core/constants.js';
import { idx } from '../js/core/board.js';
import { createGame, press, release, update, serialize, deserialize } from '../js/core/game.js';
import { SNAPSHOT_VERSION } from '../js/core/serialize.js';
import { makeRng, hashU32 } from '../js/arcade-rng.js';

const ACTION_NAMES = ['LEFT', 'RIGHT', 'CW', 'CCW', 'SOFT', 'HARD', 'HOLD'];

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

// Ticks [from, to) of the log, so a run can be stopped and picked up again.
function playRange(g, log, from, to) {
    const byTick = new Map();
    for (const entry of log) {
        if (!byTick.has(entry[0])) byTick.set(entry[0], []);
        byTick.get(entry[0]).push(entry);
    }
    for (let t = from; t < to; t++) {
        const due = byTick.get(t);
        if (due) for (const [, action, kind] of due) {
            (kind === 'press' ? press : release)(g, ACTIONS[action]);
        }
        update(g, TICK_MS);
        g.events.length = 0;
    }
    return g;
}

const hash = (g) => hashU32(JSON.stringify(serialize(g)));

// A run stopped mid-piece with as little as possible left at its default: a
// spent hold, a charging DAS, a held soft drop, debris in the well, a goal,
// non-default settings.
function busyGame() {
    const g = createGame({
        seed: 'daily-2026-08-22', mode: 'daily', garbageRows: 6, goalLines: 40,
        settings: { das: 100, arr: 0, sdf: 7, ghost: false, lockdown: 'infinite' },
    });
    playRange(g, inputLog(555, 120), 0, 420);
    press(g, ACTIONS.HOLD);
    press(g, ACTIONS.SOFT);
    press(g, ACTIONS.LEFT);
    update(g, 7);                   // a part-tick, so leftoverMs is not round
    return g;
}

test('deserialize(serialize(g)) is exact', () => {
    const g = busyGame();
    const back = deserialize(serialize(g));

    assert.deepEqual(Object.keys(back).sort(), Object.keys(g).sort(),
        'every field of a live game is either serialized or rebuilt');
    assert.deepEqual(serialize(back), serialize(g));
    assert.deepEqual(back.board, g.board);
    assert.ok(back.board instanceof Uint8Array);
    assert.deepEqual(back.active, g.active);
    assert.deepEqual(back.settings, g.settings);
    assert.deepEqual(back.stats, g.stats);
    assert.deepEqual(back.held, g.held);
    assert.deepEqual(back.bag.getState(), g.bag.getState());
});

test('the fixture really is busy, so the round trip is not proving nothing', () => {
    const snap = serialize(busyGame());
    assert.ok(snap.tick > 400);
    assert.ok(snap.leftoverMs > 0 && snap.leftoverMs < TICK_MS, 'a part-tick remainder');
    assert.ok(snap.dasMs > 0, 'DAS mid-charge');
    assert.equal(snap.dir, -1);
    assert.equal(snap.held.SOFT, true);
    assert.equal(snap.holdUsed, true);
    assert.ok(snap.hold !== null);
    assert.ok(snap.stats.pieces > 0);
    assert.equal(snap.goalLines, 40);
    assert.equal(snap.garbageRows, 6);
    assert.deepEqual(snap.settings, { das: 100, arr: 0, sdf: 7, ghost: false, lockdown: 'infinite' });
});

test('the snapshot survives a real JSON round trip', () => {
    // The path the launcher actually uses: stringify to storage, parse on the
    // way back. Anything left undefined or Infinity would not come home.
    const g = busyGame();
    const back = deserialize(JSON.parse(JSON.stringify(serialize(g))));
    assert.deepEqual(serialize(back), serialize(g));
    assert.equal(hash(back), hash(g));
});

test('a snapshot is a copy, not a window onto the live game', () => {
    const g = busyGame();
    const snap = serialize(g);
    const before = JSON.stringify(snap);
    g.events.push({ type: 'move' });
    g.events.length = 0;
    g.queue.push('I');
    g.stats.pieces += 5;
    g.settings.das = 1;
    g.board[idx(0, 0)] = GARBAGE_ID;
    assert.equal(JSON.stringify(snap), before);
});

test('the board travels as one 400-digit string, 0..8 a cell', () => {
    const g = createGame({ seed: 3, garbageRows: 4 });
    const snap = serialize(g);
    assert.equal(typeof snap.board, 'string');
    assert.equal(snap.board.length, COLS * ROWS);
    assert.match(snap.board, /^[0-8]+$/, 'ids run 0 empty, 1..7 pieces, 8 garbage');
    assert.ok(snap.board.includes(String(GARBAGE_ID)), 'the debris is in there');
    const back = deserialize(snap);
    assert.deepEqual(back.board, g.board);
});

test('the rng state travels, so a restored run keeps the same piece stream', () => {
    const g = createGame({ seed: 42 });
    playRange(g, inputLog(17, 40), 0, 300);
    const back = deserialize(serialize(g));
    assert.deepEqual(back.queue, g.queue);
    // Drain both bags in step: a snapshot that saved the generator but not the
    // partly-dealt bag (or the other way round) forks here.
    for (let i = 0; i < 30; i++) {
        assert.equal(back.bag.next(), g.bag.next(), 'piece ' + i);
    }
});

test('a snapshot that is not one deserializes to null rather than throwing', () => {
    const good = serialize(createGame({ seed: 1 }));
    assert.equal(deserialize(null), null);
    assert.equal(deserialize(undefined), null);
    assert.equal(deserialize('nope'), null);
    assert.equal(deserialize({}), null);
    assert.equal(deserialize(Object.assign({}, good, { v: SNAPSHOT_VERSION + 1 })), null);
    assert.equal(deserialize(Object.assign({}, good, { board: good.board.slice(1) })), null);
    assert.equal(deserialize(Object.assign({}, good, { board: 'x'.repeat(COLS * ROWS) })), null);
    assert.equal(deserialize(Object.assign({}, good, { bag: null })), null);
    assert.equal(deserialize(Object.assign({}, good, { bag: { rng: 'nope', queue: [] } })), null);
    assert.equal(serialize(null), null);
    assert.equal(serialize({}), null);
});

test('a restored game is a game: it accepts input and ticks on', () => {
    const g = deserialize(serialize(createGame({ seed: 42 })));
    press(g, ACTIONS.HARD);
    update(g, TICK_MS * 10);
    assert.equal(g.stats.pieces, 1);
    assert.equal(g.tick, 10);
    assert.equal(g.phase, 'playing');
});

// ---------------------------------------------------------------------------
// the acceptance test
// ---------------------------------------------------------------------------

function resumeFidelity(opts, log, breakAt, ticks) {
    // Three runs of the same log: one straight through, one that is saved and
    // restored halfway, and the original carried on past the save.
    const control = playRange(createGame(opts), log, 0, ticks);

    const original = playRange(createGame(opts), log, 0, breakAt);
    const restored = deserialize(JSON.parse(JSON.stringify(serialize(original))));
    playRange(original, log, breakAt, ticks);
    playRange(restored, log, breakAt, ticks);

    assert.equal(hash(restored), hash(original), 'the resumed run diverged from the one it was cut from');
    assert.equal(hash(restored), hash(control), 'the resumed run diverged from an uninterrupted one');
    return control;
}

test('a run interrupted, saved, restored and resumed plays out identically', () => {
    const log = inputLog(2468, 700);
    // Zen, so the trace runs long enough to cross many pieces, several
    // level-ups and the stack-sinking path.
    const control = resumeFidelity({ seed: 31, mode: 'zen' }, log, 700, 2400);
    assert.ok(control.stats.pieces > 40, control.stats.pieces + ' pieces');
    assert.equal(control.phase, 'playing');
});

test('...including a save taken mid-DAS, mid-fall, in a well full of debris', () => {
    const log = inputLog(1357, 500);
    // Marathon with debris and a Sprint goal: this one tops out or finishes,
    // and the ending has to land on the same tick either way.
    const control = resumeFidelity(
        { seed: 'well-9', mode: 'daily', garbageRows: 8, goalLines: 40, settings: { das: 90, arr: 8, sdf: 40 } },
        log, 253, 1600);
    assert.ok(control.stats.pieces > 10);
});

test('a save taken between two press events resumes with the keys still down', () => {
    const g = createGame({ seed: 42, settings: { das: 167, arr: 33 } });
    press(g, ACTIONS.LEFT);
    update(g, TICK_MS * 5);                     // DAS half charged
    const back = deserialize(serialize(g));
    for (let i = 0; i < 30; i++) { update(g, TICK_MS); update(back, TICK_MS); }
    assert.equal(back.active.x, g.active.x, 'the auto-shift carried on across the save');
    assert.ok(back.active.x < 3, 'and it really did shift');
    release(back, ACTIONS.LEFT);
    release(g, ACTIONS.LEFT);
    assert.equal(hash(back), hash(g));
});
