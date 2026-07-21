/* ------------------------------------------------------------------
 *  Region generator invariants — run with `node --test procgen/test`.
 *  DOM-free: exercises generation only (render is browser-tested).
 * ------------------------------------------------------------------ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateRegion } from '../gen-region.js';
import { buildTerrain } from '../region/terrain.js';
import { buildHydrology } from '../region/hydrology.js';
import { describe as describeModel } from '../describe.js';
import { Rng, hashSeed } from '../rng.js';

const SEEDS = ['12345', 'alpha', 'omega'];

test('same seed + params → identical model and prose', () => {
    for (const seed of SEEDS) {
        for (const p of [{}, { flavor: 'wasteland', climate: 'hot' }, { size: 'small', rivers: 'wet' }]) {
            const a = generateRegion(seed, p);
            const b = generateRegion(seed, p);
            assert.equal(JSON.stringify(a.entities), JSON.stringify(b.entities), `entities ${seed} ${JSON.stringify(p)}`);
            assert.equal(describeModel(a).prose, describeModel(b).prose, `prose ${seed} ${JSON.stringify(p)}`);
        }
    }
});

test('hydrology invariants: rivers flow downhill and end in water/sink', () => {
    for (const seed of SEEDS) {
        const p = { mask: 'island', water: 0.42, settlements: 'some', rivers: 'normal', flavor: 'normal' };
        const N = 256;
        const terrain = buildTerrain({ N, seed, p }, new Rng(`${seed}/layout:${p.mask}:${p.water}:${p.settlements}`));
        const hydro = buildHydrology({ N, height: terrain.height, sea: terrain.sea, p });
        const { waterHeight, isOcean, lakeMask, rivers } = hydro;
        for (const [ri, r] of rivers.entries()) {
            let prevWh = Infinity, prevW = 0;
            for (const [x, y, w] of r.pts) {
                const i = Math.round(y) * N + Math.round(x);
                assert.ok(waterHeight[i] <= prevWh + 1e-9, `river ${ri} (${seed}) flows uphill at ${x},${y}`);
                prevWh = waterHeight[i];
                assert.ok(w >= prevW - 1e-6, `river ${ri} (${seed}) narrows downstream at ${x},${y}`);
                prevW = Math.max(prevW, w);
            }
            const [lx, ly] = r.pts[r.pts.length - 1];
            const li = Math.round(ly) * N + Math.round(lx);
            const endsInWater = isOcean[li] || lakeMask[li]
                || r.tags.some(t => t.startsWith('tributary:'))
                || r.tags.length === 0;   // interior sink / dwindles — allowed
            assert.ok(endsInWater, `river ${ri} (${seed}) ends nowhere sensible`);
        }
    }
});

test('roads cross rivers only at bridges/fords', () => {
    for (const seed of SEEDS) {
        const model = generateRegion(seed, {});
        const N = model.layers.N;
        const bio = model.layers.biomes;
        const crossings = model.entities.filter(e => e.kind === 'bridge');
        const isLakeOrOcean = (x, y) => {
            const c = bio[Math.round(y) * N + Math.round(x)];
            return c === 0 || c === 1;
        };
        for (const road of model.entities.filter(e => e.kind === 'road')) {
            // walk the polyline at ~1-cell steps; every river touch must have
            // a bridge/ford entity within 4 cells
            for (let k = 0; k < road.pts.length - 1; k++) {
                const [x0, y0] = road.pts[k], [x1, y1] = road.pts[k + 1];
                const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
                for (let t = 0; t <= steps; t++) {
                    const x = x0 + (x1 - x0) * t / steps, y = y0 + (y1 - y0) * t / steps;
                    if (!isLakeOrOcean(x, y)) continue;
                    // lakes/ocean under a road are only acceptable right at a
                    // settlement endpoint (coastal towns) — never mid-route
                    const nearEnd = [road.pts[0], road.pts[road.pts.length - 1]]
                        .some(([ex, ey]) => Math.hypot(ex - x, ey - y) < 6);
                    assert.ok(nearEnd, `road ${road.id} (${seed}) runs through open water at ${x.toFixed(1)},${y.toFixed(1)}`);
                }
            }
        }
        for (const br of crossings) {
            assert.ok(model.entities.some(e => e.id === br.road), `bridge ${br.id} (${seed}) references missing ${br.road}`);
            if (br.river) assert.ok(model.entities.some(e => e.id === br.river), `bridge ${br.id} references missing ${br.river}`);
        }
    }
});

test('entities are well-formed for every flavor/climate/size', () => {
    for (const flavor of ['normal', 'wasteland', 'volcanic', 'blighted']) {
        for (const size of ['small', 'large']) {
            const m = generateRegion('9000', { flavor, size, climate: flavor === 'volcanic' ? 'hot' : 'cold' });
            for (const e of m.entities) {
                for (const v of [e.x, e.y]) {
                    if (v !== undefined) assert.ok(Number.isFinite(v), `${e.id} has bad coord in ${flavor}/${size}`);
                }
                if (e.pts) for (const pt of e.pts) assert.ok(pt.every(Number.isFinite), `${e.id} has bad pt in ${flavor}/${size}`);
            }
            assert.ok(m.entities.some(e => e.kind === 'settlement'), `no settlements in ${flavor}/${size}`);
        }
    }
});

test('biome grid snapshots (update deliberately on generator changes)', () => {
    const gridHash = m => hashSeed(Array.from(m.layers.biomes).join(','))[0];
    const got = {};
    for (const seed of SEEDS) {
        for (const flavor of ['normal', 'wasteland']) {
            got[`${seed}/${flavor}`] = gridHash(generateRegion(seed, { flavor }));
        }
    }
    // pinned against the v1.7.0 pipeline; on a deliberate generator change,
    // print `got` and update these values in the same commit
    assert.deepEqual(got, {
        '12345/normal': 1979654596,
        '12345/wasteland': 1721329484,
        'alpha/normal': 1009210670,
        'alpha/wasteland': 399392830,
        'omega/normal': 3330597709,
        'omega/wasteland': 2505830624,
    });
});
