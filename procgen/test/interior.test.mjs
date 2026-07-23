/* ------------------------------------------------------------------
 *  Interior generator invariants — run with `node --test`.
 * ------------------------------------------------------------------ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateInterior } from '../gen-interior.js';
import { describe as describeModel } from '../describe.js';
import { hashSeed } from '../rng.js';
import { rleDecode } from '../schema.js';

const KINDS = ['tavern', 'house', 'shop', 'temple', 'manor', 'keep',
    'smithy', 'barracks', 'warehouse', 'caravanserai', 'mill'];
const SEEDS = ['i1', 'hearth'];

test('same seed + params → identical model and prose', () => {
    for (const seed of SEEDS) {
        for (const building of KINDS) {
            for (const p of [{ building }, { building, size: 'large', wealth: 'wealthy', condition: 'looted' }]) {
                const a = generateInterior(seed, p);
                const b = generateInterior(seed, p);
                assert.equal(JSON.stringify(a.entities), JSON.stringify(b.entities), `entities ${seed} ${JSON.stringify(p)}`);
                assert.equal(describeModel(a).prose, describeModel(b).prose, `prose ${seed} ${JSON.stringify(p)}`);
            }
        }
    }
});

test('condition changes content, never geometry', () => {
    // occupants + life/lore layers are content — they may come and go with
    // condition; rooms/doors/windows/stairs must not move
    const CONTENT_KINDS = new Set(['occupant', 'event', 'rumor', 'menu', 'lore']);
    const strip = m => JSON.stringify(m.entities
        .filter(e => !CONTENT_KINDS.has(e.kind))
        .map(({ notes, content, name, ...rest }) => rest));
    for (const building of KINDS) {
        const a = generateInterior('i1', { building, condition: 'lived-in' });
        const b = generateInterior('i1', { building, condition: 'looted' });
        assert.equal(strip(a), strip(b), `${building}: geometry moved under condition change`);
    }
});

test('floors tile fully; grid letters match room counts', () => {
    for (const building of KINDS) {
        const m = generateInterior('i1', { building, size: 'large', wealth: 'wealthy' });
        for (const f of m.layers.floors) {
            const rows = rleDecode(f.grid);
            const letters = new Set();
            for (const row of rows) for (const ch of row) {
                assert.ok(!/\d/.test(ch), `${building} grid contains a digit`);
                if (ch !== '#') letters.add(ch);
            }
            const floorRooms = m.entities.filter(e => e.kind === 'room' && e.level === f.level);
            assert.equal(letters.size, floorRooms.length,
                `${building} L${f.level}: ${letters.size} letters vs ${floorRooms.length} rooms`);
        }
    }
});

test('every room reachable from the entrance via doors and stairs', () => {
    for (const building of KINDS) {
        const m = generateInterior('hearth', { building, size: 'large', wealth: 'wealthy' });
        const rooms = m.entities.filter(e => e.kind === 'room');
        const hub = rooms.find(r => r.tags?.includes('entrance'));
        assert.ok(hub, `${building} has an entrance`);
        const adj = new Map(rooms.map(r => [r.id, []]));
        for (const e of m.edges) {
            if (e.b === 'street') continue;
            if (adj.has(e.a) && adj.has(e.b)) { adj.get(e.a).push(e.b); adj.get(e.b).push(e.a); }
        }
        const seen = new Set([hub.id]);
        const q = [hub.id];
        while (q.length) for (const n of adj.get(q.shift()) || []) if (!seen.has(n)) { seen.add(n); q.push(n); }
        assert.equal(seen.size, rooms.length, `${building}: ${rooms.length - seen.size} unreachable rooms`);
    }
});

test('stairs come in mirrored pairs', () => {
    const m = generateInterior('i1', { building: 'manor', size: 'large', wealth: 'wealthy' });
    const stairs = m.entities.filter(e => e.kind === 'stair');
    assert.ok(stairs.length >= 2, 'multi-floor manor has stairs');
    for (const st of stairs) {
        assert.ok(stairs.some(o => o !== st && o.level === st.to && o.to === st.level),
            `stair ${st.id} has a mirror on level ${st.to}`);
    }
});

test('occupants live in real rooms; abandoned buildings are empty but remembered', () => {
    const lived = generateInterior('i1', { building: 'tavern' });
    const roomIds = new Set(lived.entities.filter(e => e.kind === 'room').map(e => e.id));
    const occ = lived.entities.filter(e => e.kind === 'occupant');
    assert.ok(occ.length >= 2, 'lived-in tavern has occupants');
    for (const o of occ) assert.ok(roomIds.has(o.room), `${o.id} lives in a real room`);
    const looted = generateInterior('i1', { building: 'tavern', condition: 'looted' });
    assert.equal(looted.entities.filter(e => e.kind === 'occupant').length, 0, 'looted = no occupants');
    const prose = describeModel(looted).prose;
    assert.match(prose, /Once kept by/, 'former owner mentioned');
    // same owner name as the lived-in variant
    const owner = occ.find(o => ['innkeeper'].includes(o.purpose));
    assert.ok(prose.includes(owner.name), 'former owner matches the lived-in owner');
});

test('locked doors have reachable keys (no softlock)', () => {
    let found = 0;
    for (const seed of ['i1', 'i2', 'i3', 'i4', 'hearth']) {
        const m = generateInterior(seed, { building: 'tavern', size: 'large', wealth: 'wealthy' });
        const locked = m.edges.filter(e => e.locked);
        if (!locked.length) continue;
        found++;
        const rooms = m.entities.filter(e => e.kind === 'room');
        const keyRoom = rooms.find(r => r.content && r.content.key);
        assert.ok(keyRoom, `${seed}: locked door has a key somewhere`);
        // BFS from entrance skipping locked edges must reach the key room
        const hub = rooms.find(r => r.tags?.includes('entrance'));
        const adj = new Map(rooms.map(r => [r.id, []]));
        for (const e of m.edges) {
            if (e.b === 'street' || e.locked) continue;
            if (adj.has(e.a) && adj.has(e.b)) { adj.get(e.a).push(e.b); adj.get(e.b).push(e.a); }
        }
        const seen = new Set([hub.id]);
        const q = [hub.id];
        while (q.length) for (const n of adj.get(q.shift()) || []) if (!seen.has(n)) { seen.add(n); q.push(n); }
        assert.ok(seen.has(keyRoom.id), `${seed}: key room reachable without the locked door`);
    }
    assert.ok(found > 0, 'at least one seed produced a locked door');
});

test('life layers appear only in lived-in buildings and reference real entities', () => {
    for (const seed of ['i1', 'i2', 'hearth']) {
        for (const building of KINDS) {
            for (const condition of ['abandoned', 'looted']) {
                const m = generateInterior(seed, { building, condition });
                assert.equal(m.entities.filter(e => e.kind === 'occupant' && e.tags?.includes('visitor')).length, 0,
                    `${seed}/${building}/${condition}: no visitors`);
                assert.equal(m.entities.filter(e => e.kind === 'event' || e.kind === 'rumor').length, 0,
                    `${seed}/${building}/${condition}: no events/rumors`);
                const menu = m.entities.find(e => e.kind === 'menu');
                if (menu) assert.ok(menu.tags?.includes('relic'), `${seed}/${building}/${condition}: menu only as a relic`);
            }
            const m = generateInterior(seed, { building });
            const roomIds = new Set(m.entities.filter(e => e.kind === 'room').map(e => e.id));
            const ids = new Set(m.entities.map(e => e.id));
            for (const v of m.entities.filter(e => e.kind === 'occupant' && e.tags?.includes('visitor')))
                assert.ok(roomIds.has(v.room), `${seed}/${building}: ${v.id} sits in a real room`);
            const ev = m.entities.find(e => e.kind === 'event');
            if (ev) assert.ok(roomIds.has(ev.room), `${seed}/${building}: event in a real room`);
            for (const ru of m.entities.filter(e => e.kind === 'rumor'))
                assert.ok(ids.has(ru.carrier), `${seed}/${building}: ${ru.id} carrier exists`);
        }
    }
});

test('menu: lived-in taverns and caravanserais always serve; nobody else does', () => {
    for (const seed of ['i1', 'i2', 'i3', 'hearth']) {
        for (const building of KINDS) {
            const m = generateInterior(seed, { building });
            const menu = m.entities.find(e => e.kind === 'menu');
            if (building === 'tavern' || building === 'caravanserai') {
                assert.ok(menu?.house?.brew && menu?.house?.dish, `${seed}/${building}: menu with house brew and dish`);
                assert.ok(menu.food?.length && menu.drink?.length, `${seed}/${building}: food and drink lines`);
            } else {
                assert.equal(menu, undefined, `${seed}/${building}: no menu`);
            }
        }
    }
});

test('lore is well-formed and distinct from the hook', () => {
    let fired = 0;
    for (let i = 0; i < 20; i++) {
        const m = generateInterior('l' + i, { building: 'tavern', condition: 'abandoned' });
        const lore = m.entities.find(e => e.kind === 'lore');
        if (!lore) continue;
        fired++;
        assert.ok(['full', 'partial'].includes(lore.completeness), 'completeness never "none" when emitted');
        assert.ok(lore.text?.length > 10, 'lore has text');
        const hook = m.entities.find(e => e.kind === 'room' && e.content?.hook)?.content.hook;
        if (hook) assert.ok(!lore.text.includes(hook), 'lore never contains the hook');
    }
    assert.ok(fired >= 10, `abandoned lore fires often (${fired}/20)`);
});

test('presence layers roll probabilistically across seeds', () => {
    let vis = 0, evs = 0, rus = 0, lores = 0;
    const N = 50;
    for (let i = 0; i < N; i++) {
        const m = generateInterior('p' + i, { building: 'tavern' });
        if (m.entities.some(e => e.kind === 'occupant' && e.tags?.includes('visitor'))) vis++;
        if (m.entities.some(e => e.kind === 'event')) evs++;
        if (m.entities.some(e => e.kind === 'rumor')) rus++;
        if (m.entities.some(e => e.kind === 'lore')) lores++;
    }
    // wide tolerances — asserts "sometimes but not always", not exact rates
    assert.ok(vis > N * 0.7, `visitors ${vis}/${N}`);
    assert.ok(evs > N * 0.3 && evs < N * 0.9, `events ${evs}/${N}`);
    assert.ok(rus > N * 0.45 && rus < N * 0.95, `rumors ${rus}/${N}`);
    assert.ok(lores > N * 0.35 && lores < N * 0.85, `lore ${lores}/${N}`);
});

test('geometry, name and household never move (pinned at v1.10.0, frozen forever)', () => {
    // The layout / names / occupants streams are a compatibility contract:
    // new content layers may only ADD entities on their own streams. These
    // hashes must never be re-pinned.
    const got = {};
    for (const seed of SEEDS) {
        for (const [tag, p] of [
            ['tavern', { building: 'tavern' }],
            ['spec', { building: 'caravanserai', size: 'large', wealth: 'wealthy', condition: 'abandoned' }],
        ]) {
            const m = generateInterior(seed, p);
            const core = {
                name: m.name,
                formerOwner: m.layers.formerOwner ?? null,
                geometry: m.entities
                    .filter(e => ['room', 'door', 'window', 'stair'].includes(e.kind))
                    .map(({ notes, content, ...rest }) => rest),
                household: m.entities.filter(e => e.kind === 'occupant' && e.id.startsWith('oc')),
            };
            got[`${seed}/${tag}`] = hashSeed(JSON.stringify(core))[0];
        }
    }
    assert.deepEqual(got, {
        'i1/tavern': 1019548048,
        'i1/spec': 2238954092,
        'hearth/tavern': 1341333581,
        'hearth/spec': 3604732529,
    });
});

test('model snapshots (update deliberately on generator changes)', () => {
    const got = {};
    for (const seed of SEEDS) {
        for (const [tag, p] of [
            ['tavern', { building: 'tavern' }],
            ['spec', { building: 'caravanserai', size: 'large', wealth: 'wealthy', condition: 'abandoned' }],
        ]) {
            const { layers, ...rest } = generateInterior(seed, p);
            got[`${seed}/${tag}`] = hashSeed(JSON.stringify(rest))[0];
        }
    }
    // pinned against the v1.12.0 pipeline; on a deliberate generator change,
    // print `got` and update these values in the same commit
    assert.deepEqual(got, {
        'i1/tavern': 3295422918,
        'i1/spec': 1879441810,
        'hearth/tavern': 1700801296,
        'hearth/spec': 3591373177,
    });
});
