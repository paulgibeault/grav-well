/* board.js — the well: a flat Uint8Array of cell ids, 0 for empty.
 *
 * PURE by contract (see docs/ARCHITECTURE.md, "Layer rules"): arithmetic and
 * plain data only, so every rule in here runs under `node --test`.
 *
 * The array is y-DOWN. Index 0 is the TOP row of the 40-row field, index 39
 * is the floor, and the visible well is rows 20..39; pieces spawn into rows
 * 18..19 of the buffer above it. Nothing in core ever flips that convention —
 * the one place a +y-up quantity meets this array is the SRS kick negation in
 * srs.js.
 */

import { COLS, ROWS, TYPES, ID, GARBAGE_ID } from './constants.js';

export function createBoard() {
    return new Uint8Array(COLS * ROWS);
}

export function idx(x, y) {
    return y * COLS + x;
}

export function inBounds(x, y) {
    return x >= 0 && x < COLS && y >= 0 && y < ROWS;
}

// Reads off the edge are not errors, they are terrain. Sides and floor answer
// 1 (solid) so the T-spin corner check treats them as filled with no special
// casing at the call site; the sky above row 0 answers 0, so a T rotated high
// in the buffer cannot earn free corners from empty space.
export function cellAt(board, x, y) {
    if (x < 0 || x >= COLS || y >= ROWS) return 1;
    if (y < 0) return 0;
    return board[idx(x, y)];
}

// Placement legality — a stricter question than cellAt's "what is there".
// A cell above row 0 has nowhere to be stored, so it collides even though
// cellAt calls that same space empty.
export function collides(board, cells) {
    for (let i = 0; i < cells.length; i++) {
        const x = cells[i][0], y = cells[i][1];
        if (!inBounds(x, y)) return true;
        if (board[idx(x, y)] !== 0) return true;
    }
    return false;
}

export function lockCells(board, cells, id) {
    for (let i = 0; i < cells.length; i++) {
        const x = cells[i][0], y = cells[i][1];
        if (inBounds(x, y)) board[idx(x, y)] = id;
    }
    return board;
}

export function fullRows(board) {
    const rows = [];
    for (let y = 0; y < ROWS; y++) {
        let full = true;
        for (let x = 0; x < COLS; x++) {
            if (board[idx(x, y)] === 0) { full = false; break; }
        }
        if (full) rows.push(y);
    }
    return rows;   // ascending, i.e. topmost cleared row first
}

// Compacts survivors downward, bottom-up, so a set of non-adjacent rows falls
// out in one pass and no row is ever read after it has been overwritten.
export function clearRows(board, rows) {
    const kill = new Set();
    for (let i = 0; i < rows.length; i++) {
        const y = rows[i];
        if (y >= 0 && y < ROWS) kill.add(y);
    }
    if (kill.size === 0) return 0;

    let write = ROWS - 1;
    for (let read = ROWS - 1; read >= 0; read--) {
        if (kill.has(read)) continue;
        if (write !== read) board.copyWithin(idx(0, write), idx(0, read), idx(0, read) + COLS);
        write--;
    }
    // Whatever is left at the top is the hole the cleared rows left behind.
    for (; write >= 0; write--) board.fill(0, idx(0, write), idx(0, write) + COLS);
    return kill.size;
}

export function isEmpty(board) {
    for (let i = 0; i < board.length; i++) {
        if (board[i] !== 0) return false;
    }
    return true;
}

export function highestRow(board) {
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            if (board[idx(x, y)] !== 0) return y;
        }
    }
    return ROWS;   // empty well: "the stack starts below the floor"
}

export function toStrings(board, fromRow = 0) {
    const out = [];
    for (let y = Math.max(0, fromRow); y < ROWS; y++) {
        let line = '';
        for (let x = 0; x < COLS; x++) line += charFor(board[idx(x, y)]);
        out.push(line);
    }
    return out;
}

// Fixtures are written as the BOTTOM n rows of the well, because that is the
// part a test is ever talking about — so a short list bottom-aligns by
// default. opts.fromRow places it explicitly instead (and is what makes
// fromStrings(toStrings(b, r)) an identity), opts.id picks the id that an
// anonymous fill char such as 'X' or '#' stands for.
export function fromStrings(rows, opts = {}) {
    const board = createBoard();
    const fromRow = opts.fromRow == null ? ROWS - rows.length : opts.fromRow;
    const fill = opts.id == null ? GARBAGE_ID : opts.id;
    for (let i = 0; i < rows.length; i++) {
        const line = rows[i];
        const y = fromRow + i;
        // A mistyped fixture row is a bug that would otherwise show up three
        // assertions later as a mysterious collision. Fail on the typo.
        if (line.length !== COLS) {
            throw new RangeError('fromStrings: row ' + i + ' is ' + line.length + ' wide, need ' + COLS);
        }
        if (y < 0 || y >= ROWS) throw new RangeError('fromStrings: row ' + i + ' lands at y=' + y);
        for (let x = 0; x < COLS; x++) {
            const ch = line[x];
            if (ch === '.') continue;
            board[idx(x, y)] = idFor(ch, fill);
        }
    }
    return board;
}

function charFor(id) {
    if (id === 0) return '.';
    return TYPES[id - 1] || (id === GARBAGE_ID ? 'G' : '#');
}

function idFor(ch, fill) {
    if (ch === 'G') return GARBAGE_ID;
    return Object.prototype.hasOwnProperty.call(ID, ch) ? ID[ch] : fill;
}
