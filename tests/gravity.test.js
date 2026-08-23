import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TICK_MS } from '../js/core/constants.js';
import {
    LOCK_DELAY_MS, MAX_LOCK_RESETS, MAX_G, fallIntervalMs, levelFor,
} from '../js/core/gravity.js';

// docs/DESIGN.md §2.6, verbatim: seconds per row.
const TABLE = [
    [1, 1.000], [2, 0.793], [3, 0.618], [5, 0.355],
    [8, 0.135], [10, 0.064], [12, 0.028], [15, 0.007],
];

const round3 = (s) => Number(s.toFixed(3));
const rowsPerTick = (level) => TICK_MS / fallIntervalMs(level);

test('fallIntervalMs matches the §2.6 table to 3 decimals', () => {
    // Every published level is directly observable: the 20G floor is a
    // twentieth of a tick, well below the table's fastest row (0.007 s).
    for (const [level, seconds] of TABLE) {
        assert.equal(round3(fallIntervalMs(level) / 1000), seconds, 'level ' + level);
    }
});

test('gravity never gets slower as the level rises', () => {
    let prev = Infinity;
    for (let level = 1; level <= 40; level++) {
        const ms = fallIntervalMs(level);
        assert.ok(ms <= prev, 'level ' + level + ' (' + ms + ') > level ' + (level - 1));
        prev = ms;
    }
});

test('strictly faster every level until the curve hits the 20G floor', () => {
    for (let level = 2; level <= 18; level++) {
        assert.ok(fallIntervalMs(level) < fallIntervalMs(level - 1), 'level ' + level);
    }
});

test('levels 13, 14 and 15 are three distinct speeds', () => {
    // The regression this test exists for: an earlier contract floored the
    // interval at TICK_MS — that is 1G, not 20G — which made every level from
    // 14 up fall at exactly the same speed, Marathon's top level included.
    const [a, b, c] = [13, 14, 15].map(fallIntervalMs);
    assert.ok(a > b && b > c, [a, b, c].join(' / '));
    assert.equal(round3(a / 1000), 0.018);
    assert.equal(round3(b / 1000), 0.011);
    assert.equal(round3(c / 1000), 0.007);
    // ...and two of the three are already faster than one row per tick.
    assert.ok(rowsPerTick(13) < 1);
    assert.ok(rowsPerTick(14) > 1);
    assert.ok(rowsPerTick(15) > 2);
});

test('the curve reaches true 20G at level 19', () => {
    assert.equal(MAX_G, 20);
    assert.ok(fallIntervalMs(18) > TICK_MS / MAX_G, 'level 18 is still short of 20G');
    assert.ok(rowsPerTick(18) < MAX_G);
    assert.equal(fallIntervalMs(19), TICK_MS / MAX_G);
    assert.equal(round3(rowsPerTick(19)), MAX_G);
});

test('20G is a floor, not a ceiling that the curve can punch through', () => {
    // Marathon has no finish line (§3), so the level keeps climbing; past
    // level 114 the curve's base goes negative and the odd powers with it, so
    // the interval must stay positive.
    for (const level of [19, 20, 30, 115, 200, 1000]) {
        assert.equal(fallIntervalMs(level), TICK_MS / MAX_G, 'level ' + level);
        assert.ok(fallIntervalMs(level) > 0);
        assert.ok(rowsPerTick(level) <= MAX_G + 1e-9, 'level ' + level + ' exceeds 20G');
    }
});

test('an endless run cannot walk off the end of the curve', () => {
    /* THE REGRESSION THIS EXISTS FOR. Sampling a handful of high levels was
     * not enough, because whether the old code broke depended on the PARITY of
     * the level. `0.8 - (n-1)*0.007` crosses -1 at level 259; above that
     * `base^(n-1)` explodes instead of vanishing, negative on odd exponents
     * and POSITIVE on even ones. The negative half was caught by the floor
     * comparison; the positive half sailed straight through it:
     *
     *     level 257 →      128 ms/row      level 259 →    4 680 ms/row
     *     level 301 →   1.5e37 ms/row      level 1001 →      Infinity
     *
     * — gravity getting slower the longer you survive, and finally a piece
     * that never falls. The old test's sample (19, 20, 30, 115, 200, 1000) hit
     * only levels whose parity floored, which is why it passed.
     *
     * So: EVERY level, not a sample, and the range goes past the point where
     * the old code overflowed to Infinity. Level 4 000 is 40 000 lines — far
     * past anything a human reaches, which is the point: the function has to
     * be total, not merely correct over the levels we expect. */
    let prev = fallIntervalMs(1);
    for (let level = 1; level <= 4000; level++) {
        const ms = fallIntervalMs(level);
        assert.ok(Number.isFinite(ms), 'level ' + level + ' is not finite: ' + ms);
        assert.ok(ms > 0, 'level ' + level + ' is not positive: ' + ms);
        assert.ok(ms >= TICK_MS / MAX_G, 'level ' + level + ' undercuts 20G: ' + ms);
        assert.ok(ms <= prev, 'level ' + level + ' is SLOWER than ' + (level - 1));
        assert.ok(rowsPerTick(level) <= MAX_G + 1e-9, 'level ' + level + ' exceeds 20G');
        prev = ms;
    }
    // The three levels the old code actually broke on, named so a future
    // retune that reintroduces the explosion says which one it was.
    for (const level of [257, 259, 261, 301, 1001]) {
        assert.equal(fallIntervalMs(level), TICK_MS / MAX_G, 'level ' + level);
    }
});

test('a garbage level is a level, not a NaN or an Infinity', () => {
    // js/core/game.js derives the level from the line count so these are not
    // reachable in play — but a hand-edited or corrupt snapshot deserializes
    // straight into g.level, and a NaN interval makes `floor(fallMs / interval)`
    // NaN, which silently stops gravity rather than crashing.
    for (const bad of [NaN, Infinity, -Infinity, -5, 0, null, undefined, 'nonsense', {}]) {
        const ms = fallIntervalMs(bad);
        assert.ok(Number.isFinite(ms), String(bad) + ' → ' + ms);
        assert.ok(ms >= TICK_MS / MAX_G, String(bad) + ' → ' + ms);
        // Nothing unusable is ever FASTER than the game's own top speed, and
        // nothing is ever slower than level 1.
        assert.ok(ms <= fallIntervalMs(1), String(bad) + ' → ' + ms);
    }
    // Infinity is the interesting one: it used to reach Math.pow as an
    // infinite exponent and come back Infinity — a piece that never falls.
    assert.equal(fallIntervalMs(Infinity), TICK_MS / MAX_G);
});

test('level 1 is one second per row and level 0 is not slower than it', () => {
    assert.equal(fallIntervalMs(1), 1000);
    assert.equal(fallIntervalMs(0), 1000);
});

test('levelFor advances every 10 lines', () => {
    assert.equal(levelFor(0), 1);
    assert.equal(levelFor(9), 1);
    assert.equal(levelFor(10), 2);
    assert.equal(levelFor(19), 2);
    assert.equal(levelFor(20), 3);
    // Marathon has no finish line (§3), so nothing caps this — level 15 used
    // to be the top of the run and is now just another rung.
    assert.equal(levelFor(140), 15);
    assert.equal(levelFor(150), 16);
    assert.equal(levelFor(1000), 101);
    assert.equal(levelFor(40000), 4001);
});

test('lock delay budget is the §2.7 pair', () => {
    assert.equal(LOCK_DELAY_MS, 500);
    assert.equal(MAX_LOCK_RESETS, 15);
});
