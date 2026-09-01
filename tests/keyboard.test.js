/* keyboard.test.js — the chord rule, and the auto-repeat trap it sits next to.
 *
 * js/input/keyboard.js needs an event target rather than a DOM, so the target
 * below is a plain object with addEventListener. That is the whole browser
 * surface the module touches on this path, and building it here means the
 * chord rule — which is fiddly, and was wrong — is pinned under `node --test`
 * along with everything else.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { attachKeyboard } from '../js/input/keyboard.js';
import { ACTIONS } from '../js/core/constants.js';
import { COMMANDS } from '../js/input/keymap.js';

function fakeTarget() {
    const listeners = new Map();
    return {
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(fn);
        },
        removeEventListener(type, fn) {
            const list = listeners.get(type) || [];
            const i = list.indexOf(fn);
            if (i >= 0) list.splice(i, 1);
        },
        fire(type, ev) {
            for (const fn of (listeners.get(type) || []).slice()) fn(ev);
            return ev;
        },
    };
}

// A keyboard under test, plus the log of what core would have been told.
function harness(keymap) {
    const target = fakeTarget();
    const log = [];
    const detach = attachKeyboard(target, {
        press: (a) => log.push(['press', a]),
        release: (a) => log.push(['release', a]),
        pause: () => log.push(['pause']),
        retry: () => log.push(['retry']),
    }, keymap);

    const ev = (code, extra) => Object.assign({
        code, key: '', location: 0, repeat: false,
        ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
    }, extra);

    return {
        log, detach,
        down: (code, extra) => target.fire('keydown', ev(code, extra)),
        up: (code, extra) => target.fire('keyup', ev(code, extra)),
        blur: () => target.fire('blur', {}),
    };
}

test('a plain key press reaches core once, however many keydowns arrive', () => {
    const k = harness();
    k.down('ArrowLeft');
    k.down('ArrowLeft', { repeat: true });   // OS auto-repeat
    k.down('ArrowLeft');                     // a soft keyboard that never sets .repeat
    k.up('ArrowLeft');
    assert.deepEqual(k.log, [['press', ACTIONS.LEFT], ['release', ACTIONS.LEFT]]);
});

test('a browser chord is left to the browser', () => {
    // Ctrl+R reloads, Cmd+W closes. R is the RETRY binding and must not eat it.
    const k = harness();
    const e = k.down('KeyR', { ctrlKey: true });
    assert.deepEqual(k.log, []);
    assert.equal(e.defaultPrevented, false, 'and the browser still gets the key');

    k.down('KeyC', { metaKey: true });       // Cmd+C, over the HOLD binding
    k.down('ArrowLeft', { altKey: true });   // Alt+Left, back
    assert.deepEqual(k.log, []);
});

test('Control is CCW on its own keydown, even though it raises its own flag', () => {
    // Pressing Control necessarily sets ev.ctrlKey, so the chord rule has to
    // know that a modifier's own press is not a chord.
    const k = harness();
    k.down('ControlLeft', { ctrlKey: true });
    assert.deepEqual(k.log, [['press', ACTIONS.CCW]]);
});

test('holding Control to rotate does not mute the rest of the keyboard', () => {
    /* THE BUG THIS PINS. Ctrl is the shipped CCW binding. The old rule exempted
     * only Control's OWN keydown from the chord veto, so for as long as a
     * player held it every arrow, Space and soft drop was read as a browser
     * chord and dropped — and because the veto returned before preventDefault,
     * those arrows scrolled the page instead of moving the piece. */
    const k = harness();
    k.down('ControlLeft', { ctrlKey: true });        // rotate, and hold it
    const left = k.down('ArrowLeft', { ctrlKey: true });
    const drop = k.down('Space', { ctrlKey: true });
    assert.deepEqual(k.log, [
        ['press', ACTIONS.CCW], ['press', ACTIONS.LEFT], ['press', ACTIONS.HARD],
    ]);
    assert.ok(left.defaultPrevented, 'and the page does not scroll under them');
    assert.ok(drop.defaultPrevented);
});

test('…but a held Control still yields the browser its letter chords', () => {
    /* The exemption is granted to ACTIONS only. A player reaching for a browser
     * shortcut is reaching for a letter, and this game's letters are all
     * commands — so Ctrl+R reloads even mid-rotate, while Ctrl+ArrowLeft moves
     * the piece. Losing a run to a stray reload is bad; losing the reload is
     * worse, because there is no other way to ask for it. */
    const k = harness();
    k.down('ControlLeft', { ctrlKey: true });
    const reload = k.down('KeyR', { ctrlKey: true });
    assert.deepEqual(k.log, [['press', ACTIONS.CCW]], 'no retry fired');
    assert.equal(reload.defaultPrevented, false);
});

test('once Control is released the veto is back', () => {
    const k = harness();
    k.down('ControlLeft', { ctrlKey: true });
    k.up('ControlLeft', { ctrlKey: false });
    k.log.length = 0;
    k.down('ArrowLeft', { ctrlKey: true });   // a real chord now
    assert.deepEqual(k.log, []);
});

test('Shift never vetoes — it is the HOLD binding and is legitimately down', () => {
    const k = harness();
    k.down('ShiftLeft', { shiftKey: true });
    k.down('ArrowRight', { shiftKey: true });
    assert.deepEqual(k.log, [['press', ACTIONS.HOLD], ['press', ACTIONS.RIGHT]]);
});

test('a modifier bound to nothing does not become ours', () => {
    // Alt is unbound by default, so Alt+Left stays the browser's Back.
    const k = harness();
    k.down('AltLeft', { altKey: true });
    k.down('ArrowLeft', { altKey: true });
    assert.deepEqual(k.log, []);
});

test('losing focus releases everything, so no direction is left held', () => {
    const k = harness();
    k.down('ArrowLeft');
    k.down('ControlLeft', { ctrlKey: true });
    k.log.length = 0;
    k.blur();
    assert.deepEqual(k.log.map((e) => e[0]), ['release', 'release']);
    assert.deepEqual(k.log.map((e) => e[1]).sort(), [ACTIONS.CCW, ACTIONS.LEFT].sort());
});

test('commands fire on their own edge and are not actions', () => {
    const k = harness();
    k.down('KeyP');
    k.down('KeyR');
    assert.deepEqual(k.log, [['pause'], ['retry']]);
    assert.ok(!Object.hasOwn(ACTIONS, COMMANDS.PAUSE));
});

test('detaching leaves core holding nothing', () => {
    const k = harness();
    k.down('ArrowRight');
    k.log.length = 0;
    k.detach();
    assert.deepEqual(k.log, [['release', ACTIONS.RIGHT]]);
});
