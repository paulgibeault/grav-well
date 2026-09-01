/* js/app/modes.js — the five modes of DESIGN.md §3, as pure configuration.
 *
 * PURE by convention (docs/ARCHITECTURE.md, "js/app/*"): no Arcade, no DOM, no
 * timers, no entropy. js/app/ is the layer that MAY touch the platform; this
 * file is the one member that does not, which is what lets
 * tests/modes.test.js import it under `node --test` and pin every mode's rules
 * with no browser in sight.
 *
 * A mode is nothing but the opts js/core/game.js already takes, plus the
 * fleet-facing names the finished run is filed under. Core knows about a line
 * goal, a clock, a dig and debris; it has never heard of "Sprint 40", and does
 * not need to.
 *
 * THE DAILY SEED IS NOT DERIVED HERE — deriving it needs today's date, and a
 * date is entropy. `Arcade.daily.seed()` owns it (GAME_INTEGRATION.md §7c):
 * the DEVICE-LOCAL calendar day, never UTC, so the well rolls over at the
 * player's midnight rather than at Greenwich's. It folds in the gameId, so
 * grav-well's day never shares a stream with another game's. js/main.js reads
 * it and hands it in here; that one-way flow is what keeps this file pure.
 *
 * ONE WRINKLE THE CALLER MUST NOT MISS: `Arcade.daily.seed()` hands back a
 * seeded GENERATOR, not a number, while `createGame({ seed })` wants a number
 * or a string. The u32 behind the generator is `.getState()`. gameOptsFor()
 * unwraps that shape below so both forms work — but a generator passed
 * straight to createGame would be stringified into a seed that is legal,
 * constant, and identical for every player on every day.
 */

// §12 open question 1 says 2:00 is the snappier convention; §3 specifies 3:00
// and specification wins until the question is answered.
const ULTRA_MS = 3 * 60 * 1000;

// §3: the Daily Well starts buried and the race is to dig out.
const DAILY_GARBAGE_ROWS = 8;

/* The table. Each entry carries three separable things, and mixing them up is
 * how a mode table rots:
 *   · the RULES — exactly the opts createGame() accepts, nothing more;
 *   · how the run is JUDGED — score or elapsed time, and under which fleet
 *     category (DESIGN.md §7). js/app/store.js is the only reader of those
 *     names, so the strings live here once instead of twice;
 *   · what the SHELL does with it — menu copy, retry behavior, where the seed
 *     comes from.
 */
