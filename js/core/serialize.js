/* serialize.js — the mid-run snapshot (DESIGN.md §8, `run.<mode>`).
 *
 * PURE by contract (tests/repo-gates.test.js enforces it): no DOM, no window,
 * no Arcade, no timers, no Math.random. See docs/ARCHITECTURE.md.
 *
 * The whole point is fidelity: deserialize(serialize(g)) is exact, and a run
 * interrupted, saved, restored and resumed plays out identically to one that
 * was never touched. That is not a nicety — the launcher evicts iframes, so
 * every player's session ends in a restore sooner or later.
 *
 * Two things on the state object are not plain data: the board is a
 * Uint8Array, and `bag` is a closure over the run's one generator. The board
 * gets an encoding (below); the bag is REBUILT here from the seed and the
 * state bag.getState() hands over — which is why this module can be free of
 * game.js and the import can stay one-directional.
 */

import { COLS, ROWS, ACTIONS } from './constants.js';
import { createBoard } from './board.js';
import { createBag } from './bag.js';
import { makeRng } from '../arcade-rng.js';

export const SNAPSHOT_VERSION = 1;

/* Everything on the state object that is already JSON-shaped and is copied
 * across verbatim. The structured fields (board, active, queue, stats,
 * settings, held, events, bag) are handled one at a time below; between the
 * two lists every key of a live game is accounted for, and
 * tests/serialization.test.js compares the key sets so that a field added to
 * game.js and forgotten here fails loudly instead of vanishing from saves. */
const PLAIN_KEYS = [
    'mode', 'phase', 'seed', 'ghostY', 'hold', 'holdUsed',
    'score', 'lines', 'level', 'combo', 'b2b', 'tick', 'elapsedMs',
    'goalLines', 'timeLimitMs', 'goal', 'topOutReason', 'garbageRows',
    'leftoverMs', 'fallMs', 'lockMs', 'lockResets', 'lowestY', 'lastKickIndex',
    'dir', 'dasMs', 'arrMs',
];

export function serialize(g) {
    if (!g || typeof g !== 'object' || !g.board || !g.bag) return null;
    const out = { v: SNAPSHOT_VERSION };
    for (let i = 0; i < PLAIN_KEYS.length; i++) out[PLAIN_KEYS[i]] = g[PLAIN_KEYS[i]];
    out.board = encodeBoard(g.board);
    out.active = copyPiece(g.active);
    out.queue = (g.queue || []).slice();
    out.stats = Object.assign({}, g.stats);
    out.settings = Object.assign({}, g.settings);
    out.held = Object.assign({}, g.held);
    out.bag = g.bag.getState();     // { rng, queue } — already a fresh copy
    // Events are JSON-shaped by contract, so a round trip is both the honest
    // deep copy (the caller drains g.events, and a snapshot must not change
    // under it) and a free assertion that they really are.
    out.events = JSON.parse(JSON.stringify(g.events || []));
    return out;
}

/* Returns a resumable game, or null for anything that is not a snapshot this
 * version can read. Null rather than a throw: a snapshot arrives from storage
 * that may be truncated, stale or from another build, and the app's answer to
 * all three is the same — start a fresh run. */
export function deserialize(obj) {
    if (!obj || typeof obj !== 'object' || obj.v !== SNAPSHOT_VERSION) return null;
    const board = decodeBoard(obj.board);
    if (!board) return null;

    // The run's one generator, rewound to where the snapshot left it. The seed
    // seeds it; bag.setState immediately overwrites that with the saved state,
    // so a resumed run continues the stream rather than restarting it.
    const bag = createBag(makeRng(obj.seed));
    if (!bag.setState(obj.bag)) return null;

    const g = { board: board, bag: bag };
    for (let i = 0; i < PLAIN_KEYS.length; i++) g[PLAIN_KEYS[i]] = obj[PLAIN_KEYS[i]];
    g.active = copyPiece(obj.active);
    g.queue = Array.isArray(obj.queue) ? obj.queue.slice() : [];
    g.stats = Object.assign({}, obj.stats);
    g.settings = Object.assign({}, obj.settings);
    // Rebuilt from ACTIONS rather than copied, because press()/release() gate
    // on the key EXISTING in this map. A snapshot with a partial or missing
    // `held` — a hand-edited save, an export from another version, a truncated
    // write — would otherwise restore a game that renders and falls under
    // gravity while silently refusing every input, which reads as a frozen
    // game rather than a bad save. serialize() always writes the full map, so
    // this only ever fires on a snapshot we did not author.
    g.held = {};
    for (const action of Object.values(ACTIONS)) {
        g.held[action] = !!(obj.held && obj.held[action]);
    }
    g.events = JSON.parse(JSON.stringify(obj.events || []));
    return g;
}

/* The well as one 400-character string of digits.
 *
 * Cell ids run 0..8 — 0 empty, 1..7 the seven pieces, 8 garbage — so every
 * cell is exactly one character and needs no separator. That buys three
 * things a number array would not: the payload is a fixed length, which
 * validates it for free on the way back in; it contains nothing JSON has to
 * escape; and a saved run can be read with an eye — the stack is right there
 * in the string. It is also less than half the bytes of a JSON number array.
 */
function encodeBoard(board) {
    const out = new Array(board.length);
    for (let i = 0; i < board.length; i++) {
        const v = board[i];
        // Ids never exceed 8. Clamping rather than throwing keeps a corrupt
        // cell from costing the player the whole save.
        out[i] = String(v >= 0 && v <= 9 ? v : 9);
    }
    return out.join('');
}

function decodeBoard(s) {
    if (typeof s !== 'string' || s.length !== COLS * ROWS) return null;
    const board = createBoard();
    for (let i = 0; i < s.length; i++) {
        const v = s.charCodeAt(i) - 48;     // '0'
        if (v < 0 || v > 9) return null;
        board[i] = v;
    }
    return board;
}

function copyPiece(p) {
    if (!p || typeof p !== 'object') return null;
    return { type: p.type, rot: p.rot, x: p.x, y: p.y };
}
