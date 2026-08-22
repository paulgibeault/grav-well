/* What a physical key means — and how to trust a key map that came back out
 * of storage.
 *
 * No DOM in this file, on purpose: everything below takes plain values, so
 * every binding the game ships is exercisable from tests/keymap.test.js with
 * no browser in sight, and js/input/keyboard.js stays thin enough to read in
 * one sitting.
 *
 * Bindings are keyed on `event.code` — the PHYSICAL key position — never on
 * `event.key`. The Z-rotate key reports key 'w' on AZERTY and ';' on Dvorak;
 * its code is 'KeyZ' on all three layouts. One default map therefore fits
 * every keyboard, and the controls stay where the player's fingers are rather
 * than where the letters are.
 */

import { ACTIONS } from '../core/constants.js';

// Two inputs are not moves: they talk to the run, not to the piece. They live
// here rather than in ACTIONS because core's press()/release() must never see
// them — the frozen handlers object routes them to pause()/retry() instead.
export const COMMANDS = { PAUSE: 'PAUSE', RETRY: 'RETRY' };

// The complete set of bindable names, in a fixed order. Sanitizing iterates
// THIS list rather than the stored object's keys, which is what makes an
// unknown (or hostile) name in storage unreachable instead of merely rejected.
export const BINDABLE = Object.freeze(
    [...Object.keys(ACTIONS), ...Object.keys(COMMANDS)]);

export function isAction(name) { return Object.hasOwn(ACTIONS, name); }
export function isCommand(name) { return Object.hasOwn(COMMANDS, name); }

// DESIGN.md §4. Several codes may share one action; no code may serve two
// actions (pinned by tests/keymap.test.js — a doubly-claimed key would make
// the resolver's answer depend on declaration order).
export const DEFAULT_KEYMAP = {
    LEFT: ['ArrowLeft'],
    RIGHT: ['ArrowRight'],
    SOFT: ['ArrowDown'],
    HARD: ['Space'],
    CW: ['ArrowUp', 'KeyX'],
    // Both sides of Control and Shift are bound: a player picks a hand, not a
    // half of the keyboard, and location-blind bindings would strand lefties.
    CCW: ['KeyZ', 'ControlLeft', 'ControlRight'],
    HOLD: ['KeyC', 'ShiftLeft', 'ShiftRight'],
    PAUSE: ['KeyP', 'Escape'],
    RETRY: ['KeyR'],
};
for (const codes of Object.values(DEFAULT_KEYMAP)) Object.freeze(codes);
Object.freeze(DEFAULT_KEYMAP);

// A stored map is player data, not a payload: eight codes for one action is
// already generous, and the cap keeps a hand-edited (or corrupted) 10k-entry
// array from becoming the resolver's index.
const MAX_CODES_PER_BINDING = 8;

// Firefox shipped OSLeft/OSRight for years before the spec settled on Meta*.
const CODE_ALIASES = { OSLeft: 'MetaLeft', OSRight: 'MetaRight' };

// Named keys whose `key` and `code` are spelled identically, for the
// code-less fallback below.
const KEY_IS_CODE = new Set([
    'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    'Escape', 'Enter', 'Tab', 'Backspace', 'Space',
]);

export function normalizeCode(code) {
    if (typeof code !== 'string') return '';
    const c = code.trim();
    // 'Unidentified' is the spec's way of saying "I don't know either" —
    // binding it would make one mystery key trigger an action.
    if (!c || c === 'Unidentified') return '';
    return CODE_ALIASES[c] || c;
}

