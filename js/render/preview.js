/* preview.js — the #hold and #next canvases.
 *
 * Two traps live in here, both of which make a queue look broken rather than
 * wrong-in-detail:
 *
 * 1. Centring. cellsFor('I', 0) is four cells on the box's SECOND row and
 *    cellsFor('O', 0) is a 2×2 in the corner, so centring the piece's
 *    bounding BOX puts an I low and an O left. Each preview is centred on the
 *    bounding box of its actual cells instead.
 * 2. One cell size for all five. Fitting each piece to its own slot would
 *    draw the I at three-quarter scale next to a fat O; the size is computed
 *    once from the widest piece that has to fit and every slot uses it, so
 *    the queue reads as one column of the same salvage.
 *
 * The layout axis is taken from the box the stylesheet handed us — css/well.css
 * gives #next aspect-ratio 5/2 in the phone-portrait strip and 8/25 in the
 * side rail, and says outright that the box aspect IS the contract for which
 * way the queue runs.
 */

import { ID } from '../core/constants.js';
import { cellsFor } from '../core/piece.js';
import { drawBlock, colorFor, withAlpha } from './layers.js';

// The widest piece is 4 wide and the tallest 2 tall, plus a little air so
// neighbouring previews do not touch.
const SLOT_COLS = 4.55;
const SLOT_ROWS = 2.5;

/* How many previews the box can show without shrinking them past reading.
 *
 * drawQueue divides its box into `count` equal slots along the long axis and
 * fits every piece to the SMALLEST cell any slot can take, so the count and
 * the legibility are one number, not two. In the side rail that number is
 * free — a tall column has room for five. In the phone strip the queue is a
 * band a hundred-odd pixels wide, and five slots in it are twenty pixels each:
 * a coloured shape, not a piece you can name. Three you can read beat five you
 * cannot, so the count comes from the box rather than from a constant.
 *
 * Inverts drawQueue's own geometry: cell = min(cross-axis fit, along-axis fit
 * / count), and only the along-axis term depends on the count, so the largest
 * count that still clears `minCell` is floor(along / (perSlot * minCell)).
 * Never returns 0 — one preview is the floor, however small the box.
 */
export function queueCapacity(box, max, minCell) {
    const n = Math.max(1, max || 5);
    const floorCell = Math.max(1, minCell || 1);
    if (!box || !(box.w > 1) || !(box.h > 1)) return n;
    const vertical = box.h >= box.w;
    const along = vertical ? box.h : box.w;
    const perSlot = vertical ? SLOT_ROWS : SLOT_COLS;
    const fit = Math.floor(along / (perSlot * floorCell));
    return Math.max(1, Math.min(n, fit));
}

function bounds(cells) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        if (c[0] < minX) minX = c[0];
        if (c[0] > maxX) maxX = c[0];
        if (c[1] < minY) minY = c[1];
        if (c[1] > maxY) maxY = c[1];
    }
    return { minX, maxX, minY, maxY };
}

function drawPiece(ctx, type, cell, sx, sy, sw, sh, palette, alpha, glyphs) {
    const cells = cellsFor(type, 0);   // frozen and shared — never sort in place
    const b = bounds(cells);
    const ox = sx + (sw - (b.maxX - b.minX + 1) * cell) / 2 - b.minX * cell;
    const oy = sy + (sh - (b.maxY - b.minY + 1) * cell) / 2 - b.minY * cell;
    const color = colorFor(palette, ID[type]);
    for (let i = 0; i < cells.length; i++) {
        drawBlock(ctx, ox + cells[i][0] * cell, oy + cells[i][1] * cell, cell, color, alpha,
            glyphs ? type : undefined);
    }
}

// An empty hold is a place, not a blank: a dashed socket says the slot exists
// and is unused, which is a different statement from "the panel failed".
function drawSocket(ctx, cx, cy, size, palette) {
    ctx.save();
    ctx.strokeStyle = withAlpha(palette.rim, 0.8);
    ctx.lineWidth = Math.max(1, size * 0.03);
    ctx.setLineDash([size * 0.12, size * 0.1]);
    ctx.strokeRect(cx - size / 2, cy - size / 2, size, size);
    ctx.restore();
}

// Hold: one slot, the whole canvas. Dimmed — not hidden — while holdUsed is
// set, because the player still needs to read what is in there.
export function drawHold(ctx, box, type, holdUsed, palette, glyphs) {
    ctx.clearRect(0, 0, box.w, box.h);
    const cell = Math.min(box.w / SLOT_COLS, box.h / SLOT_ROWS);
    if (!type) {
        drawSocket(ctx, box.w / 2, box.h / 2, cell * 1.25, palette);
        return;
    }
    drawPiece(ctx, type, cell, 0, 0, box.w, box.h, palette, holdUsed ? 0.3 : 1, glyphs);
}

// Next: `count` slots down the long axis. The first is drawn full size and
// the rest a shade smaller, so "the one you are getting" is legible at a
// glance without the queue turning into a size ladder.
export function drawQueue(ctx, box, types, palette, count, glyphs) {
    ctx.clearRect(0, 0, box.w, box.h);
    const n = Math.max(1, count || 5);
    const vertical = box.h >= box.w;
    const slotW = vertical ? box.w : box.w / n;
    const slotH = vertical ? box.h / n : box.h;
    const cell = Math.min(slotW / SLOT_COLS, slotH / SLOT_ROWS);
    if (!types || !types.length) return;

    for (let i = 0; i < n && i < types.length; i++) {
        const type = types[i];
        if (!type || !ID[type]) continue;
        const sx = vertical ? 0 : i * slotW;
        const sy = vertical ? i * slotH : 0;
        const scale = i === 0 ? 1 : 0.82;
        drawPiece(ctx, type, cell * scale, sx, sy, slotW, slotH, palette,
            i === 0 ? 1 : 0.86, glyphs);
    }
}

// A cheap identity for "what is currently on the preview canvases". Comparing
// it is what keeps two static canvases from being repainted sixty times a
// second for the entire run.
export function previewSignature(hold, holdUsed, queue, count) {
    let s = (hold || '-') + (holdUsed ? '!' : '');
    const n = Math.max(1, count || 5);
    if (queue) {
        for (let i = 0; i < n && i < queue.length; i++) s += queue[i] || '-';
    }
    return s;
}
