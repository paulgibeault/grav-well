/* The key map is the one part of js/input/ with real logic in it — the rest is
 * event plumbing that needs a browser. It is kept DOM-free precisely so this
 * file can pin it: what the shipped bindings are, and that a key map coming
 * back out of storage can never take the controls away from the player.
 */
import { test } from 'node:test';
import assert from 'node:assert';

import { ACTIONS } from '../js/core/constants.js';
import {
    DEFAULT_KEYMAP, COMMANDS, BINDABLE,
    isAction, isCommand, normalizeCode, codeForKey, codeFromEvent,
    buildCodeIndex, resolveCode, sanitizeKeymap,
} from '../js/input/keymap.js';

/** The defaults as a plain, mutable object — what sanitizeKeymap must produce. */
function defaults() {
    const out = {};
    for (const name of BINDABLE) out[name] = DEFAULT_KEYMAP[name].slice();
    return out;
}

// ---------------------------------------------------------------------------
// The shipped bindings
// ---------------------------------------------------------------------------

test('every default binding resolves to its own action', () => {
    for (const [name, codes] of Object.entries(DEFAULT_KEYMAP)) {
        assert.ok(codes.length > 0, `${name} has no default binding`);
        for (const code of codes) {
            assert.strictEqual(resolveCode(code), name, `${code} should resolve to ${name}`);
        }
    }
});

test('the bindings are the ones DESIGN.md §4 promises', () => {
    // Pinned literally: a silent drift here is a player relearning the game.
    const expected = {
        ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', ArrowDown: 'SOFT', Space: 'HARD',
        ArrowUp: 'CW', KeyX: 'CW',
        KeyZ: 'CCW', ControlLeft: 'CCW', ControlRight: 'CCW',
        KeyC: 'HOLD', ShiftLeft: 'HOLD', ShiftRight: 'HOLD',
        KeyP: 'PAUSE', Escape: 'PAUSE', KeyR: 'RETRY',
    };
    for (const [code, name] of Object.entries(expected)) {
        assert.strictEqual(resolveCode(code), name);
    }
    // …and nothing else is bound by default.
    assert.strictEqual(buildCodeIndex(DEFAULT_KEYMAP).size, Object.keys(expected).length);
});

test('no two actions claim the same code in the defaults', () => {
    const seen = new Map();
    for (const [name, codes] of Object.entries(DEFAULT_KEYMAP)) {
        for (const code of codes) {
            assert.ok(!seen.has(code),
                `${code} is bound to both ${seen.get(code)} and ${name} — the ` +
                'resolver would answer whichever was declared first');
            seen.set(code, name);
        }
    }
});

test('actions and commands stay in their own lanes', () => {
    for (const name of Object.keys(ACTIONS)) {
        assert.ok(isAction(name) && !isCommand(name), name);
    }
    for (const name of Object.keys(COMMANDS)) {
        // PAUSE/RETRY must never reach core's press() — they are not moves.
        assert.ok(isCommand(name) && !isAction(name), name);
        assert.ok(!Object.hasOwn(ACTIONS, name));
    }
    assert.ok(!isAction('LEFTS') && !isAction('__proto__') && !isAction('toString'));
});

test('an unbound code resolves to null rather than throwing', () => {
    for (const code of ['KeyQ', 'F5', '', 'Unidentified', null, undefined, 42, {}]) {
        assert.strictEqual(resolveCode(code), null, String(code));
    }
});

// ---------------------------------------------------------------------------
// Code normalization
// ---------------------------------------------------------------------------

test('normalizeCode trims, aliases, and refuses non-strings', () => {
    assert.strictEqual(normalizeCode('  KeyZ '), 'KeyZ');
    assert.strictEqual(normalizeCode('OSLeft'), 'MetaLeft');    // legacy Firefox
    assert.strictEqual(normalizeCode('Unidentified'), '');
    for (const junk of [null, undefined, 7, {}, [], () => {}]) {
        assert.strictEqual(normalizeCode(junk), '');
    }
});

test('codeFromEvent prefers the physical code and falls back to the key', () => {
    assert.strictEqual(codeFromEvent({ code: 'KeyZ', key: 'w' }), 'KeyZ');   // AZERTY
    // Some soft keyboards and remote-desktop stacks send no code at all.
    assert.strictEqual(codeFromEvent({ code: '', key: 'x' }), 'KeyX');
    assert.strictEqual(codeFromEvent({ key: ' ' }), 'Space');
    assert.strictEqual(codeFromEvent({ key: 'ArrowLeft' }), 'ArrowLeft');
    assert.strictEqual(codeFromEvent({ key: 'Esc' }), 'Escape');
    assert.strictEqual(codeFromEvent({ key: 'Control', location: 2 }), 'ControlRight');
    assert.strictEqual(codeFromEvent({ key: 'Control' }), 'ControlLeft');
    assert.strictEqual(codeFromEvent({ key: 'Dead' }), '');
    assert.strictEqual(codeFromEvent(null), '');
    assert.strictEqual(codeForKey('', 0), '');
});

// ---------------------------------------------------------------------------
// sanitizeKeymap — the hostile half
// ---------------------------------------------------------------------------

