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

// The §2.6 curve itself, in ms/row, with no floor and no clamp. Private,
// because raw is exactly what nobody outside this file wants: see below.
function curveMs(n) {
    return Math.pow(0.8 - (n - 1) * 0.007, n - 1) * 1000;
}

/* The last level at which the curve still has something to say.
 *
 * THE CURVE IS NOT MONOTONIC FOREVER, and Marathon is now endless (§3), so a
 * long run really does walk off the end of it. `0.8 - (n-1)*0.007` goes
 * negative at level 115 and crosses -1 at level 259, and past that
 * `base^(n-1)` EXPLODES rather than vanishing. The sign alternates with the
 * parity of the exponent, so a bare `ms > FLOOR_MS ? ms : FLOOR_MS` catches
 * only half of it — the negative half:
 *
 *     level 257 →      128 ms/row       level 259 →     4 680 ms/row
 *     level 301 →   1.5e37 ms/row       level 1001 →       Infinity
 *
 * i.e. gravity getting SLOWER the deeper the run goes, and eventually a piece
 * that never falls at all. Only the parity of the player's level stood between
 * a three-hour well and a frozen one.
 *
 * The repair is to clamp the LEVEL going into the power rather than to patch
 * the value coming out: the curve has already bottomed out on the 20G floor by
 * then, so every level past this one means the same thing and the formula is
 * just arithmetic. Derived by walking the curve rather than written down as
 * 19, so it stays true if MAX_G or the curve is ever retuned.
 */
const CURVE_MAX_LEVEL = (() => {
    let n = 1;
    // Bounded: the curve is strictly decreasing until it reaches the floor at
    // level 19, and the bound is only here so a retuned curve that never
    // reaches the floor fails as a clamp rather than as a hang at import time.
    while (n < 1000 && curveMs(n) > FLOOR_MS) n++;
    return n;
})();

// Milliseconds per row at level n, the guideline curve (§2.6) floored at 20G.
//
// From level 14 the interval is SHORTER THAN A TICK, so a caller that treats
// gravity as "did the piece move this tick" silently throws rows away. It is
// `floor(accumulated / interval)` rows in one tick, capped at MAX_G — the cap
// is what keeps a pathological interval from spinning a loop.
//
// Total: finite, positive and non-increasing for EVERY input — a level of 0, a
// NaN, an Infinity, or level 4 000 of an endless Marathon.
export function fallIntervalMs(level) {
    // Levels are 1-based and the curve is meaningless below that; a level-0
    // caller would get (0.807)^-1 — slower than level 1, i.e. backwards. Above
    // CURVE_MAX_LEVEL it is meaningless in the other direction (see above), so
    // the level is clamped at both ends before it reaches the power.
    const n = Math.min(
        CURVE_MAX_LEVEL,
        Math.max(1, Math.floor(Number(level) || 1)),
    );
    const ms = curveMs(n);
    return ms > FLOOR_MS ? ms : FLOOR_MS;
}

// Fixed goal: 10 lines a level, forever. Marathon has no finish line (§3), so
// it keeps calling this and rides the curve down to the 20G floor at 19 —
// where fallIntervalMs pins it for the rest of the run, however long that is.
export function levelFor(lines) {
    const n = Math.max(0, Math.floor(Number(lines) || 0));
    return 1 + Math.floor(n / 10);
}
