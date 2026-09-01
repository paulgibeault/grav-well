/* The six modes of DESIGN.md §3, pinned as configuration.
 *
 * This suite imports js/app/modes.js AND NOTHING ELSE. That is the property
 * worth protecting: modes.js sits in js/app/, the layer that may touch the
 * platform, and it is the one member of that layer that does not. The moment
 * an `Arcade` or a `document` appears in it these tests stop running, which is
 * a louder failure than a mode rule quietly changing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    MODES, MODE_IDS, DEFAULT_MODE, DEFAULT_PIN_LEVEL, gameOptsFor, pinLevelOf,
} from '../js/app/modes.js';

// The opts keys js/core/game.js's createGame() reads, and nothing else.
const OPT_KEYS = ['mode', 'seed', 'goalLines', 'timeLimitMs', 'goal', 'garbageRows', 'pinLevel'];

// The endings a mode can declare. Core checks them in this order on the same
// tick and emits one `goal` event whichever fires, so a mode declaring two
// would end on whichever came first.
const endingsOf = (o) => [o.goalLines, o.timeLimitMs, o.goal].filter((v) => v !== null);

const isCount = (v) => Number.isInteger(v) && v > 0;

test('the table is exactly the six modes of §3', () => {
    // Arcade first, and it is the default: it is the game somebody who has
    // never played this before should land in. Marathon asks a question — which
    // level? — that only means something once you know how fast level 8 is.
    assert.deepEqual(MODE_IDS, ['arcade', 'marathon', 'sprint', 'ultra', 'zen', 'daily']);
    assert.equal(DEFAULT_MODE, 'arcade');
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
        assert.ok(o.pinLevel === null || isCount(o.pinLevel), id + ' pinLevel');
        // createGame() treats undefined and null differently in exactly one
        // place — optCount() stores null so the value survives a snapshot's
        // JSON round trip. An absent key would deserialize as undefined.
        for (const k of OPT_KEYS) assert.notEqual(o[k], undefined, id + '.' + k);
    }
});

test('a mode declares AT MOST ONE ending', () => {
    // A line goal, a clock and a dig all resolve to the same `goal` event, so
    // a mode carrying two would end on whichever came first — a rule §3 never
    // states and no player could infer. They compose in core if a timed dig is
    // ever wanted; no v1 mode asks for one.
    //
    // This used to read "…and a mode that can end declares exactly how",
    // with Zen carved out as the single exception. Marathon losing its line
    // goal (§3, amended 2026-08-22) makes that carve-out wrong, and the honest
    // repair is to WIDEN the invariant rather than to drop it: zero declared
    // endings is a legitimate mode, because a run always has one ending core
    // provides for free — the top-out. So the rule is `<= 1`, and the modes
    // sitting at 0 are pinned by name in the next test rather than waved
    // through by an `if`.
    for (const id of MODE_IDS) {
        assert.ok(endingsOf(gameOptsFor(id, 1)).length <= 1, id);
    }
});

test('the modes with no declared ending are exactly the two that end on top-out', () => {
    // Zero endings is a design statement, not a forgotten field, and it is
    // true of EXACTLY two modes — so the set is named here. Anything else
    // reaching zero is a mode that lost its goal by accident and would run
    // forever with no way to finish.
    //
    //   Arcade   — the standard endless game: levels climb with no finish
    //              line, and the run is over when the stack tops out.
    //   Marathon — endless for a different reason: the level is PINNED, so the
    //              curve never arrives to end it. Still ends on a top-out.
    //   Zen      — endless AND unloseable: js/core/game.js softens both
    //              top-out paths on `g.mode === 'zen'`, so the well sinks
    //              instead. It is the one mode where "ends on top-out" is
    //              not literally true, which is why it is called out here.
    //
    // Everything else has to say what finishes it, or a player cannot know.
    const endless = MODE_IDS.filter((id) => endingsOf(gameOptsFor(id, 1)).length === 0);
    assert.deepEqual(endless, ['arcade', 'marathon', 'zen']);
    for (const id of MODE_IDS) {
        if (endless.includes(id)) continue;
        assert.equal(endingsOf(gameOptsFor(id, 1)).length, 1, id + ' must declare its ending');
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

test('Arcade is the endless standard game on a score board', () => {
    const o = gameOptsFor('arcade', 1);
    // §3, amended 2026-08-22: no finish line. It shipped as 150 lines with a
    // deferred "Endless" toggle; the toggle is gone and the goal with it,
    // because the standard game IS the endless one and a mode does not need a
    // setting to say so. Renamed from Marathon 2026-08-31 — the RULES did not
    // move, only the name, because "Marathon" was needed for the mode that
    // actually lets you run one.
    assert.equal(o.goalLines, null, '§3: no line goal — the run ends on a top-out');
    assert.equal(o.timeLimitMs, null);
    assert.equal(o.goal, null);
    assert.equal(o.garbageRows, 0);
    assert.equal(o.pinLevel, null, 'the curve is the mode: nothing is pinned');
    // Nothing about how the run is FILED changed. js/app/store.js gates on
    // `won` only for a time metric, so a score-metric mode that ends on a
    // top-out has always counted — which is what lets the goal go without
    // touching store.js.
    assert.equal(MODES.arcade.metric, 'score');
    assert.equal(MODES.arcade.scores.category, 'arcade');
    assert.equal(MODES.arcade.scores.order, 'desc');
    assert.equal(MODES.arcade.scores.keyed, false);
    assert.equal(MODES.arcade.record.category, 'arcade-score');
    assert.equal(MODES.arcade.record.direction, 'higher');
    // NOT the legacy `marathon` / `marathon-score` categories. Those hold
    // scores set under the old name and the SDK has no rename; re-using them
    // would mix escalating runs into the pinned board forever.
    assert.notEqual(MODES.arcade.scores.category, MODES.marathon.scores.category);
});

test('Marathon pins the level, and only Marathon does', () => {
    // The mode IS the pin: there is no other difference from Arcade, which is
    // why `pinnable` is the whole declaration and core's pinLevel does the work.
    assert.deepEqual(MODE_IDS.filter((id) => MODES[id].pinnable), ['marathon']);
    for (const id of MODE_IDS) {
        assert.equal(typeof MODES[id].pinnable, 'boolean', id + ' declares pinnable');
    }

    const o = gameOptsFor('marathon', 1, { pinLevel: 8 });
    assert.equal(o.pinLevel, 8);
    assert.equal(o.goalLines, null, 'no finish line — the level is what stops moving');
    assert.equal(o.timeLimitMs, null);
    assert.equal(o.goal, null);

    // A pinnable mode handed nothing still pins. null on a pinnable mode does
    // not mean "no preference", it means the level climbs — and silently
    // turning Marathon back into Arcade is the one outcome nobody asked for.
    assert.equal(gameOptsFor('marathon', 1).pinLevel, DEFAULT_PIN_LEVEL);
    for (const bad of [null, undefined, NaN, 'eight', {}, 0, -3]) {
        assert.equal(gameOptsFor('marathon', 1, { pinLevel: bad }).pinLevel,
            DEFAULT_PIN_LEVEL, String(bad));
    }
    assert.equal(pinLevelOf(12), 12);

    // The pin is IGNORED, not rejected, by a mode that is not pinnable: the
    // menu holds one stored level and hands it over on every launch.
    for (const id of MODE_IDS) {
        if (id === 'marathon') continue;
        assert.equal(gameOptsFor(id, 1, { pinLevel: 9 }).pinLevel, null, id);
    }
});

test('the Marathon board is partitioned by level, the way the Daily is by date', () => {
    // A table mixing level-2 runs with level-15 runs is not a leaderboard, it
    // is a pile — the same problem the Daily Well solves by keying on the day.
    assert.equal(MODES.marathon.scores.keyed, 'level');
    assert.equal(MODES.daily.scores.keyed, 'date');
    assert.equal(MODES.marathon.scores.order, 'desc');
    // And the personal best is per level too, created lazily by the first run
    // at that level rather than nineteen empty categories up front.
    assert.equal(MODES.marathon.record.perLevel, true);
    assert.equal(MODES.marathon.record.category, 'marathon');
    for (const id of MODE_IDS) {
        const r = MODES[id].record;
        if (!r || id === 'marathon') continue;
        assert.notEqual(r.perLevel, true, id + ' keeps one record, not a family');
    }
});

test('Zen is the one mode that files no skill records', () => {
    /* Best combo, longest back-to-back, longest quad streak and biggest single
     * clear are records because they were built UNDER THREAT. Zen cannot top
     * out, so a combo there can be assembled at leisure with the stack at the
     * ceiling — filing those beside a combo built in a real run would retire
     * all four categories permanently on the first Zen session. */
    assert.equal(MODES.zen.skillRecords, false);
    const off = MODE_IDS.filter((id) => MODES[id].skillRecords === false);
    assert.deepEqual(off, ['zen']);
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
    assert.equal(MODES.daily.scores.keyed, 'date');
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
    // save: the player gets Arcade, not a white screen.
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
    assert.deepEqual(scores, ['arcade', 'marathon', 'ultra', 'daily']);

    // `marathon` is a STEM here, not a finished category: js/app/store.js
    // appends the level (`marathon-l8`) because record.perLevel is set.
    const records = MODE_IDS.filter((id) => MODES[id].record)
        .map((id) => MODES[id].record.category);
    assert.deepEqual(records.sort(), ['arcade-score', 'marathon', 'sprint-40', 'ultra-score']);

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
        /* A board is keyed when its rows are not comparable to each other:
         * the Daily Well by the day, Marathon by the pinned level. Arcade and
         * Ultra are one flat ranking each, so an entry key there would only
         * partition a board that has no partitions. */
        const want = id === 'daily' ? 'date' : (id === 'marathon' ? 'level' : false);
        assert.equal(s.keyed, want, id);
    }
});
