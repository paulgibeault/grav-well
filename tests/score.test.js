import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreLock, dropPoints } from '../js/core/score.js';

// Defaults for the fields a given case does not care about.
function lock(over) {
    return scoreLock(Object.assign(
        { lines: 0, tspin: 'none', perfectClear: false, level: 1, combo: 0, b2b: false },
        over));
}

test('§2.9 line clears: 100 / 300 / 500 / 800, x level', () => {
    assert.equal(lock({ lines: 1 }).points, 100);
    assert.equal(lock({ lines: 2 }).points, 300);
    assert.equal(lock({ lines: 3 }).points, 500);
    assert.equal(lock({ lines: 4 }).points, 800);

    assert.equal(lock({ lines: 1, level: 7 }).points, 700);
    assert.equal(lock({ lines: 2, level: 7 }).points, 2100);
    assert.equal(lock({ lines: 3, level: 7 }).points, 3500);
    assert.equal(lock({ lines: 4, level: 7 }).points, 5600);
});

test('§2.9 mini T-spins: 100 / 200 / 400, x level', () => {
    assert.equal(lock({ lines: 0, tspin: 'mini' }).points, 100);
    assert.equal(lock({ lines: 1, tspin: 'mini' }).points, 200);
    assert.equal(lock({ lines: 2, tspin: 'mini' }).points, 400);
    assert.equal(lock({ lines: 2, tspin: 'mini', level: 4 }).points, 1600);
});

test('§2.9 full T-spins: 400 / 800 / 1200 / 1600, x level', () => {
    assert.equal(lock({ lines: 0, tspin: 'full' }).points, 400);
    assert.equal(lock({ lines: 1, tspin: 'full' }).points, 800);
    assert.equal(lock({ lines: 2, tspin: 'full' }).points, 1200);
    assert.equal(lock({ lines: 3, tspin: 'full' }).points, 1600);
    assert.equal(lock({ lines: 3, tspin: 'full', level: 9 }).points, 14400);
});

test('an ordinary lock scores nothing and is labelled nothing', () => {
    const r = lock({});
    assert.equal(r.points, 0);
    assert.equal(r.label, null);
});

test('B2B multiplies the clear award by 1.5', () => {
    assert.equal(lock({ lines: 4, b2b: true }).points, 1200);
    assert.equal(lock({ lines: 1, tspin: 'full', b2b: true }).points, 1200);
    assert.equal(lock({ lines: 2, tspin: 'full', b2b: true }).points, 1800);
    assert.equal(lock({ lines: 3, tspin: 'full', b2b: true }).points, 2400);
    assert.equal(lock({ lines: 1, tspin: 'mini', b2b: true }).points, 300);
    assert.equal(lock({ lines: 2, tspin: 'mini', b2b: true, level: 3 }).points, 1800);
});

test('B2B never touches a plain clear, even when the flag is set', () => {
    // The flag being set is not the same as the award being eligible: a plain
    // Triple both scores flat and breaks the chain.
    const r = lock({ lines: 3, b2b: true });
    assert.equal(r.points, 500);
    assert.equal(r.b2b, false);
    assert.equal(r.label, 'TRIPLE');
});

test('B2B chain: Quad opens it, T-spin Double rides it, plain Triple breaks it', () => {
    const quad = lock({ lines: 4 });
    assert.equal(quad.points, 800);
    assert.equal(quad.b2b, true, 'a Quad arms B2B');

    const tsd = lock({ lines: 2, tspin: 'full', b2b: quad.b2b });
    assert.equal(tsd.points, 1800, '1200 x 1.5');
    assert.equal(tsd.b2b, true, 'a T-spin clear extends B2B');
    assert.equal(tsd.label, 'B2B T-SPIN DOUBLE');

    const triple = lock({ lines: 3, b2b: tsd.b2b });
    assert.equal(triple.points, 500);
    assert.equal(triple.b2b, false);

    const after = lock({ lines: 4, b2b: triple.b2b });
    assert.equal(after.points, 800, 'chain restarts flat');
    assert.equal(after.b2b, true);
});

test('a T-spin that clears nothing neither breaks nor extends B2B', () => {
    assert.equal(lock({ lines: 0, tspin: 'full', b2b: true }).b2b, true);
    assert.equal(lock({ lines: 0, tspin: 'mini', b2b: true }).b2b, true);
    assert.equal(lock({ lines: 0, tspin: 'full', b2b: false }).b2b, false);
    // ...and it does not collect the x1.5 either.
    assert.equal(lock({ lines: 0, tspin: 'full', b2b: true }).points, 400);
    assert.equal(lock({ lines: 0, tspin: 'full', b2b: true }).label, 'T-SPIN');
});

test('a lock with no clear and no T-spin leaves B2B alone', () => {
    assert.equal(lock({ b2b: true }).b2b, true);
    assert.equal(lock({ b2b: false }).b2b, false);
});

