/* How many previews the next queue shows, which is a layout decision the
 * renderer makes on its own.
 *
 * queueCapacity() exists because the phone strip turned the queue into a band
 * ~113px wide: five slots in it are 20px each, which is a coloured shape
 * rather than a piece anyone can name. The count now falls out of the box, so
 * the rule needs pinning — it is the kind of thing a later "just show five"
 * would quietly undo, and nothing on screen would look broken enough to
 * notice.
 *
 * js/render/preview.js is pure geometry over a box, so it loads under
 * `node --test` with no page. Importing it at all is the smaller assertion.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queueCapacity } from '../js/render/preview.js';

const MAX = 5;
const MIN_CELL = 8;   // js/render/index.js's MIN_PREVIEW_CELL

test('the tall side rail still shows the whole queue', () => {
    // 96x300 is index.html's own #next box in the side-rail layout.
    assert.equal(queueCapacity({ w: 96, h: 300 }, MAX, MIN_CELL), MAX);
});

test('the phone strip shows fewer, bigger previews', () => {
    // Measured: 113x45 at 375px wide. Five slots there are 22px each.
    const n = queueCapacity({ w: 113, h: 45 }, MAX, MIN_CELL);
    assert.ok(n >= 1 && n < MAX, `expected fewer than ${MAX}, got ${n}`);
});

test('the count never reaches zero, however small the box', () => {
    // A queue of nothing reads as a broken panel, not as a small one — and
    // drawQueue's own `Math.max(1, count)` should never be the thing saving
    // us, because then the signature and the drawing would disagree.
    for (const box of [{ w: 20, h: 10 }, { w: 2.5, h: 2.5 }, { w: 400, h: 1 }]) {
        assert.equal(queueCapacity(box, MAX, MIN_CELL) >= 1, true);
    }
});

test('an unmeasured box asks for the full queue, not for one', () => {
    /* fitPreview() reports {0,0} until the canvas has been laid out, and the
     * first paint runs against exactly that. Degrading to a single preview
     * there would show a one-piece queue for a frame on every load. */
    for (const box of [null, undefined, { w: 0, h: 0 }, { w: 1, h: 1 }]) {
        assert.equal(queueCapacity(box, MAX, MIN_CELL), MAX);
    }
});

/* Monotone WITHIN an orientation, and only within one. drawQueue picks its
 * axis with `box.h >= box.w`, so a box crossing square flips from stacking
 * previews down its height to laying them along its width — and the capacity
 * jumps with it. That cliff belongs to the layout axis, not to this function,
 * and #next is never square in either layout (5/2 in the strip, 8/25 in the
 * rail), so the guarantee worth having is the one inside each axis. */
test('a wider band shows more previews, never fewer', () => {
    let prev = 0;
    for (let w = 45; w <= 400; w += 5) {
        const n = queueCapacity({ w: w, h: 40 }, MAX, MIN_CELL);
        assert.ok(n >= prev, `capacity fell from ${prev} to ${n} at w=${w}`);
        prev = n;
    }
    assert.equal(prev, MAX);
});

test('a taller column shows more previews, never fewer', () => {
    let prev = 0;
    for (let h = 40; h <= 400; h += 5) {
        const n = queueCapacity({ w: 36, h: h }, MAX, MIN_CELL);
        assert.ok(n >= prev, `capacity fell from ${prev} to ${n} at h=${h}`);
        prev = n;
    }
    assert.equal(prev, MAX);
});
