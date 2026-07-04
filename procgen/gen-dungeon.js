/* ------------------------------------------------------------------
 *  Dungeon generator.
 *
 *  Default: BSP split → one room per leaf → L-corridors up the tree
 *  (+ a few extra loops) → doors where corridors pierce room walls.
 *  Theme 'caves': cellular automata instead, with cavern "rooms"
 *  detected as sampled open pockets.
 *
 *  Tile codes: '#' wall  '.' floor  '+' door  '<' entrance  '>' exit
 *              '~' water (sewer channels / flooded basins)
 * ------------------------------------------------------------------ */
import { Rng } from './rng.js';
import { makeEnvelope, compass, rleEncode } from './schema.js';
import { nameFor, DUNGEON_ROOMS, featureFor } from './names.js';

const SIZES = { s: [40, 28], m: [60, 40], l: [80, 56] };

/* Themes shape the LAYOUT, not just the room names:
 *   crypt      — many small chambers, few loops
 *   ruins      — mid-sized rooms, collapsed (eroded) walls, rubble pillars
 *   stronghold — large regular halls, well-connected (extra loops)
 *   sewer      — long low galleries, flooded basins, extra loops
 *   caves      — cellular automata (handled separately)                */
const THEME_TUNING = {
    crypt: { roomW: [4, 8], roomH: [3, 5], loopBonus: 0, erode: 0, pools: 0 },
    ruins: { roomW: [4, 11], roomH: [3, 7], loopBonus: 1, erode: 0.2, pools: 0 },
    stronghold: { roomW: [6, 14], roomH: [4, 9], loopBonus: 2, erode: 0, pools: 0 },
    sewer: { roomW: [5, 14], roomH: [3, 4], loopBonus: 2, erode: 0, pools: 0.55 },
};

function titleCase(s) {
    return s.replace(/(^|[\s-])\w/g, c => c.toUpperCase());
}

