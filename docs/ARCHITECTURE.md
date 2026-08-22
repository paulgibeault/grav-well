# Gravity Well — frozen module contract

**This file is the interface freeze.** Every module below is written by a
different hand, in parallel, against exactly these signatures. If you are
implementing one of them: do not change a signature here, do not add a
cross-layer import that this document does not sanction. If a signature is
genuinely wrong, say so in your report rather than "fixing" it locally —
someone else is coding against it right now.

Design source of truth: [issue #1](https://github.com/paulgibeault/grav-well/issues/1).
Fleet contract: [GAME_INTEGRATION.md](https://github.com/paulgibeault/paulgibeault.github.io/blob/main/GAME_INTEGRATION.md).

## Layer rules

```
js/core/     pure. No DOM, no window, no Arcade, no timers, no Math.random.
             Imports: other js/core/* and ./arcade-rng.js ONLY.
             Every file here must be importable by `node --test`.
js/render/   canvas drawing. Reads core state, never mutates it. No Arcade
             except settings values passed IN as plain arguments.
js/input/    DOM events → core actions. Never touches core state directly;
             calls the callbacks it is handed.
js/app/      the only layer allowed to touch `Arcade` and `document` freely.
js/main.js   boot: init → await Arcade.ready → wire everything.
```

`tests/repo-gates.test.js` enforces the `js/core/` purity rule mechanically.

## Coordinates — read this twice

The board array is **y-down**: index `0` is the TOP row of the 40-row field,
index `39` is the floor. Visible rows are `20..39`. Pieces spawn occupying
rows `18..19` (just above the visible field).

The SRS kick tables in issue #1 are published in guideline convention, which
is **+y up**. `js/core/srs.js` stores them verbatim in that form (so they can
be diffed against the spec) and negates `dy` at the moment of application.
That negation happens in exactly one place and is pinned by a test.

## js/core/constants.js

```js
export const COLS = 10;
export const ROWS = 40;              // total, including buffer
export const VISIBLE_ROWS = 20;      // rows 20..39
export const HIDDEN_ROWS = 20;
export const TYPES = ['I','O','T','S','Z','J','L'];   // index+1 === cell id
export const ID = { I:1, O:2, T:3, S:4, Z:5, J:6, L:7 };
export const GARBAGE_ID = 8;         // seeded debris in Daily Well
export const ACTIONS = {             // the whole input vocabulary
  LEFT:'LEFT', RIGHT:'RIGHT', CW:'CW', CCW:'CCW',
  SOFT:'SOFT', HARD:'HARD', HOLD:'HOLD',
};
export const TICK_MS = 1000 / 60;    // fixed simulation step
```

## js/core/board.js

A board is a `Uint8Array(COLS * ROWS)`; `0` empty, otherwise a cell id.

```js
export function createBoard()                       // → Uint8Array
export function idx(x, y)                           // → y * COLS + x
export function cellAt(board, x, y)                 // → id, 0 when out of bounds above; 1 when out of side/bottom
export function inBounds(x, y)                      // → boolean (0<=x<COLS, y<ROWS; y<0 is out)
export function collides(board, cells)              // cells: [[x,y],…] absolute → boolean
export function lockCells(board, cells, id)         // mutates board
export function fullRows(board)                     // → [rowIndex,…] ascending
export function clearRows(board, rows)              // mutates: removes rows, shifts down, → count
export function isEmpty(board)                      // → boolean (perfect-clear test)
export function highestRow(board)                   // → topmost occupied row index, or ROWS when empty
export function toStrings(board, fromRow = 0)       // → ['..XX......', …] for fixtures/debug
export function fromStrings(rows, opts)             // → board; '.' empty, any other char = filled
```

`cellAt` reporting `1` for out-of-bounds sides and floor is deliberate: it is
what makes the T-spin corner check treat walls as occupied with no special
casing at the call site.

## js/core/piece.js

```js
// A piece is a plain object: { type: 'T', rot: 0, x: 3, y: 18 }
// rot: 0 = spawn, 1 = R (CW), 2 = 180, 3 = L (CCW)
export function cellsFor(type, rot)     // → [[x,y],…] offsets inside the box
export function absoluteCells(piece)    // → [[x,y],…] board coordinates
export function spawnPiece(type)        // → piece at the spawn position
export const BOX = { I: 4, O: 2, default: 3 };
```

Rotation states are **derived** from the spawn cells by rotating the bounding
box (`CW: (x,y) → (N-1-y, x)` in y-down space), not hand-tabulated — then
pinned cell-for-cell by `tests/piece.test.js`.

## js/core/srs.js

```js
export const KICKS_JLSTZ;   // { '0>1': [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]], … }  (+y UP, verbatim from spec)
export const KICKS_I;
export function kicksFor(type, from, to)         // → [[dx,dy],…] (+y up); O → [[0,0]]
export function tryRotate(board, piece, dir)     // dir: +1 CW, -1 CCW
// → { piece: rotatedPiece, kick: [dx,dy], kickIndex: 0..4 }  or  null when every test collides
```

Resolved conventions (each pinned by a test):

- **`kick` comes back VERBATIM in +y-up form**, exactly as tabulated in
  DESIGN.md §2.4, so a reader can diff it against the spec. The returned
  `piece` already has the y-down result applied, so callers want `piece`;
  `kick` is for diagnostics. `kickIndex` is what T-spin detection needs.
- **`collides` rejects `y < 0`** — a cell above the ceiling has nowhere to be
  stored — while `cellAt` reports `0` (empty) up there. The asymmetry is
  deliberate: `cellAt`'s job is "what is in this square", `collides`'s job is
  "may the piece be here". Unreachable in normal play (spawn is row 18, with
  18 rows of headroom above it), but defined rather than accidental.
- **`kicksFor` throws `RangeError` on a non-quarter turn** (`'0>2'`). v1 has
  no 180° input; when one arrives it needs a real table, and a throw makes
  that obvious instead of silently rotating with no kicks.
- **`fromStrings(rows, { fromRow, id })` bottom-aligns by default**, so a
  3-row fixture is rows 37–39 and reads like the bottom of the well. It
  throws on a row that is not exactly `COLS` wide — a mistyped fixture should
  fail at the typo, not three assertions later.

## js/core/bag.js

```js
export function createBag(rng)   // rng from makeRng() in ../arcade-rng.js
// → { next(): type, peek(n): [type,…], getState(): {rng, queue}, setState(s) }
```

7-bag: shuffle all seven, deal in order, refill when empty. `peek(n)` must
refill lazily so a 5-deep preview spanning a bag boundary works.

## js/core/gravity.js

```js
export const LOCK_DELAY_MS = 500;
export const MAX_LOCK_RESETS = 15;
export const MAX_G = 20;                // rows per tick at the 20G floor
export function fallIntervalMs(level)   // guideline curve: (0.8 - (n-1)*0.007)^(n-1) seconds
export function levelFor(lines)         // 1 + floor(lines / 10)
```

**Gravity above 1G is real, and this is the trap.** `1G` is one row per tick;
`20G` is TWENTY rows per tick. An earlier draft of this contract floored the
interval at `TICK_MS` and called that 20G — it is 1G, and it quietly capped a
game that advertises faithfulness, making levels 14 and 15 identical (the
curve crosses one-row-per-tick at level 14).

So: `fallIntervalMs` floors at `TICK_MS / MAX_G` (0.833 ms) — the actual 20G
— and every level 1..15 in DESIGN.md §2.6 is therefore observable directly
through it. The curve reaches true 20G on its own at **level 19**, which is
where a guideline stacker should reach it.

The corollary binds `js/core/game.js`: when the interval is shorter than a
tick, one tick drops **several rows**, so gravity is `floor(accumulated /
interval)` rows per tick and not a boolean "did it move". Cap the per-tick row
count at `MAX_G` so a pathological interval cannot spin.

## js/core/tspin.js

```js
export function detectTSpin(board, piece, kickIndex)   // → 'none' | 'mini' | 'full'
```

3-corner rule. `kickIndex === 4` (the TST kick) upgrades a mini to full.
Only applies when `piece.type === 'T'`; the caller is responsible for the
"last maneuver was a rotation" half of the rule and passes `kickIndex = -1`
when the last action was not a rotation.

## js/core/score.js

```js
export function scoreLock({ lines, tspin, perfectClear, level, combo, b2b })
// → { points, b2b: nextB2bFlag, label: 'QUAD' | 'T-SPIN DOUBLE' | … | null }
export function dropPoints(rows, kind)    // kind: 'soft' | 'hard' → flat points, level-independent
```

`scoreLock` returns the next B2B flag but deliberately NOT a next combo: the
caller owns the combo counter, and the `combo` passed IN is the count of
*prior* consecutive clearing locks (so the first clear of a chain adds 0).
The asymmetry is real — B2B has a rule the score function can evaluate alone,
a combo is just a caller-side tally.

Values are exactly the table in issue #1 §2.9. B2B multiplies the clear award
by 1.5 and applies to Quads and any T-spin **clear**; a plain Single/Double/
Triple breaks it; a no-line T-spin neither breaks nor extends it.

## js/core/game.js — the keystone

```js
export function createGame(opts)
// opts: { seed, mode = 'marathon', settings = {}, garbageRows = 0, goalLines, timeLimitMs }
// settings: { das = 167, arr = 33, sdf = 20, ghost = true, lockdown = 'extended' }

export function press(g, action)      // ACTIONS.*  — idempotent while held
export function release(g, action)
export function update(g, dtMs)       // accumulates and runs whole TICK_MS steps
export function reset(g)              // same seed, fresh run

export function serialize(g)          // → JSON-safe plain object (includes rng state)
export function deserialize(obj)      // → game state; deserialize(serialize(g)) is exact
```

State object (read by render/app; **never mutated outside core**):

```js
{
  mode, phase: 'playing'|'paused'|'over'|'won',
  board, active: piece|null, ghostY: number, hold: type|null, holdUsed: bool,
  queue: [type × 5],
  score, lines, level, combo, b2b, tick, elapsedMs,
  goalLines, timeLimitMs, topOutReason: 'block'|'lock'|null,
  stats: { pieces, quads, tspins, perfectClears, maxCombo, holds },
  events: [ … ],        // drained by the caller each frame
  settings, seed,
}
```

Emitted events (append-only per tick). **Two consumers, one drain:** the app
layer hands the frame's events to the audio layer AND the renderer, then
clears the array itself — neither consumer may clear it, or the other one
silently stops receiving events. The order is fixed:

```js
audio.consume(g);            // cues + bed policy
renderer.notify(g.events);   // line-clear FX, landing flashes
g.events.length = 0;         // the app owns the drain
```


```js
{ type:'move' }                              { type:'rotate', kickIndex }
{ type:'lock', tspin, cells }                { type:'hold' }
{ type:'clear', rows:[…], count, label, points, b2b, combo, perfectClear }
{ type:'levelup', level }                    { type:'softdrop', rows }
{ type:'harddrop', rows }                    { type:'topout', reason }
{ type:'goal' }                              // Sprint goal met / Ultra time up
```

DAS/ARR/soft-drop repeat live **inside** core (they are game feel, and feel is
testable): `press(LEFT)` starts the DAS timer, `update` converts held time
into discrete cell moves. The input layer only translates devices into
`press`/`release`.

## js/render/*

```js
// js/render/index.js
export function createRenderer(canvases, opts)
// canvases: { well, hold, next }
// opts: { theme, fontScale, reducedMotion, powerSaver }   ← plain values, not Arcade
// → { draw(g), notify(events), resize(), setOpts(partial), dispose() }
```

Layer discipline (§6d): a cached background, an offscreen locked-cell layer
redrawn only on lock/clear, active piece + ghost per frame, an FX layer that
runs only while an effect is alive. `draw(g)` must be safe to call for a
single `kick()` frame with nothing animating.

## js/input/*

```js
// js/input/keyboard.js
export function attachKeyboard(target, handlers, keymap)
// handlers: { press(action), release(action), pause(), retry() }
// → detach()

// js/input/touch.js
export function attachTouch(root, handlers, opts)   // opts: { handedness, scheme }
// → { detach(), setOpts(partial) }
```

Neither module imports `js/core/game.js`. They speak `ACTIONS`, plus `COLS`
(touch only, to turn surface width into a cell width) and a `COMMANDS`
vocabulary of their own for PAUSE/RETRY — those are app-layer concerns and
must never reach core's `press()`.

`attachTouch`'s `opts` also accepts an optional `cellPx`; the renderer knows
the true cell size, and without it touch measures the surface itself.

**Gestures are the primary scheme** (decided 2026-08-22; DESIGN.md §4). A
horizontal drag is POSITIONAL — the piece tracks the finger via
`Math.round(dx / cell)` — which means a single frame can deliver several
complete `press`/`release` pairs. `js/core/game.js` must apply each one, and
must apply the first shift synchronously inside `press()`. Coalescing them
per tick loses cells on a fast drag and presents as input latency rather than
as a bug.

## js/app/*

The only layer that may touch `Arcade`. `js/app/store.js` owns every
`Arcade.state` key (schema in issue #1 §8); nothing else calls
`Arcade.state.*`. `js/app/audio.js` owns every `Arcade.audio` call and
consumes `g.events`. `js/app/modes.js` owns mode configuration.
