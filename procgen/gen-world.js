/* ------------------------------------------------------------------
 *  World map generator (planetary scale, staged pipeline).
 *
 *  plates (tectonics) → terrain (continental field + boundary belts)
 *  → hydrology (reused from the region, high threshold: only
 *  Nile-class rivers) → planetary climate (latitude bands, pack ice)
 *  → nations → trade → continents/seas → wonders → assemble.
 *
 *  1 cell ≈ 40 km (layers.cellKm); medium map ≈ 11 500 km across.
 *  Determinism discipline identical to gen-region.js: fixed LAYOUT
 *  draw order (plates → nations → wonders → decor), fixed NAMES order
 *  (world → nations+gov → cities → continents → seas → rivers → lakes
 *  → wonders → dead empire/ruins), algorithmic stages RNG-free.
 * ------------------------------------------------------------------ */
import { Rng } from './rng.js';
import { makeEnvelope } from './schema.js';
import { nameFor, riverName, lakeName, continentName, seaName, oceanName } from './names.js';
import { BIOME, BIOME_CODES } from './region/biomes.js';
import { buildHydrology } from './region/hydrology.js';
import { buildPlates } from './world/plates.js';
import { buildWorldTerrain } from './world/terrain.js';
import { buildWorldClimate } from './world/climate.js';
import { buildNations } from './world/nations.js';
import { buildTrade } from './world/trade.js';
import { buildWonders } from './world/wonders.js';

const SIZE_N = { small: 224, medium: 288, large: 352 };
const RIVER_T = { dry: 700, normal: 450, wet: 280 };

/* 4-connected neighbour offsets for the continent/sea flood fills */
const DX4 = [1, -1, 0, 0];
const DY4 = [0, 0, 1, -1];

/* 8-colour muted parchment palette (indexed by nation.colorIdx) */
const NATION_PALETTE = [
    [150, 62, 54],    // deep red
    [58, 82, 120],    // blue
    [96, 66, 110],    // violet
    [72, 104, 66],    // green
    [168, 132, 58],   // gold
    [66, 110, 108],   // teal
    [110, 84, 58],    // umber
    [120, 70, 96],    // plum
];