export function generateDungeon(seed, params = {}) {
    const p = { size: 'm', theme: 'crypt', density: 0.5, secrets: true, ...params };
    const [W, H] = SIZES[p.size] || SIZES.m;
    const model = makeEnvelope('dungeon', seed, p);
    model.size = { w: W, h: H, unit: 'tile' };

    // Layout stream folds in every layout-affecting param (including the
    // theme — each theme carves a genuinely different map), so cosmetic
    // changes (name regen etc.) never move the rooms.
    const layoutRng = new Rng(`${seed}/layout:${p.size}:${p.theme}:${p.density}`);
    const grid = Array.from({ length: H }, () => Array(W).fill('#'));

    const built = (p.theme === 'caves')
        ? carveCaves(grid, W, H, layoutRng)
        : carveBsp(grid, W, H, layoutRng, p);
    const { rooms, edges, doors } = built;

    // Degenerate safety net: guarantee at least one room.
    if (!rooms.length) {
        const r = { i: 0, x: (W >> 1) - 4, y: (H >> 1) - 3, w: 8, h: 6, cx: W >> 1, cy: H >> 1 };
        for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) grid[y][x] = '.';
        rooms.push(r);
    }

    /* ---- entrance & exit: the farthest-apart room pair (graph BFS) ---- */
    const adj = rooms.map(() => []);
    for (const e of edges) { adj[e.a].push(e.b); adj[e.b].push(e.a); }
    const bfs = (start) => {
        const dist = Array(rooms.length).fill(-1);
        dist[start] = 0;
        const q = [start];
        for (let qi = 0; qi < q.length; qi++) {
            for (const v of adj[q[qi]]) if (dist[v] < 0) { dist[v] = dist[q[qi]] + 1; q.push(v); }
        }
        return dist;
    };
    const far = (dist, from) => {
        let best = from;
        for (let i = 0; i < rooms.length; i++) if (dist[i] > dist[best]) best = i;
        return best;
    };
    const u = far(bfs(0), 0);
    const v = far(bfs(u), u);
    const borderDist = r => Math.min(r.cx, r.cy, W - 1 - r.cx, H - 1 - r.cy);
    const entranceI = borderDist(rooms[u]) <= borderDist(rooms[v]) ? u : v;
    const exitI = entranceI === u ? v : u;

    grid[rooms[entranceI].cy][rooms[entranceI].cx] = '<';
    if (exitI !== entranceI) grid[rooms[exitI].cy][rooms[exitI].cx] = '>';

    /* ---- theme flavor passes (never touch doors/marks) ---- */
    const tuning = THEME_TUNING[p.theme];
    const flavorRng = layoutRng.sub('flavor');
    if (tuning?.erode) {
        // ruins: crumble walls that already border open floor
        const isOpen = c => c === '.' || c === '+' || c === '<' || c === '>';
        const snapshot = grid.map(row => [...row]);
        for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
            if (snapshot[y][x] !== '#') continue;
            let open = 0;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                if (isOpen(snapshot[y + dy][x + dx])) open++;
            }
            if (open >= 2 && flavorRng.chance(tuning.erode)) grid[y][x] = '.';
        }
        // rubble pillars inside the larger rooms
        for (const r of rooms) {
            if (r.w < 6 || r.h < 5 || !flavorRng.chance(0.5)) continue;
            const n = flavorRng.int(1, 2);
            for (let k = 0; k < n; k++) {
                const px = flavorRng.int(r.x + 1, r.x + r.w - 2);
                const py = flavorRng.int(r.y + 1, r.y + r.h - 2);
                if (grid[py][px] === '.') grid[py][px] = '#';
            }
        }
    }
    if (tuning?.pools) {
        // sewer: flooded basins filling room interiors, 1-tile walkway around
        for (const r of rooms) {
            if (r.i === entranceI || r.i === exitI) continue;
            if (r.w < 5 || r.h < 3 || !flavorRng.chance(tuning.pools)) continue;
            for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
                for (let x = r.x + 1; x < r.x + r.w - 1; x++) {
                    if (grid[y][x] === '.') grid[y][x] = '~';
                }
            }
            r.flooded = true;
        }
    }

    /* ---- secret room: one dead end becomes a hidden vault ---- */
    const deg = adj.map(a => a.length);
    const deco = new Rng(`${seed}/deco:${p.theme}`);
    let secretI = -1;
    if (p.secrets) {
        const candidates = rooms.filter(r => deg[r.i] === 1 && r.i !== entranceI && r.i !== exitI);
        if (candidates.length) {
            secretI = deco.pick(candidates).i;
            const e = edges.find(e => e.a === secretI || e.b === secretI);
            if (e) e.kind = 'secret';
        }
    }

    /* ---- purposes & features (deterministic order: room index) ---- */
    const commonPool = deco.shuffle(DUNGEON_ROOMS.common[p.theme] || DUNGEON_ROOMS.common.crypt);
    const deadPool = deco.shuffle(DUNGEON_ROOMS.deadEnd.filter(x => x !== 'hidden vault'));
    const hubPool = deco.shuffle(DUNGEON_ROOMS.hub);
    let di = 0, hi = 0, ci = 0;
    for (const r of rooms) {
        if (r.i === entranceI) r.purpose = DUNGEON_ROOMS.entrance;
        else if (r.i === secretI) r.purpose = 'hidden vault';
        else if (deg[r.i] <= 1) r.purpose = deadPool[di++ % deadPool.length];
        else if (deg[r.i] >= 3) r.purpose = hubPool[hi++ % hubPool.length];
        else r.purpose = commonPool[ci++ % commonPool.length];

        const feats = new Set();
        const n = deco.int(1, 2);
        for (let k = 0; k < n; k++) feats.add(featureFor(deco, r.purpose));
        r.notes = [...feats].join('; ');
        if (r.flooded) r.notes += (r.notes ? '; ' : '') + 'flooded with murky waist-deep water';
    }
    if (exitI !== entranceI) {
        rooms[exitI].notes += (rooms[exitI].notes ? '; ' : '') + 'a stair leads down into darkness';
    }

    /* ---- assemble the model ---- */
    const nameRng = new Rng(`${seed}/names`);
    model.name = nameFor(nameRng, 'dungeon');

    for (const r of rooms) {
        const tags = [];
        if (r.i === entranceI) tags.push('entrance');
        if (r.i === exitI && exitI !== entranceI) tags.push('exit');
        if (r.i === secretI) tags.push('secret');
        model.entities.push({
            id: 'r' + (r.i + 1), kind: 'room',
            name: titleCase(r.purpose), purpose: r.purpose,
            x: r.x, y: r.y, w: r.w, h: r.h,
            tags, notes: r.notes,
        });
    }
    doors.forEach(([x, y], i) => model.entities.push({ id: 'd' + (i + 1), kind: 'door', x, y }));
    model.edges = edges.map(e => ({
        a: 'r' + (e.a + 1), b: 'r' + (e.b + 1), kind: e.kind,
        dir: compass(rooms[e.a].cx, rooms[e.a].cy, rooms[e.b].cx, rooms[e.b].cy),
    }));
    model.layers.grid = rleEncode(grid.map(row => row.join('')));
    return model;
}

