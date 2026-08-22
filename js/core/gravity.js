/* Gravity curve, level progression and the lock-delay budget (§2.6, §2.7).
 *
 * PURE by contract (tests/repo-gates.test.js enforces it): no DOM, no window,
 * no Arcade, no timers, no Math.random. See docs/ARCHITECTURE.md.
 *
 * Nothing here owns a clock. These are lookups the reducer consults once per
 * tick; wall time never enters core.
 */

import { TICK_MS } from './constants.js';

// Extended Placement (§2.7). The reset budget is spent by moves and rotates
// while grounded and restored by falling to a new lowest row — game.js owns
// that bookkeeping; these are just the two numbers it counts against.
export const LOCK_DELAY_MS = 500;
export const MAX_LOCK_RESETS = 15;

// TWENTY rows per tick, not one. 1G is a row per tick; flooring the interval
// at TICK_MS would cap the game at 1G and flatten the top of the curve —
// levels 14 and 15 would fall at identical speed. The floor is a twentieth of
// a tick, which the curve reaches on its own at level 19.
export const MAX_G = 20;

const FLOOR_MS = TICK_MS / MAX_G;   // 0.8333 ms/row

// Milliseconds per row at level n, the guideline curve (§2.6) floored at 20G.
//
// From level 14 the interval is SHORTER THAN A TICK, so a caller that treats
// gravity as "did the piece move this tick" silently throws rows away. It is
// `floor(accumulated / interval)` rows in one tick, capped at MAX_G — the cap
// is what keeps a pathological interval from spinning a loop.
//
// Past level ~114 the curve's base turns negative and the odd powers go
// negative with it, so the floor is load-bearing for an Endless run rather
// than a rounding nicety: without it, gravity would run backwards.
export function fallIntervalMs(level) {
    // Levels are 1-based and the curve is meaningless below that; a level-0
    // caller would get (0.807)^-1 — slower than level 1, i.e. backwards.
    const n = Math.max(1, Math.floor(Number(level) || 1));
    const ms = Math.pow(0.8 - (n - 1) * 0.007, n - 1) * 1000;
    return ms > FLOOR_MS ? ms : FLOOR_MS;
}

// Fixed goal: 10 lines a level, forever. Marathon stops caring at 15; Endless
// keeps calling this and rides the curve down to the 20G floor at 19.
export function levelFor(lines) {
    const n = Math.max(0, Math.floor(Number(lines) || 0));
    return 1 + Math.floor(n / 10);
}
