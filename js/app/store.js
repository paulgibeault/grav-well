/* js/app/store.js — the one door to everything the player keeps.
 *
 * THIS MODULE IS THE ONLY CALLER OF Arcade.state, Arcade.stats, Arcade.records,
 * Arcade.scores AND Arcade.player IN THE REPO (docs/ARCHITECTURE.md, "js/app/*").
 * That is the entire point of the file: the schema in DESIGN.md §8 is written
 * down once, key names are spelled once, and a question like "what actually
 * gets written when a run ends" has exactly one file to read. A second caller
 * anywhere else is a bug even when it works.
 *
 * Nothing here touches localStorage. Not as a matter of taste — inside a
 * launcher frame the origin is opaque and the property ACCESS ITSELF throws
 * (GAME_INTEGRATION.md §9). Every durable byte goes through the SDK, which
 * namespaces it under arcade.v1.grav-well.* and rides the save bundle for free.
 *
 * NOTHING IS READ AT IMPORT TIME, and this is load-bearing rather than tidy.
 * Every export below is a function the caller invokes AFTER `await
 * Arcade.ready`. In a bridged frame the launcher's stored snapshot arrives with
 * the welcome message; a write made before it lands and whose key the snapshot
 * covers is DISCARDED in favour of the stored value. A pre-ready
 * `getOrInit('settings', DEFAULTS)` would therefore hand the game its defaults,
 * look like it worked, and the player's real settings would win a beat later —
 * or, for a key the snapshot does not cover, the defaults would flush through
 * and overwrite a save. js/main.js imports this module at boot and calls
 * nothing until ready resolves.
 *
 * STORAGE-FULL IS DELIBERATELY NOT HANDLED HERE. There is no
 * Arcade.onStorageError listener in this repo on purpose: since SDK 3.12.0 the
 * SDK toasts "Save failed — device storage is full" by itself when NO listener
 * is registered, and registering one REPLACES that default. A game that wants
 * the standard behavior gets it by writing nothing at all, so the absence
 * below is the decision, not an oversight. Revisit only with a reaction better
 * than the toast — a custom listener that merely logs is a downgrade.
 */

import { modeFor } from './modes.js';

// DESIGN.md §8. Two keys and one stats category is the whole schema.
const SETTINGS_KEY = 'settings';
const RUN_PREFIX = 'run.';
const STATS_CATEGORY = 'core';

/* `settings` and `run.<mode>` opt into multi-device sync (§3b): they are the
 * two things a player would expect to follow them from a phone to a laptop.
 * Both are far under the 64 KB per-key sync cap — a settings blob is ~0.4 KB
 * and a run snapshot ~1.2 KB, the board being a fixed 400-character string
 * whatever is stacked in it — and an oversized value does not replicate
 * loudly, it simply never replicates. The flag is sticky per key, so passing
 * it on every write costs nothing and means no boot order can leave a key
 * un-synced.
 *
 * v1 has no bulky local-only key; the first one (the M4 replay buffers of §8)
 * takes `{ exportable: false }` so it never inflates a save file. */
const SYNCED = { sync: true };

/* The SDK is a classic script in index.html and this is an ES module, so it
 * has always run by the time anything here is called. The guard is for the one
 * case that is not a programming error: a standalone page served without the
 * SDK. Every function then degrades to "no storage" — defaults in, writes
 * dropped — rather than taking the whole game down with a TypeError. */
const arcade = () =>
    (typeof window !== 'undefined' && window.Arcade) ? window.Arcade : null;

// ---------------------------------------------------------------------------
// settings — DESIGN.md §8, `settings`, { sync: true }
// ---------------------------------------------------------------------------

/* Built fresh on every read rather than shared as a frozen constant. Both
 * getOrInit()s can hand the defaults object straight back to the caller —
 * Arcade.stats.getOrInit returns it BY REFERENCE when nothing is stored — and
 * a caller that then edits its settings would be editing this module's idea of
 * what a default is, for the rest of the session. */