/* ------------------------------------------------------------------
 *  BSP rooms + corridors
 * ------------------------------------------------------------------ */
function carveBsp(grid, W, H, rng, p) {
    const MIN = 9;
    const rooms = [];
    const doors = [];
    const edges = [];

    function split(x, y, w, h, depth) {
        const canV = w >= MIN * 2, canH = h >= MIN * 2;
        const stopEarly = depth >= 3 && rng.chance(0.3 - p.density * 0.2);
        if (depth >= 5 || (!canV && !canH) || stopEarly) return { x, y, w, h, room: null };
        let vertical;
        if (canV && !canH) vertical = true;
        else if (!canV && canH) vertical = false;
        else if (w / h > 1.25) vertical = true;
        else if (h / w > 1.25) vertical = false;
        else vertical = rng.chance(0.5);
        if (vertical) {
            const cut = Math.max(MIN, Math.min(w - MIN, Math.round(w * rng.float(0.38, 0.62))));
            return { a: split(x, y, cut, h, depth + 1), b: split(x + cut, y, w - cut, h, depth + 1) };
        }
        const cut = Math.max(MIN, Math.min(h - MIN, Math.round(h * rng.float(0.38, 0.62))));
        return { a: split(x, y, w, cut, depth + 1), b: split(x, y + cut, w, h - cut, depth + 1) };
    }
    const tree = split(1, 1, W - 2, H - 2, 0);

    const leaves = [];
    (function collect(n) { if (n.a) { collect(n.a); collect(n.b); } else leaves.push(n); })(tree);

    const tune = THEME_TUNING[p.theme] || THEME_TUNING.crypt;
    for (const leaf of leaves) {
        // Low density leaves some leaves empty (but keep a playable minimum).
        if (rooms.length >= 6 && rng.chance(0.3 - p.density * 0.25)) continue;
        const rw = rng.int(Math.min(tune.roomW[0], leaf.w - 2), Math.max(4, Math.min(leaf.w - 2, tune.roomW[1])));
        const rh = rng.int(Math.min(tune.roomH[0], leaf.h - 2), Math.max(3, Math.min(leaf.h - 2, tune.roomH[1])));
        const rx = leaf.x + rng.int(1, Math.max(1, leaf.w - rw - 1));
        const ry = leaf.y + rng.int(1, Math.max(1, leaf.h - rh - 1));
        const room = { i: rooms.length, x: rx, y: ry, w: rw, h: rh, cx: rx + (rw >> 1), cy: ry + (rh >> 1) };
        leaf.room = room;
        rooms.push(room);
        for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) grid[y][x] = '.';
    }

    const inRoom = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
    const isWall = (x, y) => grid[y]?.[x] === undefined || grid[y][x] === '#';

    function carveCorridor(A, B) {
        const ptIn = r => [rng.int(r.x + 1, r.x + r.w - 2), rng.int(r.y + 1, r.y + r.h - 2)];
        const [x1, y1] = ptIn(A), [x2, y2] = ptIn(B);
        const path = [];
        let x = x1, y = y1;
        const stepX = () => { while (x !== x2) { x += Math.sign(x2 - x); path.push([x, y]); } };
        const stepY = () => { while (y !== y2) { y += Math.sign(y2 - y); path.push([x, y]); } };
        if (rng.chance(0.5)) { stepX(); stepY(); } else { stepY(); stepX(); }

        // Door candidates: the first cell after leaving A, the last before entering B.
        let doorA = null, doorB = null;
        for (const c of path) if (!inRoom(A, c[0], c[1])) { doorA = c; break; }
        for (let i = path.length - 1; i >= 0; i--) if (!inRoom(B, path[i][0], path[i][1])) { doorB = path[i]; break; }

        for (const [px, py] of path) if (grid[py][px] === '#') grid[py][px] = '.';

        for (const d of [doorA, doorB]) {
            if (!d) continue;
            const [px, py] = d;
            const narrow = (isWall(px - 1, py) && isWall(px + 1, py)) || (isWall(px, py - 1) && isWall(px, py + 1));
            if (grid[py][px] === '.' && narrow) {
                grid[py][px] = '+';
                doors.push([px, py]);
            }
        }
    }

    // Connect sibling subtrees bottom-up through the BSP tree.
    function connect(n) {
        if (!n.a) return n.room;
        const ra = connect(n.a), rb = connect(n.b);
        if (ra && rb) {
            carveCorridor(ra, rb);
            edges.push({ a: ra.i, b: rb.i, kind: 'corridor' });
            return rng.chance(0.5) ? ra : rb;
        }
        return ra || rb;
    }
    connect(tree);

    // Extra loops: make the graph non-tree, more interesting to narrate.
    const loopTries = rng.int(1, 3) + Math.round(p.density * 2) + (tune.loopBonus || 0);
    for (let i = 0; i < loopTries && rooms.length > 3; i++) {
        const A = rng.pick(rooms), B = rng.pick(rooms);
        if (A === B) continue;
        if (edges.some(e => (e.a === A.i && e.b === B.i) || (e.a === B.i && e.b === A.i))) continue;
        if (Math.abs(A.cx - B.cx) + Math.abs(A.cy - B.cy) > 24) continue;
        carveCorridor(A, B);
        edges.push({ a: A.i, b: B.i, kind: 'corridor' });
    }

    return { rooms, edges, doors };
}

