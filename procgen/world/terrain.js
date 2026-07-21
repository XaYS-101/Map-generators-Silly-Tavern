/* ------------------------------------------------------------------
 *  World stage 1b: planetary heightmap.
 *
 *  Continental field = blurred mask of continental plates, blended
 *  with low-frequency warped fBm (coastline character) and the plate
 *  boundary masks: collision belts up, island arcs up, trenches down,
 *  rifts a light shoulder lift. Sea level by percentile of p.seas so
 *  the water fraction is stable for any seed.
 *
 *  Same contract as region/terrain: `height` is immutable afterwards.
 * ------------------------------------------------------------------ */
import { Noise2D } from '../noise.js';

const SEAS_SHIFT = { pangea: -0.05, continents: 0, archipelago: 0.05, shattered: 0.08 };

function smoothstep(a, b, t) {
    const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
    return x * x * (3 - 2 * x);
}

/** separable box blur, `passes` rounds of radius `r`, in place via swap */
function boxBlur(src, N, r, passes) {
    let a = src, b = new Float32Array(N * N);
    for (let p = 0; p < passes; p++) {
        // horizontal
        for (let y = 0; y < N; y++) {
            let sum = 0;
            for (let x = -r; x <= r; x++) sum += a[y * N + Math.min(N - 1, Math.max(0, x))];
            for (let x = 0; x < N; x++) {
                b[y * N + x] = sum / (2 * r + 1);
                const xo = Math.max(0, x - r), xi = Math.min(N - 1, x + r + 1);
                sum += a[y * N + xi] - a[y * N + xo];
            }
        }
        // vertical
        for (let x = 0; x < N; x++) {
            let sum = 0;
            for (let y = -r; y <= r; y++) sum += b[Math.min(N - 1, Math.max(0, y)) * N + x];
            for (let y = 0; y < N; y++) {
                a[y * N + x] = sum / (2 * r + 1);
                const yo = Math.max(0, y - r), yi = Math.min(N - 1, y + r + 1);
                sum += b[yi * N + x] - b[yo * N + x];
            }
        }
    }
    return a;
}

/**
 * @param {{N:number, seed:string, p:object}} ctx
 * @param {object} plates  result of buildPlates
 */
export function buildWorldTerrain(ctx, plates) {
    const { N, seed, p } = ctx;
    const { plateOf, ridgeMask, arcMask, trenchMask, riftMask } = plates;

    /* continental field: 1 on continental plates, blurred into shelves */
    let cont = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) cont[i] = plates.plates[plateOf[i]].oceanic ? 0 : 1;
    cont = boxBlur(cont, N, Math.max(3, Math.round(N / 60)), 3);

    const noiseH = new Noise2D(`${seed}/height`);
    const S = 1 / 60;
    const height = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const i = y * N + x;
            const base = noiseH.warped(x * S, y * S, { octaves: 5 });
            height[i] = 0.55 * smoothstep(0.25, 0.75, cont[i])
                + 0.30 * base
                + 0.90 * ridgeMask[i]
                + 0.40 * arcMask[i]
                - 0.50 * trenchMask[i]
                + 0.10 * riftMask[i];
        }
    }

    /* sea level by percentile → stable water fraction */
    const waterFrac = Math.min(0.85, Math.max(0.35,
        (p.seas ?? 0.6) + (SEAS_SHIFT[p.continents] ?? 0)));
    const sorted = Float32Array.from(height).sort();
    const sea = sorted[Math.min(N * N - 1, Math.floor(waterFrac * N * N))];
    const landMax = sorted[N * N - 1];
    const landSpan = Math.max(1e-6, landMax - sea);

    const slope = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const i = y * N + x;
            const h0 = height[i];
            let m = 0;
            if (x > 0) m = Math.max(m, Math.abs(h0 - height[i - 1]));
            if (x < N - 1) m = Math.max(m, Math.abs(h0 - height[i + 1]));
            if (y > 0) m = Math.max(m, Math.abs(h0 - height[i - N]));
            if (y < N - 1) m = Math.max(m, Math.abs(h0 - height[i + N]));
            slope[i] = m;
        }
    }

    return { height, sea, landSpan, slope };
}
