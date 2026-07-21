/* ------------------------------------------------------------------
 *  Interior — floor-plan skeletons (1 cell = 1 m, DOM-free).
 *
 *  A "skeleton" is the raw geometry of a single floor: a hub room, an
 *  optional circulation spine (corridor / courtyard / gate) and a set
 *  of sliced regions that tile the rest of the footprint with NO holes
 *  and NO overlaps. Purposes, doors, windows and stairs are added by
 *  the other interior modules — this file is pure rectangles.
 *
 *  Skeleton families:
 *    TOP_CORRIDOR  tavern / shop / temple / smithy  — hub at the door,
 *                  a hallway behind it, a row of back rooms.
 *    SIDE_CORRIDOR manor / keep / barracks          — great hall across
 *                  the bottom, a vertical hallway, rooms either side.
 *    COURTYARD     caravanserai — a central open courtyard ringed by
 *                  four wings; the street enters through a gate passage.
 *    house         cottage: hearth-room hub, optional L-shaped footprint.
 *    warehouse     one/two huge storage bays + a corner office.
 *    mill          a single hub room (the works are upstairs).
 * ------------------------------------------------------------------ */

export const KIND_SIZE = {
    house: [12, 9], shop: [12, 10], tavern: [18, 12], temple: [18, 14],
    manor: [22, 14], keep: [22, 16], smithy: [14, 10], barracks: [20, 13],
    warehouse: [18, 13], caravanserai: [22, 16], mill: [12, 10],
};

/* Per-kind minimum ground dims — keep every skeleton valid (hub thick
 * enough, spine strips >= 3 m) even at the smallest size/jitter. */
const MIN_DIMS = {
    house: [8, 7], shop: [8, 9], tavern: [10, 9], temple: [10, 9],
    manor: [12, 9], keep: [12, 10], smithy: [9, 9], barracks: [12, 9],
    warehouse: [12, 8], caravanserai: [15, 12], mill: [8, 6],
};

const TOP_CORRIDOR = new Set(['tavern', 'shop', 'temple', 'smithy']);
const SIDE_CORRIDOR = new Set(['manor', 'keep', 'barracks']);

export function clampKind(building) {
    return KIND_SIZE[building] ? building : 'tavern';
}

export function titleCase(s) {
    return String(s).replace(/(^|[\s-])\w/g, c => c.toUpperCase());
}

/* size multiplier ×0.85 / 1 / 1.25 (round), + small jitter, min dims respected. */
export function groundDims(kind, size, rng) {
    const [bw, bh] = KIND_SIZE[kind] || KIND_SIZE.tavern;
    const mult = { small: 0.85, medium: 1, large: 1.25 }[size] ?? 1;
    const [mw, mh] = MIN_DIMS[kind] || [8, 7];
    const W = Math.max(mw, Math.round(bw * mult) + rng.int(-1, 2));
    const H = Math.max(mh, Math.round(bh * mult) + rng.int(-1, 1));
    return { W, H };
}

/* ---- recursive binary subdivision (ported from the old interior) ---- */
export function subdivideRect(rect, axis, rng, areaMax) {
    const out = [];
    (function rec(r, ax) {
        const canV = r.w >= 6 && ax !== 'h';
        const canH = r.h >= 6 && ax !== 'v';
        if (r.w * r.h <= areaMax || (!canV && !canH)) {
            out.push({ x: r.x, y: r.y, w: r.w, h: r.h });
            return;
        }
        const vertical = canV && (!canH || (r.w > r.h ? true : (r.w < r.h ? false : rng.chance(0.5))));
        if (vertical) {
            const c = Math.max(3, Math.min(r.w - 3, Math.round(r.w * rng.float(0.35, 0.65))));
            rec({ x: r.x, y: r.y, w: c, h: r.h }, ax);
            rec({ x: r.x + c, y: r.y, w: r.w - c, h: r.h }, ax);
        } else {
            const c = Math.max(3, Math.min(r.h - 3, Math.round(r.h * rng.float(0.35, 0.65))));
            rec({ x: r.x, y: r.y, w: r.w, h: c }, ax);
            rec({ x: r.x, y: r.y + c, w: r.w, h: r.h - c }, ax);
        }
    })(rect, axis);
    return out;
}

