/* ------------------------------------------------------------------
 *  Region stage 2: hydrology.
 *
 *  Priority-flood depression filling (Barnes 2014) with a monotone
 *  epsilon → every land cell drains; filled basins become LAKES.
 *  D8 flow directions over the filled surface → flow accumulation →
 *  rivers where accumulation crosses a threshold. Rivers carry a
 *  per-point width that grows downstream: pts are [x, y, w] triples
 *  (existing consumers destructure [x, y] and ignore w).
 *
 *  Deterministic and RNG-free: fixed neighbor order, ties broken by
 *  cell index. NEVER writes to ctx.height — the filled surface lives
 *  in its own `waterHeight` array.
 * ------------------------------------------------------------------ */

const EPS = 1e-7;        // monotone bump that drains flats
const LAKE_EPS = 1e-3;   // how much fill counts as standing water
const MIN_LAKE_CELLS = 12;
const SQRT2 = Math.SQRT2;

/* E, SE, S, SW, W, NW, N, NE — fixed order = deterministic ties */
const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, 1, 1, 1, 0, -1, -1, -1];
const DDIST = [1, SQRT2, 1, SQRT2, 1, SQRT2, 1, SQRT2];

/* binary min-heap on typed arrays — no object allocation in the loop */
function makeHeap(cap) {
    const idx = new Int32Array(cap);
    const key = new Float64Array(cap);
    let n = 0;
    return {
        get size() { return n; },
        push(i, k) {
            let c = n++;
            while (c > 0) {
                const p = (c - 1) >> 1;
                if (key[p] <= k) break;
                idx[c] = idx[p]; key[c] = key[p]; c = p;
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

/** Accumulation threshold (in cells) for a river to exist. */
export function riverThreshold(riversParam) {
    return { dry: 220, normal: 120, wet: 70 }[riversParam] ?? 120;
}

/**
 * @param {{N:number, height:Float32Array, sea:number, p:object}} ctx
 */
export function buildHydrology(ctx) {
    const { N, height, sea, p } = ctx;
    const M = N * N;

    /* ---- (a) priority-flood: fill every depression up to its spill ---- */
    const wh = new Float64Array(M);
    const seen = new Uint8Array(M);
    const order = new Int32Array(M);   // pop order = ascending water surface
    let orderLen = 0;
    const heap = makeHeap(M);
    for (let x = 0; x < N; x++) {
        for (const i of [x, (N - 1) * N + x]) {
            if (!seen[i]) { seen[i] = 1; wh[i] = Math.max(height[i], sea); heap.push(i, wh[i]); }
        }
    }
    for (let y = 1; y < N - 1; y++) {
        for (const i of [y * N, y * N + N - 1]) {
            if (!seen[i]) { seen[i] = 1; wh[i] = Math.max(height[i], sea); heap.push(i, wh[i]); }
        }
    }
    while (heap.size) {
        const c = heap.pop();
        order[orderLen++] = c;
        const cx = c % N, cy = (c / N) | 0;
        // no bump at exactly sea level → the open ocean stays flat
        const bump = wh[c] > sea + 1e-9 ? EPS : 0;
        for (let d = 0; d < 8; d++) {
            const nx = cx + DX[d], ny = cy + DY[d];
            if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
            const n = ny * N + nx;
            if (seen[n]) continue;
            seen[n] = 1;
            wh[n] = Math.max(height[n], wh[c] + bump);
            heap.push(n, wh[n]);
        }
    }

    /* ---- water classification ---- */
    const isOcean = new Uint8Array(M);
    const lakeMask = new Uint8Array(M);
    for (let i = 0; i < M; i++) {
        if (height[i] <= sea && wh[i] <= sea + 1e-9) isOcean[i] = 1;
        else if (wh[i] > Math.max(height[i], sea) + LAKE_EPS) lakeMask[i] = 1;
    }

    /* ---- (b) lakes: flood-fill ids, drop ponds below MIN_LAKE_CELLS ---- */
    const lakeId = new Int32Array(M);   // 0 = not a lake
    const lakes = [];
    {
        const q = new Int32Array(M);
        for (let i = 0; i < M; i++) {
            if (!lakeMask[i] || lakeId[i]) continue;
            let head = 0, tail = 0;
            q[tail++] = i;
            const id = lakes.length + 1;
            lakeId[i] = id;
            let cells = 0, sx = 0, sy = 0;
            while (head < tail) {
                const c = q[head++];
                const cx = c % N, cy = (c / N) | 0;
                cells++; sx += cx; sy += cy;
                for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
                    if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
                    const n = ny * N + nx;
                    if (lakeMask[n] && !lakeId[n]) { lakeId[n] = id; q[tail++] = n; }
                }
            }
            if (cells < MIN_LAKE_CELLS) {   // pond: revert to land
                for (let k = 0; k < tail; k++) { lakeMask[q[k]] = 0; lakeId[q[k]] = 0; }
            } else {
                lakes.push({ id, x: sx / cells, y: sy / cells, cells, level: wh[i] });
            }
        }
    }

    /* ---- (c) D8 flow over the filled surface ---- */
    const flowTo = new Int32Array(M).fill(-1);   // -1 = sink/off-map, else target index
    for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
            const i = y * N + x;
            if (isOcean[i]) continue;
            let best = -1, bg = 0;
            for (let d = 0; d < 8; d++) {
                const nx = x + DX[d], ny = y + DY[d];
                if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
                const n = ny * N + nx;
                const g = (wh[i] - wh[n]) / DDIST[d];
                if (g > bg) { bg = g; best = n; }
            }
            flowTo[i] = best;
        }
    }

    /* ---- (d) flow accumulation: one pass in reverse pop order ---- */
    const acc = new Float32Array(M);
    for (let i = 0; i < M; i++) acc[i] = isOcean[i] ? 0 : 1;
    for (let k = orderLen - 1; k >= 0; k--) {
        const i = order[k];
        if (isOcean[i]) continue;
        const t = flowTo[i];
        if (t >= 0) acc[t] += acc[i];
    }

    /* ---- (e) rivers: threshold + downstream tracing ---- */
    const T = riverThreshold(p.rivers);
    const isRiver = new Uint8Array(M);
    for (let i = 0; i < M; i++) {
        if (!isOcean[i] && !lakeMask[i] && acc[i] >= T) isRiver[i] = 1;
    }

    const widthAt = i => Math.min(4.5, 0.8 + 0.35 * Math.sqrt(acc[i] / T));
    const claimed = new Int32Array(M).fill(-1);
    const rivers = [];
    const confluences = [];
    const isSource = i => {
        const x = i % N, y = (i / N) | 0;
        for (let d = 0; d < 8; d++) {
            const nx = x + DX[d], ny = y + DY[d];
            if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
            const n = ny * N + nx;
            if (isRiver[n] && flowTo[n] === i) return false;
        }
        return true;
    };
    for (let i0 = 0; i0 < M; i0++) {
        if (!isRiver[i0] || claimed[i0] >= 0 || !isSource(i0)) continue;
        const idx = rivers.length;
        const pts = [];
        const tags = [];
        let i = i0, steps = 0, maxAcc = acc[i0];
        for (; steps < M; steps++) {
            const x = i % N, y = (i / N) | 0;
            if (steps % 2 === 0) pts.push([x, y, widthAt(i)]);
            claimed[i] = idx;
            maxAcc = Math.max(maxAcc, acc[i]);
            const t = flowTo[i];
            if (t < 0) break;                         // interior sink / off-map
            const tx = t % N, ty = (t / N) | 0;
            if (isOcean[t]) {                          // mouth
                pts.push([tx, ty, widthAt(i)]);
                tags.push('to-sea');
                if (acc[i] >= 6 * T) tags.push('delta');
                else if (acc[i] >= 3 * T) tags.push('estuary');
                break;
            }
            if (lakeMask[t]) {                         // feeds a lake
                pts.push([tx, ty, widthAt(i)]);
                tags.push('to-lake:' + lakeId[t]);
                break;
            }
            if (claimed[t] >= 0) {                     // joins a bigger river
                pts.push([tx, ty, widthAt(t)]);
                tags.push('tributary:' + claimed[t]);
                confluences.push([tx, ty]);
                break;
            }
            if (!isRiver[t]) {                         // dwindles below threshold
                pts.push([tx, ty, widthAt(i)]);
                break;
            }
            i = t;
        }
        if (steps >= 10 && pts.length >= 4) rivers.push({ pts, maxAcc, tags });
        else for (let k = 0; k < M; k++) if (claimed[k] === idx) claimed[k] = -1;
    }

    return { waterHeight: wh, isOcean, lakeMask, lakeId, lakes, flowTo, flowAcc: acc, isRiver, rivers, confluences, T };
}