export const MODES = deepFreeze({
    /* THE STANDARD ESCALATING GAME, renamed from Marathon (§3, amended
     * 2026-08-31). The rules did not move an inch — no line goal, levels every
     * ten lines forever, the curve riding down to true 20G at 19 and pinned
     * there. Only the name did, because "Marathon" was needed for the mode that
     * actually lets you run a marathon.
     *
     * NEW FLEET CATEGORIES rather than inherited ones. The legacy `marathon` /
     * `marathon-score` categories hold scores set under the old name, and the
     * SDK has no rename; re-using them would mix escalating runs into the
     * pinned board forever. Old records stay visible in the launcher's Records
     * sheet under the label they were written with, and nothing is destroyed. */
    arcade: {
        id: 'arcade',
        name: 'Arcade',
        blurb: 'The standard game. The levels keep climbing. Play until the well wins.',
        goalLines: null,
        timeLimitMs: null,
        goal: null,
        garbageRows: 0,
        pinnable: false,
        seedSource: 'entropy',
        metric: 'score',
        instantRetry: false,
        scores: { category: 'arcade', order: 'desc', keyed: false },
        record: {
            category: 'arcade-score',
            direction: 'higher',
            format: 'integer',
            label: 'Arcade score',
        },
    },
    /* MARATHON — the level you pick, held for as long as you can hold it.
     *
     * The escalating game answers "how fast can you still think"; this one
     * answers "how long can you keep it up", which is a different question and
     * needs a level that stops moving. `pinnable` says the player chooses it;
     * js/core/game.js's pinLevel does the rest, and gravity.js is never asked
     * for a second opinion because levelFor() is simply not consulted.
     *
     * THE BOARD IS KEYED BY LEVEL, exactly as the Daily Well's is keyed by
     * date, and for the same reason: a table mixing level-2 runs with level-15
     * ones is not a leaderboard, it is a pile. The personal record is per level
     * too — a category is only created the first time a level is played, so a
     * player who lives at level 8 carries one record, not nineteen. */
    marathon: {
        id: 'marathon',
        name: 'Marathon',
        blurb: 'Pin the level. No curve, no finish line — just how long you can hold it.',
        goalLines: null,
        timeLimitMs: null,
        goal: null,
        garbageRows: 0,
        pinnable: true,
        seedSource: 'entropy',
        metric: 'score',
        instantRetry: false,
        scores: { category: 'marathon', order: 'desc', keyed: 'level' },
        record: {
            category: 'marathon',
            perLevel: true,
            direction: 'higher',
            format: 'integer',
            label: 'Marathon',
        },
    },
    sprint: {
        id: 'sprint',
        name: 'Sprint 40',
        blurb: 'Forty lines. Nothing else. Go.',
        goalLines: 40,
        timeLimitMs: null,
        goal: null,
        garbageRows: 0,
        pinnable: false,
        seedSource: 'entropy',
        metric: 'time',
        instantRetry: true,
        // §3 gives Sprint a personal best and no leaderboard: one number, not
        // a ranked list, which is exactly the line §4 of the guide draws
        // between records and scores.
        scores: null,
        record: {
            category: 'sprint-40',
            direction: 'lower',
            format: 'duration-ms',
            label: 'Sprint 40',
        },
    },
    ultra: {
        id: 'ultra',
        name: 'Ultra',
        blurb: 'Three minutes on the clock. Score all you can.',
        goalLines: null,
        timeLimitMs: ULTRA_MS,
        goal: null,
        garbageRows: 0,
        pinnable: false,
        seedSource: 'entropy',
        metric: 'score',
        instantRetry: true,
        scores: { category: 'ultra', order: 'desc', keyed: false },
        record: {
            category: 'ultra-score',
            direction: 'higher',
            format: 'integer',
            label: 'Ultra score',
        },
    },
    zen: {
        id: 'zen',
        name: 'Zen',
        blurb: 'Level-one gravity, no clock, no ending. Stack.',
        goalLines: null,
        timeLimitMs: null,
        goal: null,
        garbageRows: 0,
        pinnable: false,
        seedSource: 'entropy',
        /* NO SKILL RECORDS EITHER, and this is the one place the flag is set.
         * Best combo, longest B2B, most quads and biggest lock are records
         * because they were built under threat — and Zen has no top-out, so a
         * combo there can be assembled at leisure over an hour with the stack
         * at the ceiling. Filing those alongside a combo built in a real run
         * would retire all four categories permanently on the first Zen
         * session. Lifetime counters still roll up: playing is still playing. */
        skillRecords: false,
        // Nothing to rank and nothing to beat: §3 gives Zen lifetime stats
        // only, which store.js rolls up for every mode anyway.
        metric: null,
        instantRetry: false,
        scores: null,
        record: null,
    },
    daily: {
        id: 'daily',
        name: 'Daily Well',
        blurb: 'One well, one seed, one day. Dig it clear.',
        goalLines: null,
        timeLimitMs: null,
        /* §3's dig, exactly: the run ends when no debris remains, not after
         * some number of lines. The two fields below are ONE setting in two
         * halves and must move together — `goal: 'garbage'` on a mode with
         * `garbageRows: 0` is won the instant createGame() returns, goal event
         * already in the first drain. Nothing else in this table carries it. */
        goal: 'garbage',
        garbageRows: DAILY_GARBAGE_ROWS,
        pinnable: false,
        seedSource: 'daily',
        metric: 'time',
        instantRetry: false,
        // Everyone digs the same well, so the day IS the board: one category,
        // one entry key per date, ascending because the fast time wins.
        scores: { category: 'daily', order: 'asc', keyed: 'date' },
        record: null,
    },
});

// Menu order, and the id a stored-but-unknown mode falls back to. Arcade is
// first and is the default: it is the game somebody who has never played this
// before should land in, and Marathon asks a question (which level?) that only
// means something once you know how fast level 8 is.
export const MODE_IDS = Object.freeze(Object.keys(MODES));
export const DEFAULT_MODE = 'arcade';

// The level a pinnable mode starts offering. Slow enough to hold indefinitely
// with room to think, fast enough not to feel like a demo — and the player
// moves it on the menu card, where the number is next to the button.
export const DEFAULT_PIN_LEVEL = 5;

