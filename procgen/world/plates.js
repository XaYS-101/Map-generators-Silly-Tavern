/* ------------------------------------------------------------------
 *  World stage 1a: plate tectonics.
 *
 *  ~7–14 voronoi plates (domain-warped distance so boundaries wander
 *  like real sutures), each with a drift vector and an oceanic flag.
 *  Boundary cells are classified by the relative drift along the
 *  boundary normal: continental collision → mountain-belt ridge mask,
 *  subduction → island-arc + trench masks, divergence → rift mask.
 *  The masks feed the world heightmap in world/terrain.js.
 *
 *  Plate seeds/drifts come from the LAYOUT stream in a fixed order;
 *  everything after that is RNG-free.
 * ------------------------------------------------------------------ */
import { Noise2D } from '../noise.js';

const PRESET = {   // [plate count, oceanic fraction]
    pangea: [7, 0.35], continents: [10, 0.5], archipelago: [12, 0.62], shattered: [14, 0.7],
};

/** Additive radial stamp with quadratic falloff. */
function stamp(mask, N, x, y, r, v) {
    const x0 = Math.max(0, x - r), x1 = Math.min(N - 1, x + r);
    const y0 = Math.max(0, y - r), y1 = Math.min(N - 1, y + r);
    const r2 = r * r;
    for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
            const d2 = (xx - x) * (xx - x) + (yy - y) * (yy - y);
            if (d2 > r2) continue;
            const f = 1 - d2 / r2;
            const i = yy * N + xx;
            const add = v * f * f;
            if (add > mask[i]) mask[i] = add;   // max, not sum: overlapping stamps don't spike
        }
    }
}

/**
 * @param {{N:number, seed:string, p:object}} ctx
 * @param {import('../rng.js').Rng} rng  layout stream
 */
export function buildPlates(ctx, rng) {
    const { N, seed, p } = ctx;
    const [K, oceanicFrac] = PRESET[p.continents] || PRESET.continents;

    const plates = [];
    for (let k = 0; k < K; k++) {
        const cx = rng.float(0, N), cy = rng.float(0, N);
        const a = rng.float(0, Math.PI * 2), m = rng.float(0.5, 1.5);
        plates.push({ cx, cy, drift: [Math.cos(a) * m, Math.sin(a) * m], oceanic: rng.chance(oceanicFrac) });
    }
    // a world needs land: force at least two continental plates (deterministic)
    for (let k = 0; plates.filter(pl => !pl.oceanic).length < 2 && k < K; k++) plates[k].oceanic = false;

    /* voronoi with domain warp — boundaries wander like real sutures */
    const warp = new Noise2D(`${seed}/plate-warp`);
    const plateOf = new Int16Array(N * N);
    const AMP = N * 0.13, S1 = 3.2 / N;
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const wx = x + AMP * (warp.fbm(x * S1, y * S1, { octaves: 2 }) - 0.5) * 2;
            const wy = y + AMP * (warp.fbm(x * S1 + 9.2, y * S1 + 3.7, { octaves: 2 }) - 0.5) * 2;
            let best = 0, bd = Infinity;
            for (let k = 0; k < K; k++) {
                const dx = wx - plates[k].cx, dy = wy - plates[k].cy;
                const d = dx * dx + dy * dy;
                if (d < bd) { bd = d; best = k; }
            }
            plateOf[y * N + x] = best;
        }
    }

    /* boundary classification by relative drift along the boundary normal */
    const ridgeMask = new Float32Array(N * N);
    const arcMask = new Float32Array(N * N);
    const trenchMask = new Float32Array(N * N);
    const riftMask = new Float32Array(N * N);
    const R_BELT = Math.max(4, Math.round(N / 45));
    for (let y = 0; y < N - 1; y++) {
        for (let x = 0; x < N - 1; x++) {
            const i = y * N + x;
            const a = plateOf[i];
            for (let d = 0; d < 2; d++) {
                const nx = d === 0 ? x + 1 : x, ny = d === 0 ? y : y + 1;
                const b = plateOf[ny * N + nx];
                if (a === b) continue;
                const A = plates[a], B = plates[b];
                let nvx = B.cx - A.cx, nvy = B.cy - A.cy;
                const nl = Math.hypot(nvx, nvy) || 1;
                nvx /= nl; nvy /= nl;
                const rel = (A.drift[0] - B.drift[0]) * nvx + (A.drift[1] - B.drift[1]) * nvy;
                if (rel < -0.25) {                       // converging
                    if (!A.oceanic && !B.oceanic) {
                        stamp(ridgeMask, N, x, y, R_BELT, Math.min(1, -rel * 0.7));
                    } else {
                        // subduction: the oceanic side dives (trench), the other rides up (arc)
                        const [ocean, land] = A.oceanic ? [[x, y], [nx, ny]] : [[nx, ny], [x, y]];
                        stamp(trenchMask, N, ocean[0], ocean[1], Math.max(3, R_BELT - 2), Math.min(1, -rel * 0.6));
                        stamp(arcMask, N, land[0], land[1], Math.max(3, R_BELT - 1), Math.min(1, -rel * 0.55));
                    }
                } else if (rel > 0.25) {                 // diverging
                    stamp(riftMask, N, x, y, 3, Math.min(1, rel * 0.4));
                }
            }
        }
    }

    return { plateOf, plates, ridgeMask, arcMask, trenchMask, riftMask };
}
