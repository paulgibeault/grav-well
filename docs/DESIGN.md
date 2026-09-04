<!-- The v1 design. Issue #1 holds the original; THIS copy carries amendments
     as they are decided, so the code and its spec travel together. Amendments
     are recorded as comments on issue #1 with their rationale.

     Amended 2026-08-22: §4 rewritten gesture-first, with phone/laptop parity
     as an acceptance criterion (issue #1 open question 3, resolved).

     Amended 2026-08-22 (playtest): Marathon has NO line goal — it is the
     standard endless game. §2.6 and §3 updated; open question 3 (the Endless
     cap) resolved and moved down to Resolved, and the deferred-toggle note it
     hung off is gone with it. -->

# Gravity Well — design document

**A faithful falling-block stacker for [Paul's Arcade](https://paulgibeault.github.io/).**
`gameId: grav-well` · repo: `paulgibeault/grav-well` · target URL: `https://paulgibeault.github.io/grav-well/`

> *The playfield in a falling-block game has been called **the well** since the genre began. Ours has gravity. All's well that lands well.*

This document is the v1 design, written against the fleet's
[GAME_INTEGRATION.md](https://github.com/paulgibeault/paulgibeault.github.io/blob/main/GAME_INTEGRATION.md)
(SDK major v3). §-references below point at that file. It is comprehensive on
purpose: the mechanical spec in §2 is the part every clone gets subtly wrong,
so it is written down to the kick table.

---

## 1. Concept & positioning

**What it is.** A faithful *modern-guideline* falling-block stacker: 7-bag
randomizer, SRS rotation with full wall kicks, hold, ghost piece, soft/hard
drop, lock-delay with move reset, T-spins, back-to-back, combos, perfect
clears. The feel players know from any current-generation stacker — no
surprises, no house rules in the core.

**What it is not.** Not the NES/classic ruleset (no spawn-orientation
randomizer quirks, no DAS charge carry), and not a variant-mechanics remix.
Faithfulness *is* the design. Original expression everywhere else: name, art,
sound, and copy are ours.

**Naming & IP hygiene.** Game mechanics are not protectable; names, logos and
trade dress are — and the rights holder for the famous one polices hard,
including `-tris`-suffixed names. So: the game is **Gravity Well** — display
name; the repo slug and `gameId` are `grav-well`, and per §1 of the guide the
catalog `id` must match the slug (fleet precedent: `si-syn` ↔ *Silicon
Syndicate*). Pieces are called **tetrominoes** (the generic mathematical
term, not the trademarked
spelling), a 4-line clear is a **Quad**, and the word Tetris appears nowhere in
the shipped product — not in UI copy, file names, or the catalog entry. This
document may name it; the game never does. Standard piece hues (see §5 below)
are genre-wide convention used by every open clone and stay, with our own
rendering treatment.

**Theme.** A deep well of stars. Blocks are salvage sinking into a gravity
well; the stack glows faintly against the dark; a line clear collapses with a
gravitational shimmer; a perfect clear is a **Singularity**. Tone matches the
fleet: restrained, atmospheric, negative space — tension from depth, not from
screen shake.

**Fleet fit.** Nine catalog games, no falling-block game — this fills the most
canonical gap in any arcade. Sibling precedent followed throughout: `moon-lit`
for canvas + soundpack + power-saver posture, `sowduku`/`cardstock` for SDK
storage discipline.

### Catalog entry (draft — the §1 registration PR)

```json
{
  "id": "grav-well",
  "name": "Gravity Well",
  "subtitle": "Falling Blocks",
  "icon": "/grav-well/icon.png",
  "url": "/grav-well/",
  "inDevelopment": true,
  "profile": {
    "subtitle": "A Faithful Falling-Block Stacker",
    "alt": "Gravity Well — glowing tetromino blocks sinking into a starlit stone well",
    "descLead": "The well is deep. Keep it clear.",
    "descBody": "A faithful modern stacker: 7-bag randomizer, SRS wall kicks, hold, ghost piece, T-spins, back-to-back and combo scoring. Marathon, Sprint 40, Ultra, Zen, and a shared Daily Well dig on the same seed for everyone.",
    "kicker": "All's well that lands well.",
    "tags": ["HTML5 Canvas", "JS", "ES Modules", "PWA", "Arcade SDK"],
    "codeUrl": "https://github.com/paulgibeault/grav-well"
  }
}
```

Ships with `"inDevelopment": true` at first registration (the guide's honest
early-ship ribbon) and drops the flag at M3. **Icon art direction:** square
≥ 512 px, served from this repo's root — looking straight down (or up) a
stone-ringed well at a starfield, one glowing T-piece mid-fall. Must read at
tile size; matches the `alt` text.

---

## 2. The faithful core — mechanical specification

The reference behavior is the modern guideline as implemented by
current-generation stackers. Everything in this section is pure logic
(`js/core/`), DOM-free, deterministic, and pinned by unit tests.

### 2.1 Playfield

- Grid **10 columns × 40 rows**; rows 1–20 visible, 21–40 hidden buffer above.
- The **skyline**: pieces spawn in rows 21–22 (just above the visible field),
  horizontally centered, rounding left — J/L/S/T/Z occupy columns 4–6, I
  occupies 4–7, O occupies 5–6 (1-indexed). Spawn orientation: flat side down.
- A spawned piece is immediately subject to gravity (falls on its first tick
  if unobstructed).

### 2.2 The seven tetrominoes

| Piece | Cells (spawn) | Hue (both themes) |
| --- | --- | --- |
| I | 4-in-a-row | cyan |
| O | 2×2 | yellow |
| T | T | purple |
| S | S | green |
| Z | Z | red |
| J | J | blue |
| L | L | orange |

An **accessibility glyph mode** (settings toggle, Settings → Feel → *Piece
glyphs*) stamps each piece with a distinct engraved rune so color is never the
only channel.

**The rune is the piece's own letter.** The seven pieces have been named after
the shapes of letters for forty years, so the mark a player has to learn is one
they already know — and unlike an arbitrary rune set, seven letters are
guaranteed distinct from each other at a glance. I is drawn as a bar rather
than a serif "I", because a bare vertical stroke at 24 px is indistinguishable
from noise. It is cut into the block rather than painted on it: a dark pass in
the groove and a light pass for the lip, offset toward the same corner the
block's own top band is lit from.

Garbage carries no glyph — it is not a piece, and stamping it with a letter
would be a lie about where it came from. Below 11 px a cell the mark is skipped
entirely, because a groove thinner than the stroke that draws it reads as dirt;
at that size the piece's whole *shape* is visible anyway, which is the same
information the glyph is carrying.

### 2.3 Randomizer — 7-bag

All seven pieces shuffled as a bag, dealt in order, bag refilled when empty.
Shuffle uses the fleet PRNG (§7c of the guide): the vendored, byte-identical
`js/arcade-rng.js` companion (`makeRng(seed)` → `rng.shuffle(bag)`), so bags
are reproducible from one u32 seed and the algorithm is pinned by the
known-answer vectors the guide publishes (`makeRng(42)` →
`0.6011037519201636, …`). Casual runs seed from entropy; Daily Well seeds from
`dailySeed('grav-well')` (device-local calendar day, per the platform
rule).

### 2.4 Rotation — SRS with full kick tables

Rotation states: `0` (spawn), `R` (CW), `2` (180°), `L` (CCW). On a rotation
input the piece tries the 5 offsets for that transition in order; the first
non-colliding placement wins, else the rotation fails (no state change).
Offsets below in guideline convention, **(x, y) with +y up** (the
implementation's y-down mirror is pinned against these exact tables in tests).

**J, L, S, T, Z:**

| Transition | Test 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- |
| 0→R | (0,0) | (−1,0) | (−1,+1) | (0,−2) | (−1,−2) |
| R→0 | (0,0) | (+1,0) | (+1,−1) | (0,+2) | (+1,+2) |
| R→2 | (0,0) | (+1,0) | (+1,−1) | (0,+2) | (+1,+2) |
| 2→R | (0,0) | (−1,0) | (−1,+1) | (0,−2) | (−1,−2) |
| 2→L | (0,0) | (+1,0) | (+1,+1) | (0,−2) | (+1,−2) |
| L→2 | (0,0) | (−1,0) | (−1,−1) | (0,+2) | (−1,+2) |
| L→0 | (0,0) | (−1,0) | (−1,−1) | (0,+2) | (−1,+2) |
| 0→L | (0,0) | (+1,0) | (+1,+1) | (0,−2) | (+1,−2) |

**I:**

| Transition | Test 1 | 2 | 3 | 4 | 5 |
| --- | --- | --- | --- | --- | --- |
| 0→R | (0,0) | (−2,0) | (+1,0) | (−2,−1) | (+1,+2) |
| R→0 | (0,0) | (+2,0) | (−1,0) | (+2,+1) | (−1,−2) |
| R→2 | (0,0) | (−1,0) | (+2,0) | (−1,+2) | (+2,−1) |
| 2→R | (0,0) | (+1,0) | (−2,0) | (+1,−2) | (−2,+1) |
| 2→L | (0,0) | (+2,0) | (−1,0) | (+2,+1) | (−1,−2) |
| L→2 | (0,0) | (−2,0) | (+1,0) | (−2,−1) | (+1,+2) |
| L→0 | (0,0) | (+1,0) | (−2,0) | (+1,−2) | (−2,+1) |
| 0→L | (0,0) | (−1,0) | (+2,0) | (−1,+2) | (+2,−1) |

**O:** rotates in place (identity, no kicks, always succeeds).

No 180° rotation input in v1 — classic SRS has none and faithfulness wins;
it's listed under Future (§12) as an off-by-default option.

### 2.5 Hold, next queue, ghost

- **Hold** (once per piece): swaps active ↔ held, held piece re-enters in
  spawn orientation at the spawn position; re-enabled when a piece locks.
- **Next queue:** 5 previews.
- **Ghost piece:** rendered at the hard-drop landing position; toggleable.

### 2.6 Gravity & levels

Fall speed follows the guideline curve — seconds per row at level *n*:

```
t(n) = (0.8 − (n − 1) × 0.007) ^ (n − 1)
```

| Level | 1 | 2 | 3 | 5 | 8 | 10 | 12 | 15 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| s/row | 1.000 | 0.793 | 0.618 | 0.355 | 0.135 | 0.064 | 0.028 | 0.007 |

- Level advances every **10 lines** (fixed goal), **and never stops**.
  Marathon has no line goal: the level keeps climbing until the player tops
  out, which is what makes it the standard endless game (§3). Level 15 is not
  a finish line, just the last level the table above bothers to print.
- **Past level 19 every level is the same speed**, because the curve has
  already reached the 20G floor and there is nowhere further down to go. That
  is a clamp on the *level*, not on the result: the raw curve's base
  `0.8 − (n−1)×0.007` goes negative at level 115 and passes −1 at level 259,
  after which `base^(n−1)` explodes — negative on odd exponents (which a
  floor comparison catches) and **positive on even ones** (which it does not).
  Left unclamped, level 259 computes 4.7 seconds per row and level 1001
  overflows to `Infinity`: gravity getting slower the longer you survive, and
  finally a piece that never falls. Only the parity of the player's level
  stood between a three-hour well and a frozen one.
- **Gravity above 1G is real.** `1G` is one row per tick; `20G` is twenty rows
  per tick. The curve crosses 1G at level **14**, so from there a single tick
  drops several rows — `floor(accumulated / interval)`, capped at 20 — and the
  interval floors at `TICK_MS / 20` (0.833 ms), which the curve reaches on its
  own at level **19**. Flooring at one row per tick instead would cap the game
  at 1G and make levels 14 and 15 identical; an early draft of the contract did
  exactly that, which is why it is spelled out here.
- **Soft drop:** 20× current gravity by default (SDF configurable, up to
  instant). **Hard drop:** teleports to the ghost position and locks
  immediately.

### 2.7 Lock delay — Extended Placement

- A piece resting on a surface locks after **500 ms**.
- Any successful move or rotate resets the timer — up to **15 resets**;
  once spent, moves still work but the timer keeps running out.
- Falling to a **new lowest row** restores the 15-reset budget.
- Hard drop ignores all of this (locks instantly).

### 2.8 Movement tuning — DAS / ARR

Own key-repeat implementation (never OS auto-repeat):

| Parameter | Default | Range |
| --- | --- | --- |
| DAS (delay before auto-shift) | 167 ms | 67–333 ms |
| ARR (auto-repeat rate) | 33 ms/cell | 0 (instant) – 83 ms |
| SDF (soft-drop factor) | 20× | 5× – instant |

All three are player-configurable in settings — modern stackers made tuning
these table stakes, and they cost nothing to expose.

### 2.9 Line clears, T-spins & scoring

Award = table value × level (drops are flat, not level-multiplied):

| Action | Award |
| --- | --- |
| Single / Double / Triple | 100 / 300 / 500 |
| **Quad** (4 lines) | 800 |
| Mini T-Spin (no lines) / Mini T-Spin Single / Mini T-Spin Double | 100 / 200 / 400 |
| T-Spin (no lines) / Single / Double / Triple | 400 / 800 / 1200 / 1600 |
| Perfect clear: Single / Double / Triple / Quad / B2B Quad | 800 / 1200 / 1800 / 2000 / 3200 |
| Back-to-Back (Quads & T-Spin clears chained, breaks only on a plain clear) | ×1.5 on the clear award |
| Combo (consecutive clearing locks) | +50 × combo count × level |
| Soft drop / hard drop | +1 / +2 per row (flat) |

**T-spin detection — 3-corner rule.** A lock is a T-Spin when (a) the piece is
a T, (b) its **last successful maneuver was a rotation**, and (c) at least 3
of the 4 cells diagonal to the T's center are occupied (walls and floor
count). It is a **full** T-Spin if both corners on the T's pointing side are
occupied; otherwise **Mini** — upgraded to full when the rotation used the
table's last kick (the (±1, ∓2) "TST" kick). In-theme flavor text only; the
mechanic keeps its genre-standard name in UI so players recognize it.

### 2.10 Top-out

- **Block Out:** a piece cannot spawn without overlap → game over.
- **Lock Out:** a piece locks entirely above the visible field → game over.
- Zen mode softens both (see §3).

### 2.11 Timing model & determinism

Fixed-timestep simulation at **60 logic ticks/s**, accumulated from
`Arcade.loop` deltas (render decoupled; cell-snapped movement, so no
interpolation needed). All randomness flows from one seeded `makeRng`
instance whose state (`getState`/`setState`) serializes with the run. Inputs
are reduced to `(tick, action)` events — the whole game is
`nextState = reduce(state, event)`, which buys three things: mid-run
suspend/restore is exact (§6b of the guide), a run is replayable from its
seed + input log, and the entire core is unit-testable under `node --test`.

---

## 3. Modes

*Amended 2026-09-01.* The escalating standard game is now called **Arcade**,
and **Marathon** is the level-pinned mode. Nothing about the escalating game's
rules moved — only its name, because "Marathon" was needed for the mode that
actually lets you run one. The two ask different questions: Arcade asks how
fast you can still think, Marathon asks how long you can keep it up, and the
second needs a level that stops moving.

| Mode | Rules | Persistence |
| --- | --- | --- |
| **Arcade** | **The standard endless game, and the default mode.** No line goal and no finish line: levels advance every 10 lines forever, gravity rides the §2.6 curve down to true 20G at level 19 and stays there, and the run ends when the well tops out. (It shipped as levels 1–15 / 150 lines with a deferred "Endless" toggle; the playtest verdict was that the standard game *is* the endless one, so the goal came out and the toggle was never revived — there is no setting, because there is nothing left to switch.) | leaderboard `arcade`, record `arcade-score`, resumable run snapshot |
| **Marathon** | **Pin the level and hold it.** The player picks a level 1–19 on the menu row; the run *starts* there and never advances — `levelFor()` is not consulted and no `levelup` is ever emitted. Gravity and the §2.9 score multiplier both take the pinned level, so a level-9 pin scores like level 9 from its first line. 19 is the top of the range because §2.6 has already bottomed out on the 20G floor by then, so every level above it is the same game at the same speed. Ends on a top-out like any other run. | leaderboard `marathon` **keyed by level** (`L8`), record `marathon-l<n>` created lazily per level, resumable run snapshot |
| **Sprint 40** | Clear 40 lines fastest. Instant retry on `R`. | record `sprint-40` (`duration-ms`, lower-is-better) |
| **Ultra** | 3:00 on the clock, max score. | leaderboard `ultra`, record `ultra-score` |
| **Zen** | Level-1 gravity forever, no top-out (an overflowing well gently sinks the bottom rows away), untimed. | lines/session stats only, resumable |
| **Daily Well** | One shared seed per device-local day: the well starts with 8 rows of seeded debris — dig it clear, fastest time. Same debris, same bag stream, for every player. Note `Arcade.daily.seed()` returns a seeded **generator**, not a seed value — take `.getState()` for a number, or the whole run collapses to one constant seed for every player on every day. | leaderboard `daily` keyed by `dateStr` (`order: 'asc'`), streak in stats |

Every mode keeps its own resumable snapshot (fleet convention — switching
modes never costs progress).

**Why the Marathon board is keyed by level.** A table mixing level-2 runs with
level-15 runs is not a leaderboard, it is a pile — the same problem the Daily
Well solves by keying on the day, solved the same way. The personal record is
per level too, and a category is only created the first time that level is
played, so a player who lives at level 8 carries one record rather than
nineteen. Arcade keeps its own flat board and never shares one with a pinned
run, which is the whole reason the two modes are separately named.

**The legacy `marathon` / `marathon-score` categories are not reused by
Arcade.** They hold scores set under the old name and the SDK has no rename;
pointing Arcade at them would mix escalating runs into the pinned board
forever. Old records stay visible in the launcher's Records sheet under the
label they were written with, and nothing is destroyed. A snapshot bump
(`SNAPSHOT_VERSION` 1 → 2) retires stored mid-run Marathon saves for the same
reason: every one of them predates the mode meaning something different.

---

## 4. Controls

**One input model, both platforms.** Keyboard and pointer gestures are attached
**simultaneously and always** — there is no device detection and no mode where
one of them is off. A laptop with a touchscreen and a phone with a Bluetooth
keyboard both exist, so capability is never inferred from form factor.
Gestures run on **Pointer Events**, which means the same handler serves phone
touch, stylus, and laptop trackpad/mouse with no branch.

**Keyboard (remappable, keyed on `event.code` so AZERTY and Dvorak work):**
←/→ move (DAS/ARR) · ↓ soft drop · Space hard drop · ↑ or X rotate CW ·
Z or Ctrl rotate CCW · C or Shift hold · P/Esc pause · R retry (instant in
Sprint/Ultra, hold-to-confirm elsewhere). OS key auto-repeat is dropped on the
floor — `event.repeat` events never reach the game, or the operating system's
repeat rate silently overrides the tuned DAS/ARR differently on every machine.

**Gestures — the primary scheme.** Over the playfield:

| Gesture | Action |
| --- | --- |
| Horizontal drag | Move. **Positional, not repeat-based** — the piece tracks the finger cell-for-cell from cumulative displacement off the pointer-down origin, carrying the remainder so a slow drag never drops a cell. |
| Tap | Rotate — CW by default, CCW if the player flips `tapRotate` (§8) |
| Two-finger tap | Rotate the OTHER way, always: the pair is derived from one setting, never stored as two, so the two gestures can never end up agreeing |
| Flick down | Hard drop. Judged ONCE, at lift, from the PEAK downward speed over the last 120 ms rather than a smoothed average — a 100 ms gesture cannot charge an average, which is why the first cut of this shipped effectively unreachable. |
| Long drag down | Hard drop as well, past ~4 cells, at any speed: nothing else a gesture that long could mean, and losing it to soft-drop-only was half the complaint. Reading the displacement AT LIFT means pulling back up past the soft-drop release point still cancels it. |
| Short drag down | Soft drop (held until the gesture ends or reverses) |
| Swipe up | Hold |

The whole difficulty is disambiguation — tap vs drag vs flick, and never
firing a rotate at the end of a drag. A per-pointer state machine commits to
an axis once a threshold is crossed, and a pointer-up counts as a tap only if
no axis was ever committed. Thresholds scale with cell size rather than being
fixed pixel counts, so the feel holds from a phone to a hidpi laptop.

Three details decide whether this works on a real phone at all:
`touch-action: none` on the gesture surface (otherwise the browser takes every
drag for scroll or pull-to-refresh), `setPointerCapture` so a drag that leaves
the canvas keeps tracking, and treating `pointercancel` as a full abort that
releases every held action (a missed one leaves soft drop stuck down).

**Tap rotation direction is a setting** (`tapRotate`, §8), added 2026-08-22
after a playtest: rotation "seems backwards to what I expect". The core is
correct — a T spawns nub-up and a CW turn puts the nub right — so this is
preference, not a bug, and the answer is to let the player choose rather than
to move the ruleset. Default `'cw'`, which is what shipped, so no existing
player's muscle memory changes without them asking. The KEYBOARD is untouched:
↑/X = CW and Z/Ctrl = CCW is the genre standard and is already remappable; a
tap is the gesture with no label on it, which is why it is the one that needs
the toggle.

**Flick sensitivity is a setting**, stored as one multiplier over the module's
defaults (`settings.flick`, §8) and scaling all three flick thresholds
together. How hard a flick has to be is a property of a thumb and a screen, not
of the game, and it shipped wrong once; the raw thresholds are also settable
through `attachTouch`'s opts so a device can be bisected without a build.

**Button cluster — the secondary scheme.** Real `<button>` elements with
aria-labels, selectable in settings: an accessibility path for players who
can't do precision gestures, and a fallback if a gesture scheme fights a
particular browser. Anchored per `Arcade.settings.handedness()`
(`data-handedness` mirrors it).

The cluster is **glass over the playfield, not a dock under it** — changed
2026-09-03 after a playtest on a small iPhone: "when using the on screen
buttons on a smaller iphone, this becomes rather unusable." It shipped in the
column flow, taking real space so it could never cover the well, and measured
on a 375x667 phone that cost 112px out of a 591px column. The well came out
176x352 — a 17.6px cell, four fifths of what the gesture scheme gets on the
same handset — so the players who most need this scheme were the ones playing
the smallest board. Overlaid it is 27.2px, and the trade holds because:

- The layer is mostly hole. `#touch` and `.touch-cluster` take no pointer
  events; only the buttons do, so the well is untouched everywhere a button
  isn't.
- A button is a ring and a glyph over a wash, not a plate — the stack reads
  through it. The opacity budget goes on the PRESS instead, which floods the
  button; that is the moment feedback is worth anything.
- The well still steps back by `--touch-reserve` (~40% of the pad band) so the
  rows actually being placed into stay above the glass. That variable, the
  button size and the gap are the whole ergonomic trade and they live together
  at the top of `css/well.css` to be retuned against a real thumb.

Size floor is unchanged and non-negotiable: never below 44 CSS px, larger when
the player has scaled type up (`--touch-btn` is a rem clamp), and 44px flat on
a landscape phone where there is no height to spend.

**Gamepad:** M4 (the launcher's iframe `allow` already includes `gamepad`).

### Layout — phone and laptop are both first-class

Not "responsive" as an afterthought; an acceptance criterion:

- **Phone portrait** — the well is the hero and stays fully visible with no
  page scroll; hold/next/readout reflow from side rails into a compact strip.
  The strip **never wraps**: it shipped with `flex-wrap: wrap`, and at 375px
  the readout dropped to a second line and the strip went from ~50px to 178px
  — 27% of the screen on four numbers, all of it off the well. It is now one
  row of bare canvases and a readout laid out as columns of label-over-value
  pairs, folded two pairs to a column, so a seven-figure score and a live
  combo still fit at 320px. The combo adds a COLUMN, never a row, so the
  strip's height cannot change mid-chain. Below 8px a preview stops being a
  piece, so the next queue shows **as many previews as fit at a legible size**
  rather than always five — three in the phone strip, five in the side rail.
- **Phone landscape** — the short-viewport case a naive height rule breaks.
  Short-and-wide takes the SIDE-RAIL layout, not the strip: the 46em
  breakpoint assumed every landscape phone was that wide and a 667x375 SE is
  not, so it kept the strip and came out at an 11px cell. The second clause is
  `(min-width: 30em) and (max-height: 30em)` — wide enough to seat two rails,
  short enough that a strip is the wrong way to spend the space, and
  unsatisfiable in portrait.
- **Laptop/desktop** — the three-column layout with side rails.
- `100dvh` (with a `100vh` fallback), because `vh` overshoots on mobile Safari
  where the URL bar moves; `env(safe-area-inset-*)` so nothing lands under a
  notch or home indicator; `overscroll-behavior: none` so a downward flick
  can't bounce the page; 44 px minimum touch targets; `:hover` rules confined
  to `@media (hover: hover)`.
- Every one of these must also hold inside the launcher's iframe at an
  arbitrary size.

## 5. Presentation

**Rendering.** HTML5 canvas, layered: a cached background (starfield +
well walls; re-rendered on resize/theme change), an offscreen board layer
(locked cells; redrawn on lock/clear), active piece + ghost drawn per frame,
and an FX layer (line-clear collapse ≤ 250 ms). HUD (score/level/lines/timer,
hold + next previews) is DOM beside the canvas.

### 5a. Escalation — the heat ladder

*Added 2026-09-01.* Two things a run can be on a roll about, and one ladder
they both climb so that every channel agrees about how big it is getting.

**The two counts** are kept by the reducer and ride out on the `clear` event:

- **`combo`** — the chain length, as it always was. A chain of 1 is not a
  chain; it is the first clear of one, and every clear is that.
- **`quadStreak`** — consecutive quads, which is *not* the same as the B2B
  chain (`b2bChain`, also on the event): a T-spin double extends the
  back-to-back chain and ends the quad streak. Two counters, because they
  break differently.

**The ladder** (`ui.heatFor`) is `warm` → `hot` (4) → `blaze` (7) → `nova`
(10), fed by whichever of the two is hotter, with a quad streak worth roughly
three combo steps — quads are rarer and a streak is harder to hold. A
Singularity sits above all four rungs as `record` and is deliberately *not*
reachable by grinding a chain, however long.

| Channel | What escalates |
| --- | --- |
| Banner | Colour, then a swell, then a pulse. Text names the three facts separately — `B2B QUAD ×3 · COMBO 8` — because a bare `×N` would mean the streak on one lock and the chain on the next. |
| Rail | A combo row that appears at 2 and leaves when the chain breaks, tinted on the same ladder. |
| FX (§5) | A quad wash over the whole shaft, a shock leaving the cleared band, and from the **third** quad in a row a beam standing in the shaft. Chains buy spark count and reach, not duration — the collapse stays capped at 250 ms. |
| Audio (§6) | The chain climbs a pitch ladder and counts itself out on a pawl; the quad streak escalates **downward** — bigger, longer, lower — plus a second blast from the third in a row. |

**Escalation is in reach, colour and depth — barely in level or brightness.**
The quad is already the loudest cue and the brightest thing on screen; making
it louder and brighter four times over ends in a limiter and in white. Both
the FX and the sound pack cap at a streak of five.

**Reduced motion and power saver** are unaffected in policy: `fx.notify()`
already returns early under reduced motion, so none of this exists there, and
the quad's wash/shock/beam are *feedback* and survive power saver exactly as
the clear band and lock flash already do. Only the sparks, which are
decoration, drop.

**Loop policy (§6a/§6d of the guide).** `Arcade.loop` is the only frame
source. During live play a piece is always falling, so the loop runs —
gameplay-essential motion. On menus, pause, settings and game-over the loop
is **parked** and state changes render via `kick()`: visible-but-idle is a
flat main thread at 0 fps, verified in a Performance trace. The starfield
drifts only while the play loop already runs (it never justifies frames on
its own), is **disabled under `powerSaver`**, and freezes under
`reducedMotion`.

**Danger state.** When the stack crosses row 16 a vignette pulse warns —
`animation-iteration-count: var(--arcade-pulse-count, 3)` declared as the
longhand, settling to a static tint that keeps saying "high stack" (contract
gates A/B). Never `infinite`, nothing loops while idle.

**Theme (§5).** Both launcher themes supported via `Arcade.settings.theme()`:
dark is the flagship night-well; light is a dawn-well palette (pale sky at
the top of the shaft, same seven piece hues, contrast-checked). Canvas
branches on the setting; DOM keys off `[data-theme]`.

**Reduced motion.** Line clears become instant removal, the collapse shimmer
and landing effects are skipped, the starfield is a still frame. Canvas/JS
checks `Arcade.settings.reducedMotion()`; DOM inherits the SDK kill-switch.

**Font scale.** HUD text in `rem` (free scaling via the SDK's injected root
rule); all `ctx.font` sizes multiply by `Arcade.settings.fontScale()`,
re-rendered on `Arcade.onSettingsChange`.

**Power saver.** Read defensively (`Arcade.settings.powerSaver ?
Arcade.settings.powerSaver() : false` — contract gate C): drops the
starfield drift, particle FX, and the ambient audio bed; pulse count follows
the token ladder automatically.

---

## 6. Audio — a graph-cue soundpack (§5 of the guide)

Spec-cue chiptune is the wrong palette for this game's tone; the pack is
built from the element library's physical gestures, lives in
`js/soundpack.js` (design only — synthesis stays in the framework), and is
registered via `ArcadeAudioElements.registerPack({...})` →
`window.ArcadeSoundPack`, auditioned offline with the launcher's
`tools/soundpack/` renderer.

- **Room:** one deep stone cistern (`decay ≈ 1.1`) — every cue shares it, so
  overlapping sounds fuse into the well rather than stacking into a pile.
- **Cues** (each varied per play via the seeded `rnd` stream — no
  byte-identical repeats): `shift` a featherweight high-passed `strike`;
  `turn` strike + tiny `body`; `touch`/`lock` low `thump` + resonant `body`;
  `clear` `shatter` scaled by lines cleared; `quad` a restrained `blast` with
  a high `send` (heard far up the shaft); `tspin` a `creak` — stick-slip is
  the sound of a piece twisting into a slot; `hold` a single `ratchet`
  detent; `levelup` a rising `body` gliss; `topout` the bed dying under one
  deep `thump`.
- **Bed:** `well-hum`, a sustained `drone` started with
  `Arcade.audio.start()`, **retuned** (`h.retune({ depth }, 3.0)`) as the
  stack crosses quantized height thirds with hysteresis — never per frame.
  Off under `powerSaver`; optional in settings.
- **Fallback:** none, by design — without `arcade-audio.js` the game plays
  silent (fleet posture: the pack *is* the sound). Requires SDK ≥ 3.7
  (`retune`); volume/mute arrive free via `Arcade.audio`.

---

## 7. SDK integration map (§ → what Gravity Well does)

| Guide § | Commitment |
| --- | --- |
| §1 Identity | `grav-well` everywhere: repo slug, catalog `id`, Pages path, storage namespace. `index.html` at repo root. |
| §2 SDK | Evergreen `/arcade-sdk.js` + `Arcade.init({ gameId: 'grav-well' })` in `<head>`; all boot after `await Arcade.ready`; no pre-ready state reads or writes. |
| §3 Storage | Every durable byte through `Arcade.state` (schema in §8 below); `getOrInit` for settings; `onStateReplaced` re-boots to the menu and re-hydrates snapshots (imported saves are treated as a fresh boot); storage-full left to the SDK's default toast. |
| §3a Async stores | Not used in v1 — every save fits `Arcade.state`. Replay archives would be the first `Arcade.store` consumer (M4). |
| §3b Sync | `settings` and mode snapshots opt in (`{ sync: true }`, all ≪ 64 KB); records/scores merge via the launcher already. |
| §3c Migration | Fleet-native from day one — no legacy keys, no `adopt` needed. `migrate('v1')` reserved for future reshapes. |
| §4 Profile | `Arcade.player.name()` for board entries; **scores** `arcade`, `ultra`, `marathon` (keyed by level, e.g. `L8`), `daily` (keyed by date, `order: 'asc'`); **records** `sprint-40` (`duration-ms`, lower), `arcade-score`, `ultra-score`, `marathon-l<n>` (integer, higher); **skill records** `best-combo`, `best-b2b`, `best-quad-streak`, `best-lock` (integer, higher, cross-mode — see below); **stats** counters (below). |
| §5 Settings | Theme, fontScale, reducedMotion, handedness, powerSaver, audioVolume — all honored as specified in §5–6 above; one `onSettingsChange` subscription flips cached multipliers and kicks a redraw. |
| §6 Lifecycle | `onSuspend`: pause sim, park loop, suspend audio, **synchronously flush the run snapshot**; `onResume`: reset accumulators, stay on the pause screen (never auto-unpause into gameplay). Eviction-safe by construction: the snapshot is written on every lock and on suspend. |
| §6d Idle | 0 fps outside live play; finite pulses on the token; Performance-trace verified. |
| §7 UI chrome | `Arcade.ui.toast` for records ("New best!"); `Arcade.ui.confirm` for destructive resets; `onBeforeQuit` flushes the snapshot (sync write, then `true` — never a veto-trap); `Arcade.ui.setTitle('Gravity Well — Sprint 1:23.45')` style titles. |
| §7a Multiplayer | v1 is single-player; `peer.*` untouched. Versus design sketched in §12. |
| §7b Safe rendering | The only off-device strings are score-entry names → rendered via `textContent`/`Arcade.html.escape`, always. |
| §7c Determinism | Vendored `js/arcade-rng.js` (byte-identical, KAT-pinned); `Arcade.daily.seed()` for Daily Well; `Arcade.share.encode({ seed, mode }, { v: 1 })` challenge codes — decode validates version and rejects others. |
| §7d Configs | Not in v1 (no packs/variants yet). |
| §8 Standalone | Fully playable at the Pages URL; nothing gates on `framed`. |
| §9 Sandbox | No direct `localStorage`/`indexedDB`/SW-registration assumptions; fullscreen only on user gesture; no top-navigation. |
| §10 PWA | `manifest.json` scoped `/grav-well/`; `sw.js` from the reference template: scope-filtered fetch, per-asset `add()`, `ignoreSearch`, own-prefix cache cleanup, `arcade:sw.skipWaiting` handler, CI-owned `const APP_VERSION = '0.0.0';`, generated precache markers. |
| §11 Launcher presence | Catalog entry + icon per §1 above. |
| §12 Local dev | Developed against `./dev.sh ../grav-well`; `?dev=1` tracing during handshake work. |
| §13 Acceptance | `npm run acceptance` from the launcher against the staged game is an M2 exit gate. |
| §13a CI/CD | Thin `pages.yml` caller (`version_bump: true`, `contents: write`); `tools/stage.mjs` (standard tracked-files staging) + byte-identical `verify-artifact.mjs` / `inject-precache.mjs`; tests in `tests/`, Node ≥ 24; Pages source = GitHub Actions. |

### 7a. The skill records

Four cross-mode records for what a run was *interesting* for, which its score
does not say. Two 40 000-point Arcade runs are the same row on a board; one of
them got there on a seven-quad back-to-back chain and the other ground it out
in singles.

| Category | From | Label |
| --- | --- | --- |
| `best-combo` | `stats.maxCombo` | Best combo |
| `best-b2b` | `stats.maxB2b` | Longest back-to-back |
| `best-quad-streak` | `stats.maxQuadStreak` | Longest quad streak |
| `best-lock` | `stats.bestLock` | Biggest single clear |

They are **cross-mode on purpose**: "the best combo you have ever built" is a
fact about the player, not about Ultra, and splitting it five ways would give
five easy records instead of one hard one. They are filed for every finished
run whether or not it *qualified* for its mode's board — a Sprint abandoned on
line 12 still built whatever it built.

**Zen is the one exclusion** (`skillRecords: false`). It cannot top out, so a
combo there can be assembled at leisure with the stack at the ceiling; filing
those beside a combo built under threat would retire all four categories
permanently on the first Zen session. Zen still contributes lifetime counters.

A zero is never filed, so a player who has not cleared a line does not get four
categories reading 0 in the launcher's Records sheet. `bestLock` counts the
*award* only and excludes drop points, which are a function of how far the
piece fell rather than of what the player built.

---

## 8. Persistence schema

All under `arcade.v1.grav-well.*` via the SDK:

| Key | Contents | Flags |
| --- | --- | --- |
| `settings` | DAS/ARR/SDF, ghost, glyph mode, key map, touch scheme, flick sensitivity, tap rotation direction, **Marathon pin level**, bed on/off, lockdown mode | `sync: true` |
| `run.<mode>` | Mid-run snapshot (`v: 2`): board, active piece + rotation state, bag `rng.getState()`, queue, hold, score/lines/level/combo/B2B, **pin level, B2B chain, quad streak**, elapsed, reset budget | `sync: true` |
| `stats` (via `Arcade.stats`, category `core`) | gamesPlayed & per-mode counts, total lines/pieces, quads, tspins, perfect clears, **peaks: max combo, max B2B chain, max quad streak, biggest single clear**, play time, daily streak | — |
| replay/telemetry buffers (M4) | input logs | `exportable: false` |

The **pin level** lives in `settings` rather than in the mode table because it
is a statement about how fast this player likes to play, not a per-run
decision — and because it is the key the Marathon leaderboard is filed under,
so it has to survive a reload or the player's board moves out from under them.
It reaches core as a `createGame({ pinLevel })` opt through
`modes.gameOptsFor()`, and is ignored by every mode that does not declare
`pinnable`.

Records and scores as listed in §7. A launcher Save → Load round-trip
restores every one of these (acceptance item).

---

## 9. Testing

The core is pure and reduced-form, so the suite is real, fast, and zero-dep
(`node --test 'tests/*.test.js'`, fleet default):

- `bag.test.js` — every 7-window is a permutation; first 14 pieces pinned for
  seed 42 (also pins the vendored PRNG via its known-answer vectors).
- `srs.test.js` — the §2.4 kick tables pinned verbatim; wall/floor kick
  fixtures; the TST kick; O-piece identity; failed-rotation no-ops.
- `tspin.test.js` — 3-corner fixtures: full vs mini, wall/floor corners,
  kick-upgrade, rotation-last requirement.
- `score.test.js` — the §2.9 table; B2B chains across Quads and T-spins
  (and what breaks them); combo runs; perfect-clear detection.
- `gravity.test.js` — curve values for levels 1–15 to 3 decimals; lock-delay
  reset budget and lowest-row restore.
- `game.test.js` — reducer determinism: seed + input log → identical final
  state hash, twice; Block Out / Lock Out; hold rules.
- `serialization.test.js` — mid-run snapshot round-trip, RNG state included:
  resumed run replays identically to an uninterrupted one.
- `repo-gates.test.js` — fleet floor (every tracked JS/JSON parses).

`npm test` = `node tools/verify-artifact.mjs && node --test 'tests/*.test.js'`
(the `moon-lit` pattern). Pre-merge locally: launcher `contract-gates.mjs`,
`render-smoke.mjs` (title screen draws immediately — no `tools/smoke.mjs`
hints needed), and the §13 acceptance checklist via `dev.sh`.

---

## 10. Repository layout

```
grav-well/
├── index.html                  # SDK two-liner in <head>; entry at repo root
├── manifest.json               # scope & start_url: /grav-well/
├── sw.js                       # from launcher tools/templates/game-sw.js
├── icon.png                    # ≥512² card art (§1)
├── css/well.css
├── js/
│   ├── main.js                 # boot: init → await ready → menu
│   ├── arcade-rng.js           # vendored byte-identical fleet companion
│   ├── core/                   # pure, DOM-free, node --test'able
│   │   ├── board.js  piece.js  bag.js  srs.js  tspin.js
│   │   ├── gravity.js  score.js  game.js  serialize.js
│   ├── render/                 # layers, fx, hud
│   ├── input/                  # keyboard das/arr, touch cluster
│   ├── app/audio.js            # cue wiring & bed retune policy
│   └── soundpack.js            # registered pack — design only
├── tests/                      # §9 suite
├── tools/
│   ├── stage.mjs               # per-app staging (standard tracked-files)
│   ├── inject-precache.mjs     # byte-identical fleet copy — never edited
│   └── verify-artifact.mjs     # byte-identical fleet copy — never edited
└── .github/workflows/pages.yml # thin fleet-ci caller, version_bump: true
```

Starting point: copy the launcher's `tools/templates/starter-app/` and
rename (per §2 of the guide).

---

## 11. Milestones

**M0 — Scaffold.** Starter-app copy renamed; thin CI caller green on an empty
shell; contract gates pass; Pages source set to GitHub Actions.
- [ ] Repo builds, deploys, and serves a page at `/grav-well/`

**M1 — The faithful core.** §2 complete and standalone-playable: Marathon
with SRS, 7-bag, hold, ghost, gravity curve, Extended Placement lock delay,
full scoring with T-spins/B2B/combos/PCs, keyboard DAS/ARR.
- [ ] §9 suite green, kick tables and scoring pinned
- [ ] A guideline-fluent player finds zero feel surprises

**M2 — Fleet citizen.** SDK storage/records/scores/stats wired; settings
honored (theme, fontScale, reducedMotion, powerSaver, handedness); lifecycle
+ eviction-safe snapshots; SW/manifest/precache; loop parked on menus.
- [ ] Launcher `npm run acceptance` passes end-to-end
- [ ] **Playable end-to-end on a real phone browser and a laptop browser**,
      gestures and keyboard both live, in portrait and landscape, standalone
      and inside the launcher frame (§4)
- [ ] Catalog PR opened with `inDevelopment: true`

**M3 — Modes, sound & shine.** Sprint 40, Ultra, Zen, Daily Well; the
soundpack; touch controls with handedness; icon art; line-clear FX.
- [ ] Records/leaderboards live for all modes; daily streak tracked
- [ ] `inDevelopment` flag dropped — full catalog citizen

**M4 — Beyond (unscheduled).** 1v1 Versus over `Arcade.peer` (deterministic
sims exchanging input/garbage events; garbage rows with attacker-seeded hole
columns; ride `'interrupted'` without resetting — the queue-and-replay
contract fits turn-paced garbage exchange well), replay capture & theater
(`Arcade.store`), gamepad, 180° rotation option, shareable challenge codes.

---

## 12. Open questions

1. **Ultra length** — spec says 3:00; 2:00 is the snappier convention some
   stackers use. Preference?
2. **Daily Well format** — seeded 8-row dig-race (spec) vs a seeded Ultra.
   Dig differentiates days more, Ultra is simpler. Both?

**Resolved.** *Touch default* — **gesture-first**, decided 2026-08-22. Both
input paths stay live at once on every device (§4); the button cluster remains
as the accessibility scheme rather than the default.

**Resolved.** *Endless cap* — decided 2026-08-22 from the shipped build. The
question was "clamp at 20G, or hard-stop Marathon at 15 and keep Endless a
separate toggle?", and the answer is **neither half of the either/or**:
Marathon simply has no line goal, so there is no Endless mode to toggle and
nothing to name it with. The curve is let run — it reaches true 20G at level
19 on its own — and the only clamp is the one that keeps it *at* 20G rather
than letting the formula explode past level 259 (§2.6).
