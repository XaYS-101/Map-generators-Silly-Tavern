/* ------------------------------------------------------------------
 *  World stage 4: nations, capitals, cities, borders & relations.
 *
 *  Suitability scoring on the climate layers (same discipline as the
 *  region's settlements) picks capitals with a minimum spacing; the
 *  capitals are then sorted by cell index — THAT order fixes nation
 *  ids, name draws and relation pairs. Territory grows by a multi-
 *  source Dijkstra from the capitals over a terrain cost field (rivers
 *  read as natural borders, ocean/lake/ice impassable) up to a cost
 *  cap, leaving a wild frontier (owner = -1) beyond. Neighbouring
 *  nations get a relation weighted by flavour contrast; the neighbour
 *  graph is greedily 8-coloured for the map palette.
 *
 *  Deterministic: LAYOUT draws are one-per-candidate in grid order,
 *  the Dijkstra is RNG-free with fixed neighbour order, and relations
 *  draw from a dedicated rng.sub('relations') stream in pair order.
 * ------------------------------------------------------------------ */
import { BIOME } from '../region/biomes.js';
import { nameFor, nationName, governmentFor } from '../names.js';

const NN = { few: 6, some: 10, many: 16 };

/* border-crossing biome cost — gentler than roads (mountains passable) */
const BORDER_COST = {
    [BIOME.beach]: 0.1, [BIOME.grassland]: 0, [BIOME.savanna]: 0.1, [BIOME.forest]: 0.4,
    [BIOME.taiga]: 0.5, [BIOME.rainforest]: 0.8, [BIOME.desert]: 1.2, [BIOME.tundra]: 1.0,
    [BIOME.badlands]: 1.5, [BIOME.ashland]: 3, [BIOME.blight]: 3, [BIOME.swamp]: 2.5,
    [BIOME.mountains]: 4, [BIOME.snow]: 5,
};

const BIOME_PENALTY = { [BIOME.desert]: 1, [BIOME.badlands]: 1.5, [BIOME.tundra]: 1.5, [BIOME.ashland]: 2, [BIOME.blight]: 2, [BIOME.swamp]: 1 };
const GOOD_BIOME = new Set([BIOME.grassland, BIOME.savanna, BIOME.forest, BIOME.beach]);

/* 4-connected — fixed order = deterministic ties */
const DX4 = [1, -1, 0, 0];
const DY4 = [0, 0, 1, -1];

const ANTAGONIST = [['steppe', 'forest'], ['desert', 'maritime']];

/* binary min-heap on typed arrays (copied from region/roads.js) */
function makeHeap(cap) {
    const idx = new Int32Array(cap);
    const key = new Float64Array(cap);
    let n = 0;
    return {
        get size() { return n; },
        clear() { n = 0; },
        push(i, k) {
            let c = n++;
            while (c > 0) {
                const prt = (c - 1) >> 1;
                if (key[prt] <= k) break;
                idx[c] = idx[prt]; key[c] = key[prt]; c = prt;
            }
            idx[c] = i; key[c] = k;
        },
        pop() {
            const top = idx[0];
            const li = idx[--n], lk = key[n];
            let c = 0;
            for (;;) {
                let ch = 2 * c + 1;
                if (ch >= n) break;
                if (ch + 1 < n && key[ch + 1] < key[ch]) ch++;
                if (key[ch] >= lk) break;
                idx[c] = idx[ch]; key[c] = key[ch]; c = ch;
            }
            idx[c] = li; key[c] = lk;
            return top;
        },
    };
}

function flavorFor(capBiome, coast, capNearOcean, capNearMtn) {
    if (coast && (capBiome === BIOME.beach || capNearOcean)) return 'maritime';
    if (capBiome === BIOME.grassland || capBiome === BIOME.savanna) return 'steppe';
    if (capBiome === BIOME.forest || capBiome === BIOME.taiga) return 'forest';
    if (capBiome === BIOME.desert || capBiome === BIOME.badlands) return 'desert';
    if (capBiome === BIOME.mountains || capBiome === BIOME.tundra || capNearMtn) return 'mountain';
    if (capBiome === BIOME.swamp) return 'fen';
    if (capBiome === BIOME.rainforest) return 'jungle';
    if (capBiome === BIOME.ashland || capBiome === BIOME.blight) return 'ashen';
    return 'forest';
}

function isAntagonist(a, b) {
    return ANTAGONIST.some(([x, y]) => (a === x && b === y) || (a === y && b === x));
}