test('combo counts consecutive PRIOR clears: 50 x combo x level', () => {
    // A four-clear chain of Singles at level 2: the opener adds nothing, then
    // each later clear adds 50 x combo x 2 on top of the flat 200.
    const chain = [0, 1, 2, 3].map((combo) => lock({ lines: 1, level: 2, combo }));
    assert.deepEqual(chain.map((r) => r.points), [200, 300, 400, 500]);
    assert.equal(lock({ lines: 4, level: 1, combo: 5 }).points, 800 + 250);
});

test('perfect clear awards stack on top of the line-clear award', () => {
    assert.equal(lock({ lines: 1, perfectClear: true }).points, 100 + 800);
    assert.equal(lock({ lines: 2, perfectClear: true }).points, 300 + 1200);
    assert.equal(lock({ lines: 3, perfectClear: true }).points, 500 + 1800);
    assert.equal(lock({ lines: 4, perfectClear: true }).points, 800 + 2000);
    assert.equal(lock({ lines: 2, perfectClear: true, level: 3 }).points, 900 + 3600);
});

test('a B2B Quad perfect clear is 3200 x level, not 2000 x 1.5', () => {
    const r = lock({ lines: 4, perfectClear: true, b2b: true });
    assert.equal(r.points, 1200 + 3200);
    assert.equal(r.label, 'B2B QUAD PERFECT CLEAR');
    assert.equal(lock({ lines: 4, perfectClear: true, b2b: true, level: 5 }).points,
        800 * 5 * 1.5 + 3200 * 5);
    // Without the chain it is the plain 2000 row.
    assert.equal(lock({ lines: 4, perfectClear: true }).points, 2800);
});

test('perfect clear, B2B and combo all compose in one lock', () => {
    // Level 3, third clear of a chain, B2B Quad perfect clear:
    //   clear 800 x 3 x 1.5 = 3600, PC 3200 x 3 = 9600, combo 50 x 2 x 3 = 300.
    const r = lock({ lines: 4, perfectClear: true, b2b: true, level: 3, combo: 2 });
    assert.equal(r.points, 3600 + 9600 + 300);
});

test('points are integers — the x1.5 is floored, never rounded up', () => {
    const cases = [
        { lines: 4, b2b: true, level: 13 },
        { lines: 1, tspin: 'mini', b2b: true, level: 7, combo: 3 },
        { lines: 3, tspin: 'full', b2b: true, level: 11, perfectClear: true },
    ];
    for (const c of cases) {
        const p = lock(c).points;
        assert.equal(p, Math.floor(p));
        assert.ok(Number.isInteger(p));
    }
});

test('label vocabulary', () => {
    assert.equal(lock({ lines: 1 }).label, 'SINGLE');
    assert.equal(lock({ lines: 2 }).label, 'DOUBLE');
    assert.equal(lock({ lines: 3 }).label, 'TRIPLE');
    assert.equal(lock({ lines: 4 }).label, 'QUAD');
    assert.equal(lock({ lines: 0, tspin: 'mini' }).label, 'MINI T-SPIN');
    assert.equal(lock({ lines: 1, tspin: 'mini' }).label, 'MINI T-SPIN SINGLE');
    assert.equal(lock({ lines: 2, tspin: 'mini' }).label, 'MINI T-SPIN DOUBLE');
    assert.equal(lock({ lines: 1, tspin: 'full' }).label, 'T-SPIN SINGLE');
    assert.equal(lock({ lines: 3, tspin: 'full' }).label, 'T-SPIN TRIPLE');
    assert.equal(lock({ lines: 4, b2b: true }).label, 'B2B QUAD');
    assert.equal(lock({ lines: 2, perfectClear: true }).label, 'DOUBLE PERFECT CLEAR');
    // The B2B prefix marks the multiplier actually firing, not the flag.
    assert.equal(lock({ lines: 3, b2b: true }).label, 'TRIPLE');
});

test('impossible T-spin shapes fall back to a real table row', () => {
    // No SRS placement clears four rows with a T, or three with a Mini; the
    // award and the label must agree on whatever we do with them anyway.
    const quad = lock({ lines: 4, tspin: 'full' });
    assert.equal(quad.points, 800);
    assert.equal(quad.label, 'QUAD');
    const miniTriple = lock({ lines: 3, tspin: 'mini' });
    assert.equal(miniTriple.points, 1600);
    assert.equal(miniTriple.label, 'T-SPIN TRIPLE');
});

test('drop points are flat: +1 soft, +2 hard, level-independent', () => {
    assert.equal(dropPoints(5, 'soft'), 5);
    assert.equal(dropPoints(5, 'hard'), 10);
    assert.equal(dropPoints(0, 'hard'), 0);
    assert.equal(dropPoints(19, 'hard'), 38);
    // No `level` argument exists to pass — that is the point of the row.
    assert.equal(dropPoints.length, 2);
    assert.equal(dropPoints(3, 'nonsense'), 0);
    assert.equal(dropPoints(-4, 'soft'), 0);
});
