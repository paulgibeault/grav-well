/* main.js — boot, and the only place the layers meet.
 *
 * Everything below is wiring. There is no rule of the game in this file, no
 * drawing, no storage key and no cue name: core owns the rules, js/render/*
 * owns the pixels, js/app/store.js owns the bytes, js/app/audio.js owns the
 * sound. What lives here is the order those five are started in, the frame
 * that drives them, and the lifecycle contract with the launcher.
 *
 * BOOT ORDER (GAME_INTEGRATION.md §2). `Arcade.init()` already ran in
 * index.html's <head>; this module awaits `Arcade.ready` before it reads a
 * single byte of state. Inside a launcher frame the stored snapshot arrives
 * with the welcome message, so a pre-ready read comes back empty and a
 * pre-ready write can be discarded in favour of the value that lands a beat
 * later — which is a save quietly lost, not a warning.
 *
 * THE FRAME, and its one non-obvious line:
 *
 *     update(g, dtMs);
 *     audio.consume(g);
 *     renderer.notify(g.events);
 *     g.events.length = 0;        // the app owns the drain
 *     renderer.draw(g);
 *
 * Two consumers read that array and NEITHER may clear it (ARCHITECTURE.md).
 * Whichever cleared first would silently starve the other, and the symptom —
 * "the sound stopped working on line clears" — points nowhere near the cause.
 *
 * PARKING THE LOOP (§6d). The loop runs during live play, because a piece is
 * always falling and that is gameplay-essential motion. Everywhere else —
 * menu, pause, settings, results — it is stopped and single frames are drawn
 * with kick(), once the renderer says its effects have finished. A settled
 * screen produces no frames at all; that is a battery contract, not a
 * preference, and a Performance trace is how it is checked.
 */

import {
    createGame, update, press, release, serialize, deserialize,
    MAX_PIN_LEVEL, SNAPSHOT_VERSION,
} from './core/game.js';
import { ACTIONS, ROWS } from './core/constants.js';
import { highestRow } from './core/board.js';
import { createRenderer } from './render/index.js';
import { attachKeyboard } from './input/keyboard.js';
import { attachTouch } from './input/touch.js';
import { BINDABLE, DEFAULT_KEYMAP, sanitizeKeymap } from './input/keymap.js';
import { createAudio } from './app/audio.js';
import { createUI, formatClock } from './app/ui.js';
/* Namespace imports, deliberately, for the three modules written against the
 * frozen signatures rather than against this file. A named import of an export
 * a module does not have is a link-time SyntaxError that takes the whole game
 * down before a line of it runs; a namespace import of the same missing name
 * is `undefined`, which the guards below survive. The cost is a `typeof`
 * before the calls that matter. */
import * as store from './app/store.js';
import * as modes from './app/modes.js';
import * as arcadeSettings from './app/settings.js';

const A = (typeof window !== 'undefined' && window.Arcade) ? window.Arcade : null;

// DESIGN.md §5: the vignette warns when the stack crosses row 16 of the 20
// visible rows — four rows of headroom left.
const DANGER_ROWS = 16;

// The launcher topbar is not a HUD. Retitling on every scoring frame would
// post a message across the iframe boundary sixty times a second for a string
// nobody is watching that closely.
const TITLE_MS = 1000;

/* The player's own settings, as this file needs them. js/app/store.js owns the
 * stored shape and its defaults; these are the floor under a read that came
 * back empty, partial, or hand-edited, so a missing field is never `undefined`
 * three call frames from here. `endless` is deliberately absent, and now
 * permanently so: Marathon has no line goal at all (§3), so there is nothing
 * left for such a setting to switch. */
const FALLBACK_SETTINGS = {
    das: 167, arr: 33, sdf: 20, ghost: true, lockdown: 'extended',
    scheme: 'gesture', bed: true, flick: 1, tapRotate: 'cw', keymap: null,
    // §2.2 — the accessibility glyph mode. Colour is never the only channel.
    glyphs: false,
    // §3 — the level Marathon pins itself at. Not a core setting: it is a mode
    // OPT, so it goes through modes.gameOptsFor() rather than coreSettings().
    pinLevel: 5,
};

/* Every call into js/app/store.js goes through here.
 *
 * That module is written by another hand against the same frozen contract, and
 * a throw inside a storage read at boot would otherwise be a black screen
 * rather than a run that starts without its saved settings. Storage failing is
 * survivable; the game not booting is not. */
function safe(fn, fallback) {
    try {
        const v = fn();
        return v === undefined ? fallback : v;
    } catch (err) {
        console.warn('[grav-well] storage call failed', err);
        return fallback;
    }
}

function clamp(v, min, max, dflt) {
    const n = Number(v);
    if (!Number.isFinite(n)) return dflt;
    return n < min ? min : (n > max ? max : n);
}

boot();

