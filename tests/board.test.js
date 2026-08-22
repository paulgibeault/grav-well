/* board.test.js — the well's bounds semantics, row clearing, and fixtures.
 *
 * Every fixture below is written bottom-aligned ASCII: the last string is row
 * 39, the floor. fromStrings does the aligning, so what you read is what the
 * bottom of the well looks like.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { COLS, ROWS, ID, GARBAGE_ID } from '../js/core/constants.js';
import {
    createBoard, idx, cellAt, inBounds, collides, lockCells,
    fullRows, clearRows, isEmpty, highestRow, toStrings, fromStrings,
} from '../js/core/board.js';

test('createBoard is an empty 10x40 field', () => {
    const b = createBoard();
    assert.equal(b.length, COLS * ROWS);
    assert.equal(b.constructor, Uint8Array);
    assert.ok(isEmpty(b));
});

test('idx is row-major, y-down', () => {
    assert.equal(idx(0, 0), 0);          // top-left
    assert.equal(idx(9, 0), 9);
    assert.equal(idx(0, 1), COLS);
    assert.equal(idx(9, 39), COLS * ROWS - 1);   // bottom-right, the floor
});

test('cellAt: sides and floor read as filled, the sky above reads as empty', () => {
    const b = createBoard();
    // Out to the sides at any row.
    assert.equal(cellAt(b, -1, 39), 1);
    assert.equal(cellAt(b, COLS, 39), 1);
    assert.equal(cellAt(b, -1, 0), 1);
    assert.equal(cellAt(b, COLS, 20), 1);
    // Below the floor.
    assert.equal(cellAt(b, 5, ROWS), 1);
    assert.equal(cellAt(b, 5, ROWS + 3), 1);
    // Above the top of the buffer — open sky, so a T up there earns no corners.
    assert.equal(cellAt(b, 5, -1), 0);
    assert.equal(cellAt(b, 5, -4), 0);
    // Corners off two edges at once still read solid.
    assert.equal(cellAt(b, -1, ROWS), 1);
    // In bounds: whatever is stored.
    assert.equal(cellAt(b, 5, 39), 0);
    b[idx(5, 39)] = ID.T;
    assert.equal(cellAt(b, 5, 39), ID.T);
});

test('inBounds excludes the sky, unlike cellAt', () => {
    assert.ok(inBounds(0, 0));
    assert.ok(inBounds(9, 39));
    assert.ok(!inBounds(-1, 20));
    assert.ok(!inBounds(10, 20));
    assert.ok(!inBounds(5, -1));
    assert.ok(!inBounds(5, ROWS));
});

test('collides: occupied cells, walls, floor and ceiling', () => {
    const b = fromStrings([
        '..........',
        '.....X....',
        'XXXXXXXXX.',
    ]);   // rows 37, 38, 39
    assert.ok(!collides(b, [[0, 37], [9, 37]]));           // open air
    assert.ok(collides(b, [[5, 38]]));                     // the lone block
    assert.ok(!collides(b, [[4, 38], [6, 38]]));           // beside it
    assert.ok(collides(b, [[0, 37], [5, 38]]));            // any one cell is enough
    assert.ok(collides(b, [[-1, 39]]));                    // left wall
    assert.ok(collides(b, [[COLS, 39]]));                  // right wall
    assert.ok(collides(b, [[5, ROWS]]));                   // through the floor
    assert.ok(collides(b, [[5, -1]]));                     // above the buffer: nowhere to store it
    assert.ok(!collides(b, [[9, 39]]));                    // the one gap in the floor row
    assert.ok(!collides(b, []));                           // nothing collides with nothing
});

test('lockCells stamps the piece id and leaves the rest alone', () => {
    const b = createBoard();
    lockCells(b, [[3, 38], [4, 38], [5, 38], [4, 39]], ID.T);
    assert.equal(cellAt(b, 3, 38), ID.T);
    assert.equal(cellAt(b, 4, 39), ID.T);
    assert.equal(cellAt(b, 3, 39), 0);
    assert.equal(highestRow(b), 38);
});

test('fullRows lists complete rows top-down', () => {
    const b = fromStrings([
        'IIIIIIIIII',   // 36 full
        'O.........',   // 37
        'TTTTTTTTTT',   // 38 full
        'S........Z',   // 39
    ]);
    assert.deepEqual(fullRows(b), [36, 38]);
    assert.deepEqual(fullRows(createBoard()), []);
});

test('clearRows removes rows and shifts everything above DOWN', () => {
    const b = fromStrings([
        'IIIIIIIIII',   // 35 full
        'O.........',   // 36
        'TTTTTTTTTT',   // 37 full
        'S.........',   // 38
        'Z.........',   // 39
    ]);
    const n = clearRows(b, fullRows(b));
    assert.equal(n, 2);
    // The three survivors keep their order and land on the floor; the two rows
    // that fell out are replaced by empty space at the top of the field.
    assert.deepEqual(toStrings(b, 35), [
        '..........',
        '..........',
        'O.........',
        'S.........',
        'Z.........',
    ]);
    assert.equal(highestRow(b), 37);
});

test('clearRows on the floor row alone drops the stack by one', () => {
    const b = fromStrings([
        'L.........',   // 38
        'JJJJJJJJJJ',   // 39 full
    ]);
    assert.equal(clearRows(b, [39]), 1);
    assert.deepEqual(toStrings(b, 38), ['..........', 'L.........']);
});

test('clearRows tolerates unsorted, duplicated and out-of-range input', () => {
    const b = fromStrings([
        'O.........',   // 37
        'TTTTTTTTTT',   // 38
        'IIIIIIIIII',   // 39
    ]);
    assert.equal(clearRows(b, [39, 38, 38, -1, ROWS + 5]), 2);
    assert.deepEqual(toStrings(b, 38), ['..........', 'O.........']);
    assert.equal(clearRows(b, []), 0);
});

test('clearRows of every row empties the well (perfect clear)', () => {
    const b = fromStrings(['ZZZZZZZZZZ']);
    assert.ok(!isEmpty(b));
    assert.equal(clearRows(b, [39]), 1);
    assert.ok(isEmpty(b));
});

test('highestRow finds the top of the stack, ROWS when empty', () => {
    assert.equal(highestRow(createBoard()), ROWS);
    const b = fromStrings([
        '.........L',   // 18: a piece parked in the spawn rows
        '..........',
        '..........',
    ]);
    assert.equal(highestRow(b), 37);
    b[idx(0, 3)] = GARBAGE_ID;
    assert.equal(highestRow(b), 3);
});

test('fromStrings bottom-aligns by default and honours opts.fromRow', () => {
    const b = fromStrings(['X.........']);
    assert.equal(cellAt(b, 0, ROWS - 1), GARBAGE_ID);   // an anonymous fill char
    assert.equal(highestRow(b), ROWS - 1);

    const spawned = fromStrings(['.X........'], { fromRow: 18 });
    assert.equal(cellAt(spawned, 1, 18), GARBAGE_ID);
    assert.equal(highestRow(spawned), 18);

    const tinted = fromStrings(['X.........'], { id: ID.S });
    assert.equal(cellAt(tinted, 0, ROWS - 1), ID.S);
});

test('fromStrings/toStrings round-trip exactly for piece ids and garbage', () => {
    const rows = [
        'IOTSZJLG..',
        '..G.......',
        'LJZSTOI...',
        'XXXXXXXXXX',   // anonymous fill: becomes garbage, and says so on the way back
    ];
    const b = fromStrings(rows);
    assert.deepEqual(toStrings(b, ROWS - 4), [
        'IOTSZJLG..',
        '..G.......',
        'LJZSTOI...',
        'GGGGGGGGGG',
    ]);
    // A board written from its own rendering is the same board.
    const again = fromStrings(toStrings(b, ROWS - 4));
    assert.deepEqual(Array.from(again), Array.from(b));
    // And the full-field form round-trips too.
    assert.deepEqual(Array.from(fromStrings(toStrings(b), { fromRow: 0 })), Array.from(b));
});

test('toStrings defaults to the whole field, fromRow trims the top', () => {
    const b = createBoard();
    assert.equal(toStrings(b).length, ROWS);
    assert.equal(toStrings(b, 20).length, 20);          // just the visible well
    assert.equal(toStrings(b, 39)[0], '..........');
});

test('fromStrings refuses a mistyped fixture row', () => {
    assert.throws(() => fromStrings(['....']), RangeError);
    assert.throws(() => fromStrings(['...........']), RangeError);
    assert.throws(() => fromStrings(['..........'], { fromRow: ROWS }), RangeError);
});
