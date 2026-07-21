/* ------------------------------------------------------------------
 *  Region stage 3: climate & biomes.
 *
 *  Distance-to-water (multi-source BFS) + latitude/altitude temperature
 *  + noise/proximity moisture with a single directional rain-shadow
 *  sweep → a Whittaker classification, then flavor overlays (wasteland /
 *  blighted / volcanic) that only touch vegetation (plus volcano halos).
 *
 *  DOM-free, deterministic. The only RNG draw is the upwind direction,
 *  taken from the layout stream by the caller and passed in as ctx.wind.
 * ------------------------------------------------------------------ */
import { Noise2D } from '../noise.js';
import { BIOME } from './biomes.js';

const SCALE = 1 / 46;   // must match terrain / the old moisture pass
const DIST_CAP = 60;

/* E, SE, S, SW, W, NW, N, NE — matches hydrology's neighbor order */
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * @param {object} ctx {N, seed, p, height, sea, landSpan, slope, volcanoes,
 *                       isOcean, lakeMask, isRiver, wind}
 */
export function buildClimate(ctx) {
    const { N, seed, p, height, sea, landSpan, slope, volcanoes,
        isOcean, lakeMask, isRiver, wind } = ctx;
    const M = N * N;
    const hn = i => (height[i] - sea) / landSpan;

    /* ---- (a) distance to nearest water: multi-source BFS, cap 60 ---- */
    const distWater = new Uint16Array(M).fill(DIST_CAP);
    const queue = new Int32Array(M);
    let head = 0, tail = 0;
    for (let i = 0; i < M; i++) {
        if (isOcean[i] || lakeMask[i] || isRiver[i]) { distWater[i] = 0; queue[tail++] = i; }
    }
    while (head < tail) {
        const c = queue[head++];
        const d = distWater[c];
        if (d >= DIST_CAP) continue;
        const cx = c % N, cy = (c / N) | 0;
        const nd = d + 1;
        for (let k = 0; k < 4; k++) {
            const nx = cx + DX[k * 2], ny = cy + DY[k * 2];   // 4-connected: E,S,W,N
            if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
            const n = ny * N + nx;
            if (nd < distWater[n]) { distWater[n] = nd; queue[tail++] = n; }
        }
    }

    /* ---- (b) temperature: latitude band + altitude + gentle jitter ---- */
    const [latBase, latGrad] = { cold: [0.02, 0.38], temperate: [0.22, 0.52], hot: [0.52, 0.42] }[p.climate]
        || [0.22, 0.52];
    const jitter = new Noise2D(`${seed}/temp-jitter`);
    const temp = new Float32Array(M);
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const i = y * N + x;
            const jn = jitter.fbm(x * SCALE * 0.45, y * SCALE * 0.45, { octaves: 3 });
            temp[i] = latBase + latGrad * (y / N) - 0.55 * Math.max(0, hn(i)) + 0.08 * (jn - 0.5);
        }
    }

    /* ---- (c) rain shadow: one directional sweep from the upwind edge ---- */
    const dx = DX[wind], dy = DY[wind];
    const xStart = dx >= 0 ? 0 : N - 1, xEnd = dx >= 0 ? N : -1, xStep = dx >= 0 ? 1 : -1;
    const yStart = dy >= 0 ? 0 : N - 1, yEnd = dy >= 0 ? N : -1, yStep = dy >= 0 ? 1 : -1;
    const shadow = new Float32Array(M);
    for (let y = yStart; y !== yEnd; y += yStep) {
        for (let x = xStart; x !== xEnd; x += xStep) {
            const i = y * N + x;
            const ux = x - dx, uy = y - dy;   // upwind neighbor, already processed
            const sUp = (ux >= 0 && uy >= 0 && ux < N && uy < N) ? shadow[uy * N + ux] : 0;
            const h = hn(i);
            shadow[i] = Math.max(0, sUp * 0.97 + (h > 0.55 ? 0.06 : -0.01));
        }
    }

    /* ---- (d) moisture: noise + water proximity − rain shadow + flavor ---- */
    const noiseM = new Noise2D(`${seed}/moisture`);
    const flavorShift = p.flavor === 'wasteland' ? -0.15 : 0;
    const moist = new Float32Array(M);
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const i = y * N + x;
            const fb = noiseM.fbm(x * SCALE * 1.4, y * SCALE * 1.4, { octaves: 4 });
            const m = 0.52 * fb + 0.42 * Math.exp(-distWater[i] / 14)
                - Math.min(shadow[i], 0.25) + flavorShift;
            moist[i] = clamp01(m);
        }
    }

    /* ---- (e) classification ---- */
    const biome = new Uint8Array(M);
    for (let i = 0; i < M; i++) {
        if (isOcean[i]) { biome[i] = BIOME.ocean; continue; }
        if (lakeMask[i]) { biome[i] = BIOME.lake; continue; }
        const h = hn(i), t = temp[i], m = moist[i];
        const snowLine = Math.min(0.9, Math.max(0.55, 0.80 + 0.10 * (t - 0.5)));
        if (h > snowLine) { biome[i] = BIOME.snow; continue; }
        if (h > 0.62) { biome[i] = BIOME.mountains; continue; }
        if (h < 0.035) { biome[i] = BIOME.beach; continue; }
        if (h < 0.12 && m > 0.68 && slope[i] < 0.02 && distWater[i] <= 3) { biome[i] = BIOME.swamp; continue; }
        biome[i] = whittaker(t, m);
    }

    /* ---- (f) flavor overlay: vegetation → wastes/blight/ash (+ volcano halos) ---- */
    if (p.flavor === 'wasteland' || p.flavor === 'blighted' || p.flavor === 'volcanic') {
        const corr = new Noise2D(`${seed}/corruption`);
        const veg = new Set([BIOME.grassland, BIOME.forest, BIOME.rainforest, BIOME.savanna, BIOME.taiga]);
        for (let y = 0; y < N; y++) {
            for (let x = 0; x < N; x++) {
                const i = y * N + x;
                if (!veg.has(biome[i])) continue;
                const c = corr.fbm(x * SCALE * 0.6, y * SCALE * 0.6, { octaves: 2 });
                if (p.flavor === 'wasteland') {
                    if (c > 0.66) biome[i] = BIOME.desert;
                    else if (c > 0.52) biome[i] = BIOME.badlands;
                } else if (p.flavor === 'blighted') {
                    if (c > 0.52) biome[i] = BIOME.blight;
                } else if (p.flavor === 'volcanic') {
                    if (c > 0.55) biome[i] = BIOME.ashland;
                }
            }
        }
        // volcano halos replace anything on land, not just vegetation
        if (p.flavor === 'volcanic' && volcanoes) {
            for (const vol of volcanoes) {
                const R = vol.r * 1.6;
                const x0 = Math.max(0, Math.floor(vol.x - R)), x1 = Math.min(N - 1, Math.ceil(vol.x + R));
                const y0 = Math.max(0, Math.floor(vol.y - R)), y1 = Math.min(N - 1, Math.ceil(vol.y + R));
                const R2 = R * R;
                for (let y = y0; y <= y1; y++) {
                    for (let x = x0; x <= x1; x++) {
                        const i = y * N + x;
                        if (biome[i] <= BIOME.lake) continue;   // keep water
                        if ((x - vol.x) ** 2 + (y - vol.y) ** 2 <= R2) biome[i] = BIOME.ashland;
                    }
                }
            }
        }
    }

    return { temp, moist, distWater, biome };
}

/** Whittaker band table keyed by temperature then moisture. */
function whittaker(t, m) {
    if (t < 0.22) return m < 0.45 ? BIOME.tundra : BIOME.taiga;
    if (t < 0.45) {
        if (m < 0.25) return BIOME.badlands;
        if (m < 0.5) return BIOME.grassland;
        if (m < 0.75) return BIOME.forest;
        return BIOME.taiga;
    }
    if (t < 0.72) {
        if (m < 0.22) return BIOME.desert;
        if (m < 0.48) return BIOME.grassland;
        if (m < 0.75) return BIOME.forest;
        return BIOME.rainforest;
    }
    if (m < 0.3) return BIOME.desert;
    if (m < 0.55) return BIOME.savanna;
    if (m < 0.75) return BIOME.forest;
    return BIOME.rainforest;
}
