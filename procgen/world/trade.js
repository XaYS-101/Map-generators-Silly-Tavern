/* ------------------------------------------------------------------
 *  World stage 5: trade — caravan roads & sea lanes.
 *
 *  Land routes = euclidean MST over the capitals plus an extra edge for
 *  every 'trade'/'alliance' relation, each routed with A* on a half-res
 *  terrain cost grid; accepted routes discount their blocks so caravan
 *  roads braid onto shared trakts (same trick as region/roads.js).
 *  Mountains are expensive but passable — passes emerge. Sea lanes join
 *  ports of different nations across OCEAN only (pack ice blocks ships),
 *  hugging the coast where they can, then get one Chaikin pass.
 *
 *  Deterministic and RNG-free: fixed neighbour order, index tie-breaks.
 * ------------------------------------------------------------------ */
import { BIOME } from '../region/biomes.js';

const SQRT2 = Math.SQRT2;
/* E, SE, S, SW, W, NW, N, NE */
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];
const DDIST = [1, SQRT2, 1, SQRT2, 1, SQRT2, 1, SQRT2];

const LAND_COST = {
    [BIOME.beach]: 0.2, [BIOME.grassland]: 0, [BIOME.savanna]: 0.1, [BIOME.forest]: 0.6,
    [BIOME.taiga]: 0.7, [BIOME.rainforest]: 1.2, [BIOME.desert]: 1.0, [BIOME.tundra]: 0.9,
    [BIOME.badlands]: 1.5, [BIOME.ashland]: 2.5, [BIOME.blight]: 2.5, [BIOME.swamp]: 3,
    [BIOME.mountains]: 5, [BIOME.snow]: 8,
};

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

/** A* factory over a HxH grid with injected blocked()/enter() cost. */
function makeAstar(H, blocked, enter) {
    const HH = H * H;
    const heap = makeHeap(HH);
    const gScore = new Float64Array(HH);
    const cameFrom = new Int32Array(HH);
    const stamp = new Int32Array(HH);
    let gen = 0;
    return function astar(sx, sy, gx, gy) {
        const start = sy * H + sx, goal = gy * H + gx;
        gen++; heap.clear();
        gScore[start] = 0; stamp[start] = gen; cameFrom[start] = -1;
        const hHeur = (x, y) => {
            const dx = Math.abs(x - gx), dy = Math.abs(y - gy);
            return (dx + dy) + (SQRT2 - 2) * Math.min(dx, dy);
        };
        heap.push(start, hHeur(sx, sy));
        let pops = 0;
        while (heap.size) {
            const u = heap.pop();
            if (u === goal) break;
            if (++pops > HH) return null;
            const ux = u % H, uy = (u / H) | 0, gu = gScore[u];
            for (let d = 0; d < 8; d++) {
                const nx = ux + DX[d], ny = uy + DY[d];
                if (nx < 0 || ny < 0 || nx >= H || ny >= H) continue;
                const nb = ny * H + nx;
                if (blocked(nb) && nb !== goal) continue;
                const tentative = gu + enter(u, nb, DDIST[d]);
                if (stamp[nb] !== gen || tentative < gScore[nb]) {
                    stamp[nb] = gen; gScore[nb] = tentative; cameFrom[nb] = u;
                    heap.push(nb, tentative + hHeur(nx, ny));
                }
            }
        }
        if (stamp[goal] !== gen) return null;
        const path = [];
        for (let c = goal; c !== -1; c = cameFrom[c]) path.push(c);
        path.reverse();
        return path;
    };
}

/** one Chaikin corner-cut pass on an open polyline (endpoints preserved) */
function chaikin(pts) {
    if (pts.length < 3) return pts.map(p => [p[0], p[1]]);
    const out = [[pts[0][0], pts[0][1]]];
    for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
        out.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1]);
        out.push([0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
    }
    out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
    return out;
}

/** keep endpoints, keep every 2nd interior vertex */
function simplify(pts) {
    if (pts.length <= 2) return pts.map(p => [p[0], p[1]]);
    const out = [pts[0]];
    for (let k = 1; k < pts.length - 1; k += 2) out.push(pts[k]);
    out.push(pts[pts.length - 1]);
    return out;
}

/** shove any wet vertex to the nearest dry cell (endpoints untouched) */
function detourAroundWater(pts, N, isOcean, lakeMask) {
    const wet = (x, y) => {
        const cx = Math.round(x), cy = Math.round(y);
        if (cx < 0 || cy < 0 || cx >= N || cy >= N) return false;
        const i = cy * N + cx;
        return !!(isOcean[i] || lakeMask[i]);
    };
    const dryNear = (x, y) => {
        const cx = Math.round(x), cy = Math.round(y);
        for (let r = 1; r <= 4; r++) {
            for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                const nx = cx + dx, ny = cy + dy;
                if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
                if (!wet(nx, ny)) return [nx, ny];
            }
        }
        return null;
    };
    const out = [pts[0]];
    const pushDry = (x, y) => {
        const p = wet(x, y) ? dryNear(x, y) : [x, y];
        if (!p) return;
        const last = out[out.length - 1];
        if (Math.hypot(last[0] - p[0], last[1] - p[1]) > 0.6) out.push(p);
    };
    for (let k = 1; k < pts.length; k++) {
        const [x0, y0] = out[out.length - 1];
        const [x1, y1] = pts[k];
        const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
        for (let t = 1; t < steps; t++) {
            const x = x0 + (x1 - x0) * t / steps, y = y0 + (y1 - y0) * t / steps;
            if (wet(x, y)) pushDry(x, y);
        }
        if (k === pts.length - 1) out.push([x1, y1]);
        else pushDry(x1, y1);
    }
    return out;
}

