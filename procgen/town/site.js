/* ------------------------------------------------------------------
 *  Town stage 1: site — extent, water, terrain, plaza.
 *
 *  Produces (all LAYOUT stream, fixed draw order):
 *    ctx.water = { type, riverPts, width, shorePts, shoreY, inWater, shoreYAt }
 *    ctx.site  = { type, highPoint?, contours?, entries? }
 *    ctx.plaza = { x, y, r }
 *
 *  Water widths and the real wobbled shoreline follow the entity
 *  contract (river width 14/18/22 by size; coast pts a genuine polyline).
 * ------------------------------------------------------------------ */
import { distToPolyline } from './geom.js';

const RIVER_WIDTH = { village: 14, town: 18, city: 22 };

export function buildSite(ctx) {
    const { p, rng, extent } = ctx;
    const size = p.size || 'town';

    /* ---- water ---- */
    let riverPts = null;      // polyline across the map
    let shorePts = null;      // real wobbled shoreline polyline
    let shoreY = null;        // mean shore level (water is below)
    const width = RIVER_WIDTH[size] || RIVER_WIDTH.town;

    if (p.water === 'river') {
        const vertical = rng.chance(0.5);
        const base = extent * rng.float(0.35, 0.65);
        riverPts = [];
        for (let t = -20; t <= extent + 20; t += 40) {
            const off = rng.gaussian(0, 22);
            riverPts.push(vertical ? [base + off, t] : [t, base + off]);
        }
    } else if (p.water === 'coast') {
        const mean = extent * rng.float(0.7, 0.8);
        shoreY = mean;
        shorePts = [];
        for (let x = -32; x <= extent + 32; x += 32) {
            shorePts.push([x, mean + rng.gaussian(0, 8)]);
        }
    }

    // linear interpolation of shore height at an arbitrary x
    const shoreYAt = shorePts
        ? (x) => {
            if (x <= shorePts[0][0]) return shorePts[0][1];
            for (let i = 1; i < shorePts.length; i++) {
                if (x <= shorePts[i][0]) {
                    const [x0, y0] = shorePts[i - 1], [x1, y1] = shorePts[i];
                    const f = (x - x0) / (x1 - x0 || 1);
                    return y0 + (y1 - y0) * f;
                }
            }
            return shorePts[shorePts.length - 1][1];
        }
        : null;

    const half = width / 2 + 4;
    ctx.water = {
        type: p.water, riverPts, shorePts, shoreY, width,
        shoreYAt,
        inWater: (x, y) => {
            if (shoreYAt) return y > shoreYAt(x);
            if (riverPts) return distToPolyline(x, y, riverPts) < half;
            return false;
        },
    };

    /* ---- terrain / plaza ---- */
    const site = { type: p.site || 'plain' };
    let px = extent / 2, py = extent / 2;

    if (site.type === 'hillside') {
        // high point near one corner, biased inward a little
        const cx = rng.chance(0.5) ? 0 : 1, cy = rng.chance(0.5) ? 0 : 1;
        const hx = cx ? extent - extent * rng.float(0.14, 0.24) : extent * rng.float(0.14, 0.24);
        const hy = cy ? extent - extent * rng.float(0.14, 0.24) : extent * rng.float(0.14, 0.24);
        site.highPoint = [hx, hy];

        // 2–4 roughly concentric elliptical contour polylines
        const nc = rng.int(2, 4);
        site.contours = [];
        const rot = rng.float(0, Math.PI);
        for (let k = 0; k < nc; k++) {
            const rx = extent * (0.12 + 0.11 * k) * rng.float(0.9, 1.1);
            const ry = rx * rng.float(0.6, 0.85);
            const ring = [];
            const steps = 28;
            for (let s = 0; s <= steps; s++) {
                const a = (Math.PI * 2 * s) / steps;
                const jit = rng.gaussian(0, extent * 0.012);
                const ex = Math.cos(a) * (rx + jit), ey = Math.sin(a) * (ry + jit);
                ring.push([
                    hx + ex * Math.cos(rot) - ey * Math.sin(rot),
                    hy + ex * Math.sin(rot) + ey * Math.cos(rot),
                ]);
            }
            site.contours.push(ring);
        }

        // plaza biased downhill: away from the high point toward map centre
        const dh = Math.atan2(extent / 2 - hy, extent / 2 - hx);
        const dist = extent * rng.float(0.22, 0.32);
        px = hx + Math.cos(dh) * dist + rng.float(-24, 24);
        py = hy + Math.sin(dh) * dist + rng.float(-24, 24);
    } else if (site.type === 'crossroads') {
        // 2–3 through-road entry points, each on a DIFFERENT map edge
        const nE = rng.int(2, 3);
        const edges = rng.shuffle([0, 1, 2, 3]).slice(0, nE);   // 0 N,1 E,2 S,3 W
        const m = ctx.margin;
        site.entries = edges.map((e) => {
            const f = rng.float(0.25, 0.75);
            if (e === 0) return { x: extent * f, y: m, edge: 'N' };
            if (e === 1) return { x: extent - m, y: extent * f, edge: 'E' };
            if (e === 2) return { x: extent * f, y: extent - m, edge: 'S' };
            return { x: m, y: extent * f, edge: 'W' };
        });
        px = extent / 2 + rng.float(-30, 30);
        py = extent / 2 + rng.float(-30, 30);
    } else {
        // plain
        px = extent / 2 + rng.float(-40, 40);
        py = extent / 2 + rng.float(-40, 40);
    }

    // keep the plaza clear of the water
    if (shoreYAt != null) py = Math.min(py, shoreY - 120);
    if (riverPts) {
        // snap near the river — the bridge feels like the town's reason to exist
        let best = riverPts[0], bd = Infinity;
        for (const q of riverPts) {
            const d = Math.hypot(q[0] - px, q[1] - py);
            if (d < bd) { bd = d; best = q; }
        }
        const ang = Math.atan2(py - best[1], px - best[0]);
        px = best[0] + Math.cos(ang) * (width / 2 + 40);
        py = best[1] + Math.sin(ang) * (width / 2 + 40);
    }

    ctx.site = site;
    ctx.plaza = { x: px, y: py, r: rng.int(26, 38) };
}