function settingsDefaults() {
    return {
        // §2.8, the three the player tunes. Core clamps them again on the way
        // into createGame(), so a hand-edited export cannot poison a run.
        das: 167,
        arr: 33,
        sdf: 20,
        ghost: true,                        // §2.5
        lockdown: 'extended',               // §2.7
        glyphs: false,                      // §2.2 — colour is never the only channel
        scheme: 'gesture',                  // §4 — gestures are the primary scheme
        bed: true,                          // §6 — the sustained well-hum
        /* §4, keyed on event.code. ONLY THE PLAYER'S OVERRIDES ARE STORED —
         * js/input/keymap.js owns DEFAULT_KEYMAP and merges a stored map over
         * it on the way out (sanitizeKeymap). Baking the shipped bindings into
         * the save instead would freeze them at whatever they were the day the
         * player first launched: a later build that moves a default key would
         * reach new players only. */
        keymap: {},
    };
}

/** Call after `await Arcade.ready`. Deep-merges DEFAULTS under the stored
 *  value, so a settings field added in a later build appears in an old save
 *  instead of arriving `undefined` three call frames away from here. */
export function loadSettings() {
    const A = arcade();
    if (!A) return settingsDefaults();
    // getOrInit writes when it initializes the key and again when the merge
    // adds a field, and each write fires our own onExternalChange subscriber.
    // Suppressed: a load is not an external change.
    return quietly(() => {
        // getOrInit takes no opts, so the key it CREATES carries no sync flag,
        // and the flag is sticky per key — a player who never opens the
        // settings screen would never replicate their settings at all. One
        // extra write, once per device, stamps the opt-in §8 asks for.
        const fresh = typeof A.state.has === 'function' && !A.state.has(SETTINGS_KEY);
        const s = A.state.getOrInit(SETTINGS_KEY, settingsDefaults());
        if (fresh) A.state.set(SETTINGS_KEY, s, SYNCED);
        return s;
    });
}

/** @returns {boolean} false only when the write was DEFINITELY dropped —
 *  framed writes are proxied and report `true` for "accepted, pending". */
export function saveSettings(s) {
    const A = arcade();
    if (!A || !s || typeof s !== 'object') return false;
    return quietly(() => A.state.set(SETTINGS_KEY, s, SYNCED));
}

// ---------------------------------------------------------------------------
// run snapshots — DESIGN.md §8, `run.<mode>`, { sync: true }
// ---------------------------------------------------------------------------

// A stored mode id is data like any other: a key built from an unvalidated
// string would let a corrupt save address `run.__proto__` or a key belonging
// to nothing at all.
function runKey(modeId) {
    return RUN_PREFIX + modeFor(modeId).id;
}

/** The snapshot as stored, or null. Deliberately NOT deserialized here:
 *  js/core/serialize.js is the authority on whether a snapshot is readable
 *  (version, board length, rng state) and answers with null, which is the same
 *  answer this function gives for a missing one. The caller feeds the result
 *  to deserialize() and starts a fresh run on null either way. */
export function loadRun(modeId) {
    const A = arcade();
    if (!A) return null;
    const snap = A.state.get(runKey(modeId));
    return (snap && typeof snap === 'object' && !Array.isArray(snap)) ? snap : null;
}

/**
 * SYNCHRONOUS AND CHEAP, because onSuspend is its hardest caller: the launcher
 * holds teardown for a ~250 ms grace and only a synchronous flush reliably
 * lands (§6b). One state.set(), no async work, nothing deferred, no logging.
 * It is also called on every lock, which is what makes eviction survivable —
 * the worst a destroyed iframe can cost is the piece in flight.
 *
 * The events array is dropped on the way in. It is one frame of transient FX
 * cues that the app drains every frame (ARCHITECTURE.md, "Two consumers, one
 * drain"), so it is normally empty — but game.js caps an UNDRAINED one at 1024
 * events, and 1024 line-clear events serialize to ~130 KB, which is twice the
 * 64 KB sync cap. A run that quietly stopped replicating between devices
 * because of a queue of stale sound cues is not a trade worth taking, and a
 * resumed run that replays them is not either.
 */