function relationWeights(fa, fb, boundaryCells, N) {
    let w;
    if (fa === fb) w = [['alliance', 3], ['trade', 3], ['rivalry', 2], ['war', 1]];
    else if (isAntagonist(fa, fb)) w = [['war', 3], ['rivalry', 3], ['trade', 2], ['alliance', 1]];
    else w = [['alliance', 2], ['trade', 3], ['rivalry', 2], ['war', 2]];
    if (boundaryCells > N * 0.15) w = w.map(([k, v]) => [k, (k === 'war' || k === 'rivalry') ? v + 2 : v]);
    return w;
}

/**
 * @param {object} ctx {N, p, height, sea, landSpan, biome, slope, distWater,
 *                       temp, isOcean, lakeMask, isRiver, rng (layout), nameRng}
 * @returns {{nations:Array, owner:Int16Array, relations:Array}}
 */
export function buildNations(ctx) {
    const { N, p, height, sea, landSpan, biome, slope, distWater, temp,
        isOcean, lakeMask, isRiver, rng, nameRng } = ctx;
    const M = N * N;
    const hNorm = i => (height[i] - sea) / landSpan;
    const nN = NN[p.nations] ?? NN.some;

    const near = (grid, val, x, y, r) => {
        for (let dy = -r; dy <= r; dy++) {
            const ny = y + dy; if (ny < 0 || ny >= N) continue;
            for (let dx = -r; dx <= r; dx++) {
                const nx = x + dx; if (nx < 0 || nx >= N) continue;
                if (grid[ny * N + nx] === val) return true;
            }
        }
        return false;
    };
    const nearOcean = (x, y, r) => near(isOcean, 1, x, y, r);
    const nearMtnSnow = (x, y, r) => near(biome, BIOME.mountains, x, y, r) || near(biome, BIOME.snow, x, y, r);

    /* ---- candidate suitability (LAYOUT: one draw per candidate, grid order) ---- */
    const cand = [];
    for (let y = 8; y < N - 8; y += 4) {
        for (let x = 8; x < N - 8; x += 4) {
            const i = y * N + x;
            const b = biome[i];
            if (b === BIOME.ocean || b === BIOME.lake || b === BIOME.iceshelf
                || b === BIOME.snow || b === BIOME.mountains) continue;
            let s = 1 + rng.float(0, 0.5);
            if (GOOD_BIOME.has(b)) s += 1.2;
            s -= BIOME_PENALTY[b] || 0;
            s += 2.0 * Math.exp(-distWater[i] / 4);
            const coast = nearOcean(x, y, 4);
            if (coast) s += 1.5;
            s -= 8 * Math.max(0, hNorm(i) - 0.45);
            s += 1.0 * Math.exp(-(((temp[i] - 0.45) / 0.25) ** 2));
            cand.push({ x, y, i, s });
        }
    }

    /* ---- capitals: greedy max-s with min spacing, then order by cell index ---- */
    const bySuit = [...cand].sort((a, b) => b.s - a.s || a.i - b.i);
    const spacing = 0.8 * N / Math.sqrt(nN);
    const caps = [];
    for (const c of bySuit) {
        if (caps.length >= nN) break;
        if (caps.some(k => Math.hypot(k.x - c.x, k.y - c.y) < spacing)) continue;
        caps.push(c);
    }
    caps.sort((a, b) => a.i - b.i);   // THIS order defines nation ids

    const owner = new Int16Array(M).fill(-1);
    const relations = [];
    if (!caps.length) return { nations: [], owner, relations };

    /* ---- borders: multi-source Dijkstra from capitals ---- */
    const dist = new Float64Array(M).fill(Infinity);
    const heap = makeHeap(M);
    const COST_CAP = N * 0.45;
    const passable = i => !(isOcean[i] || lakeMask[i] || biome[i] === BIOME.iceshelf);
    caps.forEach((c, id) => { owner[c.i] = id; dist[c.i] = 0; heap.push(c.i, 0); });
    while (heap.size) {
        const u = heap.pop();
        const du = dist[u];
        const ux = u % N, uy = (u / N) | 0;
        for (let d = 0; d < 4; d++) {
            const nx = ux + DX4[d], ny = uy + DY4[d];
            if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
            const nb = ny * N + nx;
            if (!passable(nb)) continue;
            const enter = 1 + (BORDER_COST[biome[nb]] || 0) + slope[nb] * 20 + (isRiver[nb] ? 6 : 0);
            const nd = du + enter;
            if (nd > COST_CAP) continue;
            if (nd < dist[nb]) { dist[nb] = nd; owner[nb] = owner[u]; heap.push(nb, nd); }
        }
    }

    /* ---- per-nation aggregates ---- */
    const nations = caps.map((c, id) => ({
        id, capId: 'cap' + id, cap: { x: c.x, y: c.y, i: c.i, biome: biome[c.i] },
        cellCount: 0, sx: 0, sy: 0, coast: false, capPort: false,
        centroid: { x: c.x, y: c.y }, flavor: null, name: null, government: null,
        cities: [], colorIdx: 0,
    }));
    for (let i = 0; i < M; i++) {
        const o = owner[i];
        if (o < 0) continue;
        const nat = nations[o];
        nat.cellCount++; nat.sx += i % N; nat.sy += (i / N) | 0;
    }
    for (let i = 0; i < M; i++) {
        const o = owner[i];
        if (o < 0 || nations[o].coast) continue;
        const x = i % N, y = (i / N) | 0;
        for (let d = 0; d < 4; d++) {
            const nx = x + DX4[d], ny = y + DY4[d];
            if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
            if (isOcean[ny * N + nx]) { nations[o].coast = true; break; }
        }
    }
    for (const nat of nations) {
        if (nat.cellCount) {
            nat.centroid = { x: Math.round(nat.sx / nat.cellCount), y: Math.round(nat.sy / nat.cellCount) };
        }
        const capNearOcean = nearOcean(nat.cap.x, nat.cap.y, 4);
        nat.capPort = nearOcean(nat.cap.x, nat.cap.y, 3);
        nat.flavor = flavorFor(nat.cap.biome, nat.coast, capNearOcean, nearMtnSnow(nat.cap.x, nat.cap.y, 3));
    }

    /* ---- names + governments (NAMES: per nation — name, gov, capital) ---- */
    for (const nat of nations) {
        nat.name = nationName(nameRng, nat.flavor);
        nat.government = governmentFor(nameRng, nat.flavor);
        nat.capName = nameFor(nameRng, 'city');   // the capital city's own name
    }

    /* ---- cities (NAMES: per nation in order, cities within a nation by cell index) ---- */
    const t1 = M * 0.008, t2 = M * 0.02;
    for (const nat of nations) {
        const nCity = nat.cellCount > t2 ? 3 : nat.cellCount > t1 ? 2 : 1;
        const owned = cand.filter(c => owner[c.i] === nat.id).sort((a, b) => b.s - a.s || a.i - b.i);
        const chosen = [];
        for (const c of owned) {
            if (chosen.length >= nCity) break;
            if (Math.hypot(c.x - nat.cap.x, c.y - nat.cap.y) < 14) continue;
            if (chosen.some(k => Math.hypot(k.x - c.x, k.y - c.y) < 14)) continue;
            chosen.push({ x: c.x, y: c.y, i: c.i, port: nearOcean(c.x, c.y, 3) });
        }
        chosen.sort((a, b) => a.i - b.i);
        for (const ci of chosen) {
            ci.name = nameFor(nameRng, 'city');
            ci.tags = ci.port ? ['port'] : [];
        }
        nat.cities = chosen;
    }

    /* ---- neighbour graph (shared-border adjacency + boundary lengths) ---- */
    const boundary = new Map();   // "i,j" (i<j) -> shared border cell count
    const bump = (a, b) => {
        const i = Math.min(a, b), j = Math.max(a, b), k = i + ',' + j;
        boundary.set(k, (boundary.get(k) || 0) + 1);
    };
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const o = owner[y * N + x];
            if (o < 0) continue;
            if (x + 1 < N) { const o2 = owner[y * N + x + 1]; if (o2 >= 0 && o2 !== o) bump(o, o2); }
            if (y + 1 < N) { const o2 = owner[(y + 1) * N + x]; if (o2 >= 0 && o2 !== o) bump(o, o2); }
        }
    }

    /* ---- relations (dedicated stream, ordered i<j) ---- */
    const relRng = rng.sub('relations');
    for (let i = 0; i < nations.length; i++) {
        for (let j = i + 1; j < nations.length; j++) {
            const bc = boundary.get(i + ',' + j);
            if (!bc) continue;
            const rel = relRng.weighted(relationWeights(nations[i].flavor, nations[j].flavor, bc, N));
            relations.push({ i, j, rel, boundary: bc });
        }
    }

    /* ---- greedy 8-colouring over the neighbour graph (node order = nation order) ---- */
    const adj = nations.map(() => new Set());
    for (const k of boundary.keys()) {
        const [i, j] = k.split(',').map(Number);
        adj[i].add(j); adj[j].add(i);
    }
    for (let i = 0; i < nations.length; i++) {
        const used = new Set();
        for (const nb of adj[i]) if (nb < i) used.add(nations[nb].colorIdx);
        let c = 0; while (used.has(c)) c++;
        nations[i].colorIdx = c % 8;
    }

    return { nations, owner, relations };
}