async function boot() {
    // §2: never read state before this resolves. Standalone it settles on the
    // SDK's own timeout; framed it settles on the welcome handshake.
    if (A && A.ready && typeof A.ready.then === 'function') {
        try { await A.ready; } catch (_) { /* a rejected ready still boots */ }
    }

    const app = document.getElementById('app');
    const touchRoot = document.getElementById('touch');
    const canvases = {
        well: document.getElementById('well'),
        hold: document.getElementById('hold'),
        next: document.getElementById('next'),
    };

    // ── settings ─────────────────────────────────────────────────────────

    let settings = readSettings();
    let keymap = sanitizeKeymap(settings.keymap);
    let arc = readArcade();

    function readSettings() {
        const stored = safe(() => store.loadSettings(), null);
        const s = Object.assign({}, FALLBACK_SETTINGS, stored || {});
        // Clamped here as well as in core: these values also reach the settings
        // screen, and a slider handed a NaN renders at its minimum without ever
        // saying why.
        s.das = clamp(s.das, 0, 5000, FALLBACK_SETTINGS.das);
        s.arr = clamp(s.arr, 0, 1000, FALLBACK_SETTINGS.arr);
        s.sdf = clamp(s.sdf, 1, 1200, FALLBACK_SETTINGS.sdf);
        s.ghost = s.ghost !== false;
        s.bed = s.bed !== false;
        s.glyphs = !!s.glyphs;
        s.scheme = s.scheme === 'buttons' ? 'buttons' : 'gesture';
        // §4 flick sensitivity. The range is js/input/touch.js's, restated
        // because the settings slider is drawn from these bounds too — and
        // because touch.js DISCARDS an out-of-range value rather than clamping
        // it, so a blob that got past here would silently keep the defaults.
        s.flick = clamp(s.flick, 0.4, 3, FALLBACK_SETTINGS.flick);
        // §4 — tap rotation direction. Two legal values and no third meaning,
        // so an unknown one is the default rather than a throw.
        s.tapRotate = s.tapRotate === 'ccw' ? 'ccw' : 'cw';
        // Core clamps it again on the way into createGame(); this is so the
        // menu's level picker cannot be handed a value with no <option>.
        s.pinLevel = Math.round(clamp(s.pinLevel, 1, MAX_PIN_LEVEL, FALLBACK_SETTINGS.pinLevel));
        if (s.lockdown !== 'classic' && s.lockdown !== 'infinite') s.lockdown = 'extended';
        return s;
    }

    function readArcade() {
        if (typeof arcadeSettings.readArcadeSettings === 'function') {
            const v = safe(() => arcadeSettings.readArcadeSettings(), null);
            if (v) return v;
        }
        // Only reached if js/app/settings.js is unavailable. The powerSaver
        // read is guarded on its own receiver — the property landed in SDK
        // 3.13.0 and calling it on anything older throws (contract gate C).
        const s = A && A.settings ? A.settings : null;
        if (!s) return { theme: 'dark', fontScale: 1, reducedMotion: false, powerSaver: false, handedness: 'right' };
        return {
            theme: (s.theme ? s.theme() : 'dark') === 'light' ? 'light' : 'dark',
            fontScale: Number(s.fontScale ? s.fontScale() : 1) || 1,
            reducedMotion: s.reducedMotion ? !!s.reducedMotion() : false,
            powerSaver: s.powerSaver ? !!s.powerSaver() : false,
            handedness: (s.handedness ? s.handedness() : 'right') === 'left' ? 'left' : 'right',
        };
    }

    // Only the five fields core knows about. The rest of the settings blob is
    // the shell's business and core would ignore it anyway.
    function coreSettings() {
        return {
            das: settings.das, arr: settings.arr, sdf: settings.sdf,
            ghost: settings.ghost, lockdown: settings.lockdown,
        };
    }

    // ── the pieces ───────────────────────────────────────────────────────

    const renderer = createRenderer(canvases, {
        theme: arc.theme,
        fontScale: arc.fontScale,
        reducedMotion: arc.reducedMotion,
        powerSaver: arc.powerSaver,
        glyphs: settings.glyphs,
    });

    const audio = createAudio({ powerSaver: arc.powerSaver, bedEnabled: settings.bed });

    /* #touch is unhidden UNCONDITIONALLY, with no device test anywhere in this
     * file (DESIGN.md §4, ARCHITECTURE.md). Gestures are the primary scheme and
     * one Pointer Events path serves a thumb, a stylus and a trackpad alike, so
     * a laptop needs the surface exactly as much as a phone does — and the
     * keyboard below is attached at the same time, on every device. There is no
     * mode in which one of the two is off. */
    if (touchRoot) touchRoot.hidden = false;

    const touch = attachTouch(touchRoot, {
        press: onPress,
        release: onRelease,
    }, {
        scheme: settings.scheme, handedness: arc.handedness,
        flick: settings.flick, tapRotate: settings.tapRotate,
    });

    let detachKeys = attachKeyboard(window, {
        press: onPress,
        release: onRelease,
        pause: onPauseKey,
        retry: onRetryKey,
    }, keymap);

    const ui = createUI(app, {
        play: (id) => startMode(id, false),
        fresh: (id) => confirmFresh(id),
        resume: resumePlay,
        restart: () => retryRun(true),
        quit: toMenu,
        openSettings: openSettings,
        closeSettings: closeSettings,
        changeSetting: changeSetting,
        rebind: rebind,
        resetKeys: resetKeys,
        resetProgress: clearSavedRuns,
        changeName: changeName,
    });

    // ── state ────────────────────────────────────────────────────────────

    let game = null;
    let modeId = defaultModeId();
    let screen = 'menu';
    let playing = false;
    /* Has this run actually been played? A game object exists from the moment
     * the menu is drawn — the well behind the card is a real, prepared run — and
     * its core phase is 'playing' from the moment createGame() returns. Without
     * this flag the onSuspend flush would write a snapshot for a run nobody has
     * touched, and every mode would offer to "Resume" a game that was never
     * started. */
    let started = false;
    let settingsFrom = 'menu';      // where the settings screen was opened from
    let lastCellPx = 0;
    let lastTitle = '';
    let titleAt = 0;
    let rebootQueued = false;
    // The results payload, kept so closing Settings can put the card back.
    let lastOver = null;
    // The board revision this shell last reacted to. -1 so the first frame of
    // a run always counts as a change.
    let lastBoardRev = -1;

    const loop = A && typeof A.loop === 'function'
        ? A.loop(frame)
        : fallbackLoop(frame);

    // ── the frame ────────────────────────────────────────────────────────

    function frame(dtMs) {
        const g = game;
        if (g) {
            if (playing) update(g, dtMs);
            // Order is the contract's, and the drain is ours: neither consumer
            // may clear g.events or it starves the other.
            audio.consume(g);
            renderer.notify(g.events);
            drainAppEvents(g);
            g.events.length = 0;
        }
        const busy = renderer.draw(g);
        pushCellPx(false);
        if (g) {
            updateHud(g);
            if (playing && (g.phase === 'over' || g.phase === 'won')) endRun(g);
        }
        // §6d: the moment nothing is animating and nothing is falling, stop
        // asking for frames. The FX layer is what `busy` reports, so a line
        // clear finishes its collapse before the screen goes quiet.
        if (!playing && !busy) loop.stop();
    }

    function kick() {
        if (!loop.running()) loop.kick();
    }

    /* The third reader of the frame's events — banner copy, the danger hook,
     * and the eviction-safe snapshot. It runs BEFORE the drain (below it in
     * frame(), above the `length = 0`) for the same reason the other two do. */
    function drainAppEvents(g) {
        const ev = g.events;
        /* The board's own revision, not the events that usually accompany it.
         * Zen's sink moves the stack with nothing but a 'hold' behind it, and
         * the danger vignette and the eviction snapshot were both keyed off
         * lock/clear/topout — so a sunk well kept its warning glow and the
         * snapshot on disk kept the pre-sink board. */
        const rev = g.boardRev | 0;
        let boardMoved = rev !== lastBoardRev;
        lastBoardRev = rev;
        let announced = false;
        for (let i = 0; i < ev.length; i++) {
            const e = ev[i];
            if (e.type === 'topout') {
                boardMoved = true;
            } else if (e.type === 'clear') {
                boardMoved = true;
                const text = clearBanner(e);
                if (text) { ui.banner(text, clearHeat(e)); announced = true; }
            } else if (e.type === 'levelup' && !announced) {
                ui.banner('LEVEL ' + e.level);
                announced = true;
            }
        }
        if (!boardMoved) return;
        refreshDanger(g);
        // §6b: the snapshot is written on every lock, not only on suspend. An
        // evicted iframe is a destroyed heap, and the most a player can then
        // lose is the piece that was in the air.
        saveNow();
    }

    /* What the banner says about one clear.
     *
     * THREE FACTS, NOT ONE NUMBER WITH THREE MEANINGS. The old line appended
     * "×N" for the combo, and a quad streak wants the same suffix — so a
     * "B2B QUAD ×3" would have meant the third quad in a row on one lock and a
     * three-clear chain on the next, with nothing on screen to tell them
     * apart. The streak keeps the bare ×, because it is a multiplier ON the
     * label it follows; the chain gets its own word, because it is not.
     */
    function clearBanner(e) {
        if (e.perfectClear) return 'SINGULARITY';
        let s = e.label || '';
        if (e.quadStreak > 1) s += ' \u00d7' + e.quadStreak;
        if (e.combo > 1) s = s ? s + ' \u00b7 COMBO ' + e.combo : 'COMBO ' + e.combo;
        return s;
    }

    /* How hard it should land. One ladder, shared with the combo readout and
     * the FX layer (ui.heatFor), so a chain that is showing as `blaze` in the
     * rail does not arrive as a polite grey banner over the well.
     *
     * A quad streak is worth roughly three combo steps: quads are rarer and
     * the streak is harder to hold, so a second quad in a row should read
     * louder than a second clear in a chain. Whichever of the two is hotter
     * wins — they are two ways of being on a run, not two runs to add up. */
    function clearHeat(e) {
        if (e.perfectClear) return 'record';
        const streak = e.quadStreak > 1 ? e.quadStreak * 3 : 0;
        const n = Math.max(streak, e.combo > 1 ? e.combo : 0);
        return n >= 2 && typeof ui.heatFor === 'function' ? ui.heatFor(n) : '';
    }

    function refreshDanger(g) {
        // highestRow() is ROWS for an empty well, so this is the stack's height
        // in rows — the buffer above the visible field included.
        ui.setDanger((ROWS - highestRow(g.board)) >= DANGER_ROWS);
    }

    /* The true cell size, pushed rather than measured.
     *
     * js/input/touch.js can measure its own surface, but that fallback drifts
     * about 25% at --font-scale: 1.5, and every gesture threshold is a ratio of
     * a cell — so a drag needs a quarter more travel per column than it should
     * and the game feels sticky for exactly the players who scaled type up. The
     * renderer is the layer that actually knows the number. Compared before it
     * is pushed, so the per-frame call costs one number comparison. */
    function pushCellPx(force) {
        const cell = renderer.cellPx();
        if (!cell) return;
        if (!force && cell === lastCellPx) return;
        lastCellPx = cell;
        touch.setOpts({ cellPx: cell });
    }

    function updateHud(g) {
        const remaining = g.timeLimitMs != null;
        ui.hud({
            score: g.score,
            lines: g.lines,
            level: g.level,
            clockMs: remaining ? Math.max(0, g.timeLimitMs - g.elapsedMs) : g.elapsedMs,
            clockLabel: remaining ? 'Left' : 'Time',
            combo: g.combo,
        });
        if (playing) setTitle(g);
    }

    function setTitle(g) {
        if (!A || !A.ui || typeof A.ui.setTitle !== 'function') return;
        const now = Date.now();
        if (now - titleAt < TITLE_MS) return;
        titleAt = now;
        const m = modeFor(modeId);
        const tail = m.metric === 'time'
            ? formatClock(g.elapsedMs)
            : g.score.toLocaleString('en-US');
        const title = 'Gravity Well — ' + m.name + ' ' + tail;
        if (title === lastTitle) return;
        lastTitle = title;
        A.ui.setTitle(title);
    }

    // ── input ────────────────────────────────────────────────────────────

    function onPress(action) {
        // Gated on the SHELL's screen, not on core's phase. Pausing never
        // touches the game state (there is no pause() in core, by design — the
        // app pauses by not calling update), so core would happily accept a
        // shift while the pause card is up.
        if (!playing || !game) {
            /* Space is HARD DROP during play, so js/input/keyboard.js owns the
             * key and calls preventDefault on it — which also cancels the
             * native activation of whichever overlay button has focus. Hand it
             * back on a settled screen: Space on a menu means "the obvious
             * one", and a keyboard player should not have to learn that this
             * particular game wants Enter. */
            if (action === ACTIONS.HARD) activateFocused();
            return;
        }
        press(game, action);
    }

    function activateFocused() {
        const el = document.activeElement;
        if (el && el.tagName === 'BUTTON' && app && app.contains(el)) el.click();
    }

    function onRelease(action) {
        if (!game) return;
        // Deliberately NOT gated: a key released while paused still has to drop
        // its auto-shift, or the piece walks into the wall on resume.
        release(game, action);
    }

    function onPauseKey() {
        if (screen === 'playing') pausePlay();
        else if (screen === 'paused') resumePlay();
        else if (screen === 'settings') closeSettings();
    }

    function onRetryKey() {
        /* GATED ON THE SCREEN, because R means "retry THIS run" and on a
         * settled screen there is no this-run to retry. Ungated it reached the
         * menu, where `instantRetry` modes (Sprint, Ultra) took it literally
         * and launched a fresh run straight past the menu the player was
         * standing in — and where everything else popped "Restart this run?"
         * over a run nobody had started.
         *
         * The settings screen is excluded too: its own key-capture listener
         * runs in the CAPTURE phase and stops propagation while a rebind is
         * armed, but the rest of the time R would reach here and throw the
         * player out of the screen they were configuring. */
        if (screen !== 'playing' && screen !== 'paused' && screen !== 'over') return;
        // The input layer fires this on the key edge and cannot express "are
        // you sure" — a key edge is not a held gesture. The confirmation is the
        // app's, which is what Arcade.ui.confirm is for.
        retryRun(false);
    }

    function releaseAllActions() {
        if (!game) return;
        for (const action of Object.keys(ACTIONS)) release(game, ACTIONS[action]);
    }

    // ── screens ──────────────────────────────────────────────────────────

    function setScreen(name, data) {
        screen = name;
        playing = name === 'playing';
        ui.show(name, data);
        if (playing) loop.start();
        else kick();
    }

    function modeFor(id) {
        if (typeof modes.modeFor === 'function') {
            const m = safe(() => modes.modeFor(id), null);
            if (m) return m;
        }
        const table = modes.MODES || {};
        const m = Object.hasOwn(table, id) ? table[id] : null;
        return m || { id: id, name: id, metric: 'score', instantRetry: false };
    }

    function defaultModeId() {
        return typeof modes.DEFAULT_MODE === 'string' ? modes.DEFAULT_MODE : 'arcade';
    }

    function modeIds() {
        if (Array.isArray(modes.MODE_IDS) && modes.MODE_IDS.length) return modes.MODE_IDS;
        return Object.keys(modes.MODES || { marathon: 1 });
    }

    function menuData(focus) {
        return {
            selected: modeId,
            focus: focus || null,
            maxPinLevel: MAX_PIN_LEVEL,
            modes: modeIds().map((id) => {
                const m = modeFor(id);
                return {
                    id: id,
                    name: m.name || id,
                    blurb: m.blurb || '',
                    // A pinnable mode draws a level picker beside its row and
                    // shows THAT level's record rather than the mode's.
                    pinnable: !!m.pinnable,
                    pinLevel: settings.pinLevel,
                    resumable: !!loadSnapshot(id),
                };
            }),
            stats: safe(() => (typeof store.loadStats === 'function' ? store.loadStats() : null), null),
            records: personalBests(),
            // The four cross-mode bests, for the foot. Inside the launcher the
            // Records sheet shows these too; the standalone page has no sheet.
            skills: typeof store.loadSkillRecords === 'function'
                ? (safe(() => store.loadSkillRecords(), null) || []) : [],
        };
    }

    /* Every personal best the player holds, formatted for display.
     *
     * Read through js/app/store.js, never through Arcade.records: that module
     * is the single owner of records/scores/stats/state/player, and a second
     * caller is a bug even when it works. */
    function personalBests() {
        if (typeof store.loadRecords !== 'function') return [];
        const all = safe(() => store.loadRecords(), null);
        if (!all || typeof all !== 'object') return [];
        const list = Array.isArray(all) ? all : Object.keys(all).map((k) => all[k]);
        const out = [];
        for (const r of list) {
            if (!r || typeof r !== 'object' || !Number.isFinite(Number(r.value))) continue;
            out.push({ label: String(r.label || r.category || 'Best'), text: formatRecord(r) });
        }
        return out;
    }

    // The record says what it is; the launcher's Records sheet renders it from
    // the same three fields, so this agrees with it by construction.
    function formatRecord(r) {
        const v = Number(r.value);
        if (r.format === 'duration-ms') return formatClock(v);
        if (r.format === 'percentage') return Math.round(v) + '%';
        return v.toLocaleString('en-US');
    }

    function runData(g) {
        const m = modeFor(modeId);
        const remaining = g.timeLimitMs != null;
        return {
            modeName: m.name || modeId,
            score: g.score, lines: g.lines, level: g.level,
            elapsedMs: remaining ? Math.max(0, g.timeLimitMs - g.elapsedMs) : g.elapsedMs,
            clockLabel: remaining ? 'Left' : 'Time',
        };
    }

    function toMenu() {
        started = false;
        lastOver = null;
        releaseAllActions();
        audio.stop();
        ui.setDanger(false);
        ui.banner('');
        prepareGame(modeId, false);
        setScreen('menu', menuData());
        clearTitle();
    }

    function clearTitle() {
        lastTitle = '';
        titleAt = 0;
        if (A && A.ui && typeof A.ui.setTitle === 'function') A.ui.setTitle('');
    }

    function startMode(id, fresh) {
        modeId = id;
        lastOver = null;
        prepareGame(id, fresh);
        if (!game) return;
        started = true;
        refreshDanger(game);
        audio.start();
        setScreen('playing');
        pushCellPx(true);
    }

    async function confirmFresh(id) {
        // Discarding a saved run is destructive and unrecoverable: the snapshot
        // is the run.
        const ok = await confirmAsk('Start a new ' + (modeFor(id).name || id)
            + ' run? The saved one is lost.', { okLabel: 'New run', cancelLabel: 'Keep it' });
        if (!ok) { setScreen('menu', menuData()); return; }
        safe(() => store.clearRun(id), null);
        startMode(id, true);
    }

    function pausePlay() {
        if (!playing) return;
        // No core state is touched: pausing IS "stop calling update". Held
        // actions are dropped so a direction held at the moment of the pause
        // does not auto-shift the instant play resumes.
        releaseAllActions();
        audio.stop();
        saveNow();
        setScreen('paused', game ? runData(game) : null);
    }

    function resumePlay() {
        if (!game || game.phase !== 'playing') { toMenu(); return; }
        started = true;
        audio.start();
        setScreen('playing');
        pushCellPx(true);
    }

    async function retryRun(fromButton) {
        if (!game && screen !== 'over') return;
        const m = modeFor(modeId);
        const wasPlaying = playing;
        if (screen === 'over' || m.instantRetry || fromButton) {
            startMode(modeId, true);
            return;
        }
        // Pause first: the piece must not keep falling behind a modal.
        if (wasPlaying) pausePlay();
        const ok = await confirmAsk('Restart this run?',
            { okLabel: 'Restart', cancelLabel: 'Keep playing' });
        if (ok) startMode(modeId, true);
        else if (wasPlaying) resumePlay();
    }

    /* Settings opens from EVERY settled screen and returns to the one it was
     * opened from — menu, pause card, results card. `lastOver` is why the
     * results case works: that card is built from a run object that endRun()
     * has already finished with, so there is nothing left to rebuild it from
     * and the payload has to be kept. */
    function openSettings() {
        settingsFrom = screen === 'paused' ? 'paused'
            : (screen === 'over' ? 'over' : 'menu');
        if (screen === 'playing') { pausePlay(); settingsFrom = 'paused'; }
        showSettings();
    }

    function showSettings() {
        setScreen('settings', {
            settings: settings,
            keymap: keymap,
            bindable: BINDABLE,
            handedness: arc.handedness,
            // null hides the field entirely rather than showing one that
            // cannot be saved, for a store build without the accessors.
            playerName: typeof store.playerName === 'function'
                ? (safe(() => store.playerName(), '') || '') : null,
        });
    }

    function changeName(name) {
        if (typeof store.setPlayerName !== 'function') return undefined;
        return safe(() => store.setPlayerName(String(name || '')), undefined);
    }

    function closeSettings() {
        if (settingsFrom === 'paused' && game) { setScreen('paused', runData(game)); return; }
        if (settingsFrom === 'over' && lastOver) { setScreen('over', lastOver); return; }
        setScreen('menu', menuData());
    }

    // ── settings changes ─────────────────────────────────────────────────

    const CORE_KEYS = new Set(['das', 'arr', 'sdf', 'ghost', 'lockdown']);

    function changeSetting(key, value) {
        if (!Object.hasOwn(FALLBACK_SETTINGS, key)) return;
        settings[key] = value;
        settings = readSettingsFrom(settings);
        persistSettings();

        if (CORE_KEYS.has(key)) applyCoreSettings();
        if (key === 'scheme') touch.setOpts({ scheme: settings.scheme });
        if (key === 'flick') touch.setOpts({ flick: settings.flick });
        if (key === 'tapRotate') touch.setOpts({ tapRotate: settings.tapRotate });
        if (key === 'bed') audio.setOpts({ bedEnabled: settings.bed });
        if (key === 'ghost') kick();
        // Every cached bitmap carries the glyphs, so this is a full rebuild —
        // which setOpts does for us, and then redraws once.
        if (key === 'glyphs') renderer.setOpts({ glyphs: settings.glyphs });
        /* The pinned level changes what the row above the picker SAYS — the
         * "Best" caption is that level's record — so the menu is rebuilt, and
         * focus is handed straight back to the control the player is still
         * using. It also invalidates any prepared-but-unstarted run, because
         * that run was built at the old level; `started` guards the reload so
         * a run actually in progress is never swapped out from under a player
         * who reached Settings through the pause card. */
        if (key === 'pinLevel') {
            if (!started && modeFor(modeId).pinnable) prepareGame(modeId, false);
            if (screen === 'menu') ui.show('menu', menuData('.mode-level'));
        }
    }

    // Re-run the same clamping the loader does, over an object we already hold.
    function readSettingsFrom(s) {
        const merged = Object.assign({}, FALLBACK_SETTINGS, s);
        merged.das = clamp(merged.das, 0, 5000, FALLBACK_SETTINGS.das);
        merged.arr = clamp(merged.arr, 0, 1000, FALLBACK_SETTINGS.arr);
        merged.sdf = clamp(merged.sdf, 1, 1200, FALLBACK_SETTINGS.sdf);
        merged.ghost = merged.ghost !== false;
        merged.bed = merged.bed !== false;
        merged.glyphs = !!merged.glyphs;
        merged.scheme = merged.scheme === 'buttons' ? 'buttons' : 'gesture';
        merged.flick = clamp(merged.flick, 0.4, 3, FALLBACK_SETTINGS.flick);
        merged.tapRotate = merged.tapRotate === 'ccw' ? 'ccw' : 'cw';
        merged.pinLevel = Math.round(
            clamp(merged.pinLevel, 1, MAX_PIN_LEVEL, FALLBACK_SETTINGS.pinLevel));
        if (merged.lockdown !== 'classic' && merged.lockdown !== 'infinite') merged.lockdown = 'extended';
        return merged;
    }

    function persistSettings() {
        const payload = Object.assign({}, settings, { keymap: keymap });
        safe(() => store.saveSettings(payload), false);
    }

    /* Push DAS/ARR/SDF/ghost/lockdown into a run that is already in flight.
     *
     * `g.settings` is core state and the contract says core state is never
     * mutated outside core — and there is no setSettings() in the frozen
     * surface. So the change is applied the one way the contract does sanction:
     * through the snapshot. serialize() hands back plain JSON, the settings
     * field of THAT is ours to edit, and deserialize() rebuilds an identical
     * run — same board, same bag, same rng state, same tick — with the new
     * feel. Costs one 400-character string per settings change, which happens
     * while a slider is being dragged and never during play. */
    function applyCoreSettings() {
        if (!game) return;
        const snap = serialize(game);
        if (!snap) return;
        snap.settings = Object.assign({}, snap.settings, coreSettings());
        const next = deserialize(snap);
        if (next) game = next;
        kick();
    }

    function rebind(name, code) {
        const next = {};
        for (const key of BINDABLE) next[key] = (keymap[key] || []).slice();
        next[name] = [code];
        keymap = sanitizeKeymap(next);
        persistSettings();
        // attachKeyboard returns only detach(), so a key map change is a detach
        // and a fresh attach — the map is captured at attach time and the
        // resolver caches an index against the object identity.
        reattachKeyboard();
        return keymap[name];
    }

    function resetKeys() {
        keymap = sanitizeKeymap(DEFAULT_KEYMAP);
        persistSettings();
        reattachKeyboard();
        showSettings();
    }

    function reattachKeyboard() {
        detachKeys();
        detachKeys = attachKeyboard(window, {
            press: onPress, release: onRelease, pause: onPauseKey, retry: onRetryKey,
        }, keymap);
    }

    async function clearSavedRuns() {
        const ok = await confirmAsk('Delete every saved run? Scores and records are kept.',
            { okLabel: 'Delete', cancelLabel: 'Cancel' });
        if (!ok) return;
        for (const id of modeIds()) safe(() => store.clearRun(id), null);
        game = null;
        prepareGame(modeId, true);
        toast('Saved runs deleted.');
        showSettings();
    }

    // ── runs ─────────────────────────────────────────────────────────────

    function loadSnapshot(id) {
        const snap = safe(() => store.loadRun(id), null);
        // A finished run is not a resumable one. Its snapshot is cleared when
        // the results are filed, so this only catches a save that predates that
        // (or an import of one).
        if (!snap || (snap.phase && snap.phase !== 'playing')) return null;
        /* And neither is one this build cannot read. deserialize() is the
         * authority and answers null for a stale version — but it is called a
         * screen later, and without this check the menu would advertise
         * "Run in progress" for a save that silently starts fresh when tapped.
         * The v1→v2 bump is exactly that case: every stored Marathon run
         * predates the mode meaning something different. */
        if (snap.v !== SNAPSHOT_VERSION) return null;
        return snap;
    }

    function seedFor(id) {
        const m = modeFor(id);
        if (m.seedSource === 'daily' && A && A.daily && typeof A.daily.seed === 'function') {
            // Returns a seeded GENERATOR; modes.gameOptsFor unwraps its u32.
            return A.daily.seed();
        }
        // Casual runs seed from entropy (§2.3). crypto is the honest source;
        // Math.random is the fallback for a context without it. Neither is in
        // core, which is why the seed is chosen here and handed in.
        const c = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto : null;
        if (c) return c.getRandomValues(new Uint32Array(1))[0];
        return (Math.random() * 0x100000000) >>> 0;
    }

    function optsFor(id) {
        const seed = seedFor(id);
        let opts = null;
        if (typeof modes.gameOptsFor === 'function') {
            opts = safe(() => modes.gameOptsFor(id, seed, { pinLevel: settings.pinLevel }), null);
        }
        if (!opts || typeof opts !== 'object') opts = { mode: id, seed: seed };
        // gameOptsFor deliberately returns no `settings`: DAS/ARR/SDF/ghost/
        // lockdown are the PLAYER's, not the mode's. Composing them is this
        // file's job and nowhere else's.
        return Object.assign({}, opts, { settings: coreSettings() });
    }

    function prepareGame(id, fresh) {
        modeId = id;
        game = null;
        started = false;
        if (!fresh) {
            const snap = loadSnapshot(id);
            if (snap) {
                // A snapshot carries the settings it was saved with; the
                // player's current feel wins on resume.
                snap.settings = Object.assign({}, snap.settings, coreSettings());
                game = deserialize(snap);
            }
        }
        if (!game) game = createGame(optsFor(id));
        if (game) refreshDanger(game);
        // The new game has its own revision counter, so the shell's baseline
        // has to be re-taken or the first frame reads as "nothing moved".
        lastBoardRev = game ? (game.boardRev | 0) : -1;
        lastTitle = '';
    }

    function saveNow() {
        if (!started || !game || game.phase !== 'playing') return;
        // Synchronous by contract — this is also the onSuspend path, where the
        // launcher holds teardown for ~250 ms and only a sync write lands.
        safe(() => store.saveRun(modeId, serialize(game)), false);
    }

    function endRun(g) {
        playing = false;
        started = false;
        releaseAllActions();
        audio.stop();
        safe(() => store.clearRun(modeId), null);

        const m = modeFor(modeId);
        const won = g.phase === 'won';
        const res = safe(() => store.recordResult(modeId, g), null) || {};
        // A toast, not a banner: #banner sits at z-index 2 and the results card
        // covers it at 4, so anything written there now is announced to an
        // empty room. The card says it instead.
        if (res.improved) toast('New best!', 'success');

        const remaining = g.timeLimitMs != null;
        /* KEPT, not just shown. endRun() is finished with `g` by the time the
         * card is up — the run is filed and cleared — so if the player opens
         * Settings from here there is nothing left to rebuild the card from.
         * closeSettings() puts this exact payload back. */
        lastOver = {
            modeName: m.name || modeId,
            title: won ? (m.metric === 'time' ? 'Dug out' : 'Run complete') : 'Topped out',
            subtitle: won ? (m.name || modeId)
                : (g.topOutReason === 'lock' ? 'Locked out above the well' : 'Blocked out at the skyline'),
            won: won,
            record: !!res.improved,
            score: g.score, lines: g.lines, level: g.level,
            elapsedMs: remaining ? Math.max(0, g.timeLimitMs - g.elapsedMs) : g.elapsedMs,
            clockLabel: remaining ? 'Left' : 'Time',
            /* THE BOARD IS OFF-DEVICE DATA. Every `name` here was typed by
             * somebody else and reached this device through a save import or a
             * paired-device sync, so js/app/ui.js renders all of it with
             * textContent and never innerHTML (§7b — a bug class this fleet has
             * shipped and fixed twice). A name like `"><img src=x onerror=…>`
             * lands as inert text. */
            scores: boardFor(modeId, res, g),
            scoreTitle: m.pinnable ? 'Best runs at level ' + g.level : 'Best runs',
            scoreFormat: m.metric === 'time' ? 'duration-ms' : 'integer',
            // What the run was interesting FOR, and every skill record it beat.
            highlights: highlightsFor(g),
            beaten: Array.isArray(res.beaten) ? res.beaten : [],
        };
        setScreen('over', lastOver);
        clearTitle();
    }

    /* The run's own tallies, as display rows — only the ones that happened.
     *
     * Order is by how hard it is to do rather than by how the stats object is
     * spelled: a quad streak is a rarer thing than a T-spin count, and the
     * first line of this list is the one a player reads. A run with none of
     * them produces an empty array and js/app/ui.js drops the whole section,
     * which is right — a card reading "T-spins 0" is a scolding, not a stat. */
    function highlightsFor(g) {
        const st = (g && g.stats) || {};
        const rows = [
            [st.maxQuadStreak > 1, 'Quad streak', '\u00d7' + st.maxQuadStreak],
            [st.quads > 0, st.quads === 1 ? 'Quad' : 'Quads', String(st.quads)],
            [st.maxCombo > 1, 'Best combo', '\u00d7' + st.maxCombo],
            [st.maxB2b > 1, 'Back-to-back', '\u00d7' + st.maxB2b],
            [st.perfectClears > 0, 'Singularities', String(st.perfectClears)],
            [st.tspins > 0, 'T-spins', String(st.tspins)],
            [st.bestLock > 0, 'Biggest clear', Number(st.bestLock).toLocaleString('en-US')],
        ];
        return rows.filter((r) => r[0]).map((r) => ({ label: r[1], text: r[2] }));
    }

    /* The ranked board for a mode, or the single entry just filed when the mode
     * has no board (Sprint keeps a personal record and no leaderboard). */
    function boardFor(id, res, g) {
        if (typeof store.loadBoard === 'function') {
            // A level-keyed board (Marathon) is asked for the level the run was
            // actually played at, which is not necessarily the one the picker
            // is showing: a resumed run keeps the level it was started with.
            const level = g && g.pinLevel != null ? g.pinLevel : settings.pinLevel;
            const list = safe(() => store.loadBoard(id, { limit: 5, level: level }), null);
            if (Array.isArray(list) && list.length) return list;
        }
        return res && res.entry ? [res.entry] : [];
    }

    // ── launcher chrome ──────────────────────────────────────────────────

    function toast(message, kind) {
        if (A && A.ui && typeof A.ui.toast === 'function') A.ui.toast(message, { kind: kind || 'info' });
    }

    function confirmAsk(message, opts) {
        if (A && A.ui && typeof A.ui.confirm === 'function') {
            return Promise.resolve(A.ui.confirm(message, opts)).catch(() => false);
        }
        // No SDK at all (a bare static host). window.confirm is a no-op inside
        // a launcher frame, which is exactly why Arcade.ui.confirm exists — but
        // there is no frame here if there is no SDK.
        try { return Promise.resolve(!!window.confirm(message)); } catch (_) { return Promise.resolve(false); }
    }

    // ── lifecycle ────────────────────────────────────────────────────────

    if (A && typeof A.onSuspend === 'function') {
        A.onSuspend(() => {
            // Pause the sim, park the loop, flush SYNCHRONOUSLY. No async work
            // here: the launcher's grace is ~250 ms and a promise does not land.
            if (playing) pausePlay();
            loop.stop();
            audio.stop();
            saveNow();
        });
    }

    if (A && typeof A.onResume === 'function') {
        A.onResume(() => {
            // Deliberately NOT resuming play. The player is not looking yet —
            // a run that unpauses itself on resume drops the piece that was in
            // the air. Arcade.loop already guarantees the first delta is 0, so
            // there is no accumulator here to reset.
            kick();
        });
    }

    if (A && A.ui && typeof A.ui.onBeforeQuit === 'function') {
        A.ui.onBeforeQuit(() => {
            saveNow();
            // Never a veto. The launcher timeboxes the ask at ~1.5 s and a
            // player who pressed quit meant it.
            return true;
        });
    }

    // One subscription for the whole snapshot (§5): flip the cached values,
    // push them into the four things that hold copies, redraw once.
    const onSettings = typeof arcadeSettings.onArcadeSettingsChange === 'function'
        ? arcadeSettings.onArcadeSettingsChange
        : (fn) => (A && typeof A.onSettingsChange === 'function' ? A.onSettingsChange(() => fn(readArcade())) : () => {});
    onSettings((next) => {
        arc = next || readArcade();
        renderer.setOpts({
            theme: arc.theme,
            fontScale: arc.fontScale,
            reducedMotion: arc.reducedMotion,
            powerSaver: arc.powerSaver,
        });
        audio.setOpts({ powerSaver: arc.powerSaver, bedEnabled: settings.bed });
        touch.setOpts({ handedness: arc.handedness });
        // A font-scale change re-lays out the rails and therefore the well, so
        // the cell size moves without a resize event ever firing. Re-measure,
        // then push the new cellPx: the touch layer's own fallback drifts ~25%
        // at --font-scale: 1.5 and every gesture threshold is a ratio of a cell.
        renderer.resize();
        pushCellPx(true);
        if (screen === 'settings') showSettings();
        kick();
    });

    if (typeof store.onExternalChange === 'function') {
        store.onExternalChange((e) => {
            const reason = e && e.reason;
            if (reason === 'settings') { reloadSettings(); return; }
            queueReboot();
        });
    } else if (A && typeof A.onStateReplaced === 'function') {
        A.onStateReplaced(queueReboot);
    }

    function reloadSettings() {
        settings = readSettings();
        keymap = sanitizeKeymap(settings.keymap);
        reattachKeyboard();
        touch.setOpts({
            scheme: settings.scheme, flick: settings.flick, tapRotate: settings.tapRotate,
        });
        audio.setOpts({ bedEnabled: settings.bed });
        renderer.setOpts({ glyphs: settings.glyphs });
        applyCoreSettings();
        if (screen === 'settings') showSettings();
        kick();
    }

    /* A save was imported: treat it as a FRESH BOOT (§3).
     *
     * Not "re-render the current screen" — the imported save need not contain a
     * run for the mode the player was in the middle of, and the game object in
     * memory belongs to a save that no longer exists. Everything is recomputed
     * from storage and the menu is where we land. Coalesced through a timer
     * because an import fires more than one notification. */
    function queueReboot() {
        if (rebootQueued) return;
        rebootQueued = true;
        setTimeout(() => {
            rebootQueued = false;
            settings = readSettings();
            keymap = sanitizeKeymap(settings.keymap);
            reattachKeyboard();
            arc = readArcade();
            touch.setOpts({ scheme: settings.scheme, handedness: arc.handedness });
            audio.setOpts({ powerSaver: arc.powerSaver, bedEnabled: settings.bed });
            renderer.setOpts({ glyphs: settings.glyphs });
            game = null;
            toMenu();
        }, 0);
    }

    // ── layout ───────────────────────────────────────────────────────────

    function onResize() {
        renderer.resize();
        pushCellPx(true);
        kick();
    }
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);

    // ── go ───────────────────────────────────────────────────────────────

    prepareGame(modeId, false);
    setScreen('menu', menuData());
    // One frame after layout settles, so the first paint measures a laid-out
    // canvas rather than a zero-width one.
    requestAnimationFrame(() => { onResize(); });
}

/* Arcade.loop is the fleet standard and the only frame source this game uses.
 * This stand-in exists for the one case the standard cannot cover — a
 * standalone page whose SDK failed to load — and matches its surface exactly,
 * including the idempotent start() that the fleet-wide bug was about. */
function fallbackLoop(fn) {
    let raf = null;
    let running = false;
    let last = null;
    function step(ts) {
        raf = null;
        const dt = last === null ? 0 : ts - last;
        last = ts;
        if (running) schedule();
        fn(dt, ts);
    }
    function schedule() {
        if (raf === null && running) raf = requestAnimationFrame(step);
    }
    const loop = {
        start() { running = true; last = null; schedule(); return loop; },
        stop() {
            running = false; last = null;
            if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
            return loop;
        },
        kick() {
            if (raf !== null) return loop;
            raf = requestAnimationFrame((ts) => {
                raf = null;
                if (running) { step(ts); return; }
                fn(0, ts);
            });
            return loop;
        },
        running() { return running; },
        dispose() { loop.stop(); return null; },
    };
    return loop;
}
