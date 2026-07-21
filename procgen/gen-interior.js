/* ------------------------------------------------------------------
 *  Building-interior generator — orchestrator (1 cell = 1 m, DOM-free).
 *
 *  Pipeline: buildFloors (cellar/ground/upper geometry + purposes +
 *  stairs) → wire doors per floor → windows → locks → populate content
 *  → occupants → building name → assemble. Eleven kinds across six
 *  skeleton families (see interior/layout.js).
 *
 *  Stream discipline (rng.js): the LAYOUT stream keys on kind/size/
 *  wealth ONLY — never `condition` — so state never rebuilds geometry.
 *  CONTENT (notes / valuables / occupants) keys on wealth+condition;
 *  the building NAME is drawn last from its own stream.
 *
 *  Caravanserai entrance: the courtyard is the hub but does not reach
 *  the south wall, so a 2-wide GATE passage is sliced into the south
 *  wing, aligned to the courtyard centre. The street door lands on the
 *  gate at y = H and the gate opens straight into the courtyard — a
 *  hole-free, deterministic "gate into the yard" with the courtyard
 *  still tagged the entrance hub. (Chosen over an open-south courtyard
 *  so the literal courtyard footprint and all four wings survive.)
 * ------------------------------------------------------------------ */
import { Rng } from './rng.js';
import { makeEnvelope, rleEncode } from './schema.js';
import { clampKind, outlinePts } from './interior/layout.js';
import { buildFloors } from './interior/floors.js';
import { wireFloor } from './interior/doors.js';
import { word, nameFor, CARAVANSERAI_ADJ } from './names.js';
import { populateInterior } from './content/interior.js';
import { assignOccupants } from './interior/occupants.js';

export function generateInterior(seed, params = {}) {
    const p = { building: 'tavern', size: 'medium', wealth: 'average', condition: 'lived-in', ...params };
    const kind = clampKind(p.building);
    const model = makeEnvelope('interior', seed, { ...p, building: kind });

    const layoutRng = new Rng(`${seed}/layout:${kind}:${p.size}:${p.wealth}`);
    const contentRng = new Rng(`${seed}/content:${kind}:${p.wealth}:${p.condition}`);
    const nameRng = new Rng(`${seed}/names`);

    // ---- floors: geometry + purposes + stairs ----
    const { floors, roomsAll, stairs, stairEdges, W, H } = buildFloors(kind, p, seed, layoutRng);
    const ground = floors.find(f => f.level === 0);

    // ---- doors, per floor ----
    for (const f of floors) {
        const { doors, edges } = wireFloor(f, f.level === 0);
        f._doors = doors; f._edges = edges;
    }
    let dn = 0;
    for (const f of floors) {
        f._doors.forEach((d, i) => { d.id = 'do' + (++dn); f._edges[i].doorId = d.id; });
    }
    const allDoors = floors.flatMap(f => f._doors);
    const allDoorEdges = floors.flatMap(f => f._edges);

    // ---- windows (exterior walls only, per floor) ----
    for (const f of floors) f._windows = buildWindows(f, layoutRng.sub('win' + f.level));
    const allWindows = floors.flatMap(f => f._windows);

    // ---- locks + key rooms ----
    const keyRooms = applyLocks(floors, roomsAll, stairs, allDoors, allDoorEdges, stairEdges, layoutRng.sub('locks'));

    // ---- content (other agent; defensive) ----
    const entranceId = ground.hub.id;
    const stairRoomIds = roomsAll.filter(r => r.tags.includes('stairs')).map(r => r.id);
    try {
        populateInterior(roomsAll, { kind, wealth: p.wealth, condition: p.condition, entranceId, keyRooms, stairRoomIds }, contentRng);
    } catch { /* leave notes/content empty on partial integration */ }
    for (const r of roomsAll) { if (r.content == null) r.content = {}; if (r.notes == null) r.notes = ''; }

    // ---- occupants (other agent; defensive) ----
    // Real occupants.js returns { occupants, formerOwner } and owns its own
    // seed stream — the owner is condition-stable, occupants are lived-in only.
    let occupants = [], formerOwner = null;
    try {
        const res = assignOccupants(roomsAll, { kind, size: p.size, condition: p.condition, seed }) || {};
        occupants = res.occupants || [];
        formerOwner = res.formerOwner || null;
    } catch { occupants = []; }

    // ---- name (drawn last) ----
    model.name = buildingName(kind, nameRng);

    return assemble(model, { W, H, floors, roomsAll, allDoors, allDoorEdges, allWindows, stairs, stairEdges, occupants, formerOwner });
}

/* Windows on exterior walls (cosmetic). Layout stream → independent of
 * condition; interior walls (e.g. a courtyard) get none. */