/* A region thinner than 3 m in either dim is skipped (would leave a
 * hole) — every caller guarantees its regions are >= 3x3. */
export function sliceRegion(rect, axis, rng, areaMax) {
    if (rect.w >= 3 && rect.h >= 3) return subdivideRect(rect, axis, rng, areaMax);
    return [];
}

/**
 * Build one ground-floor skeleton.
 * @returns {{rooms: Array<{x,y,w,h,role?,courtyard?}>, cut: object|null}}
 *   role ∈ {'hub','corridor','gate'}; courtyard flags the open central bay.
 */
export function buildSkeleton(kind, W, H, rng) {
    const rooms = [];
    const add = (r, role, courtyard) => {
        const o = { x: r.x, y: r.y, w: r.w, h: r.h };
        if (role) o.role = role;
        if (courtyard) o.courtyard = true;
        rooms.push(o);
        return o;
    };
    const areaMax = (kind === 'house' || kind === 'shop') ? 22 : 30;
    let cut = null;

    if (TOP_CORRIDOR.has(kind)) {
        // hub at the entrance, hallway behind it, a row of back rooms
        const topH = Math.max(4, Math.min(6, Math.round(H * 0.35)));
        const hh = H - 2 - topH;
        add({ x: 0, y: H - hh, w: W, h: hh }, 'hub');
        add({ x: 0, y: topH, w: W, h: 2 }, 'corridor');
        for (const r of sliceRegion({ x: 0, y: 0, w: W, h: topH }, 'v', rng, areaMax)) add(r);

    } else if (SIDE_CORRIDOR.has(kind)) {
        // great hall across the bottom, vertical hallway, rooms either side
        const hh = Math.max(4, Math.round(H * 0.32));
        const cx = Math.max(3, Math.min(W - 5, Math.round(W / 2) - 1 + rng.int(-1, 1)));
        add({ x: 0, y: H - hh, w: W, h: hh }, 'hub');
        add({ x: cx, y: 0, w: 2, h: H - hh }, 'corridor');
        for (const r of sliceRegion({ x: 0, y: 0, w: cx, h: H - hh }, 'h', rng, areaMax)) add(r);
        for (const r of sliceRegion({ x: cx + 2, y: 0, w: W - cx - 2, h: H - hh }, 'h', rng, areaMax)) add(r);

    } else if (kind === 'caravanserai') {
        buildCourtyard(add, W, H, rng, areaMax);

    } else if (kind === 'warehouse') {
        buildWarehouse(add, W, H, rng, areaMax);

    } else if (kind === 'mill') {
        add({ x: 0, y: 0, w: W, h: H }, 'hub');

    } else {
        // cottage: hearth room is the hub, optionally L-shaped footprint
        if (rng.chance(0.35)) {
            cut = {
                corner: rng.chance(0.5) ? 'tl' : 'tr',
                w: Math.round(W * rng.float(0.28, 0.4)),
                h: Math.round(H * rng.float(0.25, 0.35)),
            };
        }
        const hh = Math.max(4, Math.round(H * rng.float(0.4, 0.5)));
        const topH = H - hh;
        if (cut) {
            cut.h = Math.min(cut.h, topH - 3);
            if (cut.h < 3) cut = null;   // a thinner strip would be skipped → hole
        }
        add({ x: 0, y: H - hh, w: W, h: hh }, 'hub');
        if (cut) {
            const beside = cut.corner === 'tl'
                ? { x: cut.w, y: 0, w: W - cut.w, h: cut.h }
                : { x: 0, y: 0, w: W - cut.w, h: cut.h };
            for (const r of sliceRegion(beside, 'any', rng, areaMax)) add(r);
            for (const r of sliceRegion({ x: 0, y: cut.h, w: W, h: topH - cut.h }, 'any', rng, areaMax)) add(r);
        } else {
            for (const r of sliceRegion({ x: 0, y: 0, w: W, h: topH }, 'any', rng, areaMax)) add(r);
        }
    }

    return { rooms, cut };
}

