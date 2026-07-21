/* ------------------------------------------------------------------
 *  Region / world map generator (staged pipeline).
 *
 *  terrain (immutable heightmap) → hydrology (lakes, D8 flow, rivers)
 *  → climate (distance-to-water, temperature, moisture, Whittaker
 *  biomes + flavor overlays) → features (named biome blobs, POIs)
 *  → settlements (suitability scoring) → roads (MST + A* routing,
 *  bridges/fords) → assemble.
 *
 *  Grid size N comes from p.size (small/medium/large); 1 cell ≈ 1.5 km
 *  (layers.cellKm). Determinism: the LAYOUT stream keeps a fixed draw
 *  order, the NAMES stream a fixed naming order (see below), and every
 *  subsystem derives its own sub-stream — see rng.js.
 * ------------------------------------------------------------------ */
import { Rng } from './rng.js';
import { makeEnvelope, compass } from './schema.js';
import { nameFor, riverName, lakeName } from './names.js';
import { BIOME, BIOME_CODES } from './region/biomes.js';
import { buildTerrain } from './region/terrain.js';
import { buildHydrology } from './region/hydrology.js';
import { buildClimate } from './region/climate.js';
import { buildFeatures } from './region/features.js';
import { buildSettlements } from './region/settlements.js';
import { buildRoads } from './region/roads.js';

export { BIOME_CODES };

const SIZE_N = { small: 192, medium: 256, large: 384 };

