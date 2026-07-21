/* ------------------------------------------------------------------
 *  World stage 6: wonders, ruins & the dead empire.
 *
 *  A handful of world wonders land on the map's most dramatic cells
 *  (highest peaks, lowest coasts, deep desert, ashland/blight, tiny
 *  islands): each candidate is scored for "extremeness" plus a small
 *  LAYOUT jitter, then greedily spaced. On ancient worlds a fallen
 *  empire scatters ruins across the nations' lands and the frontier.
 *
 *  Names are drawn from the NAMES stream in emission order (wonders,
 *  then the dead empire, then ruins) so the global draw order holds.
 * ------------------------------------------------------------------ */
import { BIOME, BIOME_CODES } from '../region/biomes.js';
import { wonderName, deadEmpireName, ruinName } from '../names.js';

const WATER = new Set([BIOME.ocean, BIOME.lake, BIOME.iceshelf]);

function wonderKind(b) {
    switch (b) {
        case BIOME.mountains: case BIOME.snow: return 'spire';
        case BIOME.desert: case BIOME.badlands: return 'monument';
        case BIOME.forest: case BIOME.rainforest: return 'grove';
        case BIOME.beach: return 'deep';
        case BIOME.ashland: return 'furnace';
        case BIOME.blight: return 'scar';
        case BIOME.tundra: case BIOME.taiga: return 'colossus';
        case BIOME.swamp: return 'ruin';
        default: return 'monolith';
    }
}

function localOceanFrac(biome, N, x, y, r) {
    let ocean = 0, total = 0;
    for (let dy = -r; dy <= r; dy++) {
        const ny = y + dy; if (ny < 0 || ny >= N) continue;
        for (let dx = -r; dx <= r; dx++) {
            const nx = x + dx; if (nx < 0 || nx >= N) continue;
            const c = biome[ny * N + nx];
            total++;
            if (c === BIOME.ocean || c === BIOME.iceshelf) ocean++;
        }
    }
    return total ? ocean / total : 0;
}

/**
 * @param {object} ctx {N, p, biome, owner, height, sea, landSpan, rng (layout), nameRng}
 * @returns {{wonders:Array, ruins:Array, deadEmpire:(string|null)}}
 */
export function buildWonders(ctx) {
    const { N, p, biome, owner, height, sea, landSpan, rng, nameRng } = ctx;
    const M = N * N;
    const hNorm = i => (height[i] - sea) / landSpan;

    /* ---- wonders: extremeness score over a coarse candidate grid ---- */
    const n = rng.int(3, 6);
    const cands = [];
    for (let y = 6; y < N - 6; y += 6) {
        for (let x = 6; x < N - 6; x += 6) {
            const i = y * N + x;
            const b = biome[i];
            if (WATER.has(b)) continue;
            const h = hNorm(i);
            let ex = 0;
            ex += 3 * Math.max(0, h - 0.6);
            ex += 2.5 * Math.max(0, 0.06 - h);
            if (b === BIOME.desert || b === BIOME.badlands) ex += 1.5;
            if (b === BIOME.ashland || b === BIOME.blight) ex += 3;
            if (b === BIOME.snow || b === BIOME.mountains) ex += 2;
            if (b === BIOME.tundra) ex += 1;
            if (localOceanFrac(biome, N, x, y, 4) > 0.5) ex += 2.5;   // tiny island
            ex += rng.float(0, 0.8);                                  // LAYOUT jitter, grid order
            cands.push({ x, y, i, ex, biome: b });
        }
    }
    cands.sort((a, b) => b.ex - a.ex || a.i - b.i);
    const spacing = N / 8;
    const wchosen = [];
    for (const c of cands) {
        if (wchosen.length >= n) break;
        if (wchosen.some(k => Math.hypot(k.x - c.x, k.y - c.y) < spacing)) continue;
        wchosen.push(c);
    }
    wchosen.sort((a, b) => a.i - b.i);   // stable emission order
    const usedNames = new Set();
    const wonders = wchosen.map(c => ({
        x: c.x, y: c.y, kind: wonderKind(c.biome), name: wonderName(nameRng, BIOME_CODES[c.biome], usedNames),
    }));

    /* ---- ancient worlds: dead empire + scattered ruins ---- */
    let ruins = [], deadEmpire = null;
    if (p.age === 'ancient') {
        deadEmpire = deadEmpireName(nameRng);
        const nr = rng.int(4, 7);
        const rc = [];
        for (let y = 6; y < N - 6; y += 7) {
            for (let x = 6; x < N - 6; x += 7) {
                const i = y * N + x;
                if (WATER.has(biome[i])) continue;
                rc.push({ x, y, i, owner: owner[i], r: rng.float(0, 1) });   // LAYOUT jitter, grid order
            }
        }
        rc.sort((a, b) => b.r - a.r || a.i - b.i);
        const picks = [];
        const spacingR = N / 10;
        for (const c of rc) {
            if (picks.length >= nr) break;
            if (picks.some(k => Math.hypot(k.x - c.x, k.y - c.y) < spacingR)) continue;
            picks.push(c);
        }
        // nudge toward ≥2 distinct nations if the greedy pick landed in one realm
        const owners = new Set(picks.map(c => c.owner).filter(o => o >= 0));
        if (owners.size < 2 && picks.length) {
            const alt = rc.find(c => c.owner >= 0 && !owners.has(c.owner)
                && !picks.some(k => Math.hypot(k.x - c.x, k.y - c.y) < spacingR));
            if (alt) picks[picks.length - 1] = alt;
        }
        picks.sort((a, b) => a.i - b.i);
        ruins = picks.map(c => ({
            x: c.x, y: c.y, nation: c.owner >= 0 ? 'n' + c.owner : null, name: ruinName(nameRng, deadEmpire),
        }));
    }

    return { wonders, ruins, deadEmpire };
}
