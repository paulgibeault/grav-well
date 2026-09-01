/* norm.js — the shapes core state is allowed to have.
 *
 * PURE by contract (tests/repo-gates.test.js enforces it): no DOM, no window,
 * no Arcade, no timers. See docs/ARCHITECTURE.md.
 *
 * THIS FILE EXISTS SO THAT deserialize() CAN BE AS PARANOID AS createGame().
 *
 * The two of them are the only doors into a game state, and they used to
 * disagree: createGame() clamped every setting on the way in, and
 * deserialize() copied `settings` and `stats` across with Object.assign and
 * trusted them. That is a real gap, because a snapshot is not our data —
 * `settings` carries `{ sync: true }` and arrives from the player's other
 * devices, from an imported save file, or from a hand edit. A restored
 * `sdf: -1` makes the fall interval negative, which falls straight through
 * game.js's `interval > 0` guard into "twenty rows this tick", and a restored
 * `das: 'banana'` makes `dasMs > 0` false forever so DAS never charges.
 *
 * serialize.js may not import game.js (the import graph is one-directional, so
 * that game.js can re-export serialize/deserialize without a cycle), so the
 * normalizers live here and both sides import them. There is now exactly one
 * definition of "a legal settings block" and one of "a legal stats block".
 */

/* "Instant" soft drop (§2.8) as a finite number. JSON turns Infinity into
 * null, and a snapshot has to survive JSON; 1200x reaches gravity.js's
 * twenty-rows-a-tick ceiling at level 1 — the slowest gravity in the game — so
 * naming it costs nothing and every faster setting is the same drop. */
export const MAX_SDF = 1200;

export const DEFAULT_SETTINGS = {
    das: 167, arr: 33, sdf: 20, ghost: true, lockdown: 'extended',
};

export function normalizeSettings(s) {
    const o = (s && typeof s === 'object') ? s : {};
    return {
        // The upper clamps are JSON-safety as much as sanity: a snapshot has to
        // survive a stringify, and Infinity does not.
        das: numOr(o.das, DEFAULT_SETTINGS.das, 0, 5000),
        arr: numOr(o.arr, DEFAULT_SETTINGS.arr, 0, 1000),
        // The floor is 1, not 0: soft drop DIVIDES the fall interval by it.
        sdf: numOr(o.sdf, DEFAULT_SETTINGS.sdf, 1, MAX_SDF),
        ghost: o.ghost == null ? DEFAULT_SETTINGS.ghost : !!o.ghost,
        lockdown: (o.lockdown === 'classic' || o.lockdown === 'infinite')
            ? o.lockdown : DEFAULT_SETTINGS.lockdown,
    };
}

/* The run's own tallies. `maxCombo`, `maxB2b`, `maxQuadStreak` and `bestLock`
 * are the four the records in js/app/store.js are cut from, which is why they
 * are peaks rather than totals: a lifetime sum of combos says nothing about
 * whether the player can build one. */
export function newStats() {
    return {
        pieces: 0, quads: 0, tspins: 0, perfectClears: 0, holds: 0,
        maxCombo: 0, maxB2b: 0, maxQuadStreak: 0, bestLock: 0,
    };
}

/* Rebuilt from the known key set rather than copied, for the same reason
 * deserialize() rebuilds `held` that way: a snapshot missing a counter would
 * otherwise restore `undefined`, and the first `undefined + 1` reaches the
 * launcher's stats sheet as NaN — where it is a permanent, unfixable row. A
 * counter present but nonsensical (negative, fractional, a string) is floored
 * to a usable integer rather than dropped, because the run really did happen. */
export function normalizeStats(s) {
    const o = (s && typeof s === 'object') ? s : {};
    const out = newStats();
    for (const k of Object.keys(out)) out[k] = countOr(o[k]);
    return out;
}

function numOr(v, dflt, min, max) {
    if (v == null) return dflt;
    const n = Number(v);
    if (Number.isNaN(n)) return dflt;
    return n < min ? min : (n > max ? max : n);
}

function countOr(v) {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? n : 0;
}
