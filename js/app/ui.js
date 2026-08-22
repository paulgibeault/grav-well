/* ui.js — screens, overlay, banner, danger hook, HUD readout.
 *
 * The app layer, so `document` is fair game (docs/ARCHITECTURE.md). What is
 * NOT fair game here is game logic: nothing in this file knows what a Quad is
 * worth, when a run ends, or which mode has a time limit. It is handed data
 * and it hands back intent — every branch below is about pixels, focus and
 * escaping, never about rules.
 *
 * NO `innerHTML`, ANYWHERE IN THIS FILE. Every string that reaches the DOM
 * goes through `textContent` or `setAttribute` (GAME_INTEGRATION.md §7b): the
 * results screen renders leaderboard names that came off another device, and
 * a name like `"><img src=x onerror=alert(1)>` has to land inertly. Building
 * the DOM node-by-node rather than by string is what makes that structural
 * instead of a rule somebody has to remember.
 *
 * The DOM in index.html is fixed; this module never adds to it beyond the
 * contents of #overlay. The hooks it drives are the ones css/well.css styles:
 *
 *   #app[data-screen]        current screen
 *   #app[data-danger]        stack over row 16 -> the finite vignette pulse
 *   #banner[data-kind]       '' dismisses (the stylesheet hides :empty)
 *
 * `createUI(root, handlers)` returns the frozen four — show/banner/setDanger/
 * dispose — plus `hud()`. The extra method is additive, not a signature
 * change: `show()` fires on screen transitions and the readout changes every
 * frame, so they cannot be the same call, and js/main.js is the only consumer
 * of this module.
 */

// A banner is an announcement, not a state: it clears itself. 'alert' is the
// exception — a topped-out run has nothing else to say, so the message stays
// until the screen changes.
const BANNER_MS = 1400;

// Bindable-name -> what a player calls it. Presentation, so it lives here
// rather than in js/input/keymap.js.
const ACTION_LABELS = {
    LEFT: 'Move left', RIGHT: 'Move right',
    CW: 'Rotate CW', CCW: 'Rotate CCW',
    SOFT: 'Soft drop', HARD: 'Hard drop', HOLD: 'Hold',
    PAUSE: 'Pause', RETRY: 'Retry',
};

// event.code is a physical position, which is unreadable to everyone except
// the person who wrote the spec. Only the shapes that differ from "strip the
// prefix" need naming.
const CODE_LABELS = {
    ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    Space: 'Space', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab',
    ControlLeft: 'Ctrl L', ControlRight: 'Ctrl R',
    ShiftLeft: 'Shift L', ShiftRight: 'Shift R',
    AltLeft: 'Alt L', AltRight: 'Alt R',
    MetaLeft: 'Meta L', MetaRight: 'Meta R',
};

function labelForCode(code) {
    if (CODE_LABELS[code]) return CODE_LABELS[code];
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit\d$/.test(code)) return code.slice(5);
    return code;
}

function labelForCodes(codes) {
    const list = Array.isArray(codes) ? codes : [];
    if (!list.length) return 'unbound';
    return list.map(labelForCode).join(' / ');
}

/* m:ss.cc — the shape index.html ships in #v-clock, so the column width never
 * jumps between the static markup and the first frame. */
export function formatClock(ms) {
    const t = Math.max(0, Math.floor(Number(ms) || 0));
    const cs = Math.floor(t / 10) % 100;
    const s = Math.floor(t / 1000) % 60;
    const m = Math.floor(t / 60000);
    return m + ':' + String(s).padStart(2, '0') + '.' + String(cs).padStart(2, '0');
}

function formatInt(n) {
    const v = Math.floor(Number(n) || 0);
    // en-US rather than the locale default: the readout is tabular-nums and a
    // locale that groups by 4 (or uses a space) breaks the column alignment
    // the stylesheet is counting on.
    return v.toLocaleString('en-US');
}

// ── tiny DOM helpers ─────────────────────────────────────────────────────
// `text` is always assigned through textContent. There is no variant of these
// that takes markup, deliberately.

