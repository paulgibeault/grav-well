<div align="center">

# Gravity Well

**A faithful falling-block stacker for [Paul's Arcade](https://paulgibeault.github.io/).**

<a href="https://paulgibeault.github.io/grav-well/">
  <img src="https://img.shields.io/badge/▶%20PLAY%20NOW-Gravity%20Well-070B14?style=for-the-badge&labelColor=C9A227&color=070B14" alt="Play Gravity Well" height="60" />
</a>

**▶ Play it here: <https://paulgibeault.github.io/grav-well/>**
· or launch it inside the arcade: <https://paulgibeault.github.io/#app=grav-well>

<img src="icon.png" alt="Gravity Well — glowing tetromino blocks sinking into a starlit stone well" width="200" />

</div>

---

## About

> *The playfield in a falling-block game has been called **the well** since the
> genre began. Ours has gravity. All's well that lands well.*

Gravity Well is a **faithful modern-guideline stacker**: 7-bag randomizer, SRS
rotation with full wall kicks, hold, ghost piece, extended-placement lock
delay, T-spins, back-to-back, combos, and perfect clears. If you have muscle
memory from any current-generation stacker, it should transfer without a
single surprise — faithfulness *is* the design. Everything else — the name,
the art, the sound, the copy — is our own.

Blocks are salvage sinking into a gravity well. The stack glows faintly
against the dark, a line clear collapses with a gravitational shimmer, and a
perfect clear is a **Singularity** — the one moment per run when the well
stops being a quarry and rings like a pipe.

## Modes

| Mode | What it is |
| ---- | ---------- |
| **Marathon** | The default. Levels 1–15 over 150 lines, gravity following the guideline curve. An **Endless** toggle keeps going past 15. |
| **Sprint 40** | Clear 40 lines as fast as you can. Instant retry. |
| **Ultra** | Three minutes on the clock. Maximum score. |
| **Zen** | Level-1 gravity forever, no top-out, no timer. An overflowing well gently sinks rather than ending your run. |
| **Daily Well** | One shared seed per day: the well starts with eight rows of debris and everyone digs the same one. Same debris, same piece stream, fastest time. |

## Controls

**Gestures are the primary scheme, and the keyboard is always live too** —
there is no device detection and no mode where one of them is off. One
Pointer Events path serves phone touch, stylus, and laptop trackpad alike, so
a laptop with a touchscreen and a phone with a Bluetooth keyboard both just
work.

| Gesture | Action |
| --- | --- |
| Drag sideways | Move — the piece tracks your finger cell-for-cell |
| Tap | Rotate clockwise |
| Two-finger tap *(or right-click)* | Rotate counter-clockwise |
| Flick down | Hard drop |
| Drag down slowly | Soft drop |
| Swipe up | Hold |

**Keyboard:** ←/→ move · ↓ soft drop · **Space** hard drop · ↑ or **X** rotate
CW · **Z** or Ctrl rotate CCW · **C** or Shift hold · **P**/Esc pause ·
**R** retry. Remappable, and keyed on physical position so AZERTY and Dvorak
work unchanged.

An on-screen **button cluster** is available in settings as an accessibility
scheme, with handedness mirroring.

## Features

- The full guideline ruleset — SRS wall kicks including the TST, 3-corner
  T-spin detection with mini/full distinction, back-to-back at ×1.5, combos,
  and perfect-clear bonuses
- Tunable **DAS / ARR / soft-drop factor** — the feel knobs modern stackers
  made table stakes
- Deterministic from one seed: same seed, same bag stream, same debris.
  A run interrupted mid-game and resumed replays identically
- Environmental audio via `Arcade.audio` — graph cues built from physical
  gestures (stone, rubble, breakage, a pawl, a drone) sharing one cistern
  room, voiced by *distance* rather than volume, over a bed that deepens as
  the stack rises
- Personal bests and leaderboards via the
  [Paul's Arcade SDK](https://paulgibeault.github.io/) — per-mode records,
  a shared daily board, and lifetime stats
- Honors every launcher setting: theme, font scale, reduced motion,
  handedness, power saver, and volume
- Installable PWA, plays offline, and works standalone or inside the launcher

## Development

```sh
# from the launcher repo, which stages launcher + game on one origin
./dev.sh ../grav-well
```

```sh
npm test                  # contract gates + the full unit suite
node tools/stage.mjs dist # build the deploy artifact
node tools/verify-artifact.mjs
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/build-icon.mjs
```

The rules engine in `js/core/` is pure — no DOM, no SDK, no wall clock, and
no entropy of its own — which is what lets the whole ruleset be exercised
under `node --test`. A repo gate enforces that.

- **Design:** [`docs/DESIGN.md`](docs/DESIGN.md) · originally
  [issue #1](https://github.com/paulgibeault/grav-well/issues/1)
- **Module contract:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **Fleet contract:** [GAME_INTEGRATION.md](https://github.com/paulgibeault/paulgibeault.github.io/blob/main/GAME_INTEGRATION.md)

## License

MIT — see [LICENSE](LICENSE).
