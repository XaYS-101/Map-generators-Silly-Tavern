/* ------------------------------------------------------------------
 *  Region stage 1: terrain.
 *
 *  Warped fBm base + ridged noise modulated by a low-frequency "belt"
 *  mask (mountains form chains, not scattered bumps) + landmass mask
 *  (island/coast/inland) + optional volcanic cones. Sea level by
 *  percentile → stable land ratio for any seed.
 *
 *  The returned `height` array is IMMUTABLE from here on: later
 *  stages (hydrology) write to their own layers, never back into it.
 * ------------------------------------------------------------------ */
import { Noise2D } from '../noise.js';

const SCALE = 1 / 46;   // noise-space units per cell (1 cell ≈ 1.5 km)

function smoothstep(a, b, t) {
    const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
    return x * x * (3 - 2 * x);
}

/**
 * @param {{N:number, seed:string, p:object}} ctx
 * @param {import('../rng.js').Rng} rng  layout stream (coastSide, volcano placement)
 */
export function buildTerrain(ctx, rng) {
    const { N, seed, p } = ctx;
    const noiseH = new Noise2D(`${seed}/height`);
    const noiseR = new Noise2D(`${seed}/ridge`);
    const noiseB = new Noise2D(`${seed}/belt`);
    const coastSide = rng.int(0, 3);   // used only for mask 'coast'

    // volcanic flavor: 1–2 cones pushed up before sea level is chosen
    const volcanoes = [];
    if (p.flavor === 'volcanic') {
        const n = rng.int(1, 2);
        for (let i = 0; i < n; i++) {
            volcanoes.push({
                x: rng.float(N * 0.28, N * 0.72),
                y: rng.float(N * 0.28, N * 0.72),
                r: rng.float(N * 0.05, N * 0.09),
            });
        }
    }

    const height = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const xs = x * SCALE, ys = y * SCALE;
            const base = noiseH.warped(xs, ys, { octaves: 5 });
            const ridge = noiseR.ridged(xs * 1.6, ys * 1.6, { octaves: 4 });
            const belt = smoothstep(0.5, 0.64, noiseB.fbm(xs * 0.35, ys * 0.35, { octaves: 2 }));
            let v = base * 0.72 + ridge * belt * 0.45;
            if (p.mask === 'island') {
                const dx = (x - N / 2) / (N / 2), dy = (y - N / 2) / (N / 2);
                v *= Math.max(0, 1 - (dx * dx + dy * dy) * 0.85);
            } else if (p.mask === 'coast') {
                const t = [x / N, 1 - x / N, y / N, 1 - y / N][coastSide];
                v *= 0.15 + 0.85 * Math.min(1, t * 1.6);
            }
            for (const vol of volcanoes) {
                const d2 = ((x - vol.x) ** 2 + (y - vol.y) ** 2) / (vol.r * vol.r);
                const crater = 1 - 0.6 * Math.exp(-d2 * 18);   // dip at the very top
                v += Math.exp(-d2) * 0.5 * crater;
            }
            height[y * N + x] = v;
        }
    }

    /* sea level by percentile → stable land ratio */
    const waterFrac = p.mask === 'inland' ? Math.min(p.water, 0.1) : p.water;
    const sorted = Float32Array.from(height).sort();
    const sea = sorted[Math.min(N * N - 1, Math.floor(waterFrac * N * N))];
    const landMax = sorted[N * N - 1];
    const landSpan = Math.max(1e-6, landMax - sea);

    /* per-cell slope (max drop to a 4-neighbor), used by biomes/settlements/roads */
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

    return { height, sea, landSpan, slope, coastSide, volcanoes };
}
