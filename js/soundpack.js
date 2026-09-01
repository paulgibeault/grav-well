// Gravity Well sound pack — the game's own sound design.
//
// Loaded as a plain <script> after /arcade-audio.js (see index.html), which is
// why there is not an import or an export anywhere in this file. js/app/audio.js
// registers everything here with Arcade.audio; the launcher's tools/soundpack
// renderer loads this same file to produce audition WAVs, so what gets approved
// by ear is what plays.
//
// The place: a stone cistern, forty rows deep, with a starfield at the bottom
// of it. Salvage sinks past you into the dark and seats on the pile below.
// Everything you hear is either right under your hands (a block sliding one
// column) or a long way down the shaft (a row letting go) — and the distance
// between those two is carried almost entirely by SENDS, not by level. Stone,
// grit, and a great deal of air.
//
// This pack HAS a sustained layer, which the fleet's other canvas game
// deliberately does not: an empty room is silent, but a shaft is not — a
// standing column of air in a stone well is audible the moment you lean over
// it, and that hum is the one thing that tells the player the well has a
// bottom. It is the only continuous sound here; between events everything else
// is silence.
//
// Register plan, so simultaneous cues occupy different bands instead of masking
// each other (a lock, a clear and the bed regularly land in the same 200 ms):
//   bed 40–540 · lock/topout thump 22–320 · clear settle 30–90
//   tspin creak 200–1100 · turn/hold body 500–1300 · quad front 120–1900
//   goal/singularity body 72–430 · clear shatter 1.2k–7k · shift strike 5k–9k
//
// Every cue takes an `r` (the SDK's seeded random stream, a fresh seed per
// play) and varies pitch, timing, grain and layer balance with it. Nothing here
// plays the same twice — deliberately: `shift` and `turn` fire tens of times a
// second under DAS, and byte-identical repetition at that rate is the single
// loudest chiptune tell in the fleet.