/**
 * @param {object} ctx {N, biome, height, sea, landSpan, isOcean, lakeMask,
 *                       isRiver, flowAcc, owner, nations, relations}
 * @returns {{routes: Array<{mode, a, b, pts}>}}
 */
export function buildTrade(ctx) {
    const { N, biome, height, sea, landSpan, isOcean, lakeMask, nations, relations } = ctx;
    const routes = [];
    if (nations.length < 1) return { routes };

    const H = N / 2, HH = H * H;
    const hNorm = i => (height[i] - sea) / landSpan;

    /* ---- half-res fields (land cost + sea passability) ---- */
    const blockWater = new Uint8Array(HH);   // ocean/lake/ice → impassable for caravans
    const blockH = new Float32Array(HH);
    const blockBC = new Float32Array(HH);
    const blockMul = new Float32Array(HH).fill(1);
    const seaSub = new Int32Array(HH).fill(-1);   // a representative open-ocean full cell
    const seaCount = new Uint8Array(HH);
    const landCount = new Uint8Array(HH);
    for (let by = 0; by < H; by++) {
        for (let bx = 0; bx < H; bx++) {
            const b = by * H + bx;
            let water = 0, hsum = 0, bc = 0, sc = 0, lc = 0, rep = -1;
            for (let oy = 0; oy < 2; oy++) for (let ox = 0; ox < 2; ox++) {
                const fx = bx * 2 + ox, fy = by * 2 + oy, fi = fy * N + fx;
                const code = biome[fi];
                if (code === BIOME.ocean || code === BIOME.lake || code === BIOME.iceshelf) water = 1;
                hsum += hNorm(fi);
                bc = Math.max(bc, LAND_COST[code] || 0);
                if (isOcean[fi] && code !== BIOME.iceshelf) { sc++; if (rep < 0) rep = fi; }
                else lc++;
            }
            blockWater[b] = water; blockH[b] = hsum / 4; blockBC[b] = bc;
            seaCount[b] = sc; landCount[b] = lc; seaSub[b] = rep;
        }
    }
    // sea blocks: mostly-water blocks are navigable; flag those bordering land for coast-hug
    const blockSea = new Uint8Array(HH);
    const blockNearLand = new Uint8Array(HH);
    for (let b = 0; b < HH; b++) if (seaCount[b] >= 2 && seaSub[b] >= 0) blockSea[b] = 1;
    for (let by = 0; by < H; by++) {
        for (let bx = 0; bx < H; bx++) {
            const b = by * H + bx;
            if (!blockSea[b]) continue;
            let nearLand = landCount[b] > 0 ? 1 : 0;
            for (let d = 0; d < 8 && !nearLand; d++) {
                const nx = bx + DX[d], ny = by + DY[d];
                if (nx < 0 || ny < 0 || nx >= H || ny >= H) continue;
                if (landCount[ny * H + nx] > 0) nearLand = 1;
            }
            blockNearLand[b] = nearLand;
        }
    }

    /* ================= land caravan roads ================= */
    const caps = nations.map(n => n.cap);
    const nC = caps.length;
    if (nC >= 2) {
        const euclid = (a, b) => Math.hypot(caps[a].x - caps[b].x, caps[a].y - caps[b].y);
        const inTree = new Uint8Array(nC); inTree[0] = 1;
        const edgeSet = new Set();
        const norm = (a, b) => (a < b ? a + ',' + b : b + ',' + a);
        for (let added = 1; added < nC; added++) {
            let ba = -1, bb = -1, bd = Infinity;
            for (let i = 0; i < nC; i++) {
                if (!inTree[i]) continue;
                for (let j = 0; j < nC; j++) {
                    if (inTree[j]) continue;
                    const d = euclid(i, j);
                    if (d < bd) { bd = d; ba = i; bb = j; }
                }
            }
            if (bb < 0) break;
            inTree[bb] = 1; edgeSet.add(norm(ba, bb));
        }
        for (const r of relations) if (r.rel === 'trade' || r.rel === 'alliance') edgeSet.add(norm(r.i, r.j));
        const landEdges = [...edgeSet].map(s => s.split(',').map(Number)).sort((e, f) => e[0] - f[0] || e[1] - f[1]);

        const landBlocked = nb => blockWater[nb] === 1;
        const landEnter = (u, nb, step) => (step * (1 + 30 * Math.abs(blockH[nb] - blockH[u]) + blockBC[nb])) * blockMul[nb];
        const astar = makeAstar(H, landBlocked, landEnter);

        for (const [ai, bi] of landEdges) {
            const a = caps[ai], b = caps[bi];
            const hpath = astar((a.x / 2) | 0, (a.y / 2) | 0, (b.x / 2) | 0, (b.y / 2) | 0);
            let pts;
            if (hpath && hpath.length >= 2) {
                for (const bc of hpath) blockMul[bc] = Math.max(0.05, blockMul[bc] * 0.4);   // trakt discount
                const full = hpath.map(bc => [Math.round((bc % H) * 2 + 0.5), Math.round(((bc / H) | 0) * 2 + 0.5)]);
                pts = chaikin(simplify(full));
            } else {
                const mx1 = a.x + (b.x - a.x) / 3, my1 = a.y + (b.y - a.y) / 3;
                const mx2 = a.x + (b.x - a.x) * 2 / 3, my2 = a.y + (b.y - a.y) * 2 / 3;
                pts = [[a.x, a.y], [mx1, my1], [mx2, my2], [b.x, b.y]];
            }
            pts[0] = [a.x, a.y];
            pts[pts.length - 1] = [b.x, b.y];
            routes.push({ mode: 'land', a: nations[ai].capId, b: nations[bi].capId, pts: detourAroundWater(pts, N, isOcean, lakeMask) });
        }
    }

    /* ================= sea lanes ================= */
    const openOcean = i => isOcean[i] && biome[i] !== BIOME.iceshelf;
    const snapOcean = (x, y) => {
        const cx = Math.round(x), cy = Math.round(y);
        if (cx >= 0 && cy >= 0 && cx < N && cy < N && openOcean(cy * N + cx)) return [cx, cy];
        for (let r = 1; r <= 12; r++) {
            for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                const nx = cx + dx, ny = cy + dy;
                if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
                if (openOcean(ny * N + nx)) return [nx, ny];
            }
        }
        return null;
    };

    const ports = [];
    for (const n of nations) {
        if (n.capPort) ports.push({ id: n.capId, x: n.cap.x, y: n.cap.y, nation: n.id });
        for (const c of n.cities) if (c.port) ports.push({ id: c.id, x: c.x, y: c.y, nation: n.id });
    }
    if (ports.length >= 2) {
        const portsOf = nat => ports.filter(pt => pt.nation === nat);
        const pairs = [];
        const seen = new Set();
        const addPair = (pa, pb) => {
            if (pa.nation === pb.nation) return;
            const key = pa.id < pb.id ? pa.id + '~' + pb.id : pb.id + '~' + pa.id;
            if (seen.has(key)) return; seen.add(key);
            pairs.push({ a: pa, b: pb, d: Math.hypot(pa.x - pb.x, pa.y - pb.y) });
        };
        for (const r of relations) {
            if (r.rel !== 'trade' && r.rel !== 'alliance') continue;
            const A = portsOf(nations[r.i].id), B = portsOf(nations[r.j].id);
            if (!A.length || !B.length) continue;
            let best = null, bd = Infinity;
            for (const pa of A) for (const pb of B) {
                const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
                if (d < bd) { bd = d; best = [pa, pb]; }
            }
            if (best) addPair(best[0], best[1]);
        }
        for (const pa of ports) {
            let best = null, bd = Infinity;
            for (const pb of ports) {
                if (pb.nation === pa.nation) continue;
                const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
                if (d < bd) { bd = d; best = pb; }
            }
            if (best) addPair(pa, best);
        }
        pairs.sort((p, q) => p.d - q.d || (p.a.id < q.a.id ? -1 : p.a.id > q.a.id ? 1 : 0));
        const chosen = pairs.slice(0, Math.max(1, nations.length));

        const seaBlocked = nb => blockSea[nb] === 0;
        const seaEnter = (_u, nb, step) => step * (blockNearLand[nb] ? 0.75 : 1);
        const seaAstar = makeAstar(H, seaBlocked, seaEnter);

        for (const pr of chosen) {
            const hA = snapOcean(pr.a.x, pr.a.y), hB = snapOcean(pr.b.x, pr.b.y);
            if (!hA || !hB) continue;
            const path = seaAstar((hA[0] / 2) | 0, (hA[1] / 2) | 0, (hB[0] / 2) | 0, (hB[1] / 2) | 0);
            if (!path || path.length < 2) continue;
            const raw = [hA];
            for (const bc of path) {
                const cell = seaSub[bc];
                const pt = cell >= 0 ? [cell % N, (cell / N) | 0] : [Math.round((bc % H) * 2 + 0.5), Math.round(((bc / H) | 0) * 2 + 0.5)];
                const last = raw[raw.length - 1];
                if (Math.hypot(last[0] - pt[0], last[1] - pt[1]) > 0.6) raw.push(pt);
            }
            raw.push(hB);
            let pts = simplify(chaikin(raw)).map(([x, y]) => snapOcean(x, y) || [x, y]);
            pts[0] = hA; pts[pts.length - 1] = hB;
            routes.push({ mode: 'sea', a: pr.a.id, b: pr.b.id, pts });
        }
    }

    return { routes };
}
