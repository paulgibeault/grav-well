/* piece.test.js — the 28 cell sets pinned literally.
 *
 * piece.js DERIVES all four rotation states from one spawn shape and one line
 * of box math, which is a good trade only if an accidental change to that line
 * is loud. So every state is written out here by hand, in reading order (top
 * row first, then left to right), with the ASCII the numbers mean. If you are
 * changing this file to make a test pass, stop: re-derive the shape on paper
 * first.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { COLS } from '../js/core/constants.js';
import { BOX, cellsFor, absoluteCells, spawnPiece } from '../js/core/piece.js';

// rot: 0 spawn, 1 R (CW), 2 180, 3 L (CCW).
const PINNED = {
    // .X.    .X.    ...    .X.
    // XXX    .XX    XXX    XX.
    // ...    .X.    .X.    .X.
    T: [
        [[1, 0], [0, 1], [1, 1], [2, 1]],
        [[1, 0], [1, 1], [2, 1], [1, 2]],
        [[0, 1], [1, 1], [2, 1], [1, 2]],
        [[1, 0], [0, 1], [1, 1], [1, 2]],
    ],
    // X..    .XX    ...    .X.
    // XXX    .X.    XXX    .X.
    // ...    .X.    ..X    XX.
    J: [
        [[0, 0], [0, 1], [1, 1], [2, 1]],
        [[1, 0], [2, 0], [1, 1], [1, 2]],
        [[0, 1], [1, 1], [2, 1], [2, 2]],
        [[1, 0], [1, 1], [0, 2], [1, 2]],
    ],
    // ..X    .X.    ...    XX.
    // XXX    .X.    XXX    .X.
    // ...    .XX    X..    .X.
    L: [
        [[2, 0], [0, 1], [1, 1], [2, 1]],
        [[1, 0], [1, 1], [1, 2], [2, 2]],
        [[0, 1], [1, 1], [2, 1], [0, 2]],
        [[0, 0], [1, 0], [1, 1], [1, 2]],
    ],
    // .XX    .X.    ...    X..
    // XX.    .XX    .XX    XX.
    // ...    ..X    XX.    .X.
    S: [
        [[1, 0], [2, 0], [0, 1], [1, 1]],
        [[1, 0], [1, 1], [2, 1], [2, 2]],
        [[1, 1], [2, 1], [0, 2], [1, 2]],
        [[0, 0], [0, 1], [1, 1], [1, 2]],
    ],
    // XX.    ..X    ...    .X.
    // .XX    .XX    XX.    XX.
    // ...    .X.    .XX    X..
    Z: [
        [[0, 0], [1, 0], [1, 1], [2, 1]],
        [[2, 0], [1, 1], [2, 1], [1, 2]],
        [[0, 1], [1, 1], [1, 2], [2, 2]],
        [[1, 0], [0, 1], [1, 1], [0, 2]],
    ],
    // XX     XX     XX     XX      (2x2 box: rotation is a no-op)
    // XX     XX     XX     XX
    O: [
        [[0, 0], [1, 0], [0, 1], [1, 1]],
        [[0, 0], [1, 0], [0, 1], [1, 1]],
        [[0, 0], [1, 0], [0, 1], [1, 1]],
        [[0, 0], [1, 0], [0, 1], [1, 1]],
    ],
    // ....   ..X.   ....   .X..     (4x4 box)
    // XXXX   ..X.   ....   .X..
    // ....   ..X.   XXXX   .X..
    // ....   ..X.   ....   .X..
    I: [
        [[0, 1], [1, 1], [2, 1], [3, 1]],
        [[2, 0], [2, 1], [2, 2], [2, 3]],
        [[0, 2], [1, 2], [2, 2], [3, 2]],
        [[1, 0], [1, 1], [1, 2], [1, 3]],
    ],
};

for (const type of Object.keys(PINNED)) {
    for (let rot = 0; rot < 4; rot++) {
        test(`${type} rot ${rot} cells are exactly the pinned set`, () => {
            assert.deepEqual(cellsFor(type, rot).map((c) => [c[0], c[1]]), PINNED[type][rot]);
        });
    }
}

test('BOX sizes: I is 4x4, O is 2x2, the rest 3x3', () => {
    assert.equal(BOX.I, 4);
    assert.equal(BOX.O, 2);
    assert.equal(BOX.default, 3);
});

test('every state holds four distinct cells inside its box', () => {
    for (const type of Object.keys(PINNED)) {
        const n = BOX[type] || BOX.default;
        for (let rot = 0; rot < 4; rot++) {
            const cells = cellsFor(type, rot);
            assert.equal(cells.length, 4, `${type} rot ${rot}`);
            const seen = new Set();
            for (const [x, y] of cells) {
                assert.ok(x >= 0 && x < n && y >= 0 && y < n, `${type} rot ${rot} cell ${x},${y}`);
                seen.add(x + ',' + y);
            }
            assert.equal(seen.size, 4, `${type} rot ${rot} has a duplicated cell`);
        }
    }
});

test('four quarter turns come back to spawn, and rot wraps both ways', () => {
    for (const type of Object.keys(PINNED)) {
        assert.deepEqual(cellsFor(type, 4), cellsFor(type, 0), type);
        assert.deepEqual(cellsFor(type, 7), cellsFor(type, 3), type);
        assert.deepEqual(cellsFor(type, -1), cellsFor(type, 3), type);
        assert.deepEqual(cellsFor(type, -4), cellsFor(type, 0), type);
    }
});

test('a rotation state cannot be mutated by a caller', () => {
    const cells = cellsFor('T', 0);
    assert.throws(() => { cells[0] = [9, 9]; }, TypeError);
    assert.throws(() => { cells[0][0] = 9; }, TypeError);
});

test('unknown types are refused rather than improvised', () => {
    assert.throws(() => cellsFor('Q', 0), RangeError);
    assert.throws(() => spawnPiece('Q'), RangeError);
});

test('spawn positions: rows 18-19, centered rounding left', () => {
    // J/L/S/T/Z in columns 3..5, I in 3..6, O in 4..5 (DESIGN.md §2.1,
    // 0-indexed) — and every piece touching row 19, the last buffer row above
    // the visible well.
    assert.deepEqual(spawnPiece('T'), { type: 'T', rot: 0, x: 3, y: 18 });
    assert.deepEqual(spawnPiece('J'), { type: 'J', rot: 0, x: 3, y: 18 });
    assert.deepEqual(spawnPiece('L'), { type: 'L', rot: 0, x: 3, y: 18 });
    assert.deepEqual(spawnPiece('S'), { type: 'S', rot: 0, x: 3, y: 18 });
    assert.deepEqual(spawnPiece('Z'), { type: 'Z', rot: 0, x: 3, y: 18 });
    assert.deepEqual(spawnPiece('I'), { type: 'I', rot: 0, x: 3, y: 18 });
    assert.deepEqual(spawnPiece('O'), { type: 'O', rot: 0, x: 4, y: 18 });
});

test('absoluteCells puts each spawned piece on exactly the right columns', () => {
    assert.deepEqual(absoluteCells(spawnPiece('T')), [[4, 18], [3, 19], [4, 19], [5, 19]]);
    assert.deepEqual(absoluteCells(spawnPiece('J')), [[3, 18], [3, 19], [4, 19], [5, 19]]);
    assert.deepEqual(absoluteCells(spawnPiece('L')), [[5, 18], [3, 19], [4, 19], [5, 19]]);
    assert.deepEqual(absoluteCells(spawnPiece('S')), [[4, 18], [5, 18], [3, 19], [4, 19]]);
    assert.deepEqual(absoluteCells(spawnPiece('Z')), [[3, 18], [4, 18], [4, 19], [5, 19]]);
    assert.deepEqual(absoluteCells(spawnPiece('O')), [[4, 18], [5, 18], [4, 19], [5, 19]]);
    assert.deepEqual(absoluteCells(spawnPiece('I')), [[3, 19], [4, 19], [5, 19], [6, 19]]);
});

test('spawned pieces sit in the buffer, never in the visible well', () => {
    for (const type of Object.keys(PINNED)) {
        const cells = absoluteCells(spawnPiece(type));
        const cols = cells.map((c) => c[0]);
        const rows = cells.map((c) => c[1]);
        assert.ok(Math.min(...rows) >= 18 && Math.max(...rows) <= 19, type);
        assert.ok(Math.min(...cols) >= 0 && Math.max(...cols) < COLS, type);
        // Rounding LEFT: the gap on the left is never wider than on the right.
        const gapLeft = Math.min(...cols);
        const gapRight = COLS - 1 - Math.max(...cols);
        assert.ok(gapLeft <= gapRight, `${type} is not centered rounding left`);
    }
});

test('absoluteCells translates without touching the piece', () => {
    const piece = { type: 'I', rot: 1, x: 5, y: 30 };
    assert.deepEqual(absoluteCells(piece), [[7, 30], [7, 31], [7, 32], [7, 33]]);
    assert.deepEqual(piece, { type: 'I', rot: 1, x: 5, y: 30 });
    // Negative origins are legal mid-kick: the piece box may hang off the left
    // edge as long as its filled cells do not.
    assert.deepEqual(absoluteCells({ type: 'T', rot: 1, x: -1, y: 37 }),
        [[0, 37], [0, 38], [1, 38], [0, 39]]);
});
