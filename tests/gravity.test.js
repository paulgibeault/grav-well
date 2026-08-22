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
    // Endless keeps climbing; past level ~114 the curve's base goes negative
    // and the odd powers with it, so the interval must stay positive.
    for (const level of [19, 20, 30, 115, 200, 1000]) {
        assert.equal(fallIntervalMs(level), TICK_MS / MAX_G, 'level ' + level);
        assert.ok(fallIntervalMs(level) > 0);
        assert.ok(rowsPerTick(level) <= MAX_G + 1e-9, 'level ' + level + ' exceeds 20G');
    }
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
    // Marathon's 150-line goal is the top of the fixed run (§2.6).
    assert.equal(levelFor(140), 15);
    assert.equal(levelFor(150), 16);
});

test('lock delay budget is the §2.7 pair', () => {
    assert.equal(LOCK_DELAY_MS, 500);
    assert.equal(MAX_LOCK_RESETS, 15);
});