/* Caravanserai — central open courtyard (hub) ringed by N/W/E wings and
 * a split south wing with a 2-wide GATE passage in the middle. The gate
 * is the only room touching the south wall, so the street door lands on
 * it and it opens straight into the courtyard. See gen-interior header
 * for the entrance rationale. */
function buildCourtyard(add, W, H, rng, areaMax) {
    const m = Math.max(3, rng.int(3, 4));           // wing width
    const cw = W - 2 * m, ch = H - 2 * m;
    add({ x: m, y: m, w: cw, h: ch }, 'hub', true);   // courtyard = hub, open
    for (const r of sliceRegion({ x: 0, y: 0, w: W, h: m }, 'v', rng, areaMax)) add(r);                 // N wing
    for (const r of sliceRegion({ x: 0, y: m, w: m, h: H - 2 * m }, 'h', rng, areaMax)) add(r);         // W wing
    for (const r of sliceRegion({ x: W - m, y: m, w: m, h: H - 2 * m }, 'h', rng, areaMax)) add(r);     // E wing
    // south wing, gate aligned to the courtyard centre
    let gx = m + Math.floor(cw / 2) - 1;
    gx = Math.max(m, Math.min(W - m - 2, gx));
    for (const r of sliceRegion({ x: 0, y: H - m, w: gx, h: m }, 'v', rng, areaMax)) add(r);            // S-left
    add({ x: gx, y: H - m, w: 2, h: m }, 'gate');
    for (const r of sliceRegion({ x: gx + 2, y: H - m, w: W - gx - 2, h: m }, 'v', rng, areaMax)) add(r); // S-right
}

/* Warehouse — a corner office block, a top strip bay beside it, and one
 * or two huge storage bays filling the bottom (the entrance hub). */
function buildWarehouse(add, W, H, rng, areaMax) {
    const corner = rng.chance(0.5) ? 'tl' : 'tr';
    const ow = Math.min(W - 3, Math.max(3, Math.round(W * 0.3)));
    const oh = Math.min(H - 3, Math.max(3, Math.round(H * 0.4)));
    const ox = corner === 'tl' ? 0 : W - ow;
    add({ x: ox, y: 0, w: ow, h: oh });                       // office
    const stripX = corner === 'tl' ? ow : 0;
    add({ x: stripX, y: 0, w: W - ow, h: oh });               // top-strip bay
    const bh = H - oh;
    if (W - oh > 0 && W * bh > 90 && W >= 8) {
        const half = Math.floor(W / 2);
        add({ x: 0, y: oh, w: half, h: bh }, 'hub');          // bay 1 (hub, touches street)
        add({ x: half, y: oh, w: W - half, h: bh });          // bay 2
    } else {
        add({ x: 0, y: oh, w: W, h: bh }, 'hub');             // single bay
    }
    void areaMax;
}

/* Building outline polygon (footprint). Only the house / warehouse ever
 * carry an L-cut; every other floor is a full rectangle. */
export function outlinePts(W, H, cut) {
    if (!cut) return [[0, 0], [W, 0], [W, H], [0, H]];
    if (cut.corner === 'tl') return [[cut.w, 0], [W, 0], [W, H], [0, H], [0, cut.h], [cut.w, cut.h]];
    return [[0, 0], [W - cut.w, 0], [W - cut.w, cut.h], [W, cut.h], [W, H], [0, H]];
}