export function generateRegion(seed, params = {}) {
    const p = {
        mask: 'island', water: 0.42, settlements: 'some', size: 'medium',
        climate: 'temperate', flavor: 'normal', rivers: 'normal', ...params,
    };
    const N = SIZE_N[p.size] || SIZE_N.medium;

    const model = makeEnvelope('region', seed, p);
    model.size = { w: N, h: N, unit: 'cell' };

    // layout seed string kept EXACTLY as before so old param combos map identically
    const rng = new Rng(`${seed}/layout:${p.mask}:${p.water}:${p.settlements}`);

    /* ---- stage 1: terrain (height immutable from here) ---- */
    const terrain = buildTerrain({ N, seed, p }, rng);
    const { height, sea, landSpan, slope, volcanoes } = terrain;

    /* ---- stage 2: hydrology ---- */
    const hydro = buildHydrology({ N, height, sea, p });
    const { isOcean, lakeMask, isRiver, flowTo, flowAcc, rivers, lakes, confluences, T } = hydro;

    /* ---- stage 3: climate + biomes ---- */
    const wind = rng.int(0, 7);   // upwind direction for rain shadow (LAYOUT draw)
    const climate = buildClimate({
        N, seed, p, height, sea, landSpan, slope, volcanoes,
        isOcean, lakeMask, isRiver, wind,
    });
    const { distWater, biome } = climate;

    /* ---- NAMES stream: region → settlements → blobs → rivers → lakes ---- */
    const nameRng = new Rng(`${seed}/names`);
    model.name = nameFor(nameRng, 'region');

    /* ---- stage 5: settlements (before features: layout floats, then POI draws) ---- */
    const { settlements, scored } = buildSettlements({
        N, p, biome, slope, distWater, isOcean, lakeMask, isRiver, confluences, rng, nameRng,
    });

    /* ---- stage 4: features (blob names after settlement names; POI count on layout) ---- */
    const { blobs, pois } = buildFeatures({ N, biome, settlements, scored, rng, nameRng });

    /* ---- stage 6: roads + bridges ---- */
    const { roads, bridges, edges } = buildRoads({
        N, settlements, height, sea, landSpan, biome,
        isOcean, lakeMask, isRiver, flowTo, flowAcc, T, rivers,
    });

    /* ================= assemble ================= */
    settlements.forEach((s, i) => model.entities.push({
        id: 's' + (i + 1), kind: 'settlement', name: s.name, purpose: s.kind,
        x: s.x, y: s.y, tags: s.tags,
    }));
    pois.forEach((s, i) => model.entities.push({
        id: 'p' + (i + 1), kind: 'poi', purpose: s.kind, x: s.x, y: s.y,
        name: null, tags: [],
    }));

    // river names: top 4 by maxAcc, drawn in ENTITY order
    const top4 = rivers.map((r, i) => i)
        .sort((a, b) => rivers[b].maxAcc - rivers[a].maxAcc || a - b)
        .slice(0, 4);
    const top4set = new Set(top4);
    rivers.forEach((r, i) => model.entities.push({
        id: 'rv' + (i + 1), kind: 'river',
        name: top4set.has(i) ? riverName(nameRng) : null,
        pts: r.pts,
        tags: r.tags.map(t =>
            t.startsWith('to-lake:') ? 'to-lake:lk' + t.slice(8)
                : t.startsWith('tributary:') ? 'tributary:rv' + (Number(t.slice(10)) + 1)
                    : t),
    }));

    // lakes: emit top 8 by cells; top 3 named (drawn in size order)
    const lakesBySize = [...lakes].sort((a, b) => b.cells - a.cells || a.id - b.id);
    const lakeNameById = new Map();
    for (let k = 0; k < Math.min(3, lakesBySize.length); k++) lakeNameById.set(lakesBySize[k].id, lakeName(nameRng));
    lakesBySize.slice(0, 8).forEach(l => model.entities.push({
        id: 'lk' + l.id, kind: 'lake', name: lakeNameById.get(l.id) || null,
        x: Math.round(l.x), y: Math.round(l.y), w: l.cells, tags: [],
    }));

    blobs.forEach((b, i) => model.entities.push({
        id: 'b' + (i + 1), kind: 'biome', purpose: b.biome, name: b.name,
        x: Math.round(b.x), y: Math.round(b.y), tags: [],
    }));
    roads.forEach((r, i) => model.entities.push({ id: 'rd' + (i + 1), kind: 'road', pts: r.pts }));
    bridges.forEach((br, i) => model.entities.push({
        id: 'br' + (i + 1), kind: 'bridge', purpose: br.kind, x: br.x, y: br.y, angle: br.angle,
        road: 'rd' + (br.roadIdx + 1), river: br.riverIdx >= 0 ? 'rv' + (br.riverIdx + 1) : null,
        tags: [],
    }));

    model.edges = edges.map(e => ({
        a: 's' + (e.ai + 1), b: 's' + (e.bi + 1), kind: 'road',
        dir: compass(settlements[e.ai].x, settlements[e.ai].y, settlements[e.bi].x, settlements[e.bi].y),
    }));

    /* ---- render-only layers (stripped from JSON export) ---- */
    model.layers.N = N;
    model.layers.cellKm = 1.5;
    model.layers.biomes = biome;

    const glyph = rng.sub('glyphs');
    const isCode = (i, ...codes) => codes.includes(biome[i]);

    const peaks = [];
    for (let y = 4; y < N - 4; y += 3) for (let x = 4; x < N - 4; x += 3) {
        const i = y * N + x;
        if (isCode(i, BIOME.mountains, BIOME.snow)
            && peaks.every(pk => Math.hypot(pk[0] - x, pk[1] - y) >= 6) && glyph.chance(0.6)) {
            peaks.push([x, y]);
        }
    }
    model.layers.peaks = peaks;

    const trees = [];
    for (let y = 3; y < N - 3; y += 4) for (let x = 3; x < N - 3; x += 4) {
        const i = y * N + x;
        if (isCode(i, BIOME.forest, BIOME.rainforest, BIOME.taiga) && glyph.chance(0.55)) {
            trees.push([x + glyph.float(-1.5, 1.5), y + glyph.float(-1.5, 1.5)]);
        }
    }
    model.layers.trees = trees;

    const dunes = [];
    for (let y = 3; y < N - 3; y += 5) for (let x = 3; x < N - 3; x += 5) {
        if (isCode(y * N + x, BIOME.desert) && glyph.chance(0.5)) dunes.push([x, y]);
    }
    model.layers.dunes = dunes;

    const deadTrees = [];
    for (let y = 3; y < N - 3; y += 5) for (let x = 3; x < N - 3; x += 5) {
        const i = y * N + x;
        if (isCode(i, BIOME.blight) && glyph.chance(0.5)) deadTrees.push([x + glyph.float(-1.5, 1.5), y + glyph.float(-1.5, 1.5)]);
    }
    model.layers.deadTrees = deadTrees;

    const tussocks = [];
    for (let y = 3; y < N - 3; y += 6) for (let x = 3; x < N - 3; x += 6) {
        const i = y * N + x;
        if (isCode(i, BIOME.tundra) && glyph.chance(0.5)) tussocks.push([x + glyph.float(-1.5, 1.5), y + glyph.float(-1.5, 1.5)]);
    }
    model.layers.tussocks = tussocks;

    const vents = [];
    for (let y = 3; y < N - 3; y += 7) for (let x = 3; x < N - 3; x += 7) {
        if (isCode(y * N + x, BIOME.ashland) && glyph.chance(0.35)) vents.push([x, y]);
    }
    model.layers.vents = vents;

    return model;
}
