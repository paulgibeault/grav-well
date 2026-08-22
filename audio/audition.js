// Gravity Well — audition timeline.
//
// Test material: the sections rendered into the audition WAV. Deliberately NOT
// part of the shipped pack — players never need the dry/wet comparisons or the
// repetition tests — but it reads the game's own js/soundpack.js, so every
// sound auditioned here is literally a sound the game plays.
//
//   cd grav-well
//   node ../paulgibeault.github.io/tools/soundpack/render.mjs \
//     --config soundpack.config.json --audition full
//   node ../paulgibeault.github.io/tools/soundpack/analyze.mjs \
//     audio/out/grav-well-full.manifest.json
//
// What this timeline is built to catch, in order of how often it has caught
// something in the fleet:
//   · a cue that repeats identically (§6: byte-identical repetition is the
//     chiptune tell, and `shift` fires thirty times a second)
//   · a cue that is inaudible, or one that is far louder than its neighbours
//   · the send ladder collapsing — if `shift` and `quad` sound the same
//     distance away, the pack's whole distance grammar is gone
//   · two cues that blur into each other (touch/lock, clear/quad)
//   · the bed drowning the cues, or the retune crossfade seaming

(function (global) {
    'use strict';
    const S = global.ArcadeAudioElements;
    const A = global.ArcadeAudition;
    const P = A.pack();
    const { CUES, SENDS, SLAB } = P;

    const GAP = 0.55;   // between items inside a section
    const TAIL = 1.8;   // the room is long here; let it finish before a section ends

    // The bed's three bands, exactly as js/app/audio.js quantises them.
    const DEPTHS = [0, 0.5, 1];
    const BED_SEND = SENDS['well-hum'];

    // Every cue, dry then in the room, generated from the pack so a cue added
    // later cannot be forgotten here. Not A.everyCueDryWet(): the sustained bed
    // needs an explicit duration (a sustained cue returns a teardown, and the
    // renderer would otherwise take that function for its length), and four cues
    // are only half themselves without their parameters.
    const DRYWET_PARAMS = {
        'turn': { kicked: true },
        'lock': { hard: true },
        'clear': { count: 2 },
        'well-hum': { dur: 11, depth: 0.5 },
    };
    const DRYWET_DUR = { 'well-hum': 12 };
    function dryWetItems() {
        const items = [];
        for (const name of Object.keys(CUES)) {
            const params = DRYWET_PARAMS[name] || null;
            const dur = DRYWET_DUR[name];
            items.push(A.play(name, { label: name + ' — dry', send: 0, params, dur }));
            items.push(A.play(name, { label: name + ' — in the room', params, dur }));
        }
        return items;
    }

    const SECTIONS = [
        {
            title: 'A · Elements — the raw ingredients',
            note: 'Physical gestures, not waveforms. If one of these is wrong, every cue built on it is wrong. The last two are the pack’s two least obvious choices: a shatter run BACKWARDS (skew < 1, the Singularity) and a triangle drone (the bed, voiced so a laptop speaker can reproduce it at all).',
            items: [
                A.custom('strike — the contact click', 0.5, (ctx, bus, t) => S.strike(ctx, S.out(bus, 0.20), t, { dur: 0.005, hp: 5200, gain: 0.30 })),
                A.custom('body — SLAB, the pack’s stone table', 1.2, (ctx, bus, t) => S.body(ctx, S.out(bus, 0.30), t, { f0: 150, gain: 0.30, partials: SLAB })),
                A.custom('thump — low impact', 1.1, (ctx, bus, t) => S.thump(ctx, S.out(bus, 0.30), t, { f0: 115, f1: 38, dur: 0.35, gain: 0.36 })),
                A.custom('rustle — friction, swept', 0.9, (ctx, bus, t) => S.rustle(ctx, S.out(bus, 0.25), t, { f0: 1100, f1: 300, Q: 1.0, lp: 1400, dur: 0.5, gain: 0.28 })),
                A.custom('creak — stick-slip (the T-spin)', 1.0, (ctx, bus, t) => S.creak(ctx, S.out(bus, 0.24), t, { f0: 340, f1: 220, Q: 8, lp: 950, dur: 0.30, rate: 3.0, rate1: 1.2, gain: 0.26 })),
                A.custom('ratchet — two detents (the hold)', 0.6, (ctx, bus, t) => S.ratchet(ctx, S.out(bus, 0.12), t, { detents: 2, dur: 0.06, end: 1.5, f: 650, hp: 2700, gain: 0.16 })),
                A.custom('shatter — breaking (skew 2.2)', 1.6, (ctx, bus, t) => S.shatter(ctx, S.out(bus, 0.44), t, { grains: 56, dur: 0.5, f0: 2700, hp: 1200, gain: 0.22 })),
                A.custom('shatter REVERSED — assembling (skew 0.35)', 1.8, (ctx, bus, t) => S.shatter(ctx, S.out(bus, 0.85), t, { grains: 76, dur: 0.62, f0: 2500, skew: 0.35, ring: 1.4, hp: 900, crack: 0, gain: 0.22 })),
                A.custom('blast — restrained, no crack (the quad)', 3.4, (ctx, bus, t) => S.blast(ctx, S.out(bus, 0.72), t, { size: 1.25, gain: 0.115, crack: 0.18, attack: 0.04, rumble: 1.35, f0: 1700, f1: 140, lp: 1300, wf0: 98 })),
                A.custom('drone — triangle, the air column', 9.0, (ctx, bus, t) => S.drone(ctx, S.out(bus, BED_SEND), t, 8.0, { f: 43.65, type: 'triangle', detune: 12, gain: 0.04, lp: 390, sub: 0.18, fade: 2.0 })),
            ],
        },

        A.section(
            'B · Each cue — dry, then in the room',
            'First without reverb, then at the distance the pack declares for it. The second reading is the design: SENDS is where this pack keeps its sense of depth, so what to listen for is not "is there reverb" but "is this thing where it should be" — hold and shift in your hands, clear and quad down and up the shaft, singularity everywhere at once.',
            dryWetItems()
        ),

        {
            title: 'C · Repetition — the chiptune test',
            note: 'The same cue over and over at play density. Nothing here is a loop or a retrigger: every play pulls its own band, length, decay and seeds from the seeded stream, so eight plays are eight sounds. shift is the one that matters most — it fires on every column of travel, thirty a second with DAS held, and any repeating tell in it becomes the sound of the game.',
            items: [
                A.custom('shift ×14 at ARR 33ms — a DAS sweep across the well', 2.0, (ctx, bus, t, r) => { for (let i = 0; i < 14; i++) A.fire(ctx, bus, 'shift', t + i * 0.033, r); }),
                A.repeat('shift', { n: 10, spacing: 0.16, label: 'shift ×10 — tapped, one column at a time' }),
                A.repeat('turn', { n: 8, spacing: 0.22, label: 'turn ×8 — plain rotation' }),
                A.repeat('lock', { n: 8, spacing: 0.62, label: 'lock ×8 — eight pieces seating' }),
                A.repeat('touch', { n: 8, spacing: 0.5, label: 'touch ×8' }),
                A.repeat('hold', { n: 8, spacing: 0.4, label: 'hold ×8' }),
                A.repeat('clear', { n: 6, spacing: 1.1, params: { count: 1 }, label: 'clear ×6 — singles, back to back' }),
            ],
        },

        {
            title: 'D · The clear, by rows',
            note: 'clear at 1, 2, 3 and 4 rows. count scales the POPULATION of shards and the spread, not the level — the question is whether four rows reads as more breakage rather than as a louder break. Then the quad as it actually fires: the shatter and the blast together, the second arriving from much further up the shaft.',
            items: [
                A.custom('clear 1 → 2 → 3 → 4', 6.0, (ctx, bus, t, r) => { [1, 2, 3, 4].forEach((c, i) => A.fire(ctx, bus, 'clear', t + i * 1.4, r, { count: c })); }),
                A.custom('a real Quad — clear(4) + quad', 4.2, (ctx, bus, t, r) => { A.fire(ctx, bus, 'clear', t, r, { count: 4 }); A.fire(ctx, bus, 'quad', t, r); }),
                A.custom('quad alone — what arrives from up the shaft', 3.6, (ctx, bus, t, r) => A.fire(ctx, bus, 'quad', t, r)),
                A.custom('a Singularity — clear(4) + quad + singularity', 5.4, (ctx, bus, t, r) => { A.fire(ctx, bus, 'clear', t, r, { count: 4 }); A.fire(ctx, bus, 'quad', t, r); A.fire(ctx, bus, 'singularity', t, r); }),
                A.custom('singularity alone — the well noticing it is empty', 4.6, (ctx, bus, t, r) => A.fire(ctx, bus, 'singularity', t, r)),
            ],
        },

        {
            title: 'E · The parameter variants',
            note: 'The differences the game encodes in a cue rather than in a second cue. Each pair alternates twice: if the two halves are indistinguishable the parameter is decoration, and if they sound like different events it has gone too far.',
            items: [
                A.custom('lock — soft · hard · soft · hard', 3.4, (ctx, bus, t, r) => { for (let i = 0; i < 2; i++) { A.fire(ctx, bus, 'lock', t + i * 1.6, r, { hard: false }); A.fire(ctx, bus, 'lock', t + i * 1.6 + 0.8, r, { hard: true }); } }),
                A.custom('turn — plain · kicked · plain · kicked', 2.2, (ctx, bus, t, r) => { for (let i = 0; i < 2; i++) { A.fire(ctx, bus, 'turn', t + i * 1.0, r, { kicked: false }); A.fire(ctx, bus, 'turn', t + i * 1.0 + 0.5, r, { kicked: true }); } }),
                A.custom('tspin — mini · full · mini · full', 3.0, (ctx, bus, t, r) => { for (let i = 0; i < 2; i++) { A.fire(ctx, bus, 'tspin', t + i * 1.4, r, { mini: true }); A.fire(ctx, bus, 'tspin', t + i * 1.4 + 0.7, r, { mini: false }); } }),
                A.custom('touch · lock — the settle, then the seat', 2.6, (ctx, bus, t, r) => { A.fire(ctx, bus, 'touch', t, r); A.fire(ctx, bus, 'lock', t + 0.5, r, { hard: false }); A.fire(ctx, bus, 'touch', t + 1.4, r); A.fire(ctx, bus, 'lock', t + 1.9, r, { hard: false }); }),
                A.custom('levelup · goal — passing, then final', 9.0, (ctx, bus, t, r) => { A.fire(ctx, bus, 'levelup', t, r); A.fire(ctx, bus, 'goal', t + 4.2, r); }),
            ],
        },

        {
            title: 'F · Scenes — as the game actually fires them',
            note: 'The real test. Timings are the game’s: lock delay is 500 ms, a hard drop locks instantly, a T-spin fires its creak under the same lock the clear comes out of. If two cues blur into one event, it happens here.',
            items: [
                // Every scene starts on its first event rather than after a
                // beat of silence: the analyser's spectral window is ~85 ms
                // from an item's start, so a scene that opens with a pause
                // measures as a pause (centroid 0 Hz, no reading at all).
                A.custom('one piece, placed', 3.0, (ctx, bus, t, r) => {
                    A.fire(ctx, bus, 'shift', t + 0.02, r);
                    A.fire(ctx, bus, 'shift', t + 0.16, r);
                    A.fire(ctx, bus, 'turn', t + 0.37, r, { kicked: false });
                    A.fire(ctx, bus, 'shift', t + 0.54, r);
                    A.fire(ctx, bus, 'touch', t + 0.87, r);
                    A.fire(ctx, bus, 'lock', t + 1.37, r, { hard: false });
                }),
                A.custom('a hard drop into a Single', 3.4, (ctx, bus, t, r) => {
                    A.fire(ctx, bus, 'shift', t + 0.08, r);
                    A.fire(ctx, bus, 'turn', t + 0.30, r, { kicked: true });
                    A.fire(ctx, bus, 'lock', t + 0.70, r, { hard: true });
                    A.fire(ctx, bus, 'clear', t + 0.72, r, { count: 1 });
                }),
                A.custom('a T-spin double', 3.8, (ctx, bus, t, r) => {
                    A.fire(ctx, bus, 'shift', t + 0.06, r);
                    A.fire(ctx, bus, 'turn', t + 0.28, r, { kicked: true });
                    A.fire(ctx, bus, 'turn', t + 0.52, r, { kicked: true });
                    A.fire(ctx, bus, 'tspin', t + 0.90, r, { mini: false });
                    A.fire(ctx, bus, 'lock', t + 0.90, r, { hard: false });
                    A.fire(ctx, bus, 'clear', t + 0.92, r, { count: 2 });
                }),
                A.custom('hold, then a quad', 5.2, (ctx, bus, t, r) => {
                    A.fire(ctx, bus, 'hold', t + 0.05, r);
                    A.fire(ctx, bus, 'shift', t + 0.35, r);
                    A.fire(ctx, bus, 'shift', t + 0.40, r);
                    A.fire(ctx, bus, 'shift', t + 0.45, r);
                    A.fire(ctx, bus, 'lock', t + 0.85, r, { hard: true });
                    A.fire(ctx, bus, 'clear', t + 0.87, r, { count: 4 });
                    A.fire(ctx, bus, 'quad', t + 0.87, r);
                    A.fire(ctx, bus, 'levelup', t + 1.20, r);
                }),
                A.custom('the last row of a Perfect Clear', 6.0, (ctx, bus, t, r) => {
                    A.fire(ctx, bus, 'shift', t + 0.06, r);
                    A.fire(ctx, bus, 'shift', t + 0.12, r);
                    A.fire(ctx, bus, 'turn', t + 0.34, r, { kicked: false });
                    A.fire(ctx, bus, 'lock', t + 0.72, r, { hard: true });
                    A.fire(ctx, bus, 'clear', t + 0.74, r, { count: 2 });
                    A.fire(ctx, bus, 'singularity', t + 0.74, r);
                }),
                A.custom('Sprint 40 — the fortieth line', 6.0, (ctx, bus, t, r) => {
                    A.fire(ctx, bus, 'lock', t + 0.10, r, { hard: true });
                    A.fire(ctx, bus, 'clear', t + 0.12, r, { count: 2 });
                    A.fire(ctx, bus, 'goal', t + 0.55, r);
                }),
                A.custom('topping out', 5.0, (ctx, bus, t, r) => {
                    A.fire(ctx, bus, 'shift', t + 0.06, r);
                    A.fire(ctx, bus, 'turn', t + 0.22, r, { kicked: true });
                    A.fire(ctx, bus, 'touch', t + 0.42, r);
                    A.fire(ctx, bus, 'lock', t + 0.72, r, { hard: false });
                    A.fire(ctx, bus, 'topout', t + 0.80, r);
                }),
            ],
        },

        {
            title: 'G · The bed — well-hum through its three bands',
            note: 'One sustained drone, retuned as the stack crosses quantised height thirds. depth does NOT move the pitch (a transposing bed is a musical event, and a 3 s crossfade would smear two pitches across it) — it moves level, opens the lowpass, and past the first band fades in a fifth above the fundamental: the shaft getting narrower. Judge whether band 0 is audible at all on small speakers, whether band 2 is oppressive rather than merely present, and whether the crossfade seams.',
            items: [
                A.custom('depth 0 — an empty well', 16.0, (ctx, bus, t, r) => A.fire(ctx, bus, 'well-hum', t, r, { dur: 15.0, depth: DEPTHS[0] })),
                A.custom('depth 0.5 — the stack at your ribs', 16.0, (ctx, bus, t, r) => A.fire(ctx, bus, 'well-hum', t, r, { dur: 15.0, depth: DEPTHS[1] })),
                A.custom('depth 1 — the well nearly full', 16.0, (ctx, bus, t, r) => A.fire(ctx, bus, 'well-hum', t, r, { dur: 15.0, depth: DEPTHS[2] })),
                A.custom('the retune — depth 0 → 1 at 6s, 3.0s crossfade', 20.0, (ctx, bus, t, r) => {
                    // Exactly what js/app/audio.js does live through handle.retune():
                    // a second instance is built and the first is faded out under
                    // it. Nothing is adjusted in place, because a sustained cue
                    // schedules its whole timeline up front.
                    const shallow = S.out(bus, BED_SEND);
                    CUES['well-hum'](ctx, shallow, t, { dur: 19.0, depth: DEPTHS[0] }, r);
                    shallow.gain.setValueAtTime(1, t + 6.0);
                    shallow.gain.exponentialRampToValueAtTime(0.0001, t + 9.0);
                    A.fire(ctx, bus, 'well-hum', t + 6.0, r, { dur: 13.0, depth: DEPTHS[2] });
                }),
                A.custom('bed + gameplay — a run getting away from you', 22.0, (ctx, bus, t, r) => {
                    A.fire(ctx, bus, 'well-hum', t, r, { dur: 21.0, depth: DEPTHS[2] });
                    // pieces arriving faster than they are being cleared
                    let at = t + 1.2;
                    for (let i = 0; i < 6; i++) {
                        A.fire(ctx, bus, 'shift', at, r);
                        A.fire(ctx, bus, 'shift', at + 0.05, r);
                        A.fire(ctx, bus, 'turn', at + 0.22, r, { kicked: i % 2 === 0 });
                        A.fire(ctx, bus, 'touch', at + 0.55, r);
                        A.fire(ctx, bus, 'lock', at + 1.05, r, { hard: i % 3 === 0 });
                        at += 1.7;
                    }
                    A.fire(ctx, bus, 'clear', t + 6.9, r, { count: 1 });
                    A.fire(ctx, bus, 'hold', t + 9.6, r);
                    A.fire(ctx, bus, 'tspin', t + 12.2, r, { mini: false });
                    A.fire(ctx, bus, 'clear', t + 12.3, r, { count: 2 });
                    A.fire(ctx, bus, 'topout', t + 16.5, r);
                }),
            ],
        },
    ];

    A.publish({ gap: GAP, tail: TAIL, sections: SECTIONS });
})(typeof window !== 'undefined' ? window : globalThis);
