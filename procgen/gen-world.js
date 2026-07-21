/* ------------------------------------------------------------------
 *  World map generator (planetary scale, staged pipeline).
 *
 *  plates (tectonics) → terrain (continental field + boundary belts)
 *  → hydrology (reused from the region, high threshold: only
 *  Nile-class rivers) → planetary climate (latitude bands, pack ice)
 *  → nations → trade → wonders → assemble.
 *
 *  1 cell ≈ 40 km (layers.cellKm); medium map ≈ 11 500 km across.
 *  Determinism discipline identical to gen-region.js: fixed LAYOUT
 *  draw order, fixed NAMES order, algorithmic stages RNG-free.
 * ------------------------------------------------------------------ */
import { Rng } from './rng.js';
import { makeEnvelope } from './schema.js';
import { nameFor } from './names.js';
import { BIOME, BIOME_CODES } from './region/biomes.js';
import { buildHydrology } from './region/hydrology.js';
import { buildPlates } from './world/plates.js';
import { buildWorldTerrain } from './world/terrain.js';
import { buildWorldClimate } from './world/climate.js';

const SIZE_N = { small: 224, medium: 288, large: 352 };
const RIVER_T = { dry: 700, normal: 450, wet: 280 };

export function generateWorld(seed, params = {}) {
    const p = {
        continents: 'continents', climate: 'temperate', nations: 'some',
        age: 'young', size: 'medium', seas: 0.6, rivers: 'normal', ...params,
    };
    const N = SIZE_N[p.size] || SIZE_N.medium;

    const model = makeEnvelope('world', seed, p);
    model.size = { w: N, h: N, unit: 'cell' };

    const rng = new Rng(`${seed}/layout:${p.continents}:${p.seas}:${p.nations}`);

    /* ---- stage 1: tectonics + terrain (height immutable afterwards) ---- */
    const plates = buildPlates({ N, seed, p }, rng);
    const terrain = buildWorldTerrain({ N, seed, p }, plates);
    const { height, sea, landSpan, slope } = terrain;

    /* ---- stage 2: hydrology (only continental-scale rivers) ---- */
    const hydro = buildHydrology({ N, height, sea, p, T: RIVER_T[p.rivers] ?? RIVER_T.normal });
    const { isOcean, lakeMask, isRiver, rivers, lakes } = hydro;

    /* ---- stage 3: planetary climate ---- */
    const climate = buildWorldClimate({
        N, seed, p, height, sea, landSpan, slope, isOcean, lakeMask, isRiver,
    });
    const { distWater, biome } = climate;

    /* ---- NAMES stream: world → nations → cities → seas → rivers → wonders ---- */
    const nameRng = new Rng(`${seed}/names`);
    model.name = nameFor(nameRng, 'world');

    /* ---- stages 4-6 (nations, trade, wonders) land in later commits ---- */

    /* ---- assemble (skeleton: rivers + lakes only so far) ---- */
    rivers.forEach((r, i) => model.entities.push({
        id: 'rv' + (i + 1), kind: 'river', name: null, pts: r.pts,
        tags: r.tags.map(t =>
            t.startsWith('to-lake:') ? 'to-lake:lk' + t.slice(8)
                : t.startsWith('tributary:') ? 'tributary:rv' + (Number(t.slice(10)) + 1)
                    : t),
    }));
    lakes.slice(0, 8).forEach(l => model.entities.push({
        id: 'lk' + l.id, kind: 'lake', name: null,
        x: Math.round(l.x), y: Math.round(l.y), w: l.cells, tags: [],
    }));

    /* ---- render-only layers ---- */
    model.layers.N = N;
    model.layers.cellKm = 40;
    model.layers.biomes = biome;

    const glyph = rng.sub('glyphs');
    const peaks = [];
    for (let y = 4; y < N - 4; y += 3) for (let x = 4; x < N - 4; x += 3) {
        const i = y * N + x;
        if ((biome[i] === BIOME.mountains || biome[i] === BIOME.snow)
            && peaks.every(pk => Math.hypot(pk[0] - x, pk[1] - y) >= 6) && glyph.chance(0.5)) {
            peaks.push([x, y]);
        }
    }
    model.layers.peaks = peaks;
    const trees = [];
    for (let y = 3; y < N - 3; y += 5) for (let x = 3; x < N - 3; x += 5) {
        const i = y * N + x;
        if ((biome[i] === BIOME.forest || biome[i] === BIOME.rainforest || biome[i] === BIOME.taiga)
            && glyph.chance(0.45)) {
            trees.push([x + glyph.float(-1.5, 1.5), y + glyph.float(-1.5, 1.5)]);
        }
    }
    model.layers.trees = trees;

    return model;
}

export { BIOME_CODES };
