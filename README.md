<div align="center">

# Gravity Well

**A faithful falling-block stacker for [Paul's Arcade](https://paulgibeault.github.io/).**

</div>

> *The playfield in a falling-block game has been called **the well** since the
> genre began. Ours has gravity. All's well that lands well.*

7-bag randomizer, SRS wall kicks, hold, ghost piece, T-spins, back-to-back and
combo scoring — the modern-guideline feel players know, with original name,
art, and sound. Marathon, Sprint 40, Ultra, Zen, and a shared **Daily Well**
dig on the same seed for everyone.

## Status

Pre-development. The complete v1 design — the mechanical spec down to the SRS
kick tables, the fleet/SDK integration map, persistence schema, audio design,
test plan, and milestones — lives in
[**issue #1**](https://github.com/paulgibeault/grav-well/issues/1).

- Fleet contract this game is built against:
  [GAME_INTEGRATION.md](https://github.com/paulgibeault/paulgibeault.github.io/blob/main/GAME_INTEGRATION.md)
- Ships at `https://paulgibeault.github.io/grav-well/` through the fleet's
  shared CI (`fleet-ci.yml` thin caller)
- `gameId: grav-well` — display name *Gravity Well* (fleet precedent:
  `si-syn` ↔ *Silicon Syndicate*)
