/* srs.js — Super Rotation System: five kick tests per transition, first fit
 * wins, otherwise the rotation is refused.
 *
 * PURE by contract (see docs/ARCHITECTURE.md).
 *
 * THE TABLES BELOW ARE +y UP. They are transcribed verbatim from DESIGN.md
 * §2.4 (which is the published guideline convention) so they can be diffed
 * against the spec character for character. The board is y-DOWN, so the sign
 * of dy has to flip somewhere: that happens in exactly ONE place, tryRotate's
 * `piece.y - dy`, and tests/srs.test.js pins it. Do not pre-negate the tables
 * and do not negate again downstream.
 *
 * Keys are 'from>to' over 0 = spawn, 1 = R, 2 = 180, 3 = L.
 */

import { collides } from './board.js';
import { absoluteCells } from './piece.js';

export const KICKS_JLSTZ = deepFreeze({
    '0>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '1>0': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '1>2': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '2>1': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '2>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '3>2': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '3>0': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '0>3': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
});

export const KICKS_I = deepFreeze({
    '0>1': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '1>0': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '1>2': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    '2>1': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '2>3': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    '3>2': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    '3>0': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    '0>3': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
});

// O rotates in place: one identity test, always taken. Giving it a table of
// its own keeps the "try the offsets in order" loop uniform for all seven.
const KICKS_O = Object.freeze([Object.freeze([0, 0])]);

export function kicksFor(type, from, to) {
    if (type === 'O') return KICKS_O;
    const table = type === 'I' ? KICKS_I : KICKS_JLSTZ;
    const key = from + '>' + to;
    const tests = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
    // v1 has no 180 input (DESIGN.md §2.4), so any key that is not a quarter
    // turn is a caller bug, not a shape to improvise around.
    if (!tests) throw new RangeError('no SRS kick table for ' + type + ' ' + key);
    return tests;
}

export function tryRotate(board, piece, dir) {
    const from = piece.rot;
    const to = (from + dir + 4) % 4;
    const tests = kicksFor(piece.type, from, to);
    for (let i = 0; i < tests.length; i++) {
        const dx = tests[i][0], dy = tests[i][1];
        // The y-down flip, and the only one in the project: a kick that lifts
        // the piece (+y up, dy > 0) SUBTRACTS from the row index.
        const moved = Object.assign({}, piece, { rot: to, x: piece.x + dx, y: piece.y - dy });
        if (!collides(board, absoluteCells(moved))) {
            // `kick` is the table entry as published (+y up), to stay diffable
            // against §2.4; `moved` already has the y-down result applied.
            return { piece: moved, kick: tests[i], kickIndex: i };
        }
    }
    return null;   // every test collided: the caller keeps the piece it had
}

function deepFreeze(table) {
    for (const key of Object.keys(table)) {
        const tests = table[key];
        for (let i = 0; i < tests.length; i++) Object.freeze(tests[i]);
        Object.freeze(tests);
    }
    return Object.freeze(table);
}