test('sanitizeKeymap survives anything that is not a key map', () => {
    for (const junk of [null, undefined, 0, 42, 'ArrowLeft', true, [1, 2, 3], []]) {
        assert.deepStrictEqual(sanitizeKeymap(junk), defaults(), String(junk));
    }
});

test('sanitizeKeymap drops action names it does not know', () => {
    const map = sanitizeKeymap({ FLY: ['KeyQ'], LEFT: ['KeyA'], toString: ['KeyB'] });
    assert.deepStrictEqual(Object.keys(map), [...BINDABLE]);
    assert.strictEqual(resolveCode('KeyQ', map), null);
    assert.strictEqual(resolveCode('KeyB', map), null);
    assert.strictEqual(resolveCode('KeyA', map), 'LEFT');
});

test('sanitizeKeymap drops non-string codes and keeps the good ones', () => {
    const map = sanitizeKeymap({ LEFT: ['KeyA', 42, null, undefined, {}, [], '', '  ', 'KeyA'] });
    assert.deepStrictEqual(map.LEFT, ['KeyA']);     // deduped, too
});

test('an entry with nothing valid left in it keeps the default binding', () => {
    // A player with no way to move left is a worse failure than a player who
    // cannot fully unbind an action, so garbage loses to the shipped default.
    const map = sanitizeKeymap({ LEFT: [null, 3], RIGHT: [], HARD: 99, CW: {} });
    assert.deepStrictEqual(map.LEFT, DEFAULT_KEYMAP.LEFT.slice());
    assert.deepStrictEqual(map.RIGHT, DEFAULT_KEYMAP.RIGHT.slice());
    assert.deepStrictEqual(map.HARD, DEFAULT_KEYMAP.HARD.slice());
    assert.deepStrictEqual(map.CW, DEFAULT_KEYMAP.CW.slice());
});

test('a partial map merges over the defaults', () => {
    const map = sanitizeKeymap({ HARD: ['KeyF'] });
    assert.deepStrictEqual(map.HARD, ['KeyF']);
    assert.strictEqual(resolveCode('KeyF', map), 'HARD');
    assert.strictEqual(resolveCode('Space', map), null, 'the old binding is gone');
    for (const name of BINDABLE) {
        if (name === 'HARD') continue;
        assert.deepStrictEqual(map[name], DEFAULT_KEYMAP[name].slice(), name);
    }
});

test('a single code may be stored as a bare string', () => {
    const map = sanitizeKeymap({ HOLD: 'KeyV' });
    assert.deepStrictEqual(map.HOLD, ['KeyV']);
    assert.strictEqual(resolveCode('KeyV', map), 'HOLD');
});

test('a custom binding steals a code from a default one', () => {
    // KeyX ships as CW. Rebinding it to LEFT must not leave one physical key
    // meaning two things, with the winner decided by iteration order.
    const map = sanitizeKeymap({ LEFT: ['KeyX'] });
    assert.strictEqual(resolveCode('KeyX', map), 'LEFT');
    assert.deepStrictEqual(map.CW, ['ArrowUp']);
    assert.strictEqual(resolveCode('ArrowLeft', map), null);
});

test('two custom bindings cannot both claim one code', () => {
    const map = sanitizeKeymap({ LEFT: ['KeyG'], RIGHT: ['KeyG', 'KeyH'] });
    assert.strictEqual(resolveCode('KeyG', map), 'LEFT');   // BINDABLE order, deterministic
    assert.deepStrictEqual(map.RIGHT, ['KeyH']);
});

test('a stored map cannot smuggle in a prototype', () => {
    const hostile = JSON.parse('{"__proto__":{"pwned":true},"LEFT":["KeyA"]}');
    const map = sanitizeKeymap(hostile);
    assert.strictEqual(({}).pwned, undefined);
    assert.strictEqual(map.pwned, undefined);
    assert.strictEqual(Object.getPrototypeOf(map), Object.prototype);
    assert.deepStrictEqual(map.LEFT, ['KeyA']);
});

test('a huge stored list is capped instead of becoming the index', () => {
    const many = Array.from({ length: 500 }, (_, i) => `Key${i}`);
    assert.strictEqual(sanitizeKeymap({ SOFT: many }).SOFT.length, 8);
});

test('sanitizing hands back a private copy — the defaults are shared and frozen', () => {
    const map = sanitizeKeymap(null);
    map.LEFT.push('KeyA');
    map.HARD = ['KeyF'];
    assert.deepStrictEqual(DEFAULT_KEYMAP.LEFT, ['ArrowLeft']);
    assert.deepStrictEqual(sanitizeKeymap(null), defaults());
    assert.ok(Object.isFrozen(DEFAULT_KEYMAP) && Object.isFrozen(DEFAULT_KEYMAP.CW));
});

test('a sanitized map round-trips through JSON, which is how it is stored', () => {
    const custom = sanitizeKeymap({ CCW: ['KeyZ'], PAUSE: ['Escape'] });
    assert.deepStrictEqual(sanitizeKeymap(JSON.parse(JSON.stringify(custom))), custom);
});