/**
 * The opts object js/core/game.js's createGame() takes, for one mode.
 *
 * `settings` is deliberately absent: DAS/ARR/SDF/ghost/lockdown are the
 * PLAYER's, not the mode's, and they arrive from Arcade.state through
 * js/app/store.js. js/main.js composes the two —
 * `createGame({ ...gameOptsFor(id, seed), settings: loadSettings() })` — and
 * core normalizes and ignores the settings fields that are not its business.
 *
 * ZEN'S "NO TOP-OUT" IS NOT A FLAG. game.js keys the softening off
 * `g.mode === 'zen'` directly (both the Block Out and the Lock Out paths sink
 * the stack instead of ending the run), so the mode id in these opts IS the
 * switch. There is nothing else to set, and inventing a `noTopOut` opt here
 * would be a field core never reads.
 *
 * @param {string} modeId       one of MODE_IDS; anything else falls back to
 *                              DEFAULT_MODE rather than throwing, so a save
 *                              from a build with a mode this one lacks still
 *                              opens.
 * @param {number|string|function|{getState:function}} seed
 *                              the run's seed, a factory for one, or the
 *                              generator Arcade.daily.seed() returns.
 * @param {{pinLevel?: number}} [opts]
 *                              the player's pinned level, honoured ONLY by a
 *                              mode that declares `pinnable`. Passing it to a
 *                              mode that does not is ignored rather than
 *                              rejected: the menu holds one stored level and
 *                              hands it over on every launch, and a Sprint
 *                              that threw for being handed it would be a bug
 *                              in this file, not at the call site.
 * @returns {{mode:string, seed:number|string, goalLines:?number,
 *            timeLimitMs:?number, goal:?string, garbageRows:number,
 *            pinLevel:?number}} a fresh object every
 *            call — the caller owns it and may mutate it.
 */
export function gameOptsFor(modeId, seed, opts) {
    const m = modeFor(modeId);
    const o = opts || {};
    return {
        mode: m.id,
        seed: resolveSeed(seed),
        goalLines: m.goalLines,
        timeLimitMs: m.timeLimitMs,
        goal: m.goal,
        garbageRows: m.garbageRows,
        // core clamps to 1..MAX_PIN_LEVEL; null is the escalating curve.
        pinLevel: m.pinnable ? pinLevelOf(o.pinLevel) : null,
    };
}

/* The player's pinned level, defaulted rather than rejected. An unusable value
 * — a missing setting, a hand-edited blob, a string — becomes the default
 * rather than null, because null on a pinnable mode does not mean "no
 * preference", it means the level climbs, and silently turning Marathon back
 * into Arcade is the one outcome nobody asked for. */
export function pinLevelOf(v) {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= 1 ? n : DEFAULT_PIN_LEVEL;
}

/* A seed, however the caller happens to be holding it.
 *
 * NO SEED MEANS SEED ZERO, and seed zero is the same well every time. This
 * file cannot invent entropy — that is the whole point of it being pure — so
 * seeding a casual run is js/main.js's job (§2.3: casual runs from entropy,
 * the Daily Well from the day). Falling back to 0 rather than throwing
 * matches createGame(), which does exactly the same with a missing seed.
 */
function resolveSeed(seed) {
    // ORDER MATTERS. Arcade.daily.seed() and Arcade.rng() return a callable
    // generator whose u32 state is the seed, so a generator is also a
    // "factory" by any duck test — and CALLING it yields the first float of
    // its stream, which truncates to 0. Unwrap before calling; a factory that
    // returns a generator is then unwrapped on the way back.
    let s = seed;
    if (s && typeof s.getState === 'function') s = s.getState();
    else if (typeof s === 'function') s = s();
    if (s && typeof s.getState === 'function') s = s.getState();
    if (typeof s === 'number' && Number.isFinite(s)) return s >>> 0;
    if (typeof s === 'string' && s) return s;
    return 0;
}

/**
 * The mode a possibly-unknown id names, falling back to DEFAULT_MODE.
 *
 * hasOwn, not `MODES[id] ||`. A mode id reaches this from storage, from a
 * share code and from a menu, and `MODES['__proto__']` is Object.prototype —
 * truthy, so a plain `||` fallback never fires and the caller gets an object
 * with no goalLines at all. Same for 'toString' and 'constructor'. This is the
 * one accessor; js/app/store.js builds its `run.<mode>` key through it too, so
 * a hostile id cannot address a key that is not a run.
 */
export function modeFor(modeId) {
    return Object.hasOwn(MODES, modeId) ? MODES[modeId] : MODES[DEFAULT_MODE];
}

/* The table is shared, read every frame by the shell, and handed to no one
 * defensively-copied. Freezing it means a menu that stashes a mode object and
 * pokes at it fails at the poke instead of quietly changing the rules of
 * everybody else's next run. */
function deepFreeze(o) {
    for (const v of Object.values(o)) {
        if (v && typeof v === 'object') deepFreeze(v);
    }
    return Object.freeze(o);
}