export function saveRun(modeId, snapshot) {
    const A = arcade();
    if (!A || !snapshot || typeof snapshot !== 'object') return false;
    const payload = (snapshot.events && snapshot.events.length)
        ? Object.assign({}, snapshot, { events: [] })
        : snapshot;
    return A.state.set(runKey(modeId), payload, SYNCED);
}

/** Drop a mode's snapshot — the run ended, or the player chose a fresh one.
 *  A remove replicates too (§3b tombstones), so the other device does not
 *  resurrect a finished run. */
export function clearRun(modeId) {
    const A = arcade();
    if (!A) return;
    A.state.remove(runKey(modeId));
}

// ---------------------------------------------------------------------------
// stats — DESIGN.md §8, via Arcade.stats, category `core`
// ---------------------------------------------------------------------------

function statsDefaults() {
    return {
        gamesPlayed: 0,
        modes: { marathon: 0, sprint: 0, ultra: 0, zen: 0, daily: 0 },
        lines: 0,
        pieces: 0,
        quads: 0,
        tspins: 0,
        perfectClears: 0,
        maxCombo: 0,
        playMs: 0,
        // §3: the Daily Well tracks a streak. `lastDate` is a device-local
        // 'YYYY-MM-DD' from Arcade.daily.dateStr() — see dayBefore() below.
        daily: { streak: 0, best: 0, plays: 0, lastDate: null },
    };
}

/** Call after `await Arcade.ready`. getOrInit rather than get: it deep-merges
 *  the defaults under the stored value, so a counter added after a player
 *  already has a save reads 0 instead of undefined and `undefined + 1` never
 *  reaches the launcher's stats sheet as NaN. */
export function loadStats() {
    const A = arcade();
    if (!A) return statsDefaults();
    return A.stats.getOrInit(STATS_CATEGORY, statsDefaults());
}

/* Arcade.stats.update hands the updater the RAW stored value, not the merged
 * one — only get/getOrInit merge — so the defaults have to be folded in here
 * too, or a counter added in a later build lands as `undefined + 1` = NaN in
 * the launcher's stats sheet. Unknown top-level keys are carried through: a
 * save written by a NEWER build must not lose fields just by being played on
 * an older one.
 *
 * The copy skips the prototype-poisoning key names, because `prev` is parsed
 * JSON and `Object.assign(target, {"__proto__": …})` invokes the setter rather
 * than storing a property. The SDK's own deep merge guards the same three. */
const DUNDER = new Set(['__proto__', 'constructor', 'prototype']);

function graft(target, src) {
    if (!src || typeof src !== 'object') return target;
    for (const k of Object.keys(src)) {
        if (!DUNDER.has(k)) target[k] = src[k];
    }
    return target;
}

function withStatsDefaults(prev) {
    const s = graft(statsDefaults(), prev);
    s.modes = graft(statsDefaults().modes, s.modes);
    s.daily = graft(statsDefaults().daily, s.daily);
    return s;
}

// ---------------------------------------------------------------------------
// filing a finished run — DESIGN.md §7's three-way split
// ---------------------------------------------------------------------------

