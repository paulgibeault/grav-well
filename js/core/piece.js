/* piece.js — the seven tetrominoes and their four rotation states.
 *
 * PURE by contract (see docs/ARCHITECTURE.md). A piece is a plain object:
 * { type: 'T', rot: 0, x: 3, y: 18 } — x/y locate the top-left corner of its
 * bounding box in the y-DOWN board, rot is 0 spawn / 1 R / 2 180 / 3 L.
 */

import { COLS, HIDDEN_ROWS } from './constants.js';

export const BOX = { I: 4, O: 2, default: 3 };

// Spawn shapes, y-down: row 0 is the TOP row of the box, so every piece here
// reads exactly like it looks on screen. Flat side down, per DESIGN.md §2.1.
const SPAWN_CELLS = {
    I: [[0, 1], [1, 1], [2, 1], [3, 1]],
    O: [[0, 0], [1, 0], [0, 1], [1, 1]],
    T: [[1, 0], [0, 1], [1, 1], [2, 1]],
    S: [[1, 0], [2, 0], [0, 1], [1, 1]],
    Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
    J: [[0, 0], [0, 1], [1, 1], [2, 1]],
    L: [[2, 0], [0, 1], [1, 1], [2, 1]],
};

// Pieces enter on the two rows directly above the visible well (18 and 19 of
// the 40) — the skyline of DESIGN.md §2.1.
const SPAWN_Y = HIDDEN_ROWS - 2;

function sizeOf(type) {
    return BOX[type] || BOX.default;
}

// One quarter turn of the bounding box, y-down: CW maps (x,y) -> (N-1-y, x).
// Deriving all 28 cell sets from the seven spawn shapes means there is exactly
// ONE line here to get wrong instead of 28 tables to mistype — and
// tests/piece.test.js pins every derived set literally so a change to this
// line fails loudly rather than subtly.
function rotateCW(cells, n) {
    return cells.map((c) => [n - 1 - c[1], c[0]]);
}

// Reading order (top row first, then left to right) so a derived set can be
// compared to a literal one without sorting at the call site.
function readingOrder(cells) {
    return cells.slice().sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
}

function deriveStates() {
    const out = {};
    for (const type of Object.keys(SPAWN_CELLS)) {
        const n = sizeOf(type);
        const states = [];
        let cells = SPAWN_CELLS[type];
        for (let rot = 0; rot < 4; rot++) {
            states.push(Object.freeze(readingOrder(cells).map((c) => Object.freeze(c))));
            cells = rotateCW(cells, n);
        }
        out[type] = Object.freeze(states);
    }
    return Object.freeze(out);
}

// Frozen and shared: cellsFor runs per frame per piece, so it hands back the
// canonical array rather than a fresh copy. Freezing turns an accidental
// in-place sort at a call site into a throw instead of a corrupted piece.
const STATES = deriveStates();

export function cellsFor(type, rot) {
    const states = STATES[type];
    if (!states) throw new RangeError('unknown piece type: ' + type);
    return states[((rot % 4) + 4) % 4];
}

export function absoluteCells(piece) {
    return cellsFor(piece.type, piece.rot).map((c) => [piece.x + c[0], piece.y + c[1]]);
}

// Horizontally centered, rounding LEFT — and since every spawn shape fills the
// full width of its box, centering the box centers the piece: J/L/S/T/Z land
// in columns 3..5, I in 3..6, O in 4..5.
export function spawnPiece(type) {
    if (!STATES[type]) throw new RangeError('unknown piece type: ' + type);
    return { type: type, rot: 0, x: Math.floor((COLS - sizeOf(type)) / 2), y: SPAWN_Y };
}