(function (global) {
    'use strict';
    const S = global.ArcadeAudioElements;

    // Every cue below is built from the element library's gestures, so with the
    // library absent — a stale service-worker cache, or a standalone embed off
    // the launcher origin — there is nothing registrable and Gravity Well plays
    // silent. That is the fleet posture, not a bug: the pack IS the sound and an
    // approximation of it is worse than nothing. Bail before dereferencing S,
    // because this is a plain script and a throw here would surface as a page
    // error even though the silence itself is intended. The registerPack check
    // also covers an OLDER library — the same stale-cache case, one version on.
    if (!S || typeof S.registerPack !== 'function') return;

    // A dressed stone shaft. Long, and — unlike a room outdoors — BRIGHT: stone
    // reflects the top end that foliage and water absorb, which is what makes
    // the difference between "a cistern" and "a field at night" audible in the
    // tail rather than only in the decay time. The pre-delay is short because
    // the walls of a well are close on every side; the length comes from the
    // shaft going down, not from the room being wide.
    const ROOM = {
        dur: 3.2,
        decay: 1.10,        // §6 of the design doc, and the whole identity of the game
        preDelay: 0.019,
        wet: 0.72,
        shelfHz: 5200,      // higher than a soft room: stone keeps its top end
        shelfDb: -3,
        seed: 2731,
    };

    // How far down the well each cue is. This is the pack's most load-bearing
    // table — the same gesture at 0.10 is in your hands and at 0.72 is four
    // storeys below you, and every cue here was voiced against its send rather
    // than against its own level. Reading down the column is the design:
    // controls are dry, the stack is mid, the well is wet.
    const SENDS = {
        'shift': 0.12,      // your hands on the piece, barely in the room at all
        'turn': 0.15,
        'hold': 0.10,       // a mechanism at the rim — the driest thing in the pack
        'touch': 0.22,      // contact, a body-length down
        'lock': 0.30,       // it seats on the pile, and the pile is in the well
        'tspin': 0.24,      // a twist you can feel; only a little of it comes back
        'clear': 0.44,      // a whole row letting go, down there
        'quad': 0.72,       // heard far up the shaft — §6, and the reason quad exists
        'levelup': 0.55,    // the well itself answering
        'goal': 0.64,       // …and answering for the last time
        'topout': 0.60,     // or swallowing everything
        'singularity': 0.85,// the longest send in the pack: this happened to the whole shaft
        'well-hum': 0.42,   // the air column IS the room; some send fuses it in
    };

    // Which cues are beds. js/app/audio.js registers these with
    // `{ sustained: true }` and drives them through Arcade.audio.start(), and
    // the pack states it here rather than the module hard-coding a name: which
    // sounds sustain is a design fact about the pack.
    const SUSTAINED = { 'well-hum': true };

    // Three levels, and the whole mix is balanced on the first one. `shift` and
    // `turn` fire on every input — thirty a second with DAS held and ARR at 33
    // ms — so they have to be quieter than instinct says: loud enough to read as
    // grit under the piece, quiet enough that you could not say afterwards you
    // heard anything. PIECE fires once or twice per piece, EVENT once per clear
    // or better. They live here as named constants so the ratios between the
    // three rates stay visible instead of being buried in ten cue bodies.
    const CONSTANT = 0.020;   // per-input texture: shift, turn
    const PIECE = 0.070;      // per-piece: touch, lock, hold
    const EVENT = 0.155;      // per-clear and up

    // A struck stone slab: inharmonic, and dead. Ratios are deliberately not
    // near-integer (that is a bell, and a bell in a well is a temple, not a
    // quarry), and the decays are short and stacked so the top of it is gone
    // inside 70 ms — stone rings briefly and then is simply heavy.
    const SLAB = [
        { ratio: 1.00, gain: 1.00, decay: 0.30, detune: 4 },
        { ratio: 2.31, gain: 0.34, decay: 0.15, detune: 7 },
        { ratio: 3.87, gain: 0.13, decay: 0.07, detune: 11 },
    ];

    const seed = (r) => (r() * 1e6) | 0;

    const CUES = {
        // One column of travel. A featherweight high-passed `strike` and
        // nothing else: at this rate anything with a body becomes a beep by the
        // fourth repeat, and anything below ~4 kHz collides with the piece
        // seating a moment later. What varies per play is the whole cue — the
        // band, the length and the level all move, so a DAS sweep across the
        // well is ten different grains of the same stone rather than one sample
        // retriggered ten times.
        'shift': function (ctx, o, t, p, r) {
            S.strike(ctx, o, t, {
                dur: S.between(r, 0.0025, 0.0045),
                hp: S.between(r, 5200, 7400),
                gain: CONSTANT * S.between(r, 0.75, 1.15),
                seed: seed(r),
            });
            return 0.06;
        },

        // The piece pivoting on a corner: contact, plus the short ring of the
        // stone it pivoted against. The `body` is what separates this from
        // `shift` — a rotation is a heavier gesture than a slide even though it
        // costs the same input, and one detuned pair with a 40 ms decay is
        // enough to say so without adding level.
        //
        // `kicked` (js/app/audio.js passes it from the rotate event's
        // kickIndex) means SRS had to offset the piece to fit it: it scraped
        // past something on the way in, so a very short stick-slip `creak` goes
        // under the ring. A wall kick is the most satisfying thing a stacker
        // does and nothing else in the mix marks it.
        'turn': function (ctx, o, t, p, r) {
            const kicked = !!(p && p.kicked);
            const at = seed(r);
            S.strike(ctx, o, t, {
                dur: S.between(r, 0.0030, 0.0050),
                hp: S.between(r, 3200, 4400),
                gain: CONSTANT * (kicked ? 1.25 : 1.0) * S.between(r, 0.8, 1.15),
                seed: at,
            });
            S.body(ctx, o, t, {
                f0: S.between(r, 560, 760) * S.cents(r, 30),
                gain: CONSTANT * 0.85 * S.between(r, 0.8, 1.2),
                partials: [
                    { ratio: 1.00, gain: 1.0, decay: S.between(r, 0.030, 0.055), detune: 5 },
                    { ratio: 2.78, gain: 0.30, decay: S.between(r, 0.014, 0.026), detune: 9 },
                ],
            });
            if (kicked) {
                S.creak(ctx, o, t, {
                    f0: S.between(r, 340, 460), Q: 8, lp: 1000,
                    dur: S.between(r, 0.05, 0.09), gain: CONSTANT * 1.1,
                    rate: S.between(r, 2.8, 3.8), attack: 0.008, seed: at + 1,
                });
            }
            return 0.14;
        },

        // The piece arriving on the surface it will lock against — the moment
        // lock delay starts, not the lock itself. Same materials as `lock` and
        // deliberately the same shape, at half the weight and with a soft onset:
        // this is a settle, and the difference between it and the seat 500 ms
        // later is exactly what tells the player the timer is running.
        'touch': function (ctx, o, t, p, r) {
            const at = seed(r);
            S.strike(ctx, o, t, {
                dur: 0.003, hp: S.between(r, 1800, 2600),
                gain: PIECE * 0.18, seed: at,
            });
            S.thump(ctx, o, t, {
                f0: S.between(r, 84, 100), f1: 44,
                dur: S.between(r, 0.14, 0.20),
                attack: 0.010,          // it lands ON something, it does not hit it
                gain: PIECE * 0.55 * S.between(r, 0.85, 1.15), seed: at + 1,
            });
            S.body(ctx, o, t, {
                f0: S.between(r, 140, 175) * S.cents(r, 20),
                gain: PIECE * 0.22,
                partials: [
                    { ratio: 1.00, gain: 1.0, decay: S.between(r, 0.05, 0.09), detune: 5 },
                    { ratio: 2.31, gain: 0.25, decay: 0.03, detune: 9 },
                ],
            });
            return 0.30;
        },

        // Salvage seating on the pile. The heaviest routine sound in the game
        // and the one the player hears most, so everything about it is aimed at
        // surviving repetition: the contact click, the low `thump` and the SLAB
        // ring all pull their own pitch and length per play, and the balance
        // between them moves too.
        //
        // `hard` (set by js/app/audio.js when the lock came out of a hard drop)
        // is weight, not volume — a longer thump, a faster onset, and grit blown
        // out from under the piece. A hard drop crosses the whole well; it
        // should not sound like a piece that shuffled down one row.
        'lock': function (ctx, o, t, p, r) {
            const hard = p && p.hard ? 1 : 0;
            const w = 0.85 + 0.55 * hard;
            const at = seed(r);
            S.strike(ctx, o, t, {
                dur: S.between(r, 0.004, 0.007), hp: S.between(r, 2200, 3200),
                gain: PIECE * 0.30 * w, seed: at,
            });
            S.thump(ctx, o, t, {
                f0: S.between(r, 104, 124), f1: 38,
                dur: S.between(r, 0.30, 0.40) * (1 + 0.25 * hard),
                attack: hard ? 0.004 : 0.007,
                gain: PIECE * 0.95 * w, seed: at + 1,
            });
            S.body(ctx, o, t, {
                f0: S.between(r, 126, 168) * S.cents(r, 25),
                gain: PIECE * 0.62 * w,
                partials: SLAB,
            });
            if (hard) {
                // dust and chips going sideways out from under it
                S.rustle(ctx, o, t + 0.006, {
                    f0: S.between(r, 900, 1300), f1: S.between(r, 260, 360),
                    Q: 1.0, lp: 1400, dur: S.between(r, 0.12, 0.20),
                    gain: PIECE * 0.30, attack: 0.006, seed: at + 2,
                });
            }
            return 0.7;
        },

        // A row letting go. `shatter` is the right gesture and not an obvious
        // one — a line clear is usually voiced as a sweep — but what actually
        // happens on screen is ten cells fracturing at once and falling away, and
        // a population of shards is the only thing that sounds like a population
        // of shards. The room turns them from glass into stone chips.
        //
        // `count` (1–4) scales the POPULATION and the spread, not the level: a
        // Quad is ~90 shards over half a second where a Single is ~40 over a
        // third, so a big clear is heard as more breakage rather than as a
        // louder break. Level rises only a little (0.78 → 1.26 of EVENT) and the
        // band drops slightly, because larger fragments ring lower.
        //
        // From two rows up, a low settle goes under it: the stack above the gap
        // dropping into the space the rows left. Felt more than heard, and
        // absent on a Single, where nothing meaningful moves.
        'clear': function (ctx, o, t, p, r) {
            const count = Math.max(1, Math.min(4, (p && p.count) | 0 || 1));
            /* THE COMBO LADDER. `combo` is the chain length — 1 for the first
             * clear of a chain, which is every clear, so 1 has to sound exactly
             * like the cue always did or the whole game gets louder.
             *
             * It raises the FRACTURE PITCH rather than the level. A chain is
             * not a bigger event than a single clear, it is a faster one, and
             * the genre's answer to that has always been pitch: the same break
             * heard tighter and tighter as the well runs out of slack. Capped
             * at 12 because the curve is exponential and an unbounded chain
             * would eventually put the shatter above hearing. */
            const combo = Math.max(1, Math.min(12, (p && p.combo) | 0 || 1));
            const rung = Math.pow(1.055, combo - 1);
            const at = seed(r);
            S.shatter(ctx, o, t, {
                grains: 24 + 16 * count,
                dur: (0.32 + 0.09 * count) * S.between(r, 0.90, 1.12),
                f0: S.between(r, 2400, 3100) * rung,
                bright: 1 - 0.06 * (count - 1),
                ring: S.between(r, 0.9, 1.3),
                skew: S.between(r, 2.0, 2.6),   // dense at the fracture, thinning as they fall
                hp: 1200,
                crack: S.between(r, 0.55, 0.85),
                gain: EVENT * (0.62 + 0.16 * count),
                seed: at,
            });
            if (count >= 2) {
                S.thump(ctx, o, t + S.between(r, 0.05, 0.09), {
                    f0: S.between(r, 70, 86), f1: 30,
                    dur: 0.40 + 0.10 * count,
                    attack: 0.020,              // a settle swells; it does not knock
                    gain: EVENT * 0.30 * (0.5 + count / 4), seed: at + 1,
                });
            }
            /* The pawl, from the second clear of a chain. One detent per link,
             * climbing with the ladder — the mechanism at the rim counting the
             * chain out loud, which is the one thing in the pack that tells the
             * player how long the chain is without them reading the rail.
             *
             * It rides the LEADING edge, a hair before the shatter, because it
             * is the well anticipating the break rather than answering it; and
             * it stays at PIECE level, not EVENT, because it fires under a cue
             * that is already the loudest thing in the mix. */
            if (combo >= 2) {
                S.ratchet(ctx, o, t + S.between(r, 0.005, 0.012), {
                    detents: Math.min(6, combo),
                    dur: 0.030 + 0.014 * Math.min(6, combo),
                    end: S.between(r, 0.62, 0.78),   // accelerating: it is winding UP
                    jitter: 0.04,
                    f: S.between(r, 600, 780) * rung,
                    hp: S.between(r, 2200, 2800),
                    gain: PIECE * (0.80 + 0.10 * Math.min(5, combo - 1)),
                    seed: at + 2,
                });
            }
            return 1.2 + 0.2 * count;
        },

        // Quad. Fired ON TOP of `clear` — the shatter is the four rows going,
        // this is the well answering — which is why it carries no top end of its
        // own and why its send is the highest in the pack: it arrives from
        // somewhere else, up the shaft, a beat late.
        //
        // `crack` is nearly off. A `blast` with its snap intact is a detonation
        // and reads as a firecracker however much bass sits under it; what is
        // wanted here is the whump and the rumble rolling away, with just enough
        // edge (0.18) to remember that something broke. No `tone` either: the
        // ringing shell the element can add is heard as a struck bell, and this
        // well has no bell in it.
        /* SUCCESSIVE QUADS ESCALATE, and they escalate DOWNWARD.
         *
         * The obvious lever is level, and it is the wrong one: `quad` is
         * already the loudest cue in the pack and §6 spends a paragraph on
         * keeping it restrained. So the streak buys DEPTH instead — the blast
         * grows, the rumble lengthens, and both bottom frequencies fall, which
         * is the shaft answering from further down each time rather than the
         * game shouting. Level moves too, but by half what size does.
         *
         * From the third in a row a SECOND blast lands a fifth of a second
         * behind the first, quieter and lower still: the far end of the well
         * catching up. That is the moment the escalation stops being a trim on
         * one sound and becomes an event of its own, which is right — three
         * quads in a row is not a common thing to have done.
         *
         * Capped at five. The curve is linear in `k` and an uncapped streak
         * would eventually ask for a gain the bus has to limit, which reads as
         * the mix breaking rather than as the player doing well.
         */
        'quad': function (ctx, o, t, p, r) {
            const streak = Math.max(1, Math.min(5, (p && p.streak) | 0 || 1));
            const k = (streak - 1) / 4;         // 0 on the first, 1 on the fifth
            const at = seed(r);
            S.blast(ctx, o, t + S.between(r, 0.02, 0.05), {
                size: S.between(r, 1.15, 1.35) * (1 + 0.34 * k),
                gain: 0.115 * (1 + 0.42 * k),   // restrained, per §6 — it is already the loudest thing
                crack: 0.18 + 0.09 * k,
                attack: S.between(r, 0.030, 0.050),
                rumble: 1.35 + 0.80 * k,
                f0: S.between(r, 1500, 1900),
                f1: S.between(r, 120, 160) * (1 - 0.30 * k),
                lp: 1300,
                wf0: S.between(r, 88, 108) * (1 - 0.24 * k),
                seed: at,
            });
            if (streak >= 3) {
                S.blast(ctx, o, t + S.between(r, 0.20, 0.27), {
                    size: S.between(r, 1.30, 1.55),
                    gain: 0.115 * 0.52 * (0.6 + 0.4 * k),
                    crack: 0.05,                // no snap at all down there
                    attack: S.between(r, 0.055, 0.085),
                    rumble: 2.10,
                    f0: S.between(r, 900, 1200),
                    f1: S.between(r, 62, 84),
                    lp: 900,
                    wf0: S.between(r, 54, 68),
                    seed: at + 1,
                });
            }
            return 3.0 + 1.4 * k;
        },

        // A Singularity — the perfect clear, and the rarest thing in the game
        // (DESIGN §1 names it; §6's cue list omitted it). It fires OVER `clear`:
        // the rows still break, and this is the well noticing that it is empty.
        //
        // The whole cue is `clear` run backwards. `shatter` with `skew` below 1
        // reverses its grain distribution — the population starts sparse and
        // CONVERGES, which is a formation sound rather than a breakage one — and
        // `crack: 0` takes the fracture off the front, because nothing breaks
        // here. Under it the band sweeps UP rather than down: the shaft drawing
        // its breath in. Everything is aimed at one instant 0.66 s in, where the
        // gathering stops.
        //
        // What rings after it is the one near-HARMONIC body in the pack. Every
        // other struck thing here is rubble, and rubble is inharmonic; an empty
        // shaft is a tube, and a tube's modes are a harmonic series. For exactly
        // one moment per run the well is a pipe instead of a quarry, and that is
        // the sound of the board being clean.
        'singularity': function (ctx, o, t, p, r) {
            const at = seed(r);
            const gather = S.between(r, 0.55, 0.72);
            S.rustle(ctx, o, t, {
                f0: S.between(r, 180, 240), f1: S.between(r, 900, 1300),
                Q: 0.8, lp: 1800, dur: gather,
                gain: EVENT * 0.34, attack: gather * 0.75,   // still opening when it arrives
                seed: at,
            });
            S.shatter(ctx, o, t + 0.05, {
                grains: 76,
                dur: gather,
                f0: S.between(r, 2200, 2900),
                skew: S.between(r, 0.30, 0.42),   // < 1: glass assembling, not breaking
                ring: S.between(r, 1.2, 1.7),
                hp: 900,
                crack: 0,
                gain: EVENT * 0.50,
                seed: at + 1,
            });
            const f0 = S.between(r, 96, 118) * S.cents(r, 12);
            const hit = t + gather + 0.06;
            S.thump(ctx, o, hit, {
                f0: f0 * 0.62, f1: 26, dur: S.between(r, 1.0, 1.3),
                attack: 0.012, gain: EVENT * 0.62, seed: at + 2,
            });
            S.body(ctx, o, hit, {
                f0, gain: EVENT * 0.50,
                partials: [
                    { ratio: 1.00, gain: 1.00, decay: S.between(r, 3.0, 3.8), detune: 3, attack: 0.05 },
                    { ratio: 1.50, gain: 0.42, decay: S.between(r, 2.2, 2.8), detune: 5, attack: 0.04, delay: 0.06 },
                    { ratio: 2.00, gain: 0.26, decay: S.between(r, 1.5, 2.0), detune: 4, attack: 0.03, delay: 0.10 },
                    { ratio: 3.01, gain: 0.10, decay: S.between(r, 0.8, 1.2), detune: 7, delay: 0.14 },
                ],
            });
            return 4.2;
        },

        // A T-spin. Stick-slip is the sound of a piece being twisted into a slot
        // it does not fit through — the surfaces grip, tension builds, they
        // release — and that irregular grip-and-release is the entire reason
        // `creak` is here rather than another impact. It plays alongside `lock`,
        // so it carries no seat of its own: the lock is the seat.
        //
        // The rate falls across the gesture (`rate1` below `rate`): the piece
        // fights going in and then stops fighting. `mini` is shorter and thinner
        // — a mini T-spin is the same move with less of the well holding it.
        'tspin': function (ctx, o, t, p, r) {
            const mini = p && p.mini ? 1 : 0;
            const dur = mini ? S.between(r, 0.14, 0.20) : S.between(r, 0.22, 0.32);
            const f0 = S.between(r, 300, 400);
            const rate = S.between(r, 2.4, 3.6);
            S.creak(ctx, o, t, {
                f0, f1: f0 * S.between(r, 0.55, 0.72),
                Q: S.between(r, 7, 10), lp: S.between(r, 800, 1100),
                dur, gain: (mini ? 0.11 : 0.17) * S.between(r, 0.85, 1.15),
                rate, rate1: rate * S.between(r, 0.35, 0.60),
                attack: dur * S.between(r, 0.15, 0.30),
                seed: seed(r),
            });
            return dur + 0.3;
        },

        // Hold. One detent of a pawl dropping into a tooth — the piece is set
        // aside in a mechanism, and mechanisms click. `ratchet` rather than a
        // bare strike because a detent is a click PLUS the short ring of the
        // pawl, and that ring is what makes it a machine instead of a tap.
        //
        // Two detents, not one: the element floors at two, and two 25 ms apart
        // with the second decelerating into place is heard as a single detent
        // with its own rebound anyway — which is what a pawl actually does.
        // Driest cue in the pack (send 0.10): this one is in your hands.
        'hold': function (ctx, o, t, p, r) {
            S.ratchet(ctx, o, t, {
                detents: 2,
                dur: S.between(r, 0.045, 0.075),
                end: S.between(r, 1.3, 1.8),    // decelerating — a hand settling it, not a wheel let go
                jitter: 0.05,
                f: S.between(r, 560, 740),
                hp: S.between(r, 2400, 3000),
                gain: PIECE * S.between(r, 1.10, 1.35),
                seed: seed(r),
            });
            return 0.22;
        },

        // Level up — the well opening out under you. Four struck bodies rising
        // through a fifth, an octave and a twelfth, each entering before the
        // last has died, the final one ringing two and a half seconds into the
        // room. Overlapping is what makes it one gesture: struck separately
        // these are four knocks, struck 90 ms apart they are a gliss.
        //
        // (§6 asks for a "rising body gliss". `body` is a bank of fixed-frequency
        // oscillators — the element library has no pitched glide except a
        // pluck's string bend — so the rise is STEPPED rather than continuous.
        // The steps are close enough to read as a lift and the interval ladder
        // gives it somewhere to arrive; a true portamento would need a new
        // element in the library, which is where synthesis belongs.)
        'levelup': function (ctx, o, t, p, r) {
            const f0 = S.between(r, 158, 178) * S.cents(r, 10);
            const steps = [1, 1.5, 2, 3];
            let at = t;
            for (let i = 0; i < steps.length; i++) {
                const last = i === steps.length - 1;
                S.body(ctx, o, at, {
                    f0: f0 * steps[i] * S.cents(r, 6),
                    gain: EVENT * (0.55 - 0.07 * i),
                    partials: [
                        {
                            ratio: 1.00, gain: 1.0, detune: 6, attack: 0.03,
                            decay: last ? S.between(r, 2.0, 2.6) : S.between(r, 0.7, 1.1),
                        },
                        {
                            ratio: 2.05, gain: 0.26, detune: 10, attack: 0.02, delay: 0.02,
                            decay: last ? S.between(r, 0.9, 1.3) : S.between(r, 0.35, 0.55),
                        },
                        { ratio: 3.41, gain: 0.09, decay: S.between(r, 0.18, 0.30), detune: 14 },
                    ],
                });
                at += S.between(r, 0.075, 0.105);
            }
            return 3.4;
        },

        // Goal — Sprint 40's fortieth line, or Ultra's clock running out. A run
        // ENDING, which is a different thing from a level ticking over, and the
        // pack now has three poles to place it between: `topout` is final and
        // negative, `levelup` is positive and passing, and this is positive and
        // final.
        //
        // Finality is carried by direction. `levelup` climbs a fifth, an octave
        // and a twelfth and leaves the last note hanging up there — the run
        // continues, and the sound says so by not landing. This one goes the
        // other way: root, fifth above, then a fourth BELOW the root arriving
        // last and ringing longest, so the gesture comes to rest lower than it
        // started. The strike at the front is what makes it struck rather than
        // swelled, and the thump under it is the well taking the weight.
        //
        // Same near-harmonic body as `singularity`, for the same reason: this is
        // the shaft's own voice, and the shaft is a tube.
        'goal': function (ctx, o, t, p, r) {
            const at = seed(r);
            const f0 = S.between(r, 126, 142) * S.cents(r, 8);
            S.strike(ctx, o, t, {
                dur: 0.010, hp: S.between(r, 1600, 2200),
                gain: EVENT * 0.34, seed: at,
            });
            S.thump(ctx, o, t, {
                f0: S.between(r, 64, 74), f1: 28,
                dur: S.between(r, 1.1, 1.4), attack: 0.020,
                gain: EVENT * 0.55, seed: at + 1,
            });
            // root · fifth above · fourth below — the last voice is the lowest,
            // and the longest, which is the whole reason this reads as an ending
            const voices = [
                { ratio: 1.00, at: 0.00, gain: 0.58, decay: S.between(r, 2.6, 3.2) },
                { ratio: 1.50, at: S.between(r, 0.09, 0.13), gain: 0.40, decay: S.between(r, 2.2, 2.8) },
                { ratio: 0.75, at: S.between(r, 0.22, 0.30), gain: 0.52, decay: S.between(r, 3.6, 4.4) },
            ];
            for (let i = 0; i < voices.length; i++) {
                const v = voices[i];
                S.body(ctx, o, t + v.at, {
                    f0: f0 * v.ratio * S.cents(r, 5),
                    gain: EVENT * v.gain,
                    partials: [
                        { ratio: 1.00, gain: 1.00, decay: v.decay, detune: 4, attack: 0.035 },
                        { ratio: 2.00, gain: 0.30, decay: v.decay * 0.45, detune: 7, attack: 0.025, delay: 0.03 },
                        { ratio: 3.02, gain: 0.11, decay: v.decay * 0.20, detune: 9, delay: 0.06 },
                    ],
                });
            }
            return 4.8;
        },

        // Top out. One deep thump, long and slow to arrive, and nothing else —
        // js/app/audio.js kills the bed under it over a couple of seconds, so
        // what the player actually hears is the well going quiet. That silence
        // is the cue; the thump is only what starts it.
        //
        // Nothing bright, nothing broken, no shatter. The run did not explode,
        // it filled up.
        'topout': function (ctx, o, t, p, r) {
            S.thump(ctx, o, t, {
                f0: S.between(r, 70, 82), f1: 22,
                dur: S.between(r, 1.5, 1.9),
                attack: S.between(r, 0.018, 0.030),
                gain: 0.30, seed: seed(r),
            });
            return 2.6;
        },

        // ── the bed ───────────────────────────────────────────────────────
        // `well-hum` — the air column in the shaft. Sustained, in the SDK's own
        // shape (fn(ctx, out, when, params, rnd) returning a teardown), so
        // js/app/audio.js registers it with `{ sustained: true }` and drives it
        // through Arcade.audio.start(). It lives in CUES with everything else so
        // the offline renderer can audition it — give it an explicit `dur` on
        // the timeline item there, since a sustained cue returns a teardown
        // rather than its own length.
        //
        // `S.teardown(collect)` is the library's standard teardown, and it is
        // not optional: a bed outlives the moment that triggered it, so stopping
        // it has to actually stop its sources. Merely disconnecting the output
        // leaves three oscillators scheduled and alive for the rest of the
        // bed's duration — once per run played.
        //
        // TRIANGLE, not the default sine. The fundamental sits at 43.65 Hz (F1),
        // which is where a shaft this deep resonates and also two octaves below
        // anything a laptop speaker reproduces; a sine there is felt on
        // headphones and simply absent everywhere else, which would make the
        // whole depth ladder below inaudible for half the players. A triangle
        // lowpassed hard keeps the same weight and leaves its third and fifth
        // harmonics (131 / 218 Hz) to carry the hum on small speakers.
        //
        // `depth` (0 · 0.5 · 1, quantised by js/app/audio.js from the stack
        // height) is how far up the well the salvage has come. It does NOT move
        // the pitch — a bed that transposes is a musical event, and the crossfade
        // a retune performs would smear two pitches across three seconds. What
        // it moves is pressure: the level lifts a little, the lowpass opens so
        // the low-mids come forward, and above the first band a fifth fades in
        // above the fundamental. A fifth in a stone shaft is the sound of the
        // space getting narrower, and it arrives without anything having been
        // "added" to the mix.
        //
        // (A note on why the beat rate is not the depth signal, since it is the
        // obvious lever: at 43 Hz the two detuned oscillators beat at a fraction
        // of a hertz whatever `detune` is — 18 cents is 0.45 Hz — so the
        // "2–4 Hz reads as unease" register is simply not reachable down here.
        // The detune still widens with depth, but what carries the tension is
        // the interval and the low-mid lift.)
        'well-hum': function (ctx, o, t, params, r) {
            const dur = (params && params.dur) || 900;
            const d = params && typeof params.depth === 'number'
                ? Math.max(0, Math.min(1, params.depth)) : 0;
            const collect = [];
            const f = 43.65 * S.cents(r, 6);
            const lp = 240 + 300 * d;
            S.drone(ctx, o, t, dur, {
                f, type: 'triangle',
                detune: 6 + 12 * d,
                gain: 0.030 + 0.020 * d,
                lp,
                driftAmt: lp * 0.30,
                drift: S.between(r, 0.035, 0.055),   // slow enough that ten seconds of it never repeats
                sub: 0.18,                           // floor weight for headphones; small speakers lose it and don't miss it
                fade: 4.0,
                collect,
            });
            if (d > 0.25) {
                S.drone(ctx, o, t, dur, {
                    f: f * 1.5, detune: 9 + 9 * d,
                    gain: 0.012 * d, lp: 420, drift: 0.03, driftAmt: 120,
                    fade: 6.0,                       // enters slower than the crossfade that summoned it
                    collect,
                });
            }
            return S.teardown(collect);
        },
    };

    // Published under the framework's well-known handle so the game's audio
    // module and the launcher's soundpack toolchain both reach this pack
    // without either side knowing the game's name.
    S.registerPack({ name: 'grav-well', ROOM, SENDS, SUSTAINED, CUES, SLAB });
})(typeof window !== 'undefined' ? window : globalThis);
