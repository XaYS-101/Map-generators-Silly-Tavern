/* ------------------------------------------------------------------
 *  Town generator invariants — run with `node --test`.
 * ------------------------------------------------------------------ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTown } from '../gen-town.js';
import { describe as describeModel } from '../describe.js';
import { hashSeed } from '../rng.js';
import { polysIntersect, distToPolyline, scalePoly } from '../town/geom.js';

const SEEDS = ['t1', 'bram'];
const GRID = [
    {}, { size: 'city', walls: true, wealth: 'wealthy', site: 'hillside' },
    { size: 'village', water: 'coast', trade: 'fishing' },
    { trade: 'mining', walls: true }, { trade: 'garrison', walls: true },
    { trade: 'farming', walls: true }, { trade: 'temple', water: 'none' },
    { wealth: 'poor', condition: 'declining' },
    { condition: 'ruined', walls: true, site: 'crossroads' },
];

test('same seed + params → identical model and prose', () => {
    for (const seed of SEEDS) {
        for (const p of GRID) {
            const a = generateTown(seed, p);
            const b = generateTown(seed, p);
            assert.equal(JSON.stringify(a.entities), JSON.stringify(b.entities), `entities ${seed} ${JSON.stringify(p)}`);
            assert.equal(describeModel(a).prose, describeModel(b).prose, `prose ${seed} ${JSON.stringify(p)}`);
        }
    }
});

test('buildings never overlap and stay on dry land', () => {
    for (const p of GRID) {
        const m = generateTown('t1', p);
        const built = m.entities.filter(e => (e.kind === 'building' || e.kind === 'landmark') && e.state !== 'rubble');
        for (let i = 0; i < built.length; i++) {
            for (let j = i + 1; j < built.length; j++) {
                // integer rounding can graze; test on slightly shrunk polys
                assert.ok(!polysIntersect(scalePoly(built[i].poly, 0.92), scalePoly(built[j].poly, 0.92)),
                    `${built[i].id} overlaps ${built[j].id} in ${JSON.stringify(p)}`);
            }
        }
        const river = m.entities.find(e => e.kind === 'river');
        const coast = m.entities.find(e => e.kind === 'coast');
        const wet = (x, y) => {
            if (river && distToPolyline(x, y, river.pts) < (river.width ?? 18) / 2 - 2) return true;
            if (coast) {
                // approximate: below the shoreline by a margin
                let sy = coast.y;
                for (let i = 1; i < coast.pts.length; i++) {
                    if (x <= coast.pts[i][0]) {
                        const [x0, y0] = coast.pts[i - 1], [x1, y1] = coast.pts[i];
                        sy = y0 + (y1 - y0) * ((x - x0) / ((x1 - x0) || 1));
                        break;
                    }
                }
                return y > sy + 3;
            }
            return false;
        };
        for (const b of built) {
            for (const [x, y] of b.poly) assert.ok(!wet(x, y), `${b.id} in water in ${JSON.stringify(p)}`);
        }
    }
});

test('main roads cross the river only at bridges; lanes never do', () => {
    for (const seed of SEEDS) {
        const m = generateTown(seed, { size: 'city', walls: true });
        const river = m.entities.find(e => e.kind === 'river');
        if (!river) continue;
        const bridges = m.entities.filter(e => e.kind === 'bridge');
        const half = (river.width ?? 18) / 2;
        for (const rd of m.entities.filter(e => e.kind === 'road')) {
            for (const [x, y] of rd.pts) {
                if (distToPolyline(x, y, river.pts) >= half - 2) continue;
                if (rd.purpose === 'main') {
                    assert.ok(bridges.some(br => Math.hypot(br.x - x, br.y - y) < 34),
                        `main ${rd.id} (${seed}) crosses the river far from any bridge at ${x},${y}`);
                } else {
                    assert.fail(`${rd.purpose} ${rd.id} (${seed}) crosses the river at ${x},${y}`);
                }
            }
        }
        for (const br of bridges) assert.ok(m.entities.some(e => e.id === br.road), `${br.id} references a road`);
    }
});

test('gates sit on the wall; breached walls only when ruined', () => {
    for (const p of [{ size: 'city', walls: true }, { walls: true, condition: 'ruined' }]) {
        const m = generateTown('t1', p);
        const wall = m.entities.find(e => e.kind === 'wall');
        assert.ok(wall, 'wall exists');
        const ring = [...wall.pts, wall.pts[0]];
        for (const g of m.entities.filter(e => e.kind === 'gate')) {
            assert.ok(distToPolyline(g.x, g.y, ring) < 3, `gate ${g.id} off the wall in ${JSON.stringify(p)}`);
        }
        if (p.condition === 'ruined') assert.ok(wall.breaches.length >= 1, 'ruined wall has breaches');
        else assert.equal((wall.breaches || []).length, 0, 'intact wall has no breaches');
    }
});

test('condition drives building states; landmarks keep residents', () => {
    const ruined = generateTown('t1', { size: 'city', condition: 'ruined' });
    const built = ruined.entities.filter(e => e.kind === 'building');
    const broken = built.filter(b => b.state !== 'intact').length;
    assert.ok(broken / built.length > 0.25, `ruined city has ${broken}/${built.length} damaged buildings`);
    const thriving = generateTown('t1', { size: 'city' });
    assert.ok(thriving.entities.filter(e => e.kind === 'building').every(b => b.state === 'intact'), 'thriving = all intact');
    const lms = thriving.entities.filter(e => e.kind === 'landmark');
    const withRes = lms.filter(l => l.resident && l.resident.name && l.resident.role && l.resident.trait);
    assert.ok(withRes.length >= lms.length * 0.6, `${withRes.length}/${lms.length} landmarks have residents`);
});

test('model snapshots (update deliberately on generator changes)', () => {
    const got = {};
    for (const seed of SEEDS) {
        for (const [tag, p] of [['default', {}], ['spec', { size: 'city', walls: true, trade: 'fishing', water: 'coast', wealth: 'poor', condition: 'declining' }]]) {
            const m = generateTown(seed, p);
            const { layers, ...rest } = m;
            got[`${seed}/${tag}`] = hashSeed(JSON.stringify(rest))[0];
        }
    }
    // pinned against the v1.9.0 pipeline; on a deliberate generator change,
    // print `got` and update these values in the same commit
    assert.deepEqual(got, {
        't1/default': 214078121,
        't1/spec': 150039954,
        'bram/default': 1155474683,
        'bram/spec': 2326589349,
    });
});