/**
 * File one finished run: leaderboard, personal record, lifetime counters.
 *
 * The split is §7's, and which of the three a number belongs in is a real
 * distinction rather than a stylistic one (guide §4): `scores` is a ranked
 * board with many entrants, `records` is ONE best-ever value per category that
 * the launcher's Records sheet renders with no per-game code, `stats` is
 * counters we own the formatting of. Nothing here hand-rolls a comparison —
 * records.best() writes only on improvement and reports whether it did, which
 * is the "new best!" signal returned to the caller.
 *
 * A TIME IS ONLY A TIME IF THE RUN FINISHED. Sprint and the Daily Well are
 * judged on elapsed time, and a run that topped out on line 39 has an elapsed
 * time that is not a Sprint result — filing it would write a personal best no
 * completed run could ever beat. So time-metric modes file nothing unless the
 * goal was reached. Score-metric modes (Marathon, Ultra) file every finished
 * run: topping out early in Ultra still scored what it scored.
 *
 * @param {string} modeId
 * @param {object} r  the finished run. The core game state object works as-is
 *                    — score, lines, elapsedMs, phase and stats are read off
 *                    it — or pass any object carrying those fields. An
 *                    optional `dateStr` overrides today's date for the Daily
 *                    Well (replays, tests).
 * @returns {{mode:string, counted:boolean, improved:boolean, dateStr:?string,
 *            record:?object, entry:?object, stats:?object}}
 *          `improved` is the toast: true only when a record category actually
 *          moved. `counted` says whether the run qualified for its board at all.
 */
export function recordResult(modeId, r) {
    const A = arcade();
    const mode = modeFor(modeId);
    const run = normalizeResult(r);
    const out = {
        mode: mode.id, counted: false, improved: false,
        dateStr: null, record: null, entry: null, stats: null,
    };
    if (!A) return out;

    const dateStr = (typeof r === 'object' && r && typeof r.dateStr === 'string')
        ? r.dateStr
        : today(A);
    if (mode.scores && mode.scores.keyed) out.dateStr = dateStr;

    const timed = mode.metric === 'time';
    const value = timed ? run.elapsedMs : run.score;
    out.counted = mode.metric != null && Number.isFinite(value) && (!timed || run.won);

    if (out.counted && mode.scores) {
        /* `order` goes on EVERY add, not just the first. The SDK pins an order
         * to the CATEGORY on first write and warns on a later mismatch — a
         * single add to `daily` that forgot { order: 'asc' } would re-sort the
         * whole board descending and the 100-entry cap would evict the fastest
         * times first. The name on the entry is left to the SDK, which stamps
         * Arcade.player.name() itself (§4); passing it here would only create
         * a second opinion about the player's name. */
        out.entry = A.scores.add(mode.scores.category, {
            score: value,
            key: mode.scores.keyed ? dateStr : undefined,
            meta: {
                mode: mode.id,
                lines: run.lines,
                level: run.level,
                elapsedMs: run.elapsedMs,
                won: run.won,
            },
        }, { order: mode.scores.order });
    }

    if (out.counted && mode.record) {
        const res = A.records.best(mode.record.category, {
            value: value,
            direction: mode.record.direction,
            format: mode.record.format,
            label: mode.record.label,
        });
        out.improved = !!(res && res.improved);
        out.record = Object.assign({ category: mode.record.category }, res && res.record);
    }

    // Counters roll up for EVERY finished run, qualifying or not — Zen has no
    // board at all and still contributes its lines, and a Sprint abandoned on
    // line 12 was still a game played.
    out.stats = A.stats.update(STATS_CATEGORY, (prev) => {
        const s = withStatsDefaults(prev);
        s.gamesPlayed += 1;
        s.modes[mode.id] = (s.modes[mode.id] | 0) + 1;
        s.lines += run.lines;
        s.pieces += run.pieces;
        s.quads += run.quads;
        s.tspins += run.tspins;
        s.perfectClears += run.perfectClears;
        s.maxCombo = Math.max(s.maxCombo | 0, run.maxCombo);
        s.playMs += run.elapsedMs;
        if (mode.id === 'daily' && run.won) bumpStreak(s.daily, dateStr);
        return s;
    });

    return out;
}

/* Read a finished run defensively. It arrives from js/main.js as the live core
 * state object, and every field is coerced because a NaN reaching scores.add
 * or records.best is a thrown error, not a bad number. */