/* ------------------------------------------------------------------
 *  Cellular-automata caves
 * ------------------------------------------------------------------ */
function carveCaves(grid, W, H, rng) {
    let open = Array.from({ length: H }, () => Array(W).fill(false));
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) open[y][x] = !rng.chance(0.45);

    for (let pass = 0; pass < 5; pass++) {
        const next = open.map(r => [...r]);
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
            let walls = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                if ((dx || dy) && !open[y + dy][x + dx]) walls++;
            }
            next[y][x] = walls < 5;
        }
        open = next;
    }

    // Keep only the largest connected open component.
    const comp = Array.from({ length: H }, () => Array(W).fill(-1));
    let bestComp = -1, bestSize = 0, nComp = 0;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        if (!open[y][x] || comp[y][x] >= 0) continue;
        const q = [[x, y]];
        comp[y][x] = nComp;
        let size = 0;
        for (let qi = 0; qi < q.length; qi++) {
            const [px, py] = q[qi];
            size++;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = px + dx, ny = py + dy;
                if (open[ny]?.[nx] && comp[ny][nx] < 0) { comp[ny][nx] = nComp; q.push([nx, ny]); }
            }
        }
        if (size > bestSize) { bestSize = size; bestComp = nComp; }
        nComp++;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) open[y][x] = open[y][x] && comp[y][x] === bestComp;

    // Degenerate map → carve a guaranteed central blob.
    if (bestSize < W * H * 0.12) {
        const cx = W >> 1, cy = H >> 1, rx = W / 3.2, ry = H / 3.2;
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
            if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) open[y][x] = true;
        }
    }

    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (open[y][x]) grid[y][x] = '.';

    // Cavern "rooms": poisson-ish open pockets with measured extents.
    const openCells = [];
    for (let y = 3; y < H - 3; y++) for (let x = 3; x < W - 3; x++) if (open[y][x]) openCells.push([x, y]);
    const centers = [];
    for (const [x, y] of rng.shuffle(openCells)) {
        if (centers.length >= 10) break;
        if (centers.every(c => Math.hypot(c[0] - x, c[1] - y) >= 9)) centers.push([x, y]);
    }
    const extent = (cx, cy, dx, dy) => {
        let d = 0;
        while (d < 7 && open[cy + dy * (d + 1)]?.[cx + dx * (d + 1)]) d++;
        return d;
    };
    const rooms = centers.map(([cx, cy], i) => {
        const l = extent(cx, cy, -1, 0), r = extent(cx, cy, 1, 0);
        const t = extent(cx, cy, 0, -1), b = extent(cx, cy, 0, 1);
        return { i, x: cx - l, y: cy - t, w: l + r + 1, h: t + b + 1, cx, cy };
    });

    // Chain each cavern to its nearest earlier one → connected graph.
    const edges = [];
    for (let i = 1; i < rooms.length; i++) {
        let bj = 0, bd = Infinity;
        for (let j = 0; j < i; j++) {
            const d = Math.hypot(rooms[j].cx - rooms[i].cx, rooms[j].cy - rooms[i].cy);
            if (d < bd) { bd = d; bj = j; }
        }
        edges.push({ a: bj, b: i, kind: 'passage' });
    }
    return { rooms, edges, doors: [] };
}
