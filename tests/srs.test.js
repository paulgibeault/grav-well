/* srs.test.js — the kick tables and the single y-down negation.
 *
 * The SPEC tables below are a SECOND, independent transcription of DESIGN.md
 * §2.4, typed from the doc rather than copied from js/core/srs.js. That is the
 * point: the table in the source and the table here have to agree, so a
 * one-character slip in either shows up as a failure instead of as a rotation
 * that feels almost right. Both are in the published +y-UP convention.
 *
 * Fixtures are bottom-aligned ASCII wells; the comment on each row is its
 * y-down index.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fromStrings, createBoard } from '../js/core/board.js';
import { absoluteCells } from '../js/core/piece.js';
import { KICKS_JLSTZ, KICKS_I, kicksFor, tryRotate } from '../js/core/srs.js';

// DESIGN.md §2.4, J/L/S/T/Z. Rows in table order: 0→R, R→0, R→2, 2→R, 2→L,
// L→2, L→0, 0→L.
const SPEC_JLSTZ = {
    '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
};

// DESIGN.md §2.4, I.
const SPEC_I = {
    '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
};

const TRANSITIONS = ['0>1', '1>0', '1>2', '2>1', '2>3', '3>2', '3>0', '0>3'];
// Each quarter turn and the quarter turn that undoes it.
const INVERSES = [['0>1', '1>0'], ['1>2', '2>1'], ['2>3', '3>2'], ['3>0', '0>3']];

const plain = (tests) => tests.map((t) => [t[0], t[1]]);

test('the shipped tables match the spec transcription verbatim', () => {
    assert.deepEqual(Object.keys(KICKS_JLSTZ).sort(), TRANSITIONS.slice().sort());
    assert.deepEqual(Object.keys(KICKS_I).sort(), TRANSITIONS.slice().sort());
    for (const key of TRANSITIONS) {
        assert.deepEqual(plain(KICKS_JLSTZ[key]), SPEC_JLSTZ[key], 'JLSTZ ' + key);
        assert.deepEqual(plain(KICKS_I[key]), SPEC_I[key], 'I ' + key);
    }
});

test('the two published anchor rows, spelled out', () => {
    // The rows most often mistyped, quoted straight from §2.4.
    assert.deepEqual(plain(KICKS_JLSTZ['0>1']), [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]]);
    assert.deepEqual(plain(KICKS_I['0>1']), [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]]);
});

test('every transition has five tests and every first test is the identity', () => {
    for (const table of [KICKS_JLSTZ, KICKS_I]) {
        for (const key of TRANSITIONS) {
            assert.equal(table[key].length, 5, key);
            assert.deepEqual(plain(table[key])[0], [0, 0], key + ' test 1');
        }
    }
});

test('each transition is the element-wise negation of its inverse', () => {
    for (const table of [KICKS_JLSTZ, KICKS_I]) {
        for (const [fwd, back] of INVERSES) {
            // The `+ 0` is not decoration: negating 0 yields -0, and a strict
            // deep-equal tells -0 and 0 apart.
            const negated = plain(table[fwd]).map(([dx, dy]) => [-dx + 0, -dy + 0]);
            assert.deepEqual(plain(table[back]), negated, back + ' should negate ' + fwd);
        }
    }
});

test('offsets stay inside the guideline range', () => {
    for (const table of [KICKS_JLSTZ, KICKS_I]) {
        for (const key of TRANSITIONS) {
            for (const [dx, dy] of table[key]) {
                assert.ok(Math.abs(dx) <= 2 && Math.abs(dy) <= 2, key + ' ' + dx + ',' + dy);
            }
        }
    }
});

test('kicksFor picks the right table and refuses a non-quarter turn', () => {
    assert.equal(kicksFor('T', 0, 1), KICKS_JLSTZ['0>1']);
    assert.equal(kicksFor('S', 3, 0), KICKS_JLSTZ['3>0']);
    assert.equal(kicksFor('I', 2, 3), KICKS_I['2>3']);
    assert.deepEqual(plain(kicksFor('O', 0, 1)), [[0, 0]]);
    assert.throws(() => kicksFor('T', 0, 2), RangeError);   // no 180 input in v1
    assert.throws(() => kicksFor('I', 1, 1), RangeError);
});

test('the tables cannot be edited through the export', () => {
    assert.throws(() => { KICKS_JLSTZ['0>1'] = []; }, TypeError);
    assert.throws(() => { KICKS_I['0>1'][0][0] = 9; }, TypeError);
});

test('an unobstructed rotation takes test 1 and does not move the piece', () => {
    const board = createBoard();
    const piece = { type: 'T', rot: 0, x: 4, y: 30 };
    const res = tryRotate(board, piece, 1);
    assert.equal(res.kickIndex, 0);
    assert.deepEqual(plain([res.kick])[0], [0, 0]);
    assert.deepEqual(res.piece, { type: 'T', rot: 1, x: 4, y: 30 });
    assert.deepEqual(piece, { type: 'T', rot: 0, x: 4, y: 30 });   // untouched
    assert.notEqual(res.piece, piece);
});

test('rotation direction wraps: CW off 3 lands on 0, CCW off 0 lands on 3', () => {
    const board = createBoard();
    assert.equal(tryRotate(board, { type: 'L', rot: 3, x: 4, y: 30 }, 1).piece.rot, 0);
    assert.equal(tryRotate(board, { type: 'L', rot: 0, x: 4, y: 30 }, -1).piece.rot, 3);
});

test('left wall kick: a T hugging column 0 is pushed one column right', () => {
    // The T points right, so its box hangs off the field; rotating back to
    // spawn would put a cell at x = -1, and test 2 shoves it clear.
    const board = createBoard();
    const piece = { type: 'T', rot: 1, x: -1, y: 37 };
    assert.deepEqual(absoluteCells(piece), [[0, 37], [0, 38], [1, 38], [0, 39]]);

    const res = tryRotate(board, piece, -1);           // 1>0
    assert.equal(res.kickIndex, 1);
    assert.deepEqual(plain([res.kick])[0], [1, 0]);
    assert.deepEqual(res.piece, { type: 'T', rot: 0, x: 0, y: 37 });
    assert.deepEqual(absoluteCells(res.piece), [[1, 37], [0, 38], [1, 38], [2, 38]]);
});

test('right wall kick: a T hugging column 9 is pushed one column left', () => {
    const board = createBoard();
    const piece = { type: 'T', rot: 3, x: 8, y: 37 };
    assert.deepEqual(absoluteCells(piece), [[9, 37], [8, 38], [9, 38], [9, 39]]);

    const res = tryRotate(board, piece, 1);            // 3>0
    assert.equal(res.kickIndex, 1);
    assert.deepEqual(plain([res.kick])[0], [-1, 0]);
    assert.deepEqual(res.piece, { type: 'T', rot: 0, x: 7, y: 37 });
});

test('floor kick: an I flat on the floor is lifted two rows to stand up', () => {
    // Tests 1-4 all push the vertical I through the floor; test 5, (+1,+2),
    // is the only one that fits — and +2 in the published tables means UP, so
    // the row index has to go DOWN by two.
    const board = createBoard();
    const piece = { type: 'I', rot: 0, x: 3, y: 38 };
    assert.deepEqual(absoluteCells(piece), [[3, 39], [4, 39], [5, 39], [6, 39]]);

    const res = tryRotate(board, piece, 1);            // 0>1
    assert.equal(res.kickIndex, 4);
    assert.deepEqual(plain([res.kick])[0], [1, 2]);
    assert.deepEqual(res.piece, { type: 'I', rot: 1, x: 4, y: 36 });
    assert.deepEqual(absoluteCells(res.piece), [[6, 36], [6, 37], [6, 38], [6, 39]]);
});

test('I double-column kick: blocked at its pivot, it steps two columns over', () => {
    const board = fromStrings([
        '..........',   // 36
        '..........',   // 37   the I lies here
        '.....X....',   // 38   a two-high spur in column 5
        '.....X....',   // 39
    ]);
    const piece = { type: 'I', rot: 0, x: 3, y: 36 };
    assert.deepEqual(absoluteCells(piece), [[3, 37], [4, 37], [5, 37], [6, 37]]);

    const res = tryRotate(board, piece, 1);            // 0>1, test 2 = (-2,0)
    assert.equal(res.kickIndex, 1);
    assert.deepEqual(plain([res.kick])[0], [-2, 0]);
    assert.deepEqual(res.piece, { type: 'I', rot: 1, x: 1, y: 36 });
    assert.deepEqual(absoluteCells(res.piece), [[3, 36], [3, 37], [3, 38], [3, 39]]);
});

test('the TST kick: a T twists down two rows into a three-deep slot', () => {
    const board = fromStrings([
        '....X.....',   // 34   the lip that blocks tests 2 and 3
        '..........',   // 35   the T lies flat here, nub up
        'XXXX.XXXXX',   // 36
        'XXXX..XXXX',   // 37   the notch the nub swings into
        'XXXX.XXXXX',   // 38
        'XXXXXXXXX.',   // 39
    ]);
    const piece = { type: 'T', rot: 0, x: 4, y: 34 };
    assert.deepEqual(absoluteCells(piece), [[5, 34], [4, 35], [5, 35], [6, 35]]);

    const res = tryRotate(board, piece, 1);            // 0>1, test 5 = (-1,-2)
    assert.equal(res.kickIndex, 4);
    assert.deepEqual(plain([res.kick])[0], [-1, -2]);
    assert.deepEqual(res.piece, { type: 'T', rot: 1, x: 3, y: 36 });
    // Filling the slot and the notch: rows 36, 37 and 38 are now complete.
    assert.deepEqual(absoluteCells(res.piece), [[4, 36], [4, 37], [5, 37], [4, 38]]);
});

test('the y-down negation happens once, at application time', () => {
    // Two rotations whose winning kick has a non-zero dy, in both directions.
    // In each, x moves WITH the table's dx and y moves AGAINST its dy.
    const cases = [
        { board: createBoard(), piece: { type: 'I', rot: 0, x: 3, y: 38 }, dir: 1 },
        {
            board: fromStrings([
                '....X.....', '..........', 'XXXX.XXXXX',
                'XXXX..XXXX', 'XXXX.XXXXX', 'XXXXXXXXX.',
            ]),
            piece: { type: 'T', rot: 0, x: 4, y: 34 }, dir: 1,
        },
    ];
    for (const c of cases) {
        const res = tryRotate(c.board, c.piece, c.dir);
        const [dx, dy] = res.kick;
        assert.notEqual(dy, 0, 'fixture should exercise a vertical kick');
        assert.equal(res.piece.x, c.piece.x + dx);
        assert.equal(res.piece.y, c.piece.y - dy, 'dy must be negated exactly once');
        // And the reported kick is still the table entry, unflipped.
        assert.deepEqual(plain([res.kick])[0], plain([kicksFor(c.piece.type, c.piece.rot, res.piece.rot)[res.kickIndex]])[0]);
    }
});

test('O rotates in place, in both directions, from every state', () => {
    const board = fromStrings([
        '..........',   // 38
        'XXXX..XXXX',   // 39   an O sitting in a two-wide notch
    ]);
    for (let rot = 0; rot < 4; rot++) {
        for (const dir of [1, -1]) {
            const piece = { type: 'O', rot: rot, x: 4, y: 38 };
            const res = tryRotate(board, piece, dir);
            assert.equal(res.kickIndex, 0);
            assert.deepEqual(plain([res.kick])[0], [0, 0]);
            assert.equal(res.piece.x, 4);
            assert.equal(res.piece.y, 38);
            assert.equal(res.piece.rot, (rot + dir + 4) % 4);
            assert.deepEqual(absoluteCells(res.piece), [[4, 38], [5, 38], [4, 39], [5, 39]]);
        }
    }
});

test('a rotation that fails all five tests returns null and changes nothing', () => {
    const board = fromStrings([
        'XXXXXXXXXX',   // 36
        'XXXXXXXXXX',   // 37
        'XXXX.XXXXX',   // 38   a T-shaped pocket, sealed on every side
        'XXX...XXXX',   // 39
    ]);
    const piece = { type: 'T', rot: 0, x: 3, y: 38 };
    const before = { ...piece };
    assert.deepEqual(absoluteCells(piece), [[4, 38], [3, 39], [4, 39], [5, 39]]);

    assert.equal(tryRotate(board, piece, 1), null);
    assert.equal(tryRotate(board, piece, -1), null);
    assert.deepEqual(piece, before);
});

test('the ceiling is solid to a rotation, so a kick pushes the piece down', () => {
    // cellAt calls the space above row 0 empty, but it is no place to store a
    // cell, so collides refuses it: the first three tests of I 0>R all want a
    // row above the top of the field and lose, and test 4's (-2,-1) — down
    // one, in y-down terms — is what actually fits.
    const board = createBoard();
    const piece = { type: 'I', rot: 0, x: 3, y: -1 };
    assert.deepEqual(absoluteCells(piece), [[3, 0], [4, 0], [5, 0], [6, 0]]);

    const res = tryRotate(board, piece, 1);
    assert.equal(res.kickIndex, 3);
    assert.deepEqual(plain([res.kick])[0], [-2, -1]);
    assert.deepEqual(res.piece, { type: 'I', rot: 1, x: 1, y: 0 });
    assert.deepEqual(absoluteCells(res.piece), [[3, 0], [3, 1], [3, 2], [3, 3]]);
});
