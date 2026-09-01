/* js/app/audio.js — the game's ears: g.events → cue plays, plus the bed policy.
 *
 * This module owns every Arcade.audio call in Gravity Well (docs/ARCHITECTURE.md,
 * js/app/*). Nothing else in the repo touches audio, and nothing anywhere builds
 * a node graph: `Arcade.audio` is the only path, so the launcher's volume slider
 * and global mute govern every sound the game makes. If a future feature ever
 * does need its own graph, its destination is `Arcade.audio.bus()` — never
 * `ctx.destination`, which silently bypasses both.
 *
 * NO SYNTHESIS LIVES HERE, and none lives in js/soundpack.js either. Every
 * gesture is an element in the launcher's shared library; the crossfade that
 * makes the bed adaptive is `handle.retune()` in the SDK. What belongs to this
 * game is the DESIGN — which gestures, how loud, how far away, how often — and
 * that is all js/soundpack.js contains. A gesture the game needs and the library
 * lacks goes into the library, not into the pack.
 *
 * THERE IS NO FALLBACK. When the graph path is unavailable — a stale cached SDK,
 * a standalone embed without /arcade-audio.js, a soundpack.js that failed to
 * parse — this module registers nothing and returns a no-op, and Gravity Well
 * plays silent. That is the fleet posture (GAME_INTEGRATION.md §5): the pack IS
 * the sound, spec cues are an aesthetic a game adopts rather than a tier it
 * degrades into, and an approximation of a stone well in three oscillators is
 * worse than the silence. It is an expected state, not an error, so it is not
 * logged.
 *
 * Conventions:
 *   A1 — cues are registered ONCE, at module load. Audio is purely local, so no
 *        `await Arcade.ready` is needed: index.html's classic scripts (the SDK,
 *        /arcade-audio.js, js/soundpack.js) have all run by the time this ES
 *        module evaluates, so `Arcade.audio` and `ArcadeSoundPack` are present.
 *   A2 — every play goes through `a.play(name, params)`; the SDK is silent and
 *        cheap when the player has muted, and treats an unknown cue as a no-op.
 *   A3 — the launcher owns volume and mute. This game adds neither.
 *   A4 — cue names are lowercase-kebab and event-shaped; they match the pack.
 */

import { ROWS } from '../core/constants.js';
import { highestRow } from '../core/board.js';

const audio = () =>
    (typeof window !== 'undefined' && window.Arcade && window.Arcade.audio)
        ? window.Arcade.audio
        : null;

const pack = () =>
    (typeof window !== 'undefined' && window.ArcadeSoundPack)
        ? window.ArcadeSoundPack
        : null;

// The elements the pack is actually built out of. A cached older library has
// graph() and el() but not all of these, and a missing element would throw
// inside a cue at play time — a cue that half-plays is worse than silence — so
// the gate is on the pack's real dependencies rather than on a version number.
const NEEDED_ELEMENTS = [
    'strike', 'body', 'thump', 'rustle', 'creak', 'shatter', 'ratchet', 'blast',
    'drone', 'teardown', 'between', 'cents',
];

const BED_CUE = 'well-hum';

// The bed is a scheduled timeline, not a loop: `well-hum` runs for `dur`
// seconds and then fades out on its own. Fifteen minutes covers a Marathon or
// an Ultra outright; Zen is untimed, so the horizon is pushed out again (through
// the same crossfade a retune uses) two minutes before it would arrive.
const BED_SECONDS = 900;
const BED_REFRESH_S = 780;

// Fades, in seconds. RETUNE is the §6 figure: a band change is a slow change of
// pressure, and anything quicker is heard as an edit.
const RETUNE_FADE = 3.0;
const BED_FADE = 1.2;
const TOPOUT_FADE = 2.4;   // the well going quiet under the last thump
const DISPOSE_FADE = 0.25;

