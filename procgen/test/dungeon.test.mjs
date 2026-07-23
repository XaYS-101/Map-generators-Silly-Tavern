/* ------------------------------------------------------------------
 *  Dungeon generator invariants — run with `node --test`.
 * ------------------------------------------------------------------ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateDungeon } from '../gen-dungeon.js';
import { describe as describeModel } from '../describe.js';
import { hashSeed } from '../rng.js';
import { rleDecode } from '../schema.js';

const SEEDS = ['d1', 'barrow'];
const GRID = [
    {}, { theme: 'caves', size: 'l' }, { size: 'huge', depth: '3', danger: 'deadly' },
    { theme: 'sewer', depth: '2', tags: 'undead treasure' }, { size: 'den', depth: '3' },
    { theme: 'ruins', depth: '2', tags: 'empty' }, { depth: '3', tags: 'boss' },
];

test('same seed + params → identical model and prose', () => {
    for (const seed of SEEDS) {
        for (const p of GRID) {
            const a = generateDungeon(seed, p);
            const b = generateDungeon(seed, p);
            assert.equal(JSON.stringify(a.entities), JSON.stringify(b.entities), `entities ${seed} ${JSON.stringify(p)}`);
            assert.equal(describeModel(a).prose, describeModel(b).prose, `prose ${seed} ${JSON.stringify(p)}`);
        }
    }
});

test('deeper levels extend the same seed without touching the top level', () => {
    for (const seed of SEEDS) {
        const shallow = generateDungeon(seed, { size: 'l' });
        const deep = generateDungeon(seed, { size: 'l', depth: '3' });
        const top = m => JSON.stringify(m.entities
            .filter(e => e.kind === 'room' && (e.level ?? 0) === 0)
            .map(({ notes, content, tags, ...rest }) => rest));
        assert.equal(top(shallow), top(deep), `${seed}: top-level geometry moved under depth change`);
    }
});

test('grids are digit-free with the dungeon tile alphabet', () => {
    for (const p of GRID) {
        const m = generateDungeon('d1', p);
        for (const f of m.layers.floors) {
            for (const row of rleDecode(f.grid)) {
                for (const ch of row) assert.ok('#.+<>~'.includes(ch), `bad tile "${ch}" in ${JSON.stringify(p)}`);
            }
        }
    }
});

test('every room reachable from the entrance via doors and stairs', () => {
    for (const seed of SEEDS) {
        const m = generateDungeon(seed, { size: 'l', depth: '3' });
        const rooms = m.entities.filter(e => e.kind === 'room');
        const entrance = rooms.find(r => r.tags?.includes('entrance') && (r.level ?? 0) === 0);
        assert.ok(entrance, 'level-0 entrance exists');
        const adj = new Map(rooms.map(r => [r.id, []]));
        for (const e of m.edges) {
            if (adj.has(e.a) && adj.has(e.b)) { adj.get(e.a).push(e.b); adj.get(e.b).push(e.a); }
        }
        const seen = new Set([entrance.id]);
        const q = [entrance.id];
        while (q.length) for (const n of adj.get(q.shift()) || []) if (!seen.has(n)) { seen.add(n); q.push(n); }
        assert.equal(seen.size, rooms.length, `${seed}: ${rooms.length - seen.size} unreachable rooms`);
    }
});

test('stairs come in mirrored pairs linking adjacent levels', () => {
    const m = generateDungeon('d1', { size: 'l', depth: '3' });
    const stairs = m.entities.filter(e => e.kind === 'stair');
    assert.ok(stairs.length >= 4, 'depth-3 dungeon has two stair pairs');
    for (const st of stairs) {
        assert.equal(Math.abs(st.to - st.level), 1, `${st.id} links adjacent levels`);
        assert.ok(stairs.some(o => o !== st && o.level === st.to && o.to === st.level), `${st.id} has a mirror`);
        assert.ok(m.entities.some(e => e.id === st.room && e.kind === 'room'), `${st.id} sits in a real room`);
    }
});

test('locks never softlock: iterative key-gathering opens the whole dungeon', () => {
    // Locks may be SEQUENTIAL (level-0 key opens the way down to level-1's
    // key), so simulate play: BFS without locked doors, collect keys, then
    // repeat with locks passable once any key has been found.
    let found = 0;
    for (const seed of ['d1', 'd2', 'd3', 'barrow', 'crypt7']) {
        const m = generateDungeon(seed, { size: 'l', depth: '2' });
        const locked = m.edges.filter(e => e.locked);
        if (!locked.length) continue;
        found++;
        const rooms = m.entities.filter(e => e.kind === 'room');
        const keyRooms = new Set(rooms.filter(r => r.content?.key).map(r => r.id));
        assert.ok(keyRooms.size >= locked.length, `${seed}: every lock has a key`);
        const entrance = rooms.find(r => r.tags?.includes('entrance') && (r.level ?? 0) === 0);
        const bfs = (allowLocked) => {
            const adj = new Map(rooms.map(r => [r.id, []]));
            for (const e of m.edges) {
                if (e.locked && !allowLocked) continue;
                if (adj.has(e.a) && adj.has(e.b)) { adj.get(e.a).push(e.b); adj.get(e.b).push(e.a); }
            }
            const seen = new Set([entrance.id]);
            const q = [entrance.id];
            while (q.length) for (const n of adj.get(q.shift()) || []) if (!seen.has(n)) { seen.add(n); q.push(n); }
            return seen;
        };
        const beforeAnyKey = bfs(false);
        const firstKeyReachable = [...keyRooms].some(id => beforeAnyKey.has(id));
        assert.ok(firstKeyReachable, `${seed}: at least one key reachable before any unlock`);
        const afterKeys = bfs(true);
        assert.equal(afterKeys.size, rooms.length, `${seed}: whole dungeon opens once keys are gathered`);
    }
    assert.ok(found > 0, 'at least one seed produced locks');
});

test('inhabitants are seed-stable and reference real rooms', () => {
    // forced boss via tag
    const m = generateDungeon('d1', { size: 'l', depth: '3', tags: 'boss' });
    const boss = m.entities.find(e => e.kind === 'occupant' && e.tags?.includes('boss'));
    assert.ok(boss, 'boss tag forces a boss');
    const lair = m.entities.find(e => e.id === boss.room);
    assert.ok(lair?.tags?.includes('lair'), 'boss lairs in a lair-tagged room');
    const maxLevel = Math.max(...m.entities.filter(e => e.kind === 'room').map(r => r.level ?? 0));
    assert.equal(lair.level, maxLevel, 'lair is on the bottom level');
    assert.match(describeModel(m).prose, new RegExp(boss.name), 'boss named in prose');
    // empty tag kills boss+factions
    const e2 = generateDungeon('d1', { size: 'l', depth: '3', tags: 'empty' });
    assert.equal(e2.entities.filter(x => x.kind === 'occupant' && x.tags?.includes('boss')).length, 0);
    assert.equal(e2.entities.filter(x => x.kind === 'faction').length, 0);
    // faction rooms are real
    for (const seed of ['d1', 'd2', 'd6']) {
        const dm = generateDungeon(seed, { size: 'l', depth: '3', danger: 'deadly' });
        const ids = new Set(dm.entities.filter(x => x.kind === 'room').map(x => x.id));
        for (const f of dm.entities.filter(x => x.kind === 'faction')) {
            assert.ok(f.rooms.length > 0 && f.rooms.every(r => ids.has(r)), `${seed}: faction rooms real`);
        }
        for (const o of dm.entities.filter(x => x.kind === 'occupant')) {
            if (o.room) assert.ok(ids.has(o.room), `${seed}: occupant ${o.id} room real`);
        }
    }
});

test('presence layers roll probabilistically across seeds', () => {
    let bosses = 0, factions = 0, prisoners = 0, lore = 0;
    const N = 60;
    for (let i = 0; i < N; i++) {
        const m = generateDungeon('roll' + i, { size: 'l', depth: '2' });
        if (m.entities.some(e => e.kind === 'occupant' && e.tags?.includes('boss'))) bosses++;
        if (m.entities.some(e => e.kind === 'faction')) factions++;
        if (m.entities.some(e => e.kind === 'occupant' && !e.tags?.includes('boss'))) prisoners++;
        if (m.entities.some(e => e.kind === 'lore')) lore++;
    }
    // wide tolerances — this asserts "sometimes but not always", not exact rates
    assert.ok(bosses > N * 0.35 && bosses < N * 0.95, `bosses ${bosses}/${N}`);
    assert.ok(factions > N * 0.1 && factions < N * 0.8, `factions ${factions}/${N}`);
    assert.ok(prisoners > N * 0.08 && prisoners < N * 0.7, `prisoners ${prisoners}/${N}`);
    assert.ok(lore > N * 0.5 && lore < N * 0.98, `lore ${lore}/${N}`);
});

test('model snapshots (update deliberately on generator changes)', () => {
    const got = {};
    for (const seed of SEEDS) {
        for (const [tag, p] of [['classic', {}], ['deep', { size: 'l', depth: '3', danger: 'deadly', tags: 'undead' }]]) {
            const { layers, ...rest } = generateDungeon(seed, p);
            got[`${seed}/${tag}`] = hashSeed(JSON.stringify(rest))[0];
        }
    }
    // pinned against the v1.11.0 pipeline; on a deliberate generator change,
    // print `got` and update these values in the same commit
    assert.deepEqual(got, {
        'd1/classic': 3159631447,
        'd1/deep': 3795438205,
        'barrow/classic': 3248787965,
        'barrow/deep': 198973390,
    });
});
