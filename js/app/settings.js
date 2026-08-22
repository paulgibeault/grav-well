/* js/app/settings.js — the launcher's settings, as plain values.
 *
 * These are the ARCADE's settings, not the game's: theme, font scale, reduced
 * motion, power saver, handedness (GAME_INTEGRATION.md §5). The player's own
 * DAS/ARR/ghost/keymap live in Arcade.state and belong to js/app/store.js —
 * two different owners for two different things, and the only reason they meet
 * is that js/main.js hands both to the same modules.
 *
 * This file exists so that the reads are DEFENSIVE IN ONE PLACE. js/render/*
 * and js/app/audio.js take these as plain arguments and never learn that a
 * launcher exists (ARCHITECTURE.md, layer rules), which is also what makes
 * them testable — a renderer that calls Arcade.settings.theme() itself can
 * only be exercised in a browser.
 *
 * NOTHING IS READ AT IMPORT TIME. The SDK serves a placeholder snapshot before
 * the launcher's welcome message lands; every export here is a function
 * js/main.js calls after `await Arcade.ready`, and again on every change.
 *
 * THE powerSaver READ IS GUARDED, and the guard is the point of the line.
 * `Arcade.settings.powerSaver` landed in SDK 3.13.0; on anything older the
 * property is undefined and CALLING it throws TypeError. That is survivable at
 * boot and not survivable inside an onSettingsChange handler, where it becomes
 * a throw on every launcher settings write — the player drags the volume
 * slider and the game's theme handling dies. Guarded, an older SDK simply
 * reads "not saving". Fleet CI gates this (contract-gates.mjs, gate C), and
 * the gate wants the guard on the SAME receiver as the call, which is why the
 * ternary below is spelled out rather than routed through a helper.
 */

// Same shape as the reads below, for the standalone page whose SDK failed to
// load. Dark is the flagship theme (DESIGN.md §5); right-handed matches the
// launcher's own default.
const FALLBACK = {
    theme: 'dark',
    fontScale: 1,
    reducedMotion: false,
    powerSaver: false,
    handedness: 'right',
};

const settings = () =>
    (typeof window !== 'undefined' && window.Arcade && window.Arcade.settings)
        ? window.Arcade.settings
        : null;

/**
 * The launcher's current settings as plain values — no getters, no live view.
 * Call after `await Arcade.ready`, and again from onArcadeSettingsChange().
 *
 * Every value is validated rather than passed through. These cross an iframe
 * boundary, and a renderer that divides by a fontScale of 0 (or of "1.5") is a
 * blank canvas the player cannot explain.
 *
 * @returns {{theme: 'dark'|'light', fontScale: number, reducedMotion: boolean,
 *            powerSaver: boolean, handedness: 'left'|'right'}}
 */
export function readArcadeSettings() {
    const s = settings();
    if (!s) return Object.assign({}, FALLBACK);
    const fontScale = Number(s.fontScale ? s.fontScale() : NaN);
    return {
        theme: (s.theme ? s.theme() : null) === 'light' ? 'light' : 'dark',
        fontScale: Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1,
        reducedMotion: s.reducedMotion ? !!s.reducedMotion() : false,
        // GAME_INTEGRATION.md §5 / contract gate C — see the header.
        powerSaver: s.powerSaver ? !!s.powerSaver() : false,
        handedness: (s.handedness ? s.handedness() : null) === 'left' ? 'left' : 'right',
    };
}

/**
 * One subscription for the whole settings snapshot, because the launcher sends
 * one: there is no per-setting event, and every change re-pushes the lot.
 * §5 wants a single handler that flips the cached multipliers and kicks a
 * redraw — several subscriptions would each re-read the same snapshot and each
 * kick their own frame.
 *
 * @param {(s: ReturnType<typeof readArcadeSettings>) => void} fn
 * @returns {() => void} unsubscribe; safe to call twice.
 */
export function onArcadeSettingsChange(fn) {
    const A = (typeof window !== 'undefined' && window.Arcade) ? window.Arcade : null;
    if (!A || typeof A.onSettingsChange !== 'function' || typeof fn !== 'function') {
        return () => {};
    }
    // The snapshot is read HERE rather than by the handler, so a caller cannot
    // accidentally do the unguarded read this module exists to prevent.
    return A.onSettingsChange(() => { fn(readArcadeSettings()); });
}
