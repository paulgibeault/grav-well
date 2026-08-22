/* tspin.test.js — the 3-corner rule (DESIGN.md §2.9).
 *
 * Fixtures are bottom-aligned ASCII wells; the comment on each row is its
 * y-down index. The T is placed where it would have landed, and the kickIndex
 * argument stands in for the caller's "the last maneuver was a rotation".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fromStrings, createBoard } from '../js/core/board.js';
import { absoluteCells } from '../js/core/piece.js';
import { detectTSpin } from '../js/core/tspin.js';

// The same well twice over: a T-shaped slot with an overhang on its left.
// Which way the T points inside it is the whole difference between full and
// mini, so both cases below share this board on purpose.
const SLOT = [
    'XXXX..XXXX',   // 37   overhang at column 3, open at 4 and 5
    'XXX...XXXX',   // 38
    'XXXX.XXXXX',   // 39
];

test('full T-spin: both corners on the pointing side are covered', () => {
    const board = fromStrings(SLOT);
    // Pointing down, nub in the floor notch — the classic T-spin double.
    const piece = { type: 'T', rot: 2, x: 3, y: 37 };
    assert.deepEqual(absoluteCells(piece), [[3, 38], [4, 38], [5, 38], [4, 39]]);
    assert.equal(detectTSpin(board, piece, 0), 'full');
});

test('mini T-spin: three corners, but the pointing side is half open', () => {
    const board = fromStrings(SLOT);
    // Same well, same three occupied corners — the T just points UP, and the
    // top-right corner is open sky above the overhang.
    const piece = { type: 'T', rot: 0, x: 3, y: 37 };
    assert.deepEqual(absoluteCells(piece), [[4, 37], [3, 38], [4, 38], [5, 38]]);
    assert.equal(detectTSpin(board, piece, 0), 'mini');
});

test('the last kick test upgrades a mini to a full T-spin', () => {
    const board = fromStrings(SLOT);
    const piece = { type: 'T', rot: 0, x: 3, y: 37 };
    assert.equal(detectTSpin(board, piece, 3), 'mini');
    assert.equal(detectTSpin(board, piece, 4), 'full');   // the (±1, ∓2) TST kick
});

test('a full T-spin stays full whatever the kick index was', () => {
    const board = fromStrings(SLOT);
    const piece = { type: 'T', rot: 2, x: 3, y: 37 };
    for (const kickIndex of [0, 1, 2, 3, 4]) {
        assert.equal(detectTSpin(board, piece, kickIndex), 'full');
    }
});

test('the TST fixture from srs.test.js reads as a full T-spin', () => {
    const board = fromStrings([
        '....X.....',   // 34
        '..........',   // 35
        'XXXX.XXXXX',   // 36
        'XXXX..XXXX',   // 37
        'XXXX.XXXXX',   // 38
        'XXXXXXXXX.',   // 39
    ]);
    const piece = { type: 'T', rot: 1, x: 3, y: 36 };   // where kick test 5 put it
    assert.deepEqual(absoluteCells(piece), [[4, 36], [4, 37], [5, 37], [4, 38]]);
    assert.equal(detectTSpin(board, piece, 4), 'full');
});

test('walls count as occupied corners', () => {
    // A T twisted into the left wall: two of its four corners are off the
    // field, and cellAt hands them back as solid.
    const mini = fromStrings([
        '..........',   // 37
        '..........',   // 38
        '.X........',   // 39
    ]);
    const piece = { type: 'T', rot: 1, x: -1, y: 37 };   // pointing right
    assert.deepEqual(absoluteCells(piece), [[0, 37], [0, 38], [1, 38], [0, 39]]);
    // Corners: two wall cells, plus (1,39). The pointing side is the right
    // pair, and (1,37) is open.
    assert.equal(detectTSpin(mini, piece, 0), 'mini');

    const full = fromStrings([
        '.X........',   // 37
        '..........',   // 38
        '.X........',   // 39
    ]);
    assert.equal(detectTSpin(full, piece, 0), 'full');
});

test('the floor counts as occupied corners', () => {
    // Center on the floor row: the two corners below it are off the field.
    const piece = { type: 'T', rot: 0, x: 3, y: 38 };
    assert.deepEqual(absoluteCells(piece), [[4, 38], [3, 39], [4, 39], [5, 39]]);

    const mini = fromStrings([
        'XXXX......',   // 38   only the top-left corner is covered
        '..........',   // 39
    ]);
    assert.equal(detectTSpin(mini, piece, 0), 'mini');

    const full = fromStrings([
        'XXXX.X....',   // 38   both corners on the pointing (up) side
        '..........',   // 39
    ]);
    assert.equal(detectTSpin(full, piece, 0), 'full');

    // Floor alone is only two corners, which is not a T-spin at all.
    assert.equal(detectTSpin(createBoard(), piece, 0), 'none');
});

test('the sky above the field gives no free corners', () => {
    // The mirror of the floor case: rows above 0 read as empty, so a T at the
    // very top of the buffer is two corners short.
    const board = fromStrings(['..........', 'X.X.......'], { fromRow: 0 });
    const piece = { type: 'T', rot: 2, x: 3, y: -1 };
    assert.deepEqual(absoluteCells(piece), [[3, 0], [4, 0], [5, 0], [4, 1]]);
    assert.equal(detectTSpin(board, piece, 0), 'none');
});

test('fewer than three corners is never a T-spin', () => {
    const board = fromStrings([
        'X...X.....',   // 38
        '..........',   // 39
    ]);
    const piece = { type: 'T', rot: 0, x: 3, y: 37 };
    // Two diagonals at most, whatever the rotation or the kick.
    for (let rot = 0; rot < 4; rot++) {
        assert.equal(detectTSpin(board, { ...piece, rot }, 4), 'none');
    }
    assert.equal(detectTSpin(createBoard(), piece, 4), 'none');
});

test('only a T can spin', () => {
    const board = fromStrings(SLOT);
    for (const type of ['I', 'O', 'S', 'Z', 'J', 'L']) {
        assert.equal(detectTSpin(board, { type, rot: 2, x: 3, y: 37 }, 4), 'none', type);
    }
    assert.equal(detectTSpin(board, null, 4), 'none');
});

test('kickIndex -1 means the last maneuver was not a rotation', () => {
    const board = fromStrings(SLOT);
    // The same placements that score full and mini above score nothing when
    // the piece was moved or dropped into the slot instead of spun into it.
    assert.equal(detectTSpin(board, { type: 'T', rot: 2, x: 3, y: 37 }, -1), 'none');
    assert.equal(detectTSpin(board, { type: 'T', rot: 0, x: 3, y: 37 }, -1), 'none');
});

test('the pointing side is what full vs mini turns on, in every rotation', () => {
    // A bare corner mask around a fixed center at (4,30), so nothing but the
    // four diagonals is in play. Mask order: top-left, top-right, bottom-left,
    // bottom-right.
    const cornerBoard = (m) => {
        const row = (a, b) => '...' + (a ? 'X' : '.') + '.' + (b ? 'X' : '.') + '....';
        return fromStrings([row(m[0], m[1]), '..........', row(m[2], m[3])], { fromRow: 29 });
    };
    const at = (rot) => ({ type: 'T', rot, x: 3, y: 29 });
    const FRONT = [[0, 1], [1, 3], [2, 3], [0, 2]];   // corner indices per rotation

    for (let rot = 0; rot < 4; rot++) {
        const [f1, f2] = FRONT[rot];
        const back = [0, 1, 2, 3].filter((i) => i !== f1 && i !== f2);

        const all = [1, 1, 1, 1];
        assert.equal(detectTSpin(cornerBoard(all), at(rot), 0), 'full', `rot ${rot} four corners`);

        const frontPlusOne = [0, 0, 0, 0];
        frontPlusOne[f1] = 1; frontPlusOne[f2] = 1; frontPlusOne[back[0]] = 1;
        assert.equal(detectTSpin(cornerBoard(frontPlusOne), at(rot), 0), 'full', `rot ${rot} front pair`);

        const backPlusOne = [0, 0, 0, 0];
        backPlusOne[back[0]] = 1; backPlusOne[back[1]] = 1; backPlusOne[f1] = 1;
        assert.equal(detectTSpin(cornerBoard(backPlusOne), at(rot), 0), 'mini', `rot ${rot} back pair`);
        assert.equal(detectTSpin(cornerBoard(backPlusOne), at(rot), 4), 'full', `rot ${rot} upgraded`);

        const frontOnly = [0, 0, 0, 0];
        frontOnly[f1] = 1; frontOnly[f2] = 1;
        assert.equal(detectTSpin(cornerBoard(frontOnly), at(rot), 4), 'none', `rot ${rot} two corners`);
    }
});
