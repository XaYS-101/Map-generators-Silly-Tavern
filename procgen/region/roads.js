/* ------------------------------------------------------------------
 *  Region stage 6: roads & river crossings.
 *
 *  Settlement graph = euclidean MST (Prim) plus a couple of shortcut
 *  edges where the graph detour is large. Each edge is routed with A*
 *  on a half-resolution cost grid (terrain slope + biome + river
 *  penalties; ocean/lake impassable), then simplified and Chaikin-
 *  smoothed. Accepted routes discount their blocks so later roads
 *  braid onto shared trakts. Where a route crosses a river it drops a
 *  ford (shallow) or bridge (deep).
 *
 *  Deterministic and RNG-free: fixed neighbor order, index tie-breaks.
 * ------------------------------------------------------------------ */
import { BIOME } from './biomes.js';

const SQRT2 = Math.SQRT2;
/* E, SE, S, SW, W, NW, N, NE */
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];
const DDIST = [1, SQRT2, 1, SQRT2, 1, SQRT2, 1, SQRT2];

const BIOME_COST = {
    [BIOME.beach]: 0.2, [BIOME.grassland]: 0, [BIOME.savanna]: 0.1, [BIOME.forest]: 0.6,
    [BIOME.taiga]: 0.7, [BIOME.rainforest]: 1.2, [BIOME.desert]: 1.0, [BIOME.tundra]: 0.8,
    [BIOME.badlands]: 1.5, [BIOME.ashland]: 2.0, [BIOME.blight]: 2.0, [BIOME.swamp]: 4,
    [BIOME.mountains]: 5, [BIOME.snow]: 8,
};

/* binary min-heap on typed arrays (same pattern as hydrology.js) */
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

/**
 * @param {object} ctx {N, settlements, height, sea, landSpan, biome,
 *                       isOcean, lakeMask, isRiver, flowTo, flowAcc, T, rivers}
 */
