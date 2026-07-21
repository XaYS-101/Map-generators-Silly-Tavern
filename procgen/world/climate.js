/* ------------------------------------------------------------------
 *  World stage 3: planetary climate.
 *
 *  Latitude is symmetric around the equator (map middle row): polar
 *  caps at the edges, a subtropical desert belt near lat ≈ 0.3–0.45,
 *  an equatorial rainforest belt. Prevailing winds by latitude band
 *  (trade easterlies / westerlies / polar easterlies) pick between two
 *  precomputed rain-shadow sweeps. Continentality via BFS distance to
 *  water. Classification = the region Whittaker table + planetary
 *  overrides, incl. `iceshelf` painted OVER polar ocean cells (water
 *  for every other stage — hydrology never sees it).
 * ------------------------------------------------------------------ */
import { Noise2D } from '../noise.js';
import { BIOME } from '../region/biomes.js';

const DIST_CAP = 120;
const T_EQ = { iceage: 0.55, temperate: 0.86, hot: 1.05 };

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

/** one directional rain-shadow sweep (dx ∈ {1,-1}, horizontal winds only) */
function sweepShadow(N, hn, dx) {
    const shadow = new Float32Array(N * N);
    const xStart = dx > 0 ? 0 : N - 1, xEnd = dx > 0 ? N : -1;
    for (let y = 0; y < N; y++) {
        for (let x = xStart; x !== xEnd; x += dx) {
            const i = y * N + x;
            const ux = x - dx;
            const sUp = (ux >= 0 && ux < N) ? shadow[y * N + ux] : 0;
            shadow[i] = Math.max(0, sUp * 0.97 + (hn(i) > 0.5 ? 0.05 : -0.008));
        }
    }
    return shadow;
}

/**
 * @param {object} ctx {N, seed, p, height, sea, landSpan, slope,
 *                       isOcean, lakeMask, isRiver}
 */
export function buildWorldClimate(ctx) {
    const { N, seed, p, height, sea, landSpan, slope, isOcean, lakeMask, isRiver } = ctx;
    const M = N * N;
    const hn = i => (height[i] - sea) / landSpan;
    const lat01 = y => Math.abs(y - N / 2) / (N / 2);   // 0 equator → 1 pole

    /* ---- continentality: BFS distance to any water ---- */
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
        if (cx + 1 < N && nd < distWater[c + 1]) { distWater[c + 1] = nd; queue[tail++] = c + 1; }
        if (cx > 0 && nd < distWater[c - 1]) { distWater[c - 1] = nd; queue[tail++] = c - 1; }
        if (cy + 1 < N && nd < distWater[c + N]) { distWater[c + N] = nd; queue[tail++] = c + N; }
        if (cy > 0 && nd < distWater[c - N]) { distWater[c - N] = nd; queue[tail++] = c - N; }
    }

    /* ---- temperature: equator warm, poles cold, altitude lapse ---- */
    const tEq = T_EQ[p.climate] ?? T_EQ.temperate;
    const jitter = new Noise2D(`${seed}/temp-jitter`);
    const temp = new Float32Array(M);
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const i = y * N + x;
            const jn = jitter.fbm(x * 0.02, y * 0.02, { octaves: 2 });
            temp[i] = tEq - 0.95 * lat01(y) - 0.5 * Math.max(0, hn(i)) + 0.07 * (jn - 0.5);
        }
    }

    /* ---- moisture: noise + water proximity − banded rain shadow ---- */
    const shadowE = sweepShadow(N, hn, 1);    // westerlies: wind from the west → sweep east
    const shadowW = sweepShadow(N, hn, -1);   // easterlies: wind from the east → sweep west
    const noiseM = new Noise2D(`${seed}/moisture`);
    const moist = new Float32Array(M);
    for (let y = 0; y < N; y++) {
        const l = lat01(y);
        const westerly = l >= 0.33 && l < 0.66;   // trade + polar winds are easterly
        // subtropical high-pressure belt: dry air at lat ≈ 0.30–0.45
        const beltDry = 0.24 * Math.exp(-(((l - 0.37) / 0.09) ** 2));
        // equatorial convergence: wet air near the equator
        const eqWet = 0.18 * Math.exp(-((l / 0.13) ** 2));
        for (let x = 0; x < N; x++) {
            const i = y * N + x;
            const fb = noiseM.fbm(x * 0.03, y * 0.03, { octaves: 3 });
            const shadow = westerly ? shadowE[i] : shadowW[i];
            moist[i] = clamp01(0.42 * fb + 0.40 * Math.exp(-distWater[i] / 22)
                - Math.min(shadow, 0.25) - beltDry + eqWet);
        }
    }

    /* ---- classification: Whittaker + planetary overrides ---- */
    const biome = new Uint8Array(M);
    for (let y = 0; y < N; y++) {
        const l = lat01(y);
        for (let x = 0; x < N; x++) {
            const i = y * N + x;
            const t = temp[i], m = moist[i];
            if (isOcean[i]) {
                biome[i] = (t < -0.05) ? BIOME.iceshelf : BIOME.ocean;   // polar pack ice
                continue;
            }
            if (lakeMask[i]) { biome[i] = (t < -0.05) ? BIOME.snow : BIOME.lake; continue; }
            const h = hn(i);
            const snowLine = Math.min(0.9, Math.max(0.4, 0.78 + 0.25 * (t - 0.4)));
            if (t < 0 || h > snowLine) { biome[i] = BIOME.snow; continue; }
            if (h > 0.6) { biome[i] = BIOME.mountains; continue; }
            if (h < 0.03 && l < 0.75) { biome[i] = BIOME.beach; continue; }
            if (h < 0.1 && m > 0.68 && slope[i] < 0.02 && distWater[i] <= 3) { biome[i] = BIOME.swamp; continue; }
            if (l < 0.15 && m > 0.55 && t > 0.5) { biome[i] = BIOME.rainforest; continue; }   // equatorial belt
            biome[i] = whittaker(t, m);
        }
    }

    return { temp, moist, distWater, biome };
}

/** Whittaker band table (same shape as the region's, tuned for world temps). */
function whittaker(t, m) {
    if (t < 0.16) return m < 0.45 ? BIOME.tundra : BIOME.taiga;
    if (t < 0.4) {
        if (m < 0.22) return BIOME.badlands;
        if (m < 0.48) return BIOME.grassland;
        if (m < 0.75) return BIOME.forest;
        return BIOME.taiga;
    }
    if (t < 0.68) {
        if (m < 0.2) return BIOME.desert;
        if (m < 0.45) return BIOME.grassland;
        if (m < 0.72) return BIOME.forest;
        return BIOME.rainforest;
    }
    if (m < 0.28) return BIOME.desert;
    if (m < 0.52) return BIOME.savanna;
    if (m < 0.72) return BIOME.forest;
    return BIOME.rainforest;
}