function normalizeResult(r) {
    const o = (r && typeof r === 'object') ? r : {};
    const st = (o.stats && typeof o.stats === 'object') ? o.stats : {};
    return {
        score: count(o.score),
        lines: count(o.lines),
        level: count(o.level),
        elapsedMs: count(o.elapsedMs),
        // 'won' is core's phase for a goal reached — Sprint's 40th line,
        // Ultra's clock. Accept an explicit boolean too, for a caller that has
        // already reduced the run to a result.
        won: typeof o.won === 'boolean' ? o.won : o.phase === 'won',
        pieces: count(st.pieces),
        quads: count(st.quads),
        tspins: count(st.tspins),
        perfectClears: count(st.perfectClears),
        maxCombo: count(st.maxCombo),
    };
}

function count(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/* §3: the streak counts consecutive DAYS with a completed dig, and a day is
 * the device-local calendar day — the platform rule (§7c), which exists
 * because two games once disagreed about "today" over exactly this. */
function bumpStreak(d, dateStr) {
    if (!dateStr || d.lastDate === dateStr) return;   // today is already counted
    d.streak = (d.lastDate && d.lastDate === dayBefore(dateStr)) ? (d.streak | 0) + 1 : 1;
    d.lastDate = dateStr;
    d.best = Math.max(d.best | 0, d.streak);
    d.plays = (d.plays | 0) + 1;
}

/* 'YYYY-MM-DD' → the day before it, by CALENDAR rather than by arithmetic.
 * Subtracting 86 400 000 ms breaks twice a year in every DST zone, and
 * toISOString() would answer in UTC — the exact bug §7c's helper kills. Day 0
 * of a month is the last day of the previous one, so month and year roll for
 * free. */
function dayBefore(dateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) - 1);
    const p = (n) => (n < 10 ? '0' : '') + n;
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function today(A) {
    return (A.daily && typeof A.daily.dateStr === 'function') ? A.daily.dateStr() : null;
}

// ---------------------------------------------------------------------------
// state that changed underneath us
// ---------------------------------------------------------------------------

/* True while this module is writing. Arcade fires key-change listeners
 * SYNCHRONOUSLY from set()/getOrInit(), so without this a saveSettings() would
 * call the app back to tell it about the settings it just saved — and the
 * obvious fix at the call site (re-read and re-apply) is a loop. */
let writing = false;

function quietly(fn) {
    writing = true;
    try { return fn(); } finally { writing = false; }
}

/**
 * ONE subscription for "the stored world moved without us", so the caller has
 * one thing to unsubscribe.
 *
 *   { reason: 'replaced' }  — the launcher imported a save. TREAT IT AS A
 *     FRESH BOOT (§3): re-read settings, re-hydrate snapshots, go back to the
 *     menu. The screen the player is on may not survive the import — an
 *     imported save need not have a run for the mode they were playing, and
 *     the live game object in memory belongs to a save that no longer exists.
 *   { reason: 'settings' } — the `settings` key changed from outside this
 *     module: another frame, or an inbound sync from the player's other
 *     device (§3b — those arrive as ordinary key-change events). Re-read with
 *     loadSettings() and push the values into core/renderer/input.
 *
 * `run.<mode>` keys are deliberately NOT watched. saveRun() fires the same
 * listener as an inbound sync does, so watching them would call the app back
 * on every lock — dozens of times a minute, to report its own write. An
 * imported save arrives as 'replaced' instead, which is the one case where a
 * snapshot really did change underneath the player.
 *
 * @param {(e: {reason: 'replaced'|'settings'}) => void} fn
 * @returns {() => void} unsubscribe; idempotent.
 */
export function onExternalChange(fn) {
    const A = arcade();
    if (!A || typeof fn !== 'function') return () => {};
    const offs = [];
    if (typeof A.onStateReplaced === 'function') {
        offs.push(A.onStateReplaced(() => fn({ reason: 'replaced' })));
    }
    if (A.state && typeof A.state.onChange === 'function') {
        offs.push(A.state.onChange(SETTINGS_KEY, () => {
            if (writing) return;
            fn({ reason: 'settings' });
        }));
    }
    return () => {
        while (offs.length) {
            const off = offs.pop();
            if (typeof off === 'function') off();
        }
    };
}
