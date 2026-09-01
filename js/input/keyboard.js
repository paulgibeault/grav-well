/* Keyboard → press/release edges. Nothing else lives here.
 *
 * THE TRAP THIS FILE EXISTS TO AVOID: operating-system key auto-repeat.
 * Hold ArrowLeft and the OS starts machine-gunning keydown events at whatever
 * rate the player's control panel says — 250 ms then 30/s on one machine,
 * 500 ms then 10/s on the next. Forward those and the OS has silently
 * overridden the game's DAS/ARR, and the piece moves at a different speed on
 * every machine no matter what the settings screen claims. So a repeated
 * keydown is dropped on the floor here (`event.repeat`), and the ONE press
 * edge is all core ever sees: DAS/ARR are game feel, they live in
 * js/core/game.js, and they are driven by held TIME, not by event count.
 *
 * The other half of the contract is symmetry: exactly one release per press.
 * A key let go while the window is blurred never delivers its keyup, so
 * anything that can steal focus has to be treated as a release of everything.
 */

import { COMMANDS, sanitizeKeymap, resolveCode, codeFromEvent, isAction } from './keymap.js';

/* Which modifier flag each modifier KEY raises. Pressing Control necessarily
 * sets ev.ctrlKey on its own keydown, so a bare-Control binding cannot be
 * judged by the chord rule below without knowing that. */
const MODIFIER_FLAG = {
    ControlLeft: 'ctrlKey', ControlRight: 'ctrlKey',
    MetaLeft: 'metaKey', MetaRight: 'metaKey',
    AltLeft: 'altKey', AltRight: 'altKey',
};

export function attachKeyboard(target, handlers, keymap) {
    const el = target || (typeof window !== 'undefined' ? window : null);
    if (!el || typeof el.addEventListener !== 'function') return function detach() {};

    const h = handlers || {};
    const press = typeof h.press === 'function' ? h.press : () => {};
    const release = typeof h.release === 'function' ? h.release : () => {};
    const pause = typeof h.pause === 'function' ? h.pause : () => {};
    const retry = typeof h.retry === 'function' ? h.retry : () => {};

    const map = sanitizeKeymap(keymap);

    // event.code → binding name, for keys WE consumed. Its emptiness is the
    // invariant: nothing may stay in here across a focus loss.
    const held = new Map();

    // `target` is whatever the app hands us — window, document, or an element —
    // but blur and visibilitychange do not all live on the same object.
    const doc = el.ownerDocument || (el.nodeType === 9 ? el : null) || el.document || null;
    const win = (doc && doc.defaultView) || (el.window === el ? el : null);

    function onKeyDown(ev) {
        const code = codeFromEvent(ev);
        const name = code && resolveCode(code, map);
        if (!name) return;      // not ours — never swallow a key we do not own

        /* A chord belongs to the browser: Ctrl+R reloads, Cmd+W closes,
         * Alt+ArrowLeft goes back. Shift deliberately does NOT veto — it is the
         * HOLD binding, so it is legitimately down during play and must not
         * mute the arrow keys while a player holds it.
         *
         * CONTROL NEEDS THE SAME EXEMPTION, AND THE OLD RULE ONLY HALF GAVE IT.
         * Ctrl is the shipped CCW binding, and the veto exempted only Control's
         * OWN keydown — so for as long as a player held it to rotate, every
         * arrow, Space and soft drop was read as a browser chord and dropped.
         * Worse, the veto returned before preventDefault, so those arrows
         * scrolled the page instead.
         *
         * A modifier we are HOLDING AS A GAME ACTION is not a chord modifier.
         * But that exemption is granted to ACTIONS only, never to commands:
         * Ctrl+ArrowLeft has to move the piece, and Ctrl+R still has to reload
         * the page — a player reaching for a browser chord is reaching for a
         * letter, and the game's letters are all commands. */
        const chord = ['ctrlKey', 'metaKey', 'altKey'].some(
            (flag) => ev[flag] && !modifierIsOurs(flag, code, name));
        if (chord) return;

        // Consumed from here on. preventDefault comes BEFORE the repeat check
        // because a held arrow keeps firing repeats and each one would scroll
        // the page; it also stops Space from re-clicking whichever on-screen
        // button happens to have focus.
        if (typeof ev.preventDefault === 'function') ev.preventDefault();

        if (ev.repeat) return;          // see the file header — this is the point
        // Some virtual, remote-desktop and on-screen keyboards resend keydown
        // without ever setting .repeat. The held map makes the one-press-per-
        // physical-press guarantee hold even when the flag lies.
        if (held.has(code)) return;

        held.set(code, name);
        if (isAction(name)) press(name);
        else if (name === COMMANDS.PAUSE) pause();
        else if (name === COMMANDS.RETRY) retry();
    }

    /* Is `flag` raised by a key WE own, rather than by the player reaching for
     * a browser shortcut? True when the key being pressed is itself that
     * modifier (its own keydown always raises its own flag), or when we are
     * already holding one that raises it — but in the second case only for an
     * action, so command bindings never shadow a browser chord. */
    function modifierIsOurs(flag, code, name) {
        if (MODIFIER_FLAG[code] === flag) return true;
        if (!isAction(name)) return false;
        for (const mod of Object.keys(MODIFIER_FLAG)) {
            if (MODIFIER_FLAG[mod] === flag && held.has(mod)) return true;
        }
        return false;
    }

    function onKeyUp(ev) {
        const code = codeFromEvent(ev);
        const name = code && held.get(code);
        if (!name) return;              // we never consumed the matching keydown
        held.delete(code);
        if (typeof ev.preventDefault === 'function') ev.preventDefault();
        if (isAction(name)) release(name);
    }

    // Alt-Tab, a launcher overlay taking focus, the phone locking: the keyup
    // is delivered to whoever has focus now, which is not us. Without this the
    // game holds LEFT forever and the player comes back to a wall-scraped stack.
    function releaseAll() {
        if (!held.size) return;
        const names = [...held.values()];
        held.clear();
        for (const name of names) if (isAction(name)) release(name);
    }

    function onVisibility() {
        if (!doc || doc.visibilityState === 'hidden') releaseAll();
    }

    const bound = [];
    function on(t, type, fn) {
        if (!t || typeof t.addEventListener !== 'function') return;
        t.addEventListener(type, fn);
        bound.push([t, type, fn]);
    }

    on(el, 'keydown', onKeyDown);
    on(el, 'keyup', onKeyUp);
    on(win, 'blur', releaseAll);
    on(win, 'pagehide', releaseAll);
    on(doc, 'visibilitychange', onVisibility);
    // An element target stops receiving keys the moment it loses focus, which
    // window-level blur does not see (focus moved within the same document).
    if (el !== win) on(el, 'blur', releaseAll);

    return function detach() {
        for (const [t, type, fn] of bound) t.removeEventListener(type, fn);
        bound.length = 0;
        releaseAll();       // detaching must not leave core holding a direction
    };
}
