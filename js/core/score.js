/* Scoring — the §2.9 table, Back-to-Back, combo and drop points.
 *
 * PURE by contract (tests/repo-gates.test.js enforces it): no DOM, no window,
 * no Arcade, no timers, no Math.random. See docs/ARCHITECTURE.md.
 *
 * scoreLock resolves one lock in isolation. It does not remember anything:
 * game.js hands it the running `combo` and `b2b` and stores the `b2b` it
 * gets back, which keeps the whole table diffable against the spec and the
 * reducer replayable.
 *
 * LABEL VOCABULARY — js/render/* and js/app/audio.js both switch on this
 * string, so it is part of the contract, not decoration:
 *
 *   null                    an unremarkable lock (no clear, no T-spin)
 *   'SINGLE' 'DOUBLE' 'TRIPLE' 'QUAD'
 *   'T-SPIN'                a full T-spin that cleared nothing
 *   'T-SPIN SINGLE' 'T-SPIN DOUBLE' 'T-SPIN TRIPLE'
 *   'MINI T-SPIN'           a mini that cleared nothing
 *   'MINI T-SPIN SINGLE' 'MINI T-SPIN DOUBLE'
 *
 * with two affixes, either or both: a 'B2B ' prefix when the x1.5 actually
 * fired, and a ' PERFECT CLEAR' suffix when the well was emptied. So the
 * fattest label in the game is 'B2B QUAD PERFECT CLEAR'. Consumers that only
 * care about a family should test `startsWith`/`includes` rather than
 * enumerating all 30-odd combinations.
 */

// Award = table value x level (§2.9). Indexed by lines cleared.
const CLEAR = [0, 100, 300, 500, 800];
const TSPIN_MINI = [100, 200, 400];
const TSPIN_FULL = [400, 800, 1200, 1600];
const PERFECT = [0, 800, 1200, 1800, 2000];
const PERFECT_B2B_QUAD = 3200;      // replaces 2000, does not stack with it

const B2B_MULT = 1.5;
const COMBO_UNIT = 50;
const SOFT_DROP_POINTS = 1;
const HARD_DROP_POINTS = 2;

const NAMES = [null, 'SINGLE', 'DOUBLE', 'TRIPLE', 'QUAD'];

export function scoreLock(opts) {
    const o = opts || {};
    const lines = clampLines(o.lines);
    const level = Math.max(1, Math.floor(Number(o.level) || 1));
    // `combo` is the count of consecutive PRIOR clearing locks, so the first
    // clear of a chain is worth nothing and the second is worth 50 x level.
    const combo = Math.max(0, Math.floor(Number(o.combo) || 0));
    const hadB2b = !!o.b2b;
    const perfect = !!o.perfectClear && lines > 0;

    // A T-spin cannot clear four rows and a Mini cannot clear three. Normalise
    // those impossible pairings once, here, so the award and the label can
    // never disagree about what the player just did.
    let kind = (o.tspin === 'mini' || o.tspin === 'full') ? o.tspin : 'none';
    if (kind !== 'none' && lines === 4) kind = 'none';
    if (kind === 'mini' && lines === 3) kind = 'full';

    // B2B rides Quads and T-spin CLEARS. A T-spin that clears nothing is
    // inert — it neither extends the chain nor breaks it — and so is a lock
    // with no clear at all; only a plain Single/Double/Triple breaks it.
    const chains = lines > 0 && (kind !== 'none' || lines === 4);
    const multiplied = chains && hadB2b;
    const nextB2b = lines === 0 ? hadB2b : chains;

    const clearPoints = baseAward(lines, kind) * level * (multiplied ? B2B_MULT : 1);
    const perfectPoints = perfect ? perfectAward(lines, hadB2b) * level : 0;
    const comboPoints = COMBO_UNIT * combo * level;

    // Floor AFTER the x1.5, deliberately: the guideline's B2B bonus is a
    // multiplier on the award, not a separate term, and half a point is
    // dropped rather than rounded up so no lock can ever out-score its own
    // table row. (Every table value is even, so this only ever bites on
    // binary float dust — which is precisely why it is a floor and not a
    // `Math.round` that could quietly hand out a phantom point.)
    const points = Math.floor(clearPoints + perfectPoints + comboPoints);

    return { points, b2b: nextB2b, label: labelFor(lines, kind, multiplied, perfect) };
}

// Rows travelled, flat — NOT multiplied by level. This is the one award in
// the game a level-15 player earns at the same rate as a level-1 player.
export function dropPoints(rows, kind) {
    const n = Math.max(0, Math.floor(Number(rows) || 0));
    if (kind === 'hard') return n * HARD_DROP_POINTS;
    if (kind === 'soft') return n * SOFT_DROP_POINTS;
    return 0;
}

function clampLines(n) {
    const v = Math.floor(Number(n) || 0);
    if (v < 0) return 0;
    return v > 4 ? 4 : v;
}

function baseAward(lines, kind) {
    if (kind === 'mini') return TSPIN_MINI[lines];
    if (kind === 'full') return TSPIN_FULL[lines];
    return CLEAR[lines];
}

// The perfect-clear award is IN ADDITION to the line-clear award, and the
// B2B Quad row is a replacement value rather than a x1.5 on 2000.
function perfectAward(lines, hadB2b) {
    if (lines === 4 && hadB2b) return PERFECT_B2B_QUAD;
    return PERFECT[lines];
}

function labelFor(lines, kind, multiplied, perfect) {
    if (lines === 0 && kind === 'none') return null;
    let s = kind === 'mini' ? 'MINI T-SPIN' : kind === 'full' ? 'T-SPIN' : '';
    if (lines > 0) s = s ? s + ' ' + NAMES[lines] : NAMES[lines];
    if (multiplied) s = 'B2B ' + s;
    if (perfect) s += ' PERFECT CLEAR';
    return s;
}