function buildWindows(floor, rng) {
    const rooms = floor.rooms;
    const inside = (x, y) => rooms.some(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    const wins = [];
    for (const r of rooms) {
        for (let x = r.x + 1; x < r.x + r.w - 1; x += rng.int(3, 4)) {
            if (!inside(x, r.y - 1)) wins.push({ level: floor.level, orient: 'h', x, y: r.y });
            if (!inside(x, r.y + r.h)) wins.push({ level: floor.level, orient: 'h', x, y: r.y + r.h });
        }
        for (let y = r.y + 1; y < r.y + r.h - 1; y += rng.int(3, 4)) {
            if (!inside(r.x - 1, y)) wins.push({ level: floor.level, orient: 'v', x: r.x, y });
            if (!inside(r.x + r.w, y)) wins.push({ level: floor.level, orient: 'v', x: r.x + r.w, y });
        }
    }
    return wins;
}

/* Lock the door guarding a leaf subtree — a ground-floor strongroom, or
 * the entry to the cellar-stair room — and note the key in the hub. The
 * key always sits on the entrance side, so it is never gated by its own
 * lock (asserted). */
function applyLocks(floors, roomsAll, stairs, allDoors, allDoorEdges, stairEdges, lockRng) {
    const hub = floors.find(f => f.level === 0).hub;
    const strongroom = roomsAll.find(r => r.purpose === 'strongroom');
    const hasCellar = floors.some(f => f.level < 0);

    let door = null;
    if (strongroom) {
        door = allDoors.find(d => d.b === strongroom.id);
    } else if (hasCellar) {
        const downStair = stairs.find(s => s.level === 0 && s.to < 0);
        if (downStair && downStair.room !== hub.id) door = allDoors.find(d => d.level === 0 && d.b === downStair.room);
    }
    if (!door || !lockRng.chance(0.6)) return [];

    door.locked = true;
    const edge = allDoorEdges.find(e => e.doorId === door.id);
    if (edge) edge.locked = true;
    const keyRooms = [{ roomId: hub.id, doorId: door.id }];

    // no-softlock: entrance still reaches the key room with the lock shut
    const reach = reachable(hub.id, [...allDoorEdges, ...stairEdges], edge);
    if (!reach.has(hub.id)) throw new Error('interior lock softlock: key room unreachable');
    return keyRooms;
}

function reachable(startId, edges, skipEdge) {
    const adj = new Map();
    const link = (a, b) => { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); };
    for (const e of edges) {
        if (e === skipEdge || e.a === 'street' || e.b === 'street') continue;
        link(e.a, e.b); link(e.b, e.a);
    }
    const seen = new Set([startId]); const q = [startId];
    for (let i = 0; i < q.length; i++) for (const o of (adj.get(q[i]) || [])) if (!seen.has(o)) { seen.add(o); q.push(o); }
    return seen;
}

function buildingName(kind, rng) {
    switch (kind) {
        case 'tavern': return nameFor(rng, 'tavern');
        case 'temple': return `Temple of the ${rng.pick(['Dawn', 'Deep', 'Silent Flame', 'Veiled Moon', 'Iron Oath'])}`;
        case 'keep': return `${word(rng)} Keep`;
        case 'manor': return `${nameFor(rng, 'person')} Manor`;
        case 'house': return `${nameFor(rng, 'person')}'s house`;
        case 'shop': return `${nameFor(rng, 'person')}'s shop`;
        case 'smithy': return `${nameFor(rng, 'person')}'s Forge`;
        case 'barracks': return `${word(rng)} Barracks`;
        case 'warehouse': return `${word(rng)} Warehouse`;
        case 'caravanserai': return `The ${rng.pick(CARAVANSERAI_ADJ)} Caravanserai`;
        case 'mill': return `${word(rng)} Mill`;
        default: return `${word(rng)} House`;
    }
}

/* Grid letters use the per-floor LOCAL index (a.. then A..) so each
 * floor is self-contained and no letter aliases across 26+ rooms. RLE
 * needs non-digit cells → letters + '#' only. */
function letterFor(i) { return i < 26 ? String.fromCharCode(97 + i) : String.fromCharCode(65 + (i - 26)); }

function floorGrid(floor) {
    const rows = Array.from({ length: floor.h }, () => Array(floor.w).fill('#'));
    for (const r of floor.rooms) {
        const ch = letterFor(r.li);
        for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) rows[y][x] = ch;
    }
    return rleEncode(rows.map(row => row.join('')));
}

function assemble(model, ctx) {
    const { W, H, floors, roomsAll, allDoors, allDoorEdges, allWindows, stairs, stairEdges, occupants, formerOwner } = ctx;
    model.size = { w: W, h: H, unit: 'm' };

    // entities: rooms → doors → windows → stairs → occupants
    for (const r of roomsAll) {
        const e = {
            id: r.id, kind: 'room', level: r.level, name: r.name, purpose: r.purpose,
            x: r.x, y: r.y, w: r.w, h: r.h, tags: r.tags, notes: r.notes, content: r.content,
        };
        if (r.open) e.open = true;
        model.entities.push(e);
    }
    for (const d of allDoors) {
        const e = { id: d.id, kind: 'door', level: d.level, x: d.x, y: d.y, tags: [d.orient], notes: '' };
        if (d.locked) e.locked = true;
        model.entities.push(e);
    }
    allWindows.forEach((w, i) => model.entities.push({ id: 'wi' + (i + 1), kind: 'window', level: w.level, x: w.x, y: w.y, tags: [w.orient] }));
    for (const s of stairs) model.entities.push({ id: s.id, kind: 'stair', level: s.level, to: s.to, x: s.x, y: s.y, room: s.room });
    for (const o of occupants) model.entities.push(o);

    // edges: door (+locked) + street + stairs
    model.edges = [];
    for (const e of allDoorEdges) {
        const edge = { a: e.a, b: e.b, kind: 'door', dir: e.dir };
        if (e.locked) edge.locked = true;
        model.edges.push(edge);
    }
    for (const e of stairEdges) model.edges.push({ a: e.a, b: e.b, kind: 'stair', dir: e.dir });

    // layers
    model.layers.floors = floors.map(f => {
        const layer = { level: f.level, label: f.label, grid: floorGrid(f), outline: outlinePts(f.w, f.h, f.level === 0 ? f.cut : null), w: f.w, h: f.h };
        if (f.level === 0 && f.cut) layer.cut = f.cut;
        return layer;
    });
    model.layers.cellGrid = true;
    model.layers.doors = allDoors.map(d => {
        const o = { id: d.id, level: d.level, x: d.x, y: d.y, orient: d.orient };
        if (d.locked) o.locked = true;
        return o;
    });
    if (formerOwner) model.layers.formerOwner = formerOwner;
    return model;
}
