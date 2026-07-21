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
    const strip = m => JSON.stringify(m.entities
        .filter(e => e.kind !== 'occupant')
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
    // pinned against the v1.10.0 pipeline; on a deliberate generator change,
    // print `got` and update these values in the same commit
    assert.deepEqual(got, {
        'i1/tavern': 1598827319,
        'i1/spec': 340812048,
        'hearth/tavern': 198019143,
        'hearth/spec': 4290378965,
    });
});
