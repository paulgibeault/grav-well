/* tspin.js — the 3-corner rule (DESIGN.md §2.9).
 *
 * PURE by contract (see docs/ARCHITECTURE.md).
 *
 * A lock counts as a T-spin when the piece is a T, its last successful
 * maneuver was a rotation, and at least 3 of the 4 cells diagonal to the T's
 * center are occupied. This module owns the geometry half only: the caller
 * tracks "the last maneuver was a rotation" and says so by passing the
 * kickIndex of that rotation, or -1 when the last action was a move or a drop.
 */

import { cellAt } from './board.js';

// The T's center is the box cell (1,1) in all four rotations — the shape
// turns around it, which is exactly why the corner test can be written once.
const CENTER = [1, 1];

// The two corners on the side the T points at, per rotation, as offsets from
// the center in y-DOWN space: 0 points up, 1 right, 2 down, 3 left.
const FRONT = [
    [[-1, -1], [1, -1]],
    [[1, -1], [1, 1]],
    [[-1, 1], [1, 1]],
    [[-1, -1], [-1, 1]],
];

const CORNERS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

export function detectTSpin(board, piece, kickIndex) {
    // kickIndex < 0 is the caller saying "the last maneuver was not a
    // rotation" — half of the rule lives there, and it vetoes outright.
    if (!piece || piece.type !== 'T' || kickIndex < 0) return 'none';

    const cx = piece.x + CENTER[0];
    const cy = piece.y + CENTER[1];

    // cellAt answers 1 off the sides and below the floor, so a T twisted into
    // a corner of the well scores those walls as occupied with nothing extra
    // here; open sky above row 0 answers 0 and never gives a free corner.
    let occupied = 0;
    for (let i = 0; i < CORNERS.length; i++) {
        if (cellAt(board, cx + CORNERS[i][0], cy + CORNERS[i][1]) !== 0) occupied++;
    }
    if (occupied < 3) return 'none';

    const front = FRONT[((piece.rot % 4) + 4) % 4];
    const pointingBlocked = cellAt(board, cx + front[0][0], cy + front[0][1]) !== 0
        && cellAt(board, cx + front[1][0], cy + front[1][1]) !== 0;
    if (pointingBlocked) return 'full';

    // Kick test 5 is the (±1, ∓2) "TST" offset: nothing but a real spin can
    // land a piece there, so it promotes what the corners called a mini.
    return kickIndex === 4 ? 'full' : 'mini';
}