// Reconstruct a code from `event.key` when the event carried no usable code.
// Reached on some Android soft keyboards, some remote-desktop stacks, and
// synthetic events — rare, but the alternative there is a dead keyboard.
// `location` disambiguates the modifiers (2 === DOM_KEY_LOCATION_RIGHT).
export function codeForKey(key, location) {
    if (typeof key !== 'string' || !key) return '';
    if (key === ' ' || key === 'Spacebar') return 'Space';
    if (key.length === 1) {
        const up = key.toUpperCase();
        if (up >= 'A' && up <= 'Z') return 'Key' + up;
        if (key >= '0' && key <= '9') return 'Digit' + key;
        return '';
    }
    const side = location === 2 ? 'Right' : 'Left';
    switch (key) {
        case 'Control': return 'Control' + side;
        case 'Shift': return 'Shift' + side;
        case 'Alt': return 'Alt' + side;
        case 'Meta': case 'OS': return 'Meta' + side;
        case 'Esc': return 'Escape';                 // legacy Edge/IE spellings
        case 'Left': return 'ArrowLeft';
        case 'Right': return 'ArrowRight';
        case 'Up': return 'ArrowUp';
        case 'Down': return 'ArrowDown';
        default: return KEY_IS_CODE.has(key) ? key : '';
    }
}

// Takes anything event-shaped ({ code, key, location }) — which is what keeps
// this module testable and keyboard.js free of parsing.
export function codeFromEvent(ev) {
    if (!ev) return '';
    return normalizeCode(ev.code) || codeForKey(ev.key, ev.location);
}

export function buildCodeIndex(keymap) {
    const index = new Map();
    for (const name of BINDABLE) {
        for (const code of (keymap && keymap[name]) || []) {
            const c = normalizeCode(code);
            if (c && !index.has(c)) index.set(c, name);   // first claim wins
        }
    }
    return index;
}

// Resolving happens on every keydown, so the index is cached against the map
// object. A sanitized map is therefore to be treated as immutable: rebind by
// sanitizing a new one, never by pushing into an existing one's arrays.
const INDEX_CACHE = new WeakMap();

export function resolveCode(code, keymap = DEFAULT_KEYMAP) {
    const c = normalizeCode(code);
    if (!c) return null;
    let index = INDEX_CACHE.get(keymap);
    if (!index) INDEX_CACHE.set(keymap, index = buildCodeIndex(keymap));
    return index.get(c) || null;
}

function toCodeList(value) {
    const raw = typeof value === 'string' ? [value] : (Array.isArray(value) ? value : []);
    const out = [];
    for (const entry of raw) {
        const c = normalizeCode(entry);          // drops numbers, objects, null, ''
        if (c && !out.includes(c)) out.push(c);
        if (out.length === MAX_CODES_PER_BINDING) break;
    }
    return out;
}

/* Merge a stored key map over the defaults. `stored` arrives from
 * Arcade.state (sync: true — so possibly from another device, another
 * version, or a hand-edited export). It is never trusted and never throws:
 * anything unrecognizable simply does not survive the merge.
 */
export function sanitizeKeymap(stored) {
    const out = {};
    for (const name of BINDABLE) out[name] = DEFAULT_KEYMAP[name].slice();
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return out;

    const explicit = new Set();
    for (const name of BINDABLE) {
        // hasOwn, not `in`: a stored object parsed from JSON can carry a
        // '__proto__' payload, and an inherited "binding" is not a binding.
        if (!Object.hasOwn(stored, name)) continue;
        const codes = toCodeList(stored[name]);
        // Nothing valid left after filtering means the entry was garbage, and
        // a player with no LEFT key is a worse outcome than one who cannot
        // fully unbind an action. Keep the default and move on.
        if (!codes.length) continue;
        out[name] = codes;
        explicit.add(name);
    }

    // A remap steals its key. If the player bound KeyX to LEFT, the shipped
    // KeyX → CW must give it up; otherwise one physical key means two things
    // and which one wins is an accident of iteration order.
    const owner = new Map();
    for (const name of BINDABLE) {
        if (!explicit.has(name)) continue;
        for (const code of out[name]) if (!owner.has(code)) owner.set(code, name);
    }
    for (const name of BINDABLE) {
        out[name] = explicit.has(name)
            ? out[name].filter((c) => owner.get(c) === name)
            : out[name].filter((c) => !owner.has(c));
    }
    return out;
}
