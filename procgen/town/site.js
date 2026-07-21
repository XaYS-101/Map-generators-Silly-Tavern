/* ------------------------------------------------------------------
 *  Town stage 1: site — extent, water, plaza.
 *
 *  LAYOUT draws (order is a compatibility contract):
 *  river? (chance, base, gaussians) | coast? (float) → plaza x/y →
 *  plazaR.
 * ------------------------------------------------------------------ */
import { distToPolyline } from './geom.js';

/**
 * @param {object} ctx shared pipeline context (see gen-town.js)
 */
export function buildSite(ctx) {
    const { p, rng, extent } = ctx;

    /* ---- water ---- */
    let riverPts = null;      // polyline across the map
    let shoreY = null;        // horizontal shoreline; water below
    if (p.water === 'river') {
        const vertical = rng.chance(0.5);
        const base = extent * rng.float(0.35, 0.65);
        riverPts = [];
        for (let t = -20; t <= extent + 20; t += 40) {
            const off = rng.gaussian(0, 22);
            riverPts.push(vertical ? [base + off, t] : [t, base + off]);
        }
    } else if (p.water === 'coast') {
        shoreY = extent * rng.float(0.7, 0.8);
    }
    ctx.water = {
        riverPts, shoreY,
        inWater: (x, y) => {
            if (shoreY != null) return y > shoreY;   // shoreline wobble is render-only (fixed in C3)
            if (riverPts) return distToPolyline(x, y, riverPts) < 16;
            return false;
        },
    };

    /* ---- plaza ---- */
    let px = extent / 2 + rng.float(-40, 40), py = extent / 2 + rng.float(-40, 40);
    if (shoreY != null) py = Math.min(py, shoreY - 120);
    if (riverPts) {
        // snap near the river → the bridge feels like the reason the town exists
        let best = riverPts[0], bd = Infinity;
        for (const q of riverPts) {
            const d = Math.hypot(q[0] - px, q[1] - py);
            if (d < bd) { bd = d; best = q; }
        }
        const ang = Math.atan2(py - best[1], px - best[0]);
        px = best[0] + Math.cos(ang) * 46;
        py = best[1] + Math.sin(ang) * 46;
    }
    ctx.plaza = { x: px, y: py, r: rng.int(26, 38) };
}