// Stack height → the bed's `depth`, quantised to three bands with hysteresis.
// Rising crosses BAND_UP, falling crosses the lower BAND_DOWN, so a stack held
// at a boundary — which is exactly what a stack does, one row up and one row
// down, all game — stays put instead of retuning on every lock.
//
// WHY THIS MATTERS ENOUGH TO BE QUANTISED AT ALL: a sustained cue schedules its
// whole timeline up front, so nothing in it can be adjusted in place. `retune`
// builds a SECOND drone and crossfades the first out under it — two beds alive
// at once for RETUNE_FADE seconds, plus a fresh convolution send. It is cheap
// but it is not free, and it must never be called per frame. Here it is called
// on a board change (locks and clears are the only things that move the stack)
// and only when the band actually changes: a handful of times per run.
const DEPTHS = [0, 0.5, 1];
const BAND_UP = [7, 14];      // rows of stack — thirds of the 20 visible rows
const BAND_DOWN = [5, 12];

// The cheapest possible rate limit on `shift`, in game milliseconds. With ARR
// at its 33 ms default every cell move is a discrete thing the player did and
// deserves its own grain; with ARR at 0 (instant) a DAS sweep produces up to
// nine move events inside ONE tick, and nine strikes in one frame is a burst of
// noise rather than a slide. g.elapsedMs does not advance within a frame, so
// this also caps `shift` at one play per frame for free.
const MIN_SHIFT_MS = 28;

// True once the graph path registered successfully. Everything keys off it.
let graphMode = false;

// ─── A1 — the single registration site ──────────────────────────────────────

(function registerCues() {
    const a = audio();
    if (!a) return;
    const p = pack();
    const el = (typeof a.el === 'function') ? a.el() : null;
    const graphable =
        !!p && !!p.CUES && !!p.SENDS &&
        typeof a.room === 'function' &&
        typeof a.graph === 'function' &&
        typeof a.start === 'function' &&
        el !== null &&
        NEEDED_ELEMENTS.every((name) => typeof el[name] === 'function');
    if (!graphable) return;   // silence by design — see the header

    // One room for the whole game: the stone shaft the pack is set inside.
    // Registered before the cues, because room() rebuilds the shared bus.
    a.room(p.ROOM);
    const sustained = p.SUSTAINED || {};
    Object.keys(p.CUES).forEach((name) => {
        a.graph(name, p.CUES[name], {
            send: p.SENDS[name],
            sustained: !!sustained[name],
        });
    });
    graphMode = true;
})();

// §5 / fleet CI gate C. `Arcade.settings.powerSaver` landed in SDK 3.13.0; on
// anything older the property is undefined and calling it throws TypeError —
// inside an onSettingsChange handler that is a throw on every settings write,
// not once at boot. js/main.js normally passes the boolean in through opts (it
// already reads the settings snapshot for the renderer); this guarded read is
// only the fallback for a caller that does not.
function readPowerSaver() {
    const s = (typeof window !== 'undefined' && window.Arcade && window.Arcade.settings)
        ? window.Arcade.settings
        : null;
    if (!s) return false;
    return s.powerSaver ? !!s.powerSaver() : false;
}

// A silent stand-in with the same surface, returned when the pack is absent, so
// every call site can stay unconditional.
const SILENT = {
    consume() {}, setOpts() {}, start() {}, stop() {}, dispose() {},
};

/**
 * @param {{ powerSaver?: boolean, bedEnabled?: boolean }} [opts]
 */
