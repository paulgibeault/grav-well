/* 7-bag randomizer (§2.3): shuffle all seven, deal in order, refill when the
 * bag runs dry — so the drought between two of the same piece can never
 * exceed 12 and the stream still feels random.
 *
 * PURE by contract (tests/repo-gates.test.js enforces it): no DOM, no window,
 * no Arcade, no timers, no Math.random. See docs/ARCHITECTURE.md.
 *
 * The rng is passed IN as a live instance and never created here: the run
 * owns exactly one makeRng, and every draw has to come off it in order or a
 * replay from seed + input log diverges.
 */

import { TYPES } from './constants.js';

export function createBag(rng) {
    // The undealt tail of the current bag, plus any bag `peek` had to pull
    // early. Kept flat rather than as bag-of-seven objects because the only
    // thing anyone asks is "what are the next n".
    let queue = [];

    function refill() {
        // shuffle() copies, so TYPES is never touched.
        const bag = rng.shuffle(TYPES);
        for (let i = 0; i < bag.length; i++) queue.push(bag[i]);
    }

    function next() {
        if (queue.length === 0) refill();
        return queue.shift();
    }

    // Lazily refills, so a 5-deep preview that straddles a bag boundary works
    // — and because refilling only ever APPENDS, peeking can never change what
    // a later next() returns. It does advance the rng, which is exactly why
    // getState has to carry the queue as well as the generator state.
    function peek(n) {
        const want = Math.max(0, Math.floor(Number(n) || 0));
        while (queue.length < want) refill();
        return queue.slice(0, want);
    }

    // JSON-safe and complete: generator state + the partially-dealt bag. Save
    // one without the other and a resumed run forks its piece stream.
    function getState() {
        return { rng: rng.getState(), queue: queue.slice() };
    }

    function setState(s) {
        if (!s || typeof s !== 'object') return false;
        if (!rng.setState(s.rng)) return false;
        queue = Array.isArray(s.queue) ? s.queue.slice() : [];
        return true;
    }

    return { next, peek, getState, setState };
}