export function buildRoads(ctx) {
    const { N, settlements, height, sea, landSpan, biome,
        isOcean, lakeMask, isRiver, flowTo, flowAcc, T, rivers } = ctx;
    const S = settlements;
    const nS = S.length;
    const FORD_MAX = 3 * T;

    if (nS < 2) return { roads: [], bridges: [], edges: [] };

    /* ---- graph: euclidean MST + shortcut edges ---- */
    const euclid = (i, j) => Math.hypot(S[i].x - S[j].x, S[i].y - S[j].y);
    const inTree = new Uint8Array(nS);
    const mst = [];
    inTree[0] = 1;
    for (let added = 1; added < nS; added++) {
        let ba = -1, bb = -1, bd = Infinity;
        for (let i = 0; i < nS; i++) {
            if (!inTree[i]) continue;
            for (let j = 0; j < nS; j++) {
                if (inTree[j]) continue;
                const d = euclid(i, j);
                if (d < bd) { bd = d; ba = i; bb = j; }
            }
        }
        if (bb < 0) break;
        inTree[bb] = 1;
        mst.push([ba, bb]);
    }

    // Floyd–Warshall over the MST graph
    const INF = Infinity;
    const gd = Array.from({ length: nS }, () => new Float64Array(nS).fill(INF));
    for (let i = 0; i < nS; i++) gd[i][i] = 0;
    for (const [a, b] of mst) { const w = euclid(a, b); gd[a][b] = w; gd[b][a] = w; }
    for (let k = 0; k < nS; k++)
        for (let i = 0; i < nS; i++)
            for (let j = 0; j < nS; j++)
                if (gd[i][k] + gd[k][j] < gd[i][j]) gd[i][j] = gd[i][k] + gd[k][j];

    const edgeSet = new Set();
    const norm = (a, b) => (a < b ? a + ',' + b : b + ',' + a);
    for (const [a, b] of mst) edgeSet.add(norm(a, b));
    // add up to k=2 shortcuts per node where the graph detour is large
    for (let i = 0; i < nS; i++) {
        const cands = [];
        for (let j = 0; j < nS; j++) {
            if (j === i || edgeSet.has(norm(i, j))) continue;
            const e = euclid(i, j);
            if (gd[i][j] / e > 1.6) cands.push([j, e]);
        }
        cands.sort((p, q) => p[1] - q[1] || p[0] - q[0]);
        for (let k = 0; k < Math.min(2, cands.length); k++) edgeSet.add(norm(i, cands[k][0]));
    }
    const edges = [...edgeSet].map(s => { const [a, b] = s.split(',').map(Number); return { ai: a, bi: b }; })
        .sort((e, f) => e.ai - f.ai || e.bi - f.bi);

    /* ---- half-res cost grid ---- */
    const H = N / 2;
    const HH = H * H;
    const hNorm = i => (height[i] - sea) / landSpan;
    const blockWater = new Uint8Array(HH);
    const blockH = new Float32Array(HH);
    const blockBC = new Float32Array(HH);
    const riverPen = new Float32Array(HH);
    const blockMul = new Float32Array(HH).fill(1);
    for (let by = 0; by < H; by++) {
        for (let bx = 0; bx < H; bx++) {
            const b = by * H + bx;
            let water = 0, hsum = 0, bc = 0, hasRiver = 0, maxAcc = 0;
            for (let oy = 0; oy < 2; oy++) for (let ox = 0; ox < 2; ox++) {
                const fx = bx * 2 + ox, fy = by * 2 + oy, fi = fy * N + fx;
                const code = biome[fi];
                if (code <= BIOME.lake) water = 1;   // ocean or lake
                hsum += hNorm(fi);
                bc = Math.max(bc, BIOME_COST[code] || 0);
                if (isRiver[fi]) { hasRiver = 1; if (flowAcc[fi] > maxAcc) maxAcc = flowAcc[fi]; }
            }
            blockWater[b] = water;
            blockH[b] = hsum / 4;
            blockBC[b] = bc;
            riverPen[b] = hasRiver ? (maxAcc >= FORD_MAX ? 25 : 8) : 0;
        }
    }

    const heap = makeHeap(HH);
    const gScore = new Float64Array(HH);
    const cameFrom = new Int32Array(HH);
    const stamp = new Int32Array(HH);   // generation marker → no per-search clear
    let gen = 0;

    const astar = (sx, sy, gx, gy) => {
        const start = sy * H + sx, goal = gy * H + gx;
        gen++;
        heap.clear();
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
            const ux = u % H, uy = (u / H) | 0;
            const gu = gScore[u];
            for (let d = 0; d < 8; d++) {
                const nx = ux + DX[d], ny = uy + DY[d];
                if (nx < 0 || ny < 0 || nx >= H || ny >= H) continue;
                const nb = ny * H + nx;
                if (blockWater[nb] && nb !== goal) continue;
                const step = DDIST[d];
                const enter = (step * (1 + 30 * Math.abs(blockH[nb] - blockH[u]) + blockBC[nb]) + riverPen[nb]) * blockMul[nb];
                const tentative = gu + enter;
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

    /* ---- route every edge ---- */
    const roads = [];
    const bridges = [];
    for (const { ai, bi } of edges) {
        const a = S[ai], b = S[bi];
        const hpath = astar((a.x / 2) | 0, (a.y / 2) | 0, (b.x / 2) | 0, (b.y / 2) | 0);
        let pts;
        if (hpath && hpath.length >= 2) {
            for (const bc of hpath) blockMul[bc] = Math.max(0.05, blockMul[bc] * 0.3);   // trakt discount
            const full = hpath.map(bc => [Math.round((bc % H) * 2 + 0.5), Math.round(((bc / H) | 0) * 2 + 0.5)]);
            const simplified = [full[0]];
            for (let k = 1; k < full.length - 1; k += 2) simplified.push(full[k]);
            if (full.length > 1) simplified.push(full[full.length - 1]);
            pts = chaikin(simplified);
        } else {
            // fallback: straight two-bend line (deterministic, no jitter)
            const mx1 = a.x + (b.x - a.x) / 3, my1 = a.y + (b.y - a.y) / 3;
            const mx2 = a.x + (b.x - a.x) * 2 / 3, my2 = a.y + (b.y - a.y) * 2 / 3;
            pts = [[a.x, a.y], [mx1, my1], [mx2, my2], [b.x, b.y]];
        }
        pts[0] = [a.x, a.y];
        pts[pts.length - 1] = [b.x, b.y];
        roads.push({ pts: detourAroundWater(pts, N, isOcean, lakeMask), ai, bi });
    }

    /* ---- bridges / fords where roads cross rivers ---- */
    // map river polyline pts → owning river index (only sampled cells resolve)
    const claimedRiver = new Int32Array(N * N).fill(-1);
    rivers.forEach((r, ri) => {
        for (const [px, py] of r.pts) {
            const cx = Math.round(px), cy = Math.round(py);
            if (cx >= 0 && cy >= 0 && cx < N && cy < N) claimedRiver[cy * N + cx] = ri;
        }
    });
    const nearestRiverCell = (cx, cy) => {
        for (let r = 0; r <= 3; r++) {
            for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                const nx = cx + dx, ny = cy + dy;
                if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
                if (isRiver[ny * N + nx]) return [nx, ny];
            }
        }
        return null;
    };
    const resolveRiverIdx = (cx, cy) => {
        for (let r = 0; r <= 2; r++) {
            for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                const nx = cx + dx, ny = cy + dy;
                if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
                const idx = claimedRiver[ny * N + nx];
                if (idx >= 0) return idx;
            }
        }
        return -1;
    };

    roads.forEach((road, roadIdx) => {
        // dense 1-cell sampling along the drawn polyline
        const samples = [];
        for (let k = 0; k < road.pts.length - 1; k++) {
            const [x0, y0] = road.pts[k], [x1, y1] = road.pts[k + 1];
            const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
            for (let t = 0; t < steps; t++) {
                const f = t / steps;
                samples.push([x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]);
            }
        }
        samples.push(road.pts[road.pts.length - 1]);
        // contiguous runs of river cells → one crossing at the run middle
        const kept = [];
        let runStart = -1;
        const flush = end => {
            if (runStart < 0) return;
            const mid = (runStart + end) >> 1;
            const [mx, my] = samples[mid];
            const snap = nearestRiverCell(Math.round(mx), Math.round(my));
            if (snap) {
                const [sx, sy] = snap, si = sy * N + sx;
                if (!kept.some(br => Math.hypot(br.x - sx, br.y - sy) < 3)) {
                    const t = flowTo[si];
                    let angle = 0;
                    if (t >= 0) angle = Math.atan2(((t / N) | 0) - sy, (t % N) - sx);
                    kept.push({
                        x: sx, y: sy,
                        kind: flowAcc[si] < FORD_MAX ? 'ford' : 'bridge',
                        angle, roadIdx, riverIdx: resolveRiverIdx(sx, sy),
                    });
                }
            }
            runStart = -1;
        };
        for (let k = 0; k < samples.length; k++) {
            const [sx, sy] = samples[k];
            const cx = Math.round(sx), cy = Math.round(sy);
            const river = cx >= 0 && cy >= 0 && cx < N && cy < N && isRiver[cy * N + cx];
            if (river) { if (runStart < 0) runStart = k; }
            else flush(k - 1);
        }
        flush(samples.length - 1);
        for (const br of kept) bridges.push(br);
    });

    return { roads, bridges, edges };
}

/* Chaikin smoothing (and the half-res → full-res mapping) can graze a
 * single water cell diagonally between passable blocks. Walk the final
 * polyline at ~1-cell steps and shove any watery vertex/sample to the
 * nearest land cell. Deterministic ring search, endpoints untouched. */
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
        if (k === pts.length - 1) out.push([x1, y1]);   // endpoint stays exact
        else pushDry(x1, y1);
    }
    return out;
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