export function generateWorld(seed, params = {}) {
    const p = {
        continents: 'continents', climate: 'temperate', nations: 'some',
        age: 'young', size: 'medium', seas: 0.6, rivers: 'normal', ...params,
    };
    const N = SIZE_N[p.size] || SIZE_N.medium;
    const M = N * N;

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
    const { distWater, temp, biome } = climate;

    /* ---- NAMES stream: world first ---- */
    const nameRng = new Rng(`${seed}/names`);
    model.name = nameFor(nameRng, 'world');

    /* ---- stage 4: nations (LAYOUT + NAMES: nations, gov, cities) ---- */
    const { nations, owner, relations } = buildNations({
        N, p, height, sea, landSpan, biome, slope, distWater, temp,
        isOcean, lakeMask, isRiver, rng, nameRng,
    });
    // entity ids for capitals/cities (needed by trade & assembly)
    let cityK = 0;
    for (const n of nations) { n.capId = 'cap' + n.id; for (const c of n.cities) c.id = 'c' + (++cityK); }

    /* ---- stage 5: trade (RNG-free) ---- */
    const { routes } = buildTrade({
        N, biome, height, sea, landSpan, isOcean, lakeMask, isRiver,
        flowAcc: hydro.flowAcc, owner, nations, relations,
    });

    /* ---- continents & seas: connected-component discovery (RNG-free) ---- */
    const q = new Int32Array(M);
    const landComp = new Int32Array(M).fill(-1);
    const continents = [];
    let cid = 0;
    for (let i = 0; i < M; i++) {
        if (landComp[i] !== -1) continue;
        if (isOcean[i] || lakeMask[i]) { landComp[i] = -2; continue; }
        let head = 0, tail = 0; q[tail++] = i; landComp[i] = cid;
        let cells = 0, sx = 0, sy = 0;
        while (head < tail) {
            const c = q[head++]; const cx = c % N, cy = (c / N) | 0;
            cells++; sx += cx; sy += cy;
            for (let d = 0; d < 4; d++) {
                const nx = cx + DX4[d], ny = cy + DY4[d];
                if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
                const nb = ny * N + nx;
                if (landComp[nb] !== -1) continue;
                if (isOcean[nb] || lakeMask[nb]) { landComp[nb] = -2; }
                else { landComp[nb] = cid; q[tail++] = nb; }
            }
        }
        if (cells >= M * 0.02) continents.push({ cells, cid, x: Math.round(sx / cells), y: Math.round(sy / cells) });
        cid++;
    }
    continents.sort((a, b) => b.cells - a.cells || (a.y * N + a.x) - (b.y * N + b.x));

    const waterComp = new Int32Array(M).fill(-1);
    const bodies = [];
    let wid = 0;
    for (let i = 0; i < M; i++) {
        if (waterComp[i] !== -1) continue;
        if (!isOcean[i]) { waterComp[i] = -2; continue; }
        let head = 0, tail = 0; q[tail++] = i; waterComp[i] = wid;
        let cells = 0, open = 0, sx = 0, sy = 0;
        while (head < tail) {
            const c = q[head++]; const cx = c % N, cy = (c / N) | 0;
            cells++; sx += cx; sy += cy;
            if (biome[c] !== BIOME.iceshelf) open++;
            for (let d = 0; d < 4; d++) {
                const nx = cx + DX4[d], ny = cy + DY4[d];
                if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
                const nb = ny * N + nx;
                if (waterComp[nb] !== -1) continue;
                if (isOcean[nb]) { waterComp[nb] = wid; q[tail++] = nb; }
                else waterComp[nb] = -2;
            }
        }
        bodies.push({ cells, open, wid, x: Math.round(sx / cells), y: Math.round(sy / cells) });
        wid++;
    }
    const namedBodies = bodies.filter(b => b.open > 0)   // skip iceshelf-only bodies
        .sort((a, b) => b.cells - a.cells || (a.y * N + a.x) - (b.y * N + b.x));
    const oceanCount = (namedBodies.length >= 2 && namedBodies[1].cells >= M * 0.06) ? 2 : (namedBodies.length ? 1 : 0);
    const seaBodies = [];
    namedBodies.forEach((b, k) => {
        if (k < oceanCount) seaBodies.push({ ...b, ocean: true });
        else if (b.cells >= M * 0.01) seaBodies.push({ ...b, ocean: false });
    });

    /* ---- distance-to-land over ocean (label anchors + decor) ---- */
    const distLand = new Int32Array(M).fill(-1);
    {
        let head = 0, tail = 0;
        for (let i = 0; i < M; i++) if (!isOcean[i]) { distLand[i] = 0; q[tail++] = i; }
        while (head < tail) {
            const c = q[head++]; const cx = c % N, cy = (c / N) | 0; const nd = distLand[c] + 1;
            for (let d = 0; d < 4; d++) {
                const nx = cx + DX4[d], ny = cy + DY4[d];
                if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
                const nb = ny * N + nx;
                if (isOcean[nb] && distLand[nb] < 0) { distLand[nb] = nd; q[tail++] = nb; }
            }
        }
    }

    /* label anchors: a sea label sits on its own deepest water, a continent
     * label on its own landmass (a C-shaped body's centroid may miss both) */
    {
        const bestBy = new Map();   // wid → cell index of max distLand
        for (let i = 0; i < M; i++) {
            const w = waterComp[i];
            if (w < 0) continue;
            const cur = bestBy.get(w);
            if (cur === undefined || distLand[i] > distLand[cur]) bestBy.set(w, i);
        }
        for (const b of seaBodies) {
            const bi = bestBy.get(b.wid);
            if (bi !== undefined) { b.x = bi % N; b.y = (bi / N) | 0; }
        }
        for (const c of continents) {
            if (landComp[c.y * N + c.x] === c.cid) continue;
            let snapped = false;
            for (let r = 1; r < N / 5 && !snapped; r++) {
                for (let dy = -r; dy <= r && !snapped; dy++) for (let dx = -r; dx <= r; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                    const nx = c.x + dx, ny = c.y + dy;
                    if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
                    if (landComp[ny * N + nx] === c.cid) { c.x = nx; c.y = ny; snapped = true; break; }
                }
            }
        }
    }

    /* ---- NAMES: continents → seas → rivers → lakes ---- */
    for (const c of continents) c.name = continentName(nameRng);
    for (const b of seaBodies) b.name = b.ocean ? oceanName(nameRng) : seaName(nameRng);

    const top4 = rivers.map((r, i) => i).sort((a, b) => rivers[b].maxAcc - rivers[a].maxAcc || a - b).slice(0, 4);
    const top4set = new Set(top4);
    const riverNames = rivers.map((r, i) => (top4set.has(i) ? riverName(nameRng) : null));

    const lakesBySize = [...lakes].sort((a, b) => b.cells - a.cells || a.id - b.id);
    const lakeNameById = new Map();
    for (let k = 0; k < Math.min(2, lakesBySize.length); k++) lakeNameById.set(lakesBySize[k].id, lakeName(nameRng));

    /* ---- stage 6: wonders (LAYOUT + NAMES: wonders, dead empire, ruins) ---- */
    const { wonders, ruins, deadEmpire } = buildWonders({
        N, p, biome, owner, height, sea, landSpan, rng, nameRng,
    });
    if (deadEmpire) model.deadEmpire = deadEmpire;

    /* ================= assemble (strict entity order) ================= */
    continents.forEach((c, i) => model.entities.push({
        id: 'ct' + (i + 1), kind: 'continent', name: c.name, x: c.x, y: c.y,
    }));
    seaBodies.forEach((b, i) => model.entities.push({
        id: 'sea' + (i + 1), kind: 'sea', name: b.name, x: b.x, y: b.y, w: b.cells,
    }));
    nations.forEach(n => {
        const tags = [n.government];
        if (n.coast) tags.push('coastal');
        model.entities.push({
            id: 'n' + n.id, kind: 'nation', name: n.name, purpose: n.flavor,
            x: n.centroid.x, y: n.centroid.y, tags, colorIdx: n.colorIdx,
        });
    });
    nations.forEach(n => model.entities.push({
        id: n.capId, kind: 'capital', name: n.capName || n.name, x: n.cap.x, y: n.cap.y, nation: 'n' + n.id,
    }));
    nations.forEach(n => n.cities.forEach(c => model.entities.push({
        id: c.id, kind: 'city', name: c.name, x: c.x, y: c.y, nation: 'n' + n.id, tags: c.tags,
    })));

    rivers.forEach((r, i) => model.entities.push({
        id: 'rv' + (i + 1), kind: 'river', name: riverNames[i], pts: r.pts,
        tags: r.tags.map(t =>
            t.startsWith('to-lake:') ? 'to-lake:lk' + t.slice(8)
                : t.startsWith('tributary:') ? 'tributary:rv' + (Number(t.slice(10)) + 1)
                    : t),
    }));
    lakesBySize.slice(0, 8).forEach(l => model.entities.push({
        id: 'lk' + l.id, kind: 'lake', name: lakeNameById.get(l.id) || null,
        x: Math.round(l.x), y: Math.round(l.y), w: l.cells, tags: [],
    }));

    routes.forEach((r, i) => model.entities.push({
        id: 'r' + (i + 1), kind: 'route', purpose: r.mode, pts: r.pts, a: r.a, b: r.b,
    }));
    wonders.forEach((w, i) => model.entities.push({
        id: 'w' + (i + 1), kind: 'wonder', name: w.name, purpose: w.kind, x: w.x, y: w.y,
    }));
    ruins.forEach((r, i) => model.entities.push({
        id: 'ru' + (i + 1), kind: 'ruin', name: r.name, x: r.x, y: r.y, nation: r.nation,
    }));

    model.edges = [
        ...relations.map(r => ({ a: 'n' + r.i, b: 'n' + r.j, kind: 'relation', rel: r.rel })),
        ...routes.map(r => ({ a: r.a, b: r.b, kind: 'route', mode: r.mode })),
    ];

    /* ---- render-only layers ---- */
    model.layers.N = N;
    model.layers.cellKm = 40;
    model.layers.biomes = biome;
    model.layers.owner = owner;
    model.layers.nationColors = nations.map(n => NATION_PALETTE[n.colorIdx]);

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

    /* ---- decor: compass + sea serpents (deterministic; reuses distLand) ---- */
    const openWater = i => isOcean[i] && biome[i] !== BIOME.iceshelf;

    // serpents: centres of the largest open-ocean expanses, spaced ≥ N/4
    const openCells = [];
    for (let i = 0; i < M; i++) if (openWater(i) && distLand[i] >= 20) openCells.push(i);
    openCells.sort((a, b) => distLand[b] - distLand[a] || a - b);
    const serpents = [];
    for (const i of openCells) {
        if (serpents.length >= 3) break;
        const x = i % N, y = (i / N) | 0;
        if (serpents.some(s => Math.hypot(s[0] - x, s[1] - y) < N / 4)) continue;
        serpents.push([x, y]);
    }

    // compass: an open-ocean cell near a corner with a wide clear-water radius
    const R = Math.floor(N * 0.25);
    let compass = null, cbest = -1;
    for (const [cxc, cyc] of [[0, 0], [N - 1, 0], [0, N - 1], [N - 1, N - 1]]) {
        let best = -1, bi = -1;
        for (let dy = 0; dy < R; dy++) for (let dx = 0; dx < R; dx++) {
            const x = cxc === 0 ? dx : cxc - dx, y = cyc === 0 ? dy : cyc - dy;
            if (x < 0 || y < 0 || x >= N || y >= N) continue;
            const i = y * N + x;
            if (openWater(i) && distLand[i] >= 12 && distLand[i] > best) { best = distLand[i]; bi = i; }
        }
        if (best > cbest) { cbest = best; compass = bi >= 0 ? [bi % N, (bi / N) | 0] : compass; }
    }
    model.layers.decor = { compass, serpents };

    return model;
}

export { BIOME_CODES };
