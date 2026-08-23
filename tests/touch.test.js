/* The parts of js/input/touch.js that do not need a browser.
 *
 * The module itself is a DOM layer and attachTouch() cannot run under
 * `node --test` — but the ONE rule the tap-rotation setting has to keep is
 * pure arithmetic over two constants, so it lives in an exported function and
 * is pinned here rather than only in a browser harness. The gesture behaviour
 * around it (tap vs drag vs flick) is exercised against a real Chromium.
 *
 * Importing this file at all is itself the smaller assertion: js/input/ may
 * touch the DOM inside its handlers, but nothing there may run at IMPORT time,
 * or the module stops being loadable outside a page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS } from '../js/core/constants.js';
import { rotationPair } from '../js/input/touch.js';

test('a tap turns the way the setting says', () => {
    assert.equal(rotationPair('cw').tap, ACTIONS.CW);
    assert.equal(rotationPair('ccw').tap, ACTIONS.CCW);
});

test('the two-finger tap always turns the OTHER way', () => {
    /* The invariant the setting exists to protect. Tap and two-finger tap are
     * the only two rotation gestures on the surface, so if a setting could
     * ever point them the same way the player would simply lose
     * counter-rotation — and would find out at the one moment they needed it,
     * with no label anywhere to explain why. Deriving `alt` from `tap` makes
     * that state unrepresentable; this says so out loud. */
    for (const v of ['cw', 'ccw']) {
        const { tap, alt } = rotationPair(v);
        assert.notEqual(tap, alt, v + ': both gestures rotate the same way');
        assert.deepEqual([tap, alt].sort(), [ACTIONS.CCW, ACTIONS.CW].sort(), v);
    }
    // …including for every junk value, which all resolve to a real pair.
    for (const bad of [undefined, null, '', 'CW', 'clockwise', 0, 1, {}, [], 'ccw ']) {
        const { tap, alt } = rotationPair(bad);
        assert.notEqual(tap, alt, String(bad));
        assert.ok(tap === ACTIONS.CW || tap === ACTIONS.CCW, String(bad));
    }
});

test('flipping the setting swaps the pair rather than changing one half', () => {
    const a = rotationPair('cw'), b = rotationPair('ccw');
    assert.equal(a.tap, b.alt);
    assert.equal(a.alt, b.tap);
});

test('an unknown value is the shipped default, never a throw', () => {
    // It arrives from a stored settings blob that another build wrote or a
    // hand edit mangled. The rotation the player already has muscle memory for
    // is the safe answer; a throw here would take the input layer down at boot.
    for (const bad of [undefined, null, 'CCW', 'left', 42, {}, () => 'ccw']) {
        assert.equal(rotationPair(bad).tap, ACTIONS.CW, String(bad));
    }
});

test('rotationPair returns a fresh object the caller may keep', () => {
    const a = rotationPair('cw');
    a.tap = 'NONSENSE';
    assert.equal(rotationPair('cw').tap, ACTIONS.CW);
});
