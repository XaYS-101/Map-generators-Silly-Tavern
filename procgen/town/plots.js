/* ------------------------------------------------------------------
 *  Town stage 3: plots — buildings along roads.
 *
 *  Rotated rects offset to alternating road sides, SAT overlap tests,
 *  up to 3 laps to hit the target count. Sizes and stone/wood odds
 *  scale with wealth; condition drives per-building state (DECO stream,
 *  in building array order). Landmark slots are the plots nearest the
 *  plaza whose ENLARGED footprint still clears its neighbours — the old
 *  overlap bug is gone. Names are NOT drawn here anymore; the life
 *  stage owns every display string (see the naming contract).
 * ------------------------------------------------------------------ */
import { TOWN_LANDMARKS, BUILDING_KINDS } from '../names.js';
import { rectPoly, centroid, scalePoly, polysIntersect } from './geom.js';

const WEALTH = {
    poor: { bw: [8, 14], bd: [7, 11], nextAt: [16, 24], stone: 0.1 },
    average: { bw: [10, 18], bd: [8, 14], nextAt: [20, 30], stone: 0.35 },
    wealthy: { bw: [13, 22], bd: [10, 17], nextAt: [26, 38], stone: 0.8 },
};

/** Collapse a building footprint into a jittered 5–6-gon debris blob. */
function rubbleBlob(poly, deco) {
    const [cx, cy] = centroid(poly);
    let r = 0;
    for (const [x, y] of poly) r += Math.hypot(x - cx, y - cy);
    r /= poly.length;
    const n = deco.int(5, 6);
    const rot = deco.float(0, Math.PI * 2);
    const out = [];
    for (let i = 0; i < n; i++) {
        const a = rot + (Math.PI * 2 * i) / n;
        const rr = r * deco.float(0.6, 0.95);
        out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    return out;
}

export function buildPlots(ctx) {
    const { p, rng, deco, preset, extent, water, plaza, roads, tooCloseToRoads } = ctx;
    const MARGIN = ctx.margin;
    const w = WEALTH[p.wealth] || WEALTH.average;

    const buildings = [];   // { poly, cx, cy, purpose|landmark, material, state }
    const [minB, maxB] = preset.buildings;
    const targetB = rng.int(minB, maxB);

    outer:
    for (let lap = 0; lap < 3 && buildings.length < targetB; lap++) {
        for (const road of roads) {
            const pts = road.pts;
            let acc = 0, nextAt = rng.int(w.nextAt[0], w.nextAt[1]);
            let side = rng.chance(0.5) ? 1 : -1;
            for (let i = 1; i < pts.length; i++) {
                const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
                const segLen = Math.hypot(dx, dy) || 1;
                acc += segLen;
                if (acc < nextAt) continue;
                acc = 0;
                nextAt = rng.int(w.nextAt[0], w.nextAt[1]);
                side = -side;
                const tx = dx / segLen, ty = dy / segLen;
                const nx = -ty * side, ny = tx * side;
                const offset = rng.int(9, 13);
                const cx = pts[i][0] + nx * offset, cy = pts[i][1] + ny * offset;
                const bw = rng.int(w.bw[0], w.bw[1]), bd = rng.int(w.bd[0], w.bd[1]);
                const poly = rectPoly(cx + nx * bd / 2, cy + ny * bd / 2, bw, bd, Math.atan2(ty, tx));
                if (poly.some(([qx, qy]) => qx < MARGIN || qy < MARGIN || qx > extent - MARGIN || qy > extent - MARGIN)) continue;
                if (poly.some(([qx, qy]) => water.inWater(qx, qy))) continue;
                if (Math.hypot(cx - plaza.x, cy - plaza.y) < plaza.r + 12) continue;
                const c = centroid(poly);
                if (tooCloseToRoads(c[0], c[1], 8, -1)) continue;
                if (buildings.some(b => polysIntersect(b.poly, poly))) continue;
                buildings.push({ poly, cx: c[0], cy: c[1] });
                if (buildings.length >= targetB) break outer;
            }
        }
    }

    /* ---- landmark slots: nearest plaza whose ×1.3 poly still fits ---- */
    const lmKinds = (TOWN_LANDMARKS[p.size] || TOWN_LANDMARKS.town).filter(k => k !== 'market');
    const byDist = [...buildings].sort((a, b) =>
        Math.hypot(a.cx - plaza.x, a.cy - plaza.y) - Math.hypot(b.cx - plaza.x, b.cy - plaza.y));
    let ci = 0;
    for (const kind of lmKinds) {
        while (ci < byDist.length) {
            const cand = byDist[ci++];
            if (cand.landmark) continue;
            const scaled = scalePoly(cand.poly, 1.3);
            // the enlarged footprint must still clear the map, the water, and every neighbour
            if (scaled.some(([qx, qy]) => qx < MARGIN || qy < MARGIN || qx > extent - MARGIN || qy > extent - MARGIN)) continue;
            if (scaled.some(([qx, qy]) => water.inWater(qx, qy))) continue;
            if (buildings.some(o => o !== cand && polysIntersect(o.poly, scaled))) continue;
            cand.poly = scaled;
            cand.landmark = kind;
            cand.name = null;
            break;
        }
    }

    /* ---- material + purpose + condition (DECO, building array order) ---- */
    const cond = p.condition || 'thriving';
    let tavernAnchored = false;
    for (const b of buildings) {
        b.material = deco.chance(w.stone) ? 'stone' : 'wood';
        if (!b.landmark) b.purpose = deco.weighted(BUILDING_KINDS);
        b.state = 'intact';
        if (b.landmark) {
            if (cond === 'ruined') {
                if (b.landmark === 'tavern' && !tavernAnchored) tavernAnchored = true;   // keep one anchor
                else if (deco.chance(0.3)) b.state = 'ruined';
            }
        } else if (cond === 'declining') {
            if (deco.chance(0.15)) b.state = 'abandoned';
        } else if (cond === 'ruined') {
            const r = deco.next();
            if (r < 0.2) b.state = 'abandoned';
            else if (r < 0.45) b.state = 'ruined';
            else if (r < 0.53) { b.state = 'rubble'; b.poly = rubbleBlob(b.poly, deco); }
        }
    }

    ctx.buildings = buildings;
}