function mk(tag, opts) {
    const el = document.createElement(tag);
    const o = opts || {};
    if (o.className) el.className = o.className;
    if (o.text != null) el.textContent = String(o.text);
    if (o.attrs) for (const k of Object.keys(o.attrs)) el.setAttribute(k, String(o.attrs[k]));
    if (o.style) el.setAttribute('style', o.style);
    if (o.children) for (const c of o.children) if (c) el.append(c);
    return el;
}

function button(text, onClick, opts) {
    const o = opts || {};
    const b = mk('button', { text: text, attrs: { type: 'button' } });
    if (o.primary) b.dataset.primary = '';
    if (o.style) b.setAttribute('style', o.style);
    if (o.label) b.setAttribute('aria-label', o.label);
    b.addEventListener('click', onClick);
    return b;
}

function defList(pairs) {
    const dl = mk('dl');
    for (const [k, v] of pairs) {
        if (v == null) continue;
        dl.append(mk('dt', { text: k }), mk('dd', { text: v }));
    }
    return dl;
}

function row(children) {
    // The card is a flex column and .overlay button is width:100%, so anything
    // side-by-side needs its own row box. Inline styles rather than new class
    // names: css/well.css is somebody else's file and this is layout glue for
    // nodes that only exist here.
    return mk('div', {
        style: 'display:flex; gap:0.4rem; align-items:center;',
        children: children,
    });
}

function fieldRow(labelText, control, valueEl) {
    const label = mk('label', {
        text: labelText,
        style: 'flex:1 1 auto; min-inline-size:0; font-size:0.9rem; color:var(--fg-dim);',
    });
    const id = control.id || ('f-' + Math.random().toString(36).slice(2, 8));
    control.id = id;
    label.setAttribute('for', id);
    return mk('div', {
        style: 'display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;',
        children: [label, valueEl || null, control],
    });
}

