/* The five modes of DESIGN.md §3, pinned as configuration.
 *
 * This suite imports js/app/modes.js AND NOTHING ELSE. That is the property
 * worth protecting: modes.js sits in js/app/, the layer that may touch the
 * platform, and it is the one member of that layer that does not. The moment
 * an `Arcade` or a `document` appears in it these tests stop running, which is
 * a louder failure than a mode rule quietly changing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODES, MODE_IDS, DEFAULT_MODE, gameOptsFor } from '../js/app/modes.js';

// The opts keys js/core/game.js's createGame() reads, and nothing else.
const OPT_KEYS = ['mode', 'seed', 'goalLines', 'timeLimitMs', 'goal', 'garbageRows'];

// The endings a mode can declare. Core checks them in this order on the same
// tick and emits one `goal` event whichever fires, so a mode declaring two
// would end on whichever came first.
const endingsOf = (o) => [o.goalLines, o.timeLimitMs, o.goal].filter((v) => v !== null);

const isCount = (v) => Number.isInteger(v) && v > 0;

test('the table is exactly the five modes of §3', () => {
    assert.deepEqual(MODE_IDS, ['marathon', 'sprint', 'ultra', 'zen', 'daily']);
    assert.deepEqual(Object.keys(MODES), MODE_IDS);
    for (const id of MODE_IDS) assert.equal(MODES[id].id, id, id + ' knows its own id');
    assert.ok(MODES[DEFAULT_MODE], 'the default mode is in the table');
});

test('every mode produces a valid createGame opts object', () => {
    for (const id of MODE_IDS) {
        const o = gameOptsFor(id, 1234);
        assert.deepEqual(Object.keys(o).sort(), [...OPT_KEYS].sort(), id + ' opts keys');
        assert.equal(o.mode, id, id + ' mode');
        assert.ok(typeof o.seed === 'number' || typeof o.seed === 'string', id + ' seed');
        assert.ok(o.goalLines === null || isCount(o.goalLines), id + ' goalLines');
        assert.ok(o.timeLimitMs === null || isCount(o.timeLimitMs), id + ' timeLimitMs');
        assert.ok(o.goal === null || o.goal === 'garbage', id + ' goal');
        assert.ok(Number.isInteger(o.garbageRows) && o.garbageRows >= 0, id + ' garbageRows');
        // createGame() treats undefined and null differently in exactly one
        // place — optCount() stores null so the value survives a snapshot's
        // JSON round trip. An absent key would deserialize as undefined.
        for (const k of OPT_KEYS) assert.notEqual(o[k], undefined, id + '.' + k);
    }
});

test('no mode declares two endings at once', () => {
    // A line goal, a clock and a dig all resolve to the same `goal` event, so
    // a mode carrying two would end on whichever came first — a rule §3 never
    // states and no player could infer. They compose in core if a timed dig is
    // ever wanted; no v1 mode asks for one.
    for (const id of MODE_IDS) {
        assert.ok(endingsOf(gameOptsFor(id, 1)).length <= 1, id);
    }
});

test('a mode that can end declares exactly how', () => {
    // Zen is the only endless one (§3), and that is a design statement, not an
    // omission — every other mode has to say what finishes it.
    for (const id of MODE_IDS) {
        assert.equal(endingsOf(gameOptsFor(id, 1)).length, id === 'zen' ? 0 : 1, id);
    }
});

test('Sprint 40 is a line goal with no clock', () => {
    const o = gameOptsFor('sprint', 1);
    assert.equal(o.goalLines, 40);
    assert.equal(o.timeLimitMs, null);
    assert.equal(o.garbageRows, 0);
    // §3: one personal best, no ranked board — guide §4's records/scores line.
    assert.equal(MODES.sprint.record.category, 'sprint-40');
    assert.equal(MODES.sprint.record.direction, 'lower');
    assert.equal(MODES.sprint.record.format, 'duration-ms');
    assert.equal(MODES.sprint.scores, null);
});

test('Ultra is a clock with no line goal', () => {
    const o = gameOptsFor('ultra', 1);
    assert.equal(o.timeLimitMs, 3 * 60 * 1000, '§3 says 3:00');
    assert.equal(o.goalLines, null);
    assert.equal(o.garbageRows, 0);
    assert.equal(MODES.ultra.scores.category, 'ultra');
    assert.equal(MODES.ultra.record.category, 'ultra-score');
    assert.equal(MODES.ultra.record.direction, 'higher');
});

test('Marathon is 150 lines and a score board', () => {
    const o = gameOptsFor('marathon', 1);
    assert.equal(o.goalLines, 150, '§2.6: levels 1–15, ten lines each');
    assert.equal(o.timeLimitMs, null);
    assert.equal(MODES.marathon.scores.category, 'marathon');
    assert.equal(MODES.marathon.scores.order, 'desc');
    assert.equal(MODES.marathon.record.category, 'marathon-score');
});

test('Zen has neither ending, and the mode id is what disables top-out', () => {
    const o = gameOptsFor('zen', 1);
    assert.equal(o.goalLines, null);
    assert.equal(o.timeLimitMs, null);
    // There is no `noTopOut` opt to set. js/core/game.js softens BOTH top-out
    // paths — the Block Out on spawn and the Lock Out above the field — on
    // `g.mode === 'zen'` directly, sinking the stack instead of ending the
    // run, so the mode id in these opts IS the flag. If this assertion ever
    // has to change, core grew a real flag and this table must set it.
    assert.equal(o.mode, 'zen');
    assert.equal(MODES.zen.scores, null, '§3: lifetime stats only');
    assert.equal(MODES.zen.record, null);
});

test('the Daily Well starts buried and ends when it is clean', () => {
    const o = gameOptsFor('daily', 1);
    assert.equal(o.garbageRows, 8, '§3: eight rows of seeded debris');
    // §3 is a DIG. Not a line count: a player can clear line after line well
    // above the debris, so a goalLines approximation hands out the win with
    // the bottom of the well still dirty.
    assert.equal(o.goal, 'garbage');
    assert.equal(o.goalLines, null);
    assert.equal(o.timeLimitMs, null);
    // §3/§7: one board, keyed by the day, ascending because it is a time race.
    assert.equal(MODES.daily.scores.category, 'daily');
    assert.equal(MODES.daily.scores.order, 'asc');
    assert.equal(MODES.daily.scores.keyed, true);
    assert.equal(MODES.daily.seedSource, 'daily');
});

test('a dig goal never ships without debris to dig', () => {
    // The trap this pins: `goal: 'garbage'` on a well with garbageRows 0 is
    // won the instant createGame() returns, goal event already in the first
    // drain. The two fields are one setting in two halves.
    for (const id of MODE_IDS) {
        const o = gameOptsFor(id, 1);
        if (o.goal === 'garbage') assert.ok(o.garbageRows > 0, id + ' digs nothing');
        if (o.garbageRows > 0) assert.equal(o.goal, 'garbage', id + ' buries the player with no way out');
    }
    assert.deepEqual(MODE_IDS.filter((id) => gameOptsFor(id, 1).goal === 'garbage'), ['daily']);
});

test('only the Daily Well seeds from the day', () => {
    for (const id of MODE_IDS) {
        assert.equal(MODES[id].seedSource, id === 'daily' ? 'daily' : 'entropy', id);
    }
});

test('the same mode and seed give identical opts, twice', () => {
    for (const id of MODE_IDS) {
        const a = gameOptsFor(id, 20260822);
        const b = gameOptsFor(id, 20260822);
        assert.deepEqual(a, b, id);
        // Deep-equal but never the same object: a caller that spreads settings
        // into the opts it got back must not be editing the next caller's.
        assert.notEqual(a, b, id + ' returns a fresh object');
    }
});

test('a different seed gives different opts', () => {
    for (const id of MODE_IDS) {
        assert.notDeepEqual(gameOptsFor(id, 1), gameOptsFor(id, 2), id);
        assert.equal(gameOptsFor(id, 1).seed, 1);
        assert.equal(gameOptsFor(id, 2).seed, 2);
    }
});

test('a mode is deterministic in its seed alone', () => {
    // Everything except the seed is table data, so two runs of the same mode
    // differ in exactly one field. This is what makes a Daily Well shared:
    // same day, same seed, same well, for every player.
    const a = gameOptsFor('daily', 111);
    const b = gameOptsFor('daily', 222);
    for (const k of OPT_KEYS) {
        if (k === 'seed') assert.notEqual(a[k], b[k]);
        else assert.deepEqual(a[k], b[k], k);
    }
});

test('seeds arrive in every shape the SDK hands them out in', () => {
    // A plain u32, a string, a factory, and the GENERATOR Arcade.daily.seed()
    // actually returns — that last one is the trap: passed through unwrapped
    // it would stringify into one constant seed for every player, every day.
    const rngLike = () => 0.5;
    rngLike.getState = () => 987654321;

    assert.equal(gameOptsFor('daily', rngLike).seed, 987654321);
    assert.equal(gameOptsFor('daily', () => 4242).seed, 4242);
    assert.equal(gameOptsFor('daily', () => rngLike).seed, 987654321);
    assert.equal(gameOptsFor('marathon', 'room-42').seed, 'room-42');
    // u32, so a negative or fractional seed lands where the PRNG expects it.
    assert.equal(gameOptsFor('marathon', -1).seed, 4294967295);
    assert.equal(gameOptsFor('marathon', 7.9).seed, 7);
});

test('a missing or unusable seed falls back to 0, like createGame does', () => {
    for (const bad of [undefined, null, NaN, Infinity, '', {}, []]) {
        assert.equal(gameOptsFor('marathon', bad).seed, 0, String(bad));
    }
});

test('an unknown mode id opens as the default instead of throwing', () => {
    // A snapshot from a build with a mode this one lacks, or a hand-edited
    // save: the player gets Marathon, not a white screen.
    for (const bad of ['versus', '', null, undefined, '__proto__', 'toString']) {
        assert.deepEqual(gameOptsFor(bad, 5), gameOptsFor(DEFAULT_MODE, 5), String(bad));
    }
});

test('the table cannot be edited by the screens that read it', () => {
    assert.ok(Object.isFrozen(MODES));
    assert.ok(Object.isFrozen(MODES.sprint));
    assert.ok(Object.isFrozen(MODES.sprint.record));
    assert.throws(() => { MODES.sprint.goalLines = 41; }, TypeError);
    assert.equal(MODES.sprint.goalLines, 40);
    // The opts, by contrast, belong to the caller.
    const o = gameOptsFor('sprint', 1);
    o.goalLines = 41;
    assert.equal(gameOptsFor('sprint', 1).goalLines, 40);
});

test('every mode has the menu copy the shell needs', () => {
    for (const id of MODE_IDS) {
        const m = MODES[id];
        assert.equal(typeof m.name, 'string');
        assert.ok(m.name.length > 0, id + ' name');
        assert.equal(typeof m.blurb, 'string');
        assert.ok(m.blurb.length > 0, id + ' blurb');
        assert.equal(typeof m.instantRetry, 'boolean', id + ' instantRetry');
        assert.ok(m.metric === null || m.metric === 'score' || m.metric === 'time', id);
    }
    // §4: Sprint and Ultra retry instantly, everything else confirms.
    assert.deepEqual(MODE_IDS.filter((id) => MODES[id].instantRetry), ['sprint', 'ultra']);
});

test('the fleet category names are spelled once, here', () => {
    // js/app/store.js is the only reader of these, and the launcher renders
    // them; a typo is a leaderboard nobody can find. DESIGN.md §7, verbatim.
    const scores = MODE_IDS.filter((id) => MODES[id].scores)
        .map((id) => MODES[id].scores.category);
    assert.deepEqual(scores, ['marathon', 'ultra', 'daily']);

    const records = MODE_IDS.filter((id) => MODES[id].record)
        .map((id) => MODES[id].record.category);
    assert.deepEqual(records.sort(), ['marathon-score', 'sprint-40', 'ultra-score']);

    for (const id of MODE_IDS) {
        const r = MODES[id].record;
        if (!r) continue;
        assert.ok(r.direction === 'higher' || r.direction === 'lower', id);
        // A time is judged low, a score high — and the record's format is what
        // lets the launcher's Records sheet render it with no per-game code.
        assert.equal(r.direction, MODES[id].metric === 'time' ? 'lower' : 'higher', id);
        assert.equal(r.format, MODES[id].metric === 'time' ? 'duration-ms' : 'integer', id);
        assert.equal(typeof r.label, 'string');
    }
});

test('a time race sorts ascending and a score board descending', () => {
    for (const id of MODE_IDS) {
        const s = MODES[id].scores;
        if (!s) continue;
        assert.equal(s.order, MODES[id].metric === 'time' ? 'asc' : 'desc', id);
        // Only a board with more than one entry per player needs an entry key.
        assert.equal(s.keyed, id === 'daily', id);
    }
});
