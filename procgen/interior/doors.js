/* ------------------------------------------------------------------
 *  Interior — door wiring (one floor at a time).
 *
 *  Circulation priority (ported from the old single-floor generator):
 *    1. the spine — corridor, or the courtyard-hub — is wired first;
 *    2. rooms opening onto the hub come next;
 *    3. any leftover room attaches to its already-connected neighbour
 *       with the longest shared wall.
 *  This keeps you from walking through the kitchen to reach a bedroom,
 *  and gives a stable connection order that the purpose pass reuses.
 *
 *  A room is `hub` (role) on the ground floor and on cellar/upper
 *  landings; `corridor` is the hallway; both are pure geometry markers
 *  set by layout.js / floors.js. Door/edge `a` is always the parent
 *  (nearer the hub), `b` the newly connected room — content locks key
 *  off that direction.
 * ------------------------------------------------------------------ */
import { compass } from '../schema.js';

/** Shared-wall midpoint between two rectangles, or null. */
export function sharedWall(A, B) {
    if (A.x + A.w === B.x || B.x + B.w === A.x) {
        const x = (A.x + A.w === B.x) ? B.x : A.x;
        const y0 = Math.max(A.y, B.y), y1 = Math.min(A.y + A.h, B.y + B.h);
        if (y1 - y0 >= 1) return { orient: 'v', x, y: Math.floor((y0 + y1) / 2), len: y1 - y0 };
    }
    if (A.y + A.h === B.y || B.y + B.h === A.y) {
        const y = (A.y + A.h === B.y) ? B.y : A.y;
        const x0 = Math.max(A.x, B.x), x1 = Math.min(A.x + A.w, B.x + B.w);
        if (x1 - x0 >= 1) return { orient: 'h', y, x: Math.floor((x0 + x1) / 2), len: x1 - x0 };
    }
    return null;
}

/**
 * Deterministic connection order for a floor's rooms (pure geometry —
 * no RNG). Both the purpose pass and the door pass consume it so the
 * door graph tracks purpose depth.
 * @returns {{order: Array, parent: Map, hub: object, corridor: object|null}}
 */
export function computeOrder(rooms) {
    const hub = rooms.find(r => r.role === 'hub') || rooms[0];
    const corridor = rooms.find(r => r.role === 'corridor') || null;
    const connected = new Set([hub]);
    const order = [hub];
    const parent = new Map([[hub, null]]);
    const conn = (a, b) => {
        if (!sharedWall(a, b)) return false;
        connected.add(b); order.push(b); parent.set(b, a);
        return true;
    };

    if (corridor) conn(hub, corridor);
    if (corridor) for (const r of rooms) if (!connected.has(r) && sharedWall(r, corridor)) conn(corridor, r);
    for (const r of rooms) if (!connected.has(r) && sharedWall(r, hub)) conn(hub, r);

    let progress = true;
    while (progress && connected.size < rooms.length) {
        progress = false;
        for (const r of rooms) {
            if (connected.has(r)) continue;
            let best = null, bestLen = 0;
            for (const o of rooms) {
                if (!connected.has(o) || o === r) continue;
                const w = sharedWall(r, o);
                if (w && w.len > bestLen) { bestLen = w.len; best = o; }
            }
            if (best) { conn(best, r); progress = true; }
        }
    }
    return { order, parent, hub, corridor };
}

/**
 * Wire one floor. Rooms must already carry global `id`s.
 * @returns {{doors: Array, edges: Array}}  door[i] ↔ edge[i] (1:1).
 *   Ground floors also get the single street entrance door on the hub
 *   (or, for a courtyard, the gate passage) bottom wall at y = H.
 */
export function wireFloor(floor, isGround) {
    const { order, parent, hub } = computeOrder(floor.rooms);
    const doors = [], edges = [];
    const cx = r => r.x + r.w / 2, cy = r => r.y + r.h / 2;

    for (const r of order) {
        const p = parent.get(r);
        if (!p) continue;
        const w = sharedWall(p, r);
        if (!w) continue;
        doors.push({ level: floor.level, x: w.x, y: w.y, orient: w.orient, a: p.id, b: r.id });
        edges.push({ a: p.id, b: r.id, kind: 'door', dir: compass(cx(p), cy(p), cx(r), cy(r)) });
    }

    if (isGround) {
        const gate = floor.rooms.find(r => r.role === 'gate') || hub;
        const ex = gate.x + Math.floor(gate.w / 2);
        doors.push({ level: floor.level, x: Math.max(gate.x, Math.min(gate.x + gate.w - 1, ex)), y: floor.h, orient: 'h', a: gate.id, b: 'street' });
        edges.push({ a: gate.id, b: 'street', kind: 'door', dir: 'S' });
        floor.streetRoomId = gate.id;
    }
    return { doors, edges };
}