export function createUI(root, handlers) {
    const doc = (root && root.ownerDocument) || document;
    const h = handlers || {};
    const call = (name, ...args) => {
        const fn = h[name];
        if (typeof fn === 'function') return fn(...args);
        return undefined;
    };

    const overlay = doc.getElementById('overlay');
    const banner = doc.getElementById('banner');
    const readout = {
        score: doc.getElementById('v-score'),
        lines: doc.getElementById('v-lines'),
        level: doc.getElementById('v-level'),
        clock: doc.getElementById('v-clock'),
        clockLabel: doc.getElementById('l-clock'),
    };

    let bannerTimer = 0;
    let disposed = false;
    let capture = null;         // live key-rebind capture, or null
    const hudCache = { score: null, lines: null, level: null, clock: null, clockLabel: null };

    // ── banner ───────────────────────────────────────────────────────────

    function clearBannerTimer() {
        if (!bannerTimer) return;
        clearTimeout(bannerTimer);
        bannerTimer = 0;
    }

    function setBanner(text, kind) {
        if (!banner) return;
        clearBannerTimer();
        const msg = text == null ? '' : String(text);
        banner.textContent = msg;      // '' is a complete teardown (:empty hides it)
        if (!msg) { delete banner.dataset.kind; return; }
        if (kind) banner.dataset.kind = kind;
        else delete banner.dataset.kind;
        // A bad-news banner is the last thing the run said; everything else is
        // a flourish over live play and gets out of the way on its own.
        if (kind === 'alert') return;
        bannerTimer = setTimeout(() => {
            bannerTimer = 0;
            if (disposed || !banner) return;
            banner.textContent = '';
            delete banner.dataset.kind;
        }, BANNER_MS);
    }

    // ── screens ──────────────────────────────────────────────────────────

    function card(children) {
        return mk('section', { children: children.filter(Boolean) });
    }

    /* `armed` decides whether a button is left focused.
     *
     * ARMING THE RESULTS CARD IS A BUG, and it is worth spelling out because it
     * is invisible in review and obvious in play. The run ends on the DOWN edge
     * of the hard-drop key, so this card is painted while Space is still held.
     * Focus a button and the browser fires that button's activation on the UP
     * edge a few milliseconds later: the player's last hard drop silently
     * becomes "Play again", the results they just earned flash past, and a
     * fresh run is already falling. Measured, not theorised — it cost this
     * screen a full run in the harness before the cause was found.
     *
     * So the results card focuses its own container instead: the heading is
     * announced, Tab starts inside the card, nothing is armed, and R still
     * retries for anyone who wants the keyboard. Every other screen is entered
     * by a click or by Escape, neither of which can activate anything, and
     * having the primary action focused there is a kindness. */
    function paint(node, armed) {
        if (!overlay) return;
        overlay.replaceChildren(node);
        overlay.hidden = false;
        const first = armed
            ? (overlay.querySelector('button[data-primary]') || overlay.querySelector('button'))
            : node;
        if (!first) return;
        if (first === node) {
            node.tabIndex = -1;
            // A programmatic focus target is not a control, and css/well.css's
            // :focus-visible ring around the whole card reads as "selected"
            // rather than as "you are here". Hiding it on THIS element only is
            // the standard treatment for a tabindex="-1" announce target; every
            // real control keeps its ring.
            node.style.outline = 'none';
        }
        try { first.focus({ preventScroll: true }); } catch (_) { first.focus(); }
    }

    function menuScreen(data) {
        const d = data || {};
        const modes = Array.isArray(d.modes) ? d.modes : [];
        const kids = [
            mk('h1', { text: 'Gravity Well' }),
            mk('p', { text: 'The well is deep. Keep it clear.' }),
        ];

        for (const m of modes) {
            const main = button(
                (m.resumable ? 'Resume ' : '') + (m.name || m.id),
                () => call('play', m.id),
                { primary: m.id === d.selected, style: 'flex:1 1 auto;' });
            // The blurb rides inside the button as a second line: one target,
            // 44 px minimum, and nothing to mis-tap next to it.
            if (m.blurb) {
                main.textContent = '';
                main.append(
                    mk('span', { text: (m.resumable ? 'Resume ' : '') + (m.name || m.id) }),
                    mk('span', {
                        text: m.blurb,
                        style: 'display:block; font-size:0.78rem; font-weight:500; color:var(--fg-dim);',
                    }));
            }
            const kids2 = [main];
            if (m.resumable) {
                // Discarding a saved run is destructive, so the label says so
                // and js/main.js asks before it happens.
                kids2.push(button('New', () => call('fresh', m.id), {
                    style: 'inline-size:auto; flex:0 0 auto; padding:0.7rem 0.8rem;',
                    label: 'Start a new ' + (m.name || m.id) + ' run, discarding the saved one',
                }));
            }
            kids.push(row(kids2));
        }

        // Personal bests. `label` and the formatted value both come from the
        // records themselves, so a record category added later needs no code
        // here — and both are written with textContent like everything else.
        const records = Array.isArray(d.records) ? d.records : [];
        if (records.length) {
            kids.push(mk('h2', { text: 'Personal bests', style: 'margin-block-start:0.4rem;' }));
            kids.push(defList(records.map((r) => [r.label, r.text])));
        }

        const st = d.stats && typeof d.stats === 'object' ? d.stats : null;
        if (st) {
            const pairs = [];
            if (st.gamesPlayed != null) pairs.push(['Runs', formatInt(st.gamesPlayed)]);
            if (st.lines != null) pairs.push(['Lines cleared', formatInt(st.lines)]);
            if (st.quads != null) pairs.push(['Quads', formatInt(st.quads)]);
            if (st.tspins != null) pairs.push(['T-spins', formatInt(st.tspins)]);
            if (pairs.length) kids.push(defList(pairs));
        }

        kids.push(button('Settings', () => call('openSettings')));
        return card(kids);
    }

    function statPairs(d) {
        const pairs = [['Score', formatInt(d.score)], ['Lines', formatInt(d.lines)]];
        if (d.level != null) pairs.push(['Level', formatInt(d.level)]);
        if (d.elapsedMs != null) pairs.push([d.clockLabel || 'Time', formatClock(d.elapsedMs)]);
        return pairs;
    }

    function pausedScreen(data) {
        const d = data || {};
        return card([
            mk('h2', { text: 'Paused' }),
            mk('p', { text: d.modeName || '' }),
            defList(statPairs(d)),
            button('Resume', () => call('resume'), { primary: true }),
            button('Restart', () => call('restart')),
            button('Settings', () => call('openSettings')),
            button('Back to menu', () => call('quit')),
        ]);
    }

    function overScreen(data) {
        const d = data || {};
        const kids = [
            mk('h1', { text: d.title || (d.won ? 'Well cleared' : 'Topped out') }),
            mk('p', { text: d.subtitle || d.modeName || '' }),
            defList(statPairs(d)),
        ];

        if (d.record) {
            kids.push(mk('p', {
                text: 'New personal best.',
                style: 'color:var(--accent); font-weight:600;',
            }));
        }

        const scores = Array.isArray(d.scores) ? d.scores.slice(0, 5) : [];
        if (scores.length) {
            kids.push(mk('h2', { text: d.scoreTitle || 'Leaderboard' }));
            // EVERY name here came off another device (or another player's
            // sync). textContent, never innerHTML — §7b.
            kids.push(defList(scores.map((e, i) => [
                (i + 1) + '. ' + String((e && e.name) || 'Anonymous'),
                d.scoreFormat === 'duration-ms' ? formatClock(e && e.score) : formatInt(e && e.score),
            ])));
        }

        kids.push(button('Play again', () => call('restart'), { primary: true }));
        kids.push(button('Back to menu', () => call('quit')));
        return card(kids);
    }

    function settingsScreen(data) {
        const d = data || {};
        const s = d.settings || {};
        const kids = [mk('h2', { text: 'Settings' })];

        // — controls —
        kids.push(mk('h2', { text: 'Controls', style: 'margin-block-start:0.4rem;' }));
        const scheme = mk('select', { style: 'flex:0 0 auto; padding:0.35rem;' });
        for (const [value, text] of [['gesture', 'Gestures'], ['buttons', 'On-screen buttons']]) {
            const opt = mk('option', { text: text });
            opt.value = value;
            if ((s.scheme || 'gesture') === value) opt.selected = true;
            scheme.append(opt);
        }
        scheme.addEventListener('change', () => call('changeSetting', 'scheme', scheme.value));
        kids.push(fieldRow('Touch scheme', scheme));
        kids.push(mk('p', {
            text: 'Keyboard and pointer are both live at all times. Handedness follows your'
                + ' launcher setting (' + (d.handedness || 'right') + ').',
            style: 'font-size:0.8rem;',
        }));

        // — feel —
        kids.push(mk('h2', { text: 'Feel', style: 'margin-block-start:0.4rem;' }));
        kids.push(slider('DAS', 'das', s.das, 67, 333, 1, (v) => v + ' ms'));
        kids.push(slider('ARR', 'arr', s.arr, 0, 83, 1, (v) => (v === 0 ? 'instant' : v + ' ms')));
        // The slider's top notch is "instant": core clamps sdf at 1200, which
        // reaches the 20G ceiling at level 1, so anything past it is the same
        // drop and a slider that pretended otherwise would be lying.
        kids.push(slider('Soft drop', 'sdf', s.sdf >= 1200 ? 41 : s.sdf, 5, 41, 1,
            (v) => (v >= 41 ? 'instant' : v + '×'),
            (v) => (v >= 41 ? 1200 : v)));
        kids.push(toggle('Ghost piece', 'ghost', s.ghost !== false));

        const lock = mk('select', { style: 'flex:0 0 auto; padding:0.35rem;' });
        for (const [value, text] of [
            ['extended', 'Extended (15 resets)'], ['classic', 'Classic'], ['infinite', 'Infinite'],
        ]) {
            const opt = mk('option', { text: text });
            opt.value = value;
            if ((s.lockdown || 'extended') === value) opt.selected = true;
            lock.append(opt);
        }
        lock.addEventListener('change', () => call('changeSetting', 'lockdown', lock.value));
        kids.push(fieldRow('Lock down', lock));

        // — sound —
        kids.push(mk('h2', { text: 'Sound', style: 'margin-block-start:0.4rem;' }));
        kids.push(toggle('Ambient bed', 'bed', s.bed !== false));
        kids.push(mk('p', {
            text: 'Volume and mute live in the launcher.',
            style: 'font-size:0.8rem;',
        }));

        // — keys —
        if (d.playerName != null) {
            kids.push(mk('h2', { text: 'Name', style: 'margin-block-start:0.4rem;' }));
            const name = mk('input', { style: 'flex:1 1 8rem; min-inline-size:6rem; padding:0.35rem;' });
            name.type = 'text';
            name.maxLength = 32;
            name.value = String(d.playerName);
            name.setAttribute('autocomplete', 'off');
            // 'change', not 'input': the name is a shared global the launcher
            // and every other game read, and writing it per keystroke would
            // fire a storage write (and a sync) for every letter typed.
            name.addEventListener('change', () => {
                // The store clamps to 32 characters and trims; it hands back
                // what was actually kept, so the field agrees with the
                // leaderboard instead of showing a name nobody will ever see.
                const kept = call('changeName', name.value);
                if (typeof kept === 'string') name.value = kept;
            });
            kids.push(fieldRow('Leaderboard name', name));
        }

        kids.push(mk('h2', { text: 'Keys', style: 'margin-block-start:0.4rem;' }));
        const bindable = Array.isArray(d.bindable) ? d.bindable : [];
        const keymap = d.keymap || {};
        for (const name of bindable) {
            const value = mk('span', {
                text: labelForCodes(keymap[name]),
                style: 'flex:1 1 6rem; min-inline-size:0; text-align:end; font-size:0.85rem;'
                    + ' color:var(--fg); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;',
            });
            const btn = button('Rebind', () => beginCapture(name, value, btn), {
                style: 'inline-size:auto; flex:0 0 auto; padding:0.45rem 0.7rem; font-size:0.85rem;',
                label: 'Rebind ' + (ACTION_LABELS[name] || name),
            });
            kids.push(fieldRow(ACTION_LABELS[name] || name, btn, value));
        }
        kids.push(button('Restore default keys', () => call('resetKeys')));

        kids.push(button('Reset scores and progress', () => call('resetProgress')));
        kids.push(button('Done', () => call('closeSettings'), { primary: true }));
        return card(kids);

        function slider(labelText, key, current, min, max, step, fmt, toValue) {
            const input = mk('input', { style: 'flex:1 1 8rem; min-inline-size:6rem;' });
            input.type = 'range';
            input.min = String(min);
            input.max = String(max);
            input.step = String(step);
            const n = Number(current);
            input.value = String(Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min);
            const value = mk('span', {
                text: fmt(Number(input.value)),
                style: 'flex:0 0 4.5rem; text-align:end; font-variant-numeric:tabular-nums;'
                    + ' font-size:0.85rem;',
            });
            input.addEventListener('input', () => {
                const raw = Number(input.value);
                value.textContent = fmt(raw);
                // The screen is NOT re-rendered on a settings change: rebuilding
                // it under a dragging thumb would drop the pointer capture and
                // strand the drag. The row updates itself; main.js persists.
                call('changeSetting', key, toValue ? toValue(raw) : raw);
            });
            return fieldRow(labelText, input, value);
        }

        function toggle(labelText, key, on) {
            const input = mk('input', { style: 'inline-size:1.2rem; block-size:1.2rem;' });
            input.type = 'checkbox';
            input.checked = !!on;
            input.addEventListener('change', () => call('changeSetting', key, input.checked));
            return fieldRow(labelText, input);
        }
    }

    // ── key rebinding ────────────────────────────────────────────────────

    /* The next key pressed becomes the binding.
     *
     * The listener is on `window` in the CAPTURE phase and stops propagation:
     * js/input/keyboard.js is attached to the same window in the bubble phase
     * and is always live (there is no mode where the keyboard is off), so
     * without this the key being bound would also fire the action it is
     * currently bound to — pressing Escape to cancel would pause the game
     * underneath the settings screen. */
    function beginCapture(name, valueEl, btn) {
        endCapture();
        const original = valueEl.textContent;
        valueEl.textContent = 'press a key…';
        btn.textContent = 'Cancel';
        const win = doc.defaultView || window;

        const onKey = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            const code = ev.code || '';
            endCapture();
            if (!code || code === 'Escape') { valueEl.textContent = original; return; }
            const codes = call('rebind', name, code);
            valueEl.textContent = Array.isArray(codes) ? labelForCodes(codes) : labelForCode(code);
        };

        capture = () => {
            win.removeEventListener('keydown', onKey, true);
            btn.textContent = 'Rebind';
            capture = null;
        };
        win.addEventListener('keydown', onKey, true);
    }

    function endCapture() {
        if (capture) capture();
    }

    // ── public surface ───────────────────────────────────────────────────

    function show(screen, data) {
        if (disposed || !root) return;
        endCapture();
        root.dataset.screen = screen;
        // Cleared on EVERY transition, entering play included: a "TOPPED OUT"
        // left over from the last run would otherwise still be hanging over the
        // well when the next one starts.
        setBanner('');
        if (screen === 'playing') {
            if (overlay) { overlay.hidden = true; overlay.replaceChildren(); }
            // A button left focused would keep taking Enter while the piece
            // falls; the keyboard layer owns the keys from here.
            const active = doc.activeElement;
            if (active && active !== doc.body && typeof active.blur === 'function') active.blur();
            return;
        }
        if (screen === 'menu') paint(menuScreen(data), true);
        else if (screen === 'paused') paint(pausedScreen(data), true);
        else if (screen === 'over') paint(overScreen(data), false);
        else if (screen === 'settings') paint(settingsScreen(data), true);
        else if (overlay) { overlay.hidden = true; overlay.replaceChildren(); }
    }

    /* The readout, every frame. Each field is compared before it is written:
     * an unchanged textContent assignment still dirties the node in some
     * engines, and this runs 60 times a second next to a canvas that is
     * already asking for the main thread. */
    function hud(d) {
        if (disposed || !d) return;
        const score = formatInt(d.score);
        if (score !== hudCache.score && readout.score) {
            hudCache.score = score; readout.score.textContent = score;
        }
        const lines = formatInt(d.lines);
        if (lines !== hudCache.lines && readout.lines) {
            hudCache.lines = lines; readout.lines.textContent = lines;
        }
        const level = formatInt(d.level);
        if (level !== hudCache.level && readout.level) {
            hudCache.level = level; readout.level.textContent = level;
        }
        const clock = formatClock(d.clockMs);
        if (clock !== hudCache.clock && readout.clock) {
            hudCache.clock = clock; readout.clock.textContent = clock;
        }
        const clockLabel = d.clockLabel || 'Time';
        if (clockLabel !== hudCache.clockLabel && readout.clockLabel) {
            hudCache.clockLabel = clockLabel; readout.clockLabel.textContent = clockLabel;
        }
    }

    function setDanger(on) {
        if (disposed || !root) return;
        // The attribute is removed rather than set to "false": css/well.css
        // selects on [data-danger="true"], and a stale "false" reads as a bug
        // to the next person with DevTools open.
        if (on) root.dataset.danger = 'true';
        else delete root.dataset.danger;
    }

    function dispose() {
        disposed = true;
        endCapture();
        clearBannerTimer();
        if (overlay) { overlay.hidden = true; overlay.replaceChildren(); }
        if (banner) { banner.textContent = ''; delete banner.dataset.kind; }
    }

    return { show, banner: setBanner, setDanger, hud, dispose };
}
