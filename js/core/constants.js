/* The vocabulary every other core module shares.
 *
 * PURE by contract (tests/repo-gates.test.js enforces it): no DOM, no window,
 * no Arcade, no timers. See docs/ARCHITECTURE.md.
 */

// The well. 10 wide, 40 tall, of which the bottom 20 are visible — the top 20
// are the buffer a piece spawns into and rotates in.
export const COLS = 10;
export const ROWS = 40;
export const VISIBLE_ROWS = 20;
export const HIDDEN_ROWS = ROWS - VISIBLE_ROWS;   // 20; visible rows are 20..39

// Cell ids. Index in TYPES + 1, so a cell value round-trips to a piece type.
export const TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
export const ID = { I: 1, O: 2, T: 3, S: 4, Z: 5, J: 6, L: 7 };
export const GARBAGE_ID = 8;    // seeded debris (Daily Well), never a piece

// The whole input vocabulary. Devices (js/input/*) translate into these and
// know nothing else about the game.
export const ACTIONS = {
    LEFT: 'LEFT', RIGHT: 'RIGHT',
    CW: 'CW', CCW: 'CCW',
    SOFT: 'SOFT', HARD: 'HARD', HOLD: 'HOLD',
};

// Fixed simulation step. Everything in core counts ticks, never wall time —
// which is what lets a run be replayed from its seed and input log.
export const TICK_MS = 1000 / 60;
