/* ------------------------------------------------------------------
 *  World generator invariants — run with `node --test`.
 *  DOM-free: exercises generation only (render is browser-tested).
 * ------------------------------------------------------------------ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateWorld } from '../gen-world.js';
import { generateRegion } from '../gen-region.js';
import { deriveRegionParams } from '../world/zoom.js';
import { describe as describeModel } from '../describe.js';
import { hashSeed } from '../rng.js';
import { BIOME } from '../region/biomes.js';

const SEEDS = ['w1', 'aeldros'];

test('same seed + params → identical model and prose', () => {
    for (const seed of SEEDS) {
        for (const p of [{}, { continents: 'archipelago', age: 'ancient' }, { climate: 'iceage', size: 'small' }]) {
            const a = generateWorld(seed, p);
            const b = generateWorld(seed, p);
            assert.equal(JSON.stringify(a.entities), JSON.stringify(b.entities), `entities ${seed} ${JSON.stringify(p)}`);
            assert.equal(describeModel(a).prose, describeModel(b).prose, `prose ${seed} ${JSON.stringify(p)}`);
        }
    }
});

test('every owned cell connects to its capital through own territory', () => {
    const m = generateWorld('w1', {});
    const N = m.layers.N;
    const owner = m.layers.owner;
    const capitals = m.entities.filter(e => e.kind === 'capital');
    const nationIdx = new Map(m.entities.filter(e => e.kind === 'nation').map((n, i) => [n.id, i]));
    // multi-source BFS from each capital across same-owner cells
    const reached = new Uint8Array(N * N);
    const q = [];
    for (const cap of capitals) {
        const i = cap.y * N + cap.x;
        const own = owner[i];
        assert.equal(own, nationIdx.get(cap.nation), `capital ${cap.id} stands on its own territory`);
        reached[i] = 1;
        q.push(i);
    }
    for (let head = 0; head < q.length; head++) {
        const c = q[head];
        const cx = c % N, cy = (c / N) | 0;
        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
            if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
            const n = ny * N + nx;
            if (!reached[n] && owner[n] >= 0 && owner[n] === owner[c]) { reached[n] = 1; q.push(n); }
        }
    }
    let orphans = 0;
    for (let i = 0; i < N * N; i++) if (owner[i] >= 0 && !reached[i]) orphans++;
    // Dijkstra growth guarantees connectivity; tolerate nothing
    assert.equal(orphans, 0, `${orphans} owned cells unreachable from their capital`);
});

test('routes travel on the right element and reference real endpoints', () => {
    for (const seed of SEEDS) {
        const m = generateWorld(seed, { age: 'ancient' });
        const N = m.layers.N;
        const bio = m.layers.biomes;
        const ids = new Set(m.entities.map(e => e.id));
        const isWater = i => bio[i] === BIOME.ocean || bio[i] === BIOME.lake || bio[i] === BIOME.iceshelf;
        for (const r of m.entities.filter(e => e.kind === 'route')) {
            assert.ok(ids.has(r.a) && ids.has(r.b), `route ${r.id} endpoints exist`);
            // check interior points (skip 3 points at both ends: harbor ramps / capital snaps)
            for (let k = 3; k < r.pts.length - 3; k++) {
                const [x, y] = r.pts[k];
                const i = Math.round(y) * N + Math.round(x);
                if (r.purpose === 'sea') {
                    assert.ok(bio[i] === BIOME.ocean, `sea lane ${r.id} (${seed}) leaves open ocean at ${x},${y}`);
                } else {
                    assert.ok(!isWater(i), `caravan road ${r.id} (${seed}) enters water at ${x},${y}`);
                }
            }
        }
        for (const e of m.edges) {
            assert.ok(ids.has(e.a) && ids.has(e.b), `edge ${e.kind} ${e.a}-${e.b} references real entities`);
        }
    }
});

test('zoom derives a valid region with world-consistent params', () => {
    const w = generateWorld('w1', { climate: 'iceage' });
    const N = w.layers.N;
    const spots = [[N >> 1, 20], [N >> 1, N >> 1], [40, N - 30]];
    for (const [wx, wy] of spots) {
        const { seed, params } = deriveRegionParams(w, wx, wy);
        assert.match(seed, /^w1@\d+,\d+$/);
        assert.ok(['cold', 'temperate', 'hot'].includes(params.climate));
        const region = generateRegion(seed, params);
        assert.ok(region.entities.some(e => e.kind === 'settlement'), `region at ${wx},${wy} has settlements`);
        // twice → same region
        assert.equal(JSON.stringify(generateRegion(seed, params).entities), JSON.stringify(region.entities));
    }
    // polar spot on an iceage world must derive cold
    assert.equal(deriveRegionParams(w, N >> 1, 6).params.climate, 'cold');
});

test('biome + owner grid snapshots (update deliberately on generator changes)', () => {
    const gridHash = arr => hashSeed(Array.from(arr).join(','))[0];
    const got = {};
    for (const seed of SEEDS) {
        const m = generateWorld(seed, {});
        got[`${seed}/biomes`] = gridHash(m.layers.biomes);
        got[`${seed}/owner`] = gridHash(m.layers.owner);
    }
    // pinned against the v1.8.0 pipeline; on a deliberate generator change,
    // print `got` and update these values in the same commit
    assert.deepEqual(got, {
        'w1/biomes': 185747086,
        'w1/owner': 1908542146,
        'aeldros/biomes': 2832075876,
        'aeldros/owner': 4008545763,
    });
});