export function createAudio(opts) {
    if (!graphMode) return SILENT;

    const a = audio();
    const o = opts || {};
    let saving = typeof o.powerSaver === 'boolean' ? o.powerSaver : readPowerSaver();
    let bedEnabled = o.bedEnabled !== false;

    let live = false;        // inside live play, per start()/stop()
    let bed = null;          // the sustained handle, or null
    let band = 0;            // index into DEPTHS
    let bandDirty = false;   // re-check the band on the first frame after start()
    let bedAtSec = 0;        // audio-clock stamp of the last (re)build
    let grounded = false;    // was the active piece resting last frame?
    let lastShiftMs = -1e9;
    // The board revision the bed was last banded against. See consume().
    let lastBoardRev = -1;

    // The bed's own clock. The AudioContext's currentTime is the clock its
    // timeline is scheduled on, and it freezes when the SDK suspends audio on
    // hide — which performance.now() does not. Null before the first play.
    function nowSec() {
        const ctx = (typeof a.context === 'function') ? a.context() : null;
        return ctx ? ctx.currentTime : 0;
    }

    function startBed() {
        if (bed || !bedEnabled || saving) return;
        bed = a.start(BED_CUE, { dur: BED_SECONDS, depth: DEPTHS[band] });
        bedAtSec = nowSec();
        bandDirty = true;
    }

    function stopBed(fade) {
        if (!bed) return;
        const h = bed;
        bed = null;
        band = 0;
        try { h.stop(fade); } catch (e) { /* never throw at a play site */ }
    }

    // Re-band the bed. Only ever called on a frame where the stack moved.
    function updateBand(g) {
        if (!bed || typeof bed.retune !== 'function') return;
        // highestRow() is the topmost occupied row (ROWS when the well is
        // empty), so this is the stack's height in rows — the buffer above the
        // visible field included, which is right: a stack in the buffer is the
        // deepest the well ever feels.
        const rows = ROWS - highestRow(g.board);
        let b = band;
        while (b < DEPTHS.length - 1 && rows >= BAND_UP[b]) b++;
        while (b > 0 && rows < BAND_DOWN[b - 1]) b--;
        if (b === band) return;
        band = b;
        bed.retune({ dur: BED_SECONDS, depth: DEPTHS[b] }, RETUNE_FADE);
        bedAtSec = nowSec();
    }

    // Push the bed's horizon out before its timeline runs out (Zen, mostly).
    // Same machinery as a band change, same parameters, so it is inaudible.
    function keepAlive() {
        if (!bed || typeof bed.retune !== 'function') return;
        const t = nowSec();
        const age = t - bedAtSec;
        if (age < 0) { bedAtSec = t; return; }   // context restarted under us
        if (age < BED_REFRESH_S) return;
        bed.retune({ dur: BED_SECONDS, depth: DEPTHS[band] }, RETUNE_FADE);
        bedAtSec = t;
    }

    function shift(g) {
        const dt = g.elapsedMs - lastShiftMs;
        if (dt >= 0 && dt < MIN_SHIFT_MS) return;   // dt < 0: the run was reset
        lastShiftMs = g.elapsedMs;
        a.play('shift');
    }

    /**
     * Drain one frame's events into cue plays and run the bed policy. Called
     * every frame from the loop, so it stays allocation-light: the hot path
     * (`shift`, which can arrive nine times in a tick) allocates nothing, and
     * the rest allocate one small params object per discrete player action.
     *
     * It READS g.events and never clears it — the caller owns that array.
     */
    function consume(g) {
        if (!g) return;
        const ev = g.events;
        if (!ev) return;
        const n = ev.length;
        /* "The stack changed" is asked of the BOARD, not inferred from the
         * events: Zen's sink moves it with nothing but a 'hold' behind it, and
         * the bed would keep the depth of a well that is no longer that deep. */
        const rev = g.boardRev | 0;
        let moved = rev !== lastBoardRev;
        lastBoardRev = rev;
        let locked = false;
        let hard = false;

        // One cheap pass for the hard drop first, so the lock it caused lands
        // with its full weight whatever order core appended the two events in.
        for (let i = 0; i < n; i++) {
            if (ev[i].type === 'harddrop') { hard = true; break; }
        }

        for (let i = 0; i < n; i++) {
            const e = ev[i];
            switch (e.type) {
                case 'move':
                    shift(g);
                    break;
                case 'rotate':
                    // kickIndex > 0 means SRS had to offset the piece to fit
                    // it: it scraped its way in, and the cue grinds accordingly.
                    a.play('turn', { kicked: e.kickIndex > 0 });
                    break;
                case 'lock':
                    locked = true;
                    // The twist goes in first — it is the gesture that put the
                    // piece there — and the lock seats under it.
                    if (e.tspin && e.tspin !== 'none') {
                        a.play('tspin', { mini: e.tspin === 'mini' });
                    }
                    a.play('lock', { hard });
                    break;
                case 'clear':
                    /* `combo` climbs the pack's pitch ladder and counts itself
                     * out on the pawl; `streak` is how many quads in a row this
                     * one makes. Both are read straight off the event — this
                     * module decides WHEN a cue plays, never what escalation
                     * means, which is the pack's business (js/soundpack.js). */
                    a.play('clear', { count: e.count, combo: e.combo });
                    // Quad rides ON TOP of the clear rather than replacing it:
                    // the shatter is the four rows going, the blast is the well
                    // answering from far up the shaft (send 0.72). The streak
                    // sends it further down the shaft each time, not louder.
                    if (e.count >= 4) a.play('quad', { streak: e.quadStreak || 1 });
                    // A Singularity (DESIGN §1) — the well is empty. Layered
                    // for the same reason: the rows did break, and this is what
                    // the shaft does about it afterwards, from further away than
                    // anything else in the pack (send 0.85).
                    if (e.perfectClear) a.play('singularity');
                    break;
                case 'hold':
                    a.play('hold');
                    break;
                case 'levelup':
                    a.play('levelup');
                    break;
                case 'goal':
                    // Sprint 40's fortieth line, or Ultra's clock running out —
                    // a run ENDING. It gets its own cue rather than borrowing
                    // `levelup`: a level tick is a milestone passed mid-run, and
                    // reusing it would make the end of a run sound like
                    // something inside one.
                    a.play('goal');
                    break;
                case 'topout':
                    a.play('topout');
                    // §6: the bed dies under the thump. Live play is over, so
                    // nothing restarts it until the next start().
                    live = false;
                    stopBed(TOPOUT_FADE);
                    break;
                default:
                    // softdrop / harddrop carry no cue of their own: soft drop
                    // is continuous (a cue per row is a machine gun) and a hard
                    // drop is already spoken for by the weight it puts on the
                    // lock a moment later.
                    break;
            }
        }

        // `touch` — the piece arriving on a surface, which is when lock delay
        // starts. The frozen event vocabulary has no landing event, so it is
        // derived from state: the active piece is resting exactly when it sits
        // on its own ghost. Cheap (two field reads), and edge-triggered, so a
        // piece shuffled along a surface for 500 ms sounds once — but a piece
        // that moves off a ledge and lands again sounds again, which is what
        // actually happened.
        const act = g.active;
        const down = !!act && !locked && act.y === g.ghostY;
        if (down && !grounded) a.play('touch');
        grounded = down;

        if (bed) {
            if (moved || bandDirty) { bandDirty = false; updateBand(g); }
            keepAlive();
        }
    }

    // Settings changed under us (Arcade.onSettingsChange, or the game's own bed
    // toggle). Power saver kills the bed outright — it is the one ambient,
    // non-gameplay layer in the mix; the discrete cues are feedback and stay.
    function setOpts(partial) {
        if (!partial) return;
        if (typeof partial.powerSaver === 'boolean') saving = partial.powerSaver;
        if (typeof partial.bedEnabled === 'boolean') bedEnabled = partial.bedEnabled;
        if (saving || !bedEnabled) stopBed(BED_FADE);
        else if (live) startBed();
    }

    // Entering live play. Idempotent, and safe to call when the bed is off.
    function start() {
        live = true;
        startBed();
    }

    // Leaving live play — menu, game over, quit. The run's sound stops with it;
    // the bed never plays under a menu (§6d: idle screens are idle).
    function stop() {
        live = false;
        grounded = false;
        lastBoardRev = -1;      // the next run's first frame is a change
        stopBed(BED_FADE);
    }

    function dispose() {
        live = false;
        stopBed(DISPOSE_FADE);
    }

    return { consume, setOpts, start, stop, dispose };
}
