import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../js/arcade-rng.js';
import { TYPES } from '../js/core/constants.js';
import { createBag } from '../js/core/bag.js';

function draw(bag, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(bag.next());
    return out;
}

test('the vendored PRNG still produces the guide\'s known-answer vectors', () => {
    // If this fails, js/arcade-rng.js has been edited and every seeded run in
    // the fleet has forked. Fix the vendored copy, do not touch this vector.
    const rng = makeRng(42);
    assert.equal(rng(), 0.6011037519201636);
    assert.equal(rng(), 0.44829055899754167);
    assert.equal(rng(), 0.8524657934904099);
});

test('seed 42 deals a pinned 14-piece opening', () => {
    // Two full bags, hard-coded from the real generator. This pins the bag
    // algorithm (shuffle-then-deal, refill on empty) as tightly as the vector
    // above pins the PRNG — a change to either fails here first.
    const bag = createBag(makeRng(42));
    assert.deepEqual(draw(bag, 14), [
        'S', 'O', 'I', 'J', 'L', 'T', 'Z',
        'T', 'J', 'I', 'L', 'Z', 'S', 'O',
    ]);
});

test('the same seed always deals the same stream', () => {
    const a = draw(createBag(makeRng('grav-well')), 40);
    const b = draw(createBag(makeRng('grav-well')), 40);
    assert.deepEqual(a, b);
    const other = draw(createBag(makeRng('grav-well-2')), 40);
    assert.notDeepEqual(a, other);
});

test('every bag-aligned window of 7 is a permutation of all seven types', () => {
    for (let seed = 1; seed <= 25; seed++) {
        const stream = draw(createBag(makeRng(seed)), 7 * 40);
        for (let i = 0; i < stream.length; i += 7) {
            const window = stream.slice(i, i + 7).slice().sort();
            assert.deepEqual(window, TYPES.slice().sort(),
                'seed ' + seed + ' bag ' + (i / 7));
        }
    }
});

test('no type appears three times in any 7 consecutive pieces', () => {
    // The 7-bag guarantee that matters to a player: the worst drought is 12
    // and a flood of three of anything inside one window is impossible.
    for (let seed = 100; seed < 120; seed++) {
        const stream = draw(createBag(makeRng(seed)), 7 * 40);
        for (let i = 0; i + 7 <= stream.length; i++) {
            const counts = {};
            for (const t of stream.slice(i, i + 7)) {
                counts[t] = (counts[t] || 0) + 1;
                assert.ok(counts[t] <= 2, 'seed ' + seed + ' at ' + i + ': ' + t);
            }
        }
    }
});

test('peek(5) is exactly the next five next() calls', () => {
    const bag = createBag(makeRng(7));
    const preview = bag.peek(5);
    assert.equal(preview.length, 5);
    assert.deepEqual(draw(bag, 5), preview);
});

test('peek refills lazily across a bag boundary without disturbing the deal', () => {
    const bag = createBag(makeRng(7));
    draw(bag, 4);                       // 3 left in the current bag
    const preview = bag.peek(5);        // straddles the boundary
    assert.equal(preview.length, 5);
    assert.deepEqual(draw(bag, 5), preview);

    // Peeking repeatedly (which is what a 5-preview HUD does every frame)
    // must not consume anything or drift the stream.
    const control = draw(createBag(makeRng(7)), 20);
    const b2 = createBag(makeRng(7));
    const got = [];
    for (let i = 0; i < 20; i++) {
        assert.deepEqual(b2.peek(5)[0], control[i]);
        b2.peek(5);
        b2.peek(1);
        got.push(b2.next());
    }
    assert.deepEqual(got, control);
});

test('peek tolerates 0 and nonsense without touching the queue', () => {
    const bag = createBag(makeRng(3));
    assert.deepEqual(bag.peek(0), []);
    assert.deepEqual(bag.peek(-2), []);
    const expected = draw(createBag(makeRng(3)), 3);
    assert.deepEqual(draw(bag, 3), expected);
});

test('getState hands out copies, not the live queue', () => {
    const bag = createBag(makeRng(11));
    const expected = bag.peek(3);
    const s = bag.getState();
    s.queue.length = 0;
    s.queue.push('I', 'I', 'I');
    assert.deepEqual(draw(bag, 3), expected);
});

test('getState/setState resumes an identical piece stream mid-bag', () => {
    // Snapshot after 10 pieces — deliberately mid-bag, so both halves of the
    // state (the generator AND the undealt tail) have to be carried.
    const live = createBag(makeRng(2024));
    draw(live, 10);
    const snapshot = JSON.parse(JSON.stringify(live.getState()));
    const uninterrupted = draw(live, 30);

    const resumed = createBag(makeRng(0));
    assert.equal(resumed.setState(snapshot), true);
    assert.deepEqual(draw(resumed, 30), uninterrupted,
        'a resumed run must replay the piece stream exactly');
});

test('a snapshot taken after a peek still resumes exactly', () => {
    // peek pulls the next bag early, which advances the rng ahead of the
    // pieces actually dealt — the case a rng-state-only save would corrupt.
    const live = createBag(makeRng(2024));
    draw(live, 5);
    live.peek(5);
    const snapshot = JSON.parse(JSON.stringify(live.getState()));
    const uninterrupted = draw(live, 21);

    const resumed = createBag(makeRng(0));
    resumed.setState(snapshot);
    assert.deepEqual(draw(resumed, 21), uninterrupted);
});

test('setState rejects garbage instead of forking the stream silently', () => {
    const bag = createBag(makeRng(5));
    assert.equal(bag.setState(null), false);
    assert.equal(bag.setState({ rng: 'not a number', queue: [] }), false);
    assert.deepEqual(draw(bag, 7), draw(createBag(makeRng(5)), 7));
});
