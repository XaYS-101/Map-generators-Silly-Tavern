/* ------------------------------------------------------------------
 *  Town stage 3: plots — buildings along roads.
 *
 *  Rotated rects offset to alternating road sides, SAT overlap tests,
 *  up to 3 laps to hit the target count. Landmark slots claim the
 *  plots nearest the plaza (DECO stream assigns ordinary purposes;
 *  the tavern draws its name from the NAMES stream — order contract).
 * ------------------------------------------------------------------ */
import { nameFor, TOWN_LANDMARKS, BUILDING_KINDS } from '../names.js';
import { rectPoly, centroid, scalePoly, polysIntersect } from './geom.js';

export function buildPlots(ctx) {
    const { p, rng, deco, nameRng, preset, extent, water, plaza, roads, tooCloseToRoads } = ctx;
    const MARGIN = ctx.margin;

    const buildings = [];   // { poly, cx, cy, purpose, landmark? }
    const [minB, maxB] = preset.buildings;
    const targetB = rng.int(minB, maxB);

    outer:
    for (let lap = 0; lap < 3 && buildings.length < targetB; lap++) {
        for (const road of roads) {
            const pts = road.pts;
            let acc = 0, nextAt = rng.int(20, 30);
            let side = rng.chance(0.5) ? 1 : -1;
            for (let i = 1; i < pts.length; i++) {
                const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
                const segLen = Math.hypot(dx, dy) || 1;
                acc += segLen;
                if (acc < nextAt) continue;
                acc = 0;
                nextAt = rng.int(20, 30);
                side = -side;
                const tx = dx / segLen, ty = dy / segLen;
                const nx = -ty * side, ny = tx * side;
                const offset = rng.int(9, 13);
                const cx = pts[i][0] + nx * offset, cy = pts[i][1] + ny * offset;
                const bw = rng.int(10, 18), bd = rng.int(8, 14);
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

    /* ---- landmarks: plots nearest the plaza ---- */
    const lmKinds = (TOWN_LANDMARKS[p.size] || TOWN_LANDMARKS.town).filter(k => k !== 'market');
    const byDist = [...buildings].sort((a, b) =>
        Math.hypot(a.cx - plaza.x, a.cy - plaza.y) - Math.hypot(b.cx - plaza.x, b.cy - plaza.y));
    byDist.slice(0, lmKinds.length).forEach((b, i) => {
        b.landmark = lmKinds[i];
        b.name = lmKinds[i] === 'tavern' ? nameFor(nameRng, 'tavern') : null;
        b.poly = scalePoly(b.poly, 1.3);
    });
    for (const b of buildings) {
        if (!b.landmark) b.purpose = deco.weighted(BUILDING_KINDS);
    }

    ctx.buildings = buildings;
}
