/* ------------------------------------------------------------------
 *  Region / world map generator.
 *
 *  fBm heightmap (256×256, in-memory only) with an island/coast/
 *  inland mask → percentile sea level → moisture → biomes → rivers
 *  traced downhill from springs → settlements & POIs by suitability
 *  scoring → named biome blobs → crude road graph.
 *
 *  1 cell ≈ 1.5 km (layers.cellKm), so the map is ~380×380 km.
 * ------------------------------------------------------------------ */
import { Rng } from './rng.js';
import { Noise2D } from './noise.js';
import { makeEnvelope, compass } from './schema.js';
import { nameFor, biomeName, POI_KINDS } from './names.js';
import { BIOME_CODES } from './region/biomes.js';
import { buildTerrain } from './region/terrain.js';

const N = 256;
export { BIOME_CODES };

export function generateRegion(seed, params = {}) {
    const p = { mask: 'island', water: 0.42, settlements: 'some', ...params };
    const model = makeEnvelope('region', seed, p);
    model.size = { w: N, h: N, unit: 'cell' };

    const rng = new Rng(`${seed}/layout:${p.mask}:${p.water}:${p.settlements}`);
    const noiseM = new Noise2D(`${seed}/moisture`);

    /* ---- stage 1: terrain (height is immutable from here on) ---- */
    const terrain = buildTerrain({ N, seed, p }, rng);
    const { height, sea, landSpan } = terrain;
    const hNorm = i => (height[i] - sea) / landSpan;   // 0 at shore, 1 at highest peak

    const moist = new Float32Array(N * N);
    const scale = 1 / 46;
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            moist[y * N + x] = noiseM.fbm(x * scale * 1.4, y * scale * 1.4, { octaves: 4 });
        }
    }

    /* ---- rivers: springs in the highlands, greedy downhill ---- */
    const rivers = [];
    const isWater = i => height[i] <= sea;
    {
        const springs = [];
        const cand = [];
        for (let y = 8; y < N - 8; y += 2) for (let x = 8; x < N - 8; x += 2) {
            if (hNorm(y * N + x) > 0.55) cand.push([x, y]);
        }
        const nSprings = rng.int(3, 6);
        for (const [x, y] of rng.shuffle(cand)) {
            if (springs.length >= nSprings) break;
            if (springs.every(s => Math.hypot(s[0] - x, s[1] - y) >= 30)) springs.push([x, y]);
        }
        for (const [sx, sy] of springs) {
            let x = sx, y = sy;
            const pts = [[x, y]];
            const visited = new Set([y * N + x]);
            let toSea = false;
            for (let step = 0; step < 600; step++) {
                let bx = -1, by = -1, bh = height[y * N + x];
                for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                    if (!dx && !dy) continue;
                    const nx = x + dx, ny = y + dy;
                    if (nx < 1 || ny < 1 || nx >= N - 1 || ny >= N - 1) continue;
                    if (visited.has(ny * N + nx)) continue;
                    if (height[ny * N + nx] < bh) { bh = height[ny * N + nx]; bx = nx; by = ny; }
                }
                if (bx < 0) {   // pit: carve slightly and take the lowest unvisited neighbor
                    height[y * N + x] -= 0.004;
                    let alt = Infinity;
                    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                        if (!dx && !dy) continue;
                        const nx = x + dx, ny = y + dy;
                        if (nx < 1 || ny < 1 || nx >= N - 1 || ny >= N - 1) continue;
                        if (visited.has(ny * N + nx)) continue;
                        if (height[ny * N + nx] < alt) { alt = height[ny * N + nx]; bx = nx; by = ny; }
                    }
                    if (bx < 0) break;
                }
                x = bx; y = by;
                visited.add(y * N + x);
                if (step % 3 === 0) pts.push([x, y]);
                // moisten the banks so the biome pass grows greener near rivers
                for (const [mx, my] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
                    const mi = my * N + mx;
                    if (mi >= 0 && mi < N * N) moist[mi] = Math.min(1, moist[mi] + 0.12);
                }
                if (isWater(y * N + x)) { toSea = true; break; }
            }
            pts.push([x, y]);
            if (pts.length >= 6) rivers.push({ pts, toSea });
        }
    }

    /* ---- biomes (after rivers moistened the banks) ---- */
    const biome = new Uint8Array(N * N);
    const code = name => BIOME_CODES.indexOf(name);
    for (let i = 0; i < N * N; i++) {
        if (height[i] <= sea) { biome[i] = code('ocean'); continue; }
        const h = hNorm(i), m = moist[i];
        if (h > 0.8) biome[i] = code('snow');
        else if (h > 0.6) biome[i] = code('mountains');
        else if (h < 0.035) biome[i] = code('beach');
        else if (m < 0.34) biome[i] = code('desert');
        else if (m < 0.55) biome[i] = code('grassland');
        else if (m < 0.75) biome[i] = code('forest');
        else biome[i] = (h < 0.12) ? code('swamp') : code('rainforest');
    }
    // water not connected to the border = lakes
    {
        const seen = new Uint8Array(N * N);
        const q = [];
        for (let x = 0; x < N; x++) { q.push(x, (N - 1) * N + x); }
        for (let y = 0; y < N; y++) { q.push(y * N, y * N + N - 1); }
        for (const i of q) if (biome[i] === code('ocean')) seen[i] = 1;
        for (let qi = 0; qi < q.length; qi++) {
            const i = q[qi];
            if (!seen[i]) continue;
            const x = i % N, y = (i / N) | 0;
            for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
                if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
                const ni = ny * N + nx;
                if (biome[ni] === code('ocean') && !seen[ni]) { seen[ni] = 1; q.push(ni); }
            }
        }
        for (let i = 0; i < N * N; i++) if (biome[i] === code('ocean') && !seen[i]) biome[i] = code('lake');
    }

    /* ---- settlements by suitability scoring ---- */
    const nameRng = new Rng(`${seed}/names`);
    const riverCells = new Set();
    for (const r of rivers) for (const [x, y] of r.pts) riverCells.add(((y | 0) * N + (x | 0)));
    const nearRiver = (x, y, d) => {
        for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) {
            if (riverCells.has((y + dy) * N + (x + dx))) return true;
        }
        return false;
    };
    const nearBiome = (x, y, d, codes) => {
        for (let dy = -d; dy <= d; dy += 2) for (let dx = -d; dx <= d; dx += 2) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
            if (codes.includes(biome[ny * N + nx])) return true;
        }
        return false;
    };

    const scored = [];
    const badLand = [code('ocean'), code('lake'), code('mountains'), code('snow'), code('swamp')];
    for (let y = 10; y < N - 10; y += 4) {
        for (let x = 10; x < N - 10; x += 4) {
            const i = y * N + x;
            if (badLand.includes(biome[i])) continue;
            let s = 1 + rng.float(0, 0.5);
            if (nearRiver(x, y, 4)) s += 2;
            if (nearBiome(x, y, 6, [code('ocean')])) s += 1.5;
            if (biome[i] === code('desert')) s -= 1;
            scored.push({ x, y, s });
        }
    }
    scored.sort((a, b) => b.s - a.s || a.y - b.y || a.x - b.x);

    const counts = { few: [1, 2, 2], some: [1, 3, 4], many: [2, 4, 6] }[p.settlements] || [1, 3, 4];
    const settlements = [];
    const wanted = [['city', counts[0]], ['town', counts[1]], ['village', counts[2]]];
    for (const [kind, n] of wanted) {
        let placed = 0;
        for (const c of scored) {
            if (placed >= n) break;
            if (settlements.some(s => Math.hypot(s.x - c.x, s.y - c.y) < 28)) continue;
            const tags = [];
            if (nearRiver(c.x, c.y, 4)) tags.push('on a river');
            if (nearBiome(c.x, c.y, 6, [code('ocean')])) tags.push('coastal');
            if (nearBiome(c.x, c.y, 8, [code('mountains')])) tags.push('in the foothills');
            settlements.push({
                x: c.x, y: c.y, kind,
                name: nameFor(nameRng, kind === 'village' ? 'village' : 'city'),
                tags,
            });
            placed++;
        }
    }

    /* ---- POIs ---- */
    const pois = [];
    const poiKinds = rng.shuffle(POI_KINDS);
    const nPois = rng.int(3, 6);
    for (const c of scored.slice().reverse()) {   // less "ideal" spots feel wilder
        if (pois.length >= nPois) break;
        if (settlements.some(s => Math.hypot(s.x - c.x, s.y - c.y) < 20)) continue;
        if (pois.some(s => Math.hypot(s.x - c.x, s.y - c.y) < 20)) continue;
        pois.push({ x: c.x, y: c.y, kind: poiKinds[pois.length % poiKinds.length] });
    }

    /* ---- named biome blobs (BFS on a 4× downsample) ---- */
    const blobs = [];
    {
        const M = N / 4;
        const down = new Uint8Array(M * M);
        for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) down[y * M + x] = biome[(y * 4) * N + x * 4];
        const nameable = [code('forest'), code('rainforest'), code('swamp'), code('mountains'), code('desert')];
        const seen = new Uint8Array(M * M);
        for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
            const i = y * M + x;
            if (seen[i] || !nameable.includes(down[i])) continue;
            const b = down[i];
            const q = [i];
            seen[i] = 1;
            let size = 0, sx = 0, sy = 0;
            for (let qi = 0; qi < q.length; qi++) {
                const ci = q[qi], cx = ci % M, cy = (ci / M) | 0;
                size++; sx += cx; sy += cy;
                for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
                    if (nx < 0 || ny < 0 || nx >= M || ny >= M) continue;
                    const ni = ny * M + nx;
                    if (!seen[ni] && down[ni] === b) { seen[ni] = 1; q.push(ni); }
                }
            }
            if (size >= 55) blobs.push({ biome: BIOME_CODES[b], x: (sx / size) * 4, y: (sy / size) * 4, cells: size * 16 });
        }
        blobs.sort((a, b) => b.cells - a.cells);
        blobs.length = Math.min(blobs.length, 5);
        for (const b of blobs) b.name = biomeName(nameRng, b.biome);
    }

    /* ---- roads: every settlement → nearest bigger neighbor ---- */
    const rank = { city: 3, town: 2, village: 1 };
    const roadEdges = [];
    const roads = [];
    settlements.forEach((s, i) => {
        let best = -1, bd = Infinity;
        settlements.forEach((o, j) => {
            if (i === j || rank[o.kind] <= rank[s.kind]) return;
            const d = Math.hypot(o.x - s.x, o.y - s.y);
            if (d < bd) { bd = d; best = j; }
        });
        if (best < 0 && s.kind !== 'city') {   // no bigger one → nearest any
            settlements.forEach((o, j) => {
                if (i === j) return;
                const d = Math.hypot(o.x - s.x, o.y - s.y);
                if (d < bd) { bd = d; best = j; }
            });
        }
        if (best < 0) return;
        const o = settlements[best];
        if (roadEdges.some(e => (e.ai === best && e.bi === i))) return;
        roadEdges.push({ ai: i, bi: best });
        // gentle two-midpoint bend
        const mx1 = s.x + (o.x - s.x) / 3, my1 = s.y + (o.y - s.y) / 3;
        const mx2 = s.x + (o.x - s.x) * 2 / 3, my2 = s.y + (o.y - s.y) * 2 / 3;
        const nx = -(o.y - s.y), ny = o.x - s.x;
        const nl = Math.hypot(nx, ny) || 1;
        const b1 = rng.float(-8, 8), b2 = rng.float(-8, 8);
        roads.push({
            pts: [[s.x, s.y], [mx1 + nx / nl * b1, my1 + ny / nl * b1], [mx2 + nx / nl * b2, my2 + ny / nl * b2], [o.x, o.y]],
        });
    });

    /* ---- assemble ---- */
    model.name = nameFor(nameRng, 'region');
    settlements.forEach((s, i) => model.entities.push({
        id: 's' + (i + 1), kind: 'settlement', name: s.name, purpose: s.kind,
        x: s.x, y: s.y, tags: s.tags,
    }));
    pois.forEach((s, i) => model.entities.push({
        id: 'p' + (i + 1), kind: 'poi', purpose: s.kind, x: s.x, y: s.y,
        name: null, tags: [],
    }));
    rivers.forEach((r, i) => model.entities.push({
        id: 'rv' + (i + 1), kind: 'river', pts: r.pts,
        tags: r.toSea ? ['to-sea'] : [],
    }));
    blobs.forEach((b, i) => model.entities.push({
        id: 'b' + (i + 1), kind: 'biome', purpose: b.biome, name: b.name,
        x: Math.round(b.x), y: Math.round(b.y), tags: [],
    }));
    roads.forEach((r, i) => model.entities.push({ id: 'rd' + (i + 1), kind: 'road', pts: r.pts }));
    model.edges = roadEdges.map(e => ({
        a: 's' + (e.ai + 1), b: 's' + (e.bi + 1), kind: 'road',
        dir: compass(settlements[e.ai].x, settlements[e.ai].y, settlements[e.bi].x, settlements[e.bi].y),
    }));

    // render-only layers (never serialized: compactJson strips them)
    model.layers.N = N;
    model.layers.cellKm = 1.5;
    model.layers.biomes = biome;
    const peaks = [];
    for (let y = 4; y < N - 4; y += 3) for (let x = 4; x < N - 4; x += 3) {
        const i = y * N + x;
        if (biome[i] === code('mountains') || biome[i] === code('snow')) {
            if (peaks.every(pk => Math.hypot(pk[0] - x, pk[1] - y) >= 6) && rng.chance(0.6)) peaks.push([x, y]);
        }
    }
    model.layers.peaks = peaks;
    const trees = [];
    for (let y = 3; y < N - 3; y += 4) for (let x = 3; x < N - 3; x += 4) {
        const i = y * N + x;
        if ((biome[i] === code('forest') || biome[i] === code('rainforest')) && rng.chance(0.55)) {
            trees.push([x + rng.float(-1.5, 1.5), y + rng.float(-1.5, 1.5)]);
        }
    }
    model.layers.trees = trees;
    return model;
}
