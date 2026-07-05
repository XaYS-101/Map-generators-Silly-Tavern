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
import { nameFor, DUNGEON_ROOMS } from './names.js';
import { populateDungeon } from './content/dungeon.js';

const SIZES = { s: [40, 28], m: [60, 40], l: [80, 56], den: [34, 24], huge: [100, 68] };

/* Tags that reshape the map itself (vs content-only tags). They fold
 * into the layout stream key; maps without them keep their old layout. */
const LAYOUT_TAGS = ['den', 'huge', 'small', 'large', 'loops', 'linear'];

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

/* ------------------------------------------------------------------
 *  Room shapes. Decided on a dedicated layout sub-stream AFTER all
 *  room rects are placed, so the BSP/corridor randomness of a given
 *  seed is untouched — shapes only re-sculpt rooms inside their rects.
 *  Membership is analytic (roomHas), no grid reads, so carving,
 *  corridor endpoints and door detection all agree.
 * ------------------------------------------------------------------ */
/* Weights are tuned against THEME_TUNING's room size ranges (e.g. crypt
 * rooms are ≤5 tall → no cross; sewer galleries are ≤4 tall → octagon
 * there means a bevel-ended gallery, not a rotunda). Ineligible picks
 * degrade to rounded/rect. */
const SHAPE_WEIGHTS = {
    crypt: [['rect', 35], ['octagon', 20], ['round', 15], ['rounded', 20], ['columned', 10]],
    ruins: [['rect', 35], ['rounded', 25], ['round', 10], ['octagon', 10], ['cross', 10], ['columned', 10]],
    stronghold: [['rect', 40], ['columned', 25], ['octagon', 10], ['round', 10], ['cross', 15]],
    sewer: [['rect', 60], ['octagon', 20], ['rounded', 20]],
};
const SHAPE_MIN = { round: [5, 5], octagon: [5, 4], cross: [7, 6], columned: [8, 5], rounded: [4, 4] };

function shapeEligible(shape, r) {
    const min = SHAPE_MIN[shape];
    if (!min) return true;                                    // rect
    if (r.w < min[0] || r.h < min[1]) return false;
    // a very elongated room squashed into a small rotunda loses too much area
    if (shape === 'round' && Math.max(r.w, r.h) > Math.min(r.w, r.h) * 1.6) return false;
    return true;
}

/** Pillar lattice for columned halls: every 3rd cell, centered, ≥2 cells
 *  of clearance from every wall; the room's center cell is never a pillar
 *  (entrance/exit glyphs and labels live there). */
function isPillar(r, x, y) {
    if (r.shape !== 'columned') return false;
    const lx = x - r.x, ly = y - r.y;
    if (lx < 2 || ly < 2 || lx > r.w - 3 || ly > r.h - 3) return false;
    if ((lx - r.pil.ox) % 3 || (ly - r.pil.oy) % 3) return false;
    if ((lx - r.pil.ox) < 0 || (ly - r.pil.oy) < 0) return false;
    return !(x === r.cx && y === r.cy);
}

/** Analytic membership test: is cell (x,y) part of room r's floor? */
function roomHas(r, x, y) {
    if (x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h) return false;
    const dx = x - r.x, dy = y - r.y;
    switch (r.shape) {
        case 'round': {
            const c = (r.w - 1) / 2;                          // bbox is d×d
            return (dx - c) ** 2 + (dy - c) ** 2 <= (r.w / 2) ** 2;
        }
        case 'octagon':
        case 'rounded': {
            const c = r.cut;
            return dx + dy >= c && (r.w - 1 - dx) + dy >= c
                && dx + (r.h - 1 - dy) >= c && (r.w - 1 - dx) + (r.h - 1 - dy) >= c;
        }
        case 'cross':
            return (dx >= r.vx0 && dx < r.vx0 + r.barW)
                || (dy >= r.hy0 && dy < r.hy0 + r.barH);
        case 'columned':
            return !isPillar(r, x, y);
        default:
            return true;
    }
}

/** Safe all-floor sub-rect [x0, x1, y0, y1] for corridor endpoint picks. */
function innerRect(r) {
    switch (r.shape) {
        case 'round': {
            const inset = Math.max(1, Math.ceil((r.w / 2) * 0.3));
            return [r.x + inset, r.x + r.w - 1 - inset, r.y + inset, r.y + r.h - 1 - inset];
        }
        case 'octagon':
        case 'rounded': {
            const inset = Math.max(1, Math.ceil(r.cut / 2));
            return [r.x + inset, r.x + r.w - 1 - inset, r.y + inset, r.y + r.h - 1 - inset];
        }
        case 'cross':
            return [r.x + r.vx0, r.x + r.vx0 + r.barW - 1, r.y + r.hy0, r.y + r.hy0 + r.barH - 1];
        default:                                              // rect / columned:
            return [r.x + 1, r.x + r.w - 2, r.y + 1, r.y + r.h - 2];
    }
}

/** Straight 1–2 cell wall gaps between two rooms' facing walls → direct
 *  door sites. Uses roomHas, so shaped rims work (a rotunda's closest-
 *  approach rows qualify); every gap cell must still be solid wall. */
function directGap(A, B, grid) {
    const out = [];
    for (const [P, Q] of [[A, B], [B, A]]) {
        if (P.x + P.w <= Q.x) {                       // P left of Q
            const y0 = Math.max(P.y, Q.y), y1 = Math.min(P.y + P.h, Q.y + Q.h);
            for (let y = y0; y < y1; y++) {
                let px = -1, qx = -1;
                for (let x = P.x + P.w - 1; x >= P.x; x--) if (roomHas(P, x, y)) { px = x; break; }
                for (let x = Q.x; x < Q.x + Q.w; x++) if (roomHas(Q, x, y)) { qx = x; break; }
                if (px < 0 || qx < 0) continue;
                const gap = qx - px - 1;
                if (gap < 1 || gap > 2) continue;
                const cells = [];
                for (let x = px + 1; x < qx; x++) {
                    if (grid[y][x] !== '#') { cells.length = 0; break; }
                    cells.push([x, y]);
                }
                if (cells.length) out.push(cells);
            }
        }
        if (P.y + P.h <= Q.y) {                       // P above Q
            const x0 = Math.max(P.x, Q.x), x1 = Math.min(P.x + P.w, Q.x + Q.w);
            for (let x = x0; x < x1; x++) {
                let py = -1, qy = -1;
                for (let y = P.y + P.h - 1; y >= P.y; y--) if (roomHas(P, x, y)) { py = y; break; }
                for (let y = Q.y; y < Q.y + Q.h; y++) if (roomHas(Q, x, y)) { qy = y; break; }
                if (py < 0 || qy < 0) continue;
                const gap = qy - py - 1;
                if (gap < 1 || gap > 2) continue;
                const cells = [];
                for (let y = py + 1; y < qy; y++) {
                    if (grid[y][x] !== '#') { cells.length = 0; break; }
                    cells.push([x, y]);
                }
                if (cells.length) out.push(cells);
            }
        }
    }
    return out;
}

/** Roll a theme-weighted shape for room r and re-carve it into the grid. */
function assignShape(r, rng, theme, grid) {
    r.shape = 'rect';
    const table = SHAPE_WEIGHTS[theme];
    if (!table) return;
    let pick = rng.weighted(table);
    if (!shapeEligible(pick, r)) pick = shapeEligible('rounded', r) ? 'rounded' : 'rect';
    if (pick === 'rect') return;
    r.shape = pick;

    const ox = r.x, oy = r.y, ow = r.w, oh = r.h;             // original rect
    if (pick === 'round') {
        const d = Math.min(r.w, r.h);
        r.x += (r.w - d) >> 1;
        r.y += (r.h - d) >> 1;
        r.w = d; r.h = d;
        r.cx = r.x + (d >> 1);
        r.cy = r.y + (d >> 1);
    } else if (pick === 'octagon') {
        r.cut = Math.ceil(Math.min(r.w, r.h) / 3);
    } else if (pick === 'rounded') {
        r.cut = Math.min(r.w, r.h) >= 8 ? rng.int(1, 2) : 1;
    } else if (pick === 'cross') {
        r.barW = Math.max(3, (r.w / 3) | 0);
        r.barH = Math.max(3, (r.h / 3) | 0);
        r.vx0 = (r.w - r.barW) >> 1;
        r.hy0 = (r.h - r.barH) >> 1;
    } else if (pick === 'columned') {
        r.pil = { ox: 2 + (((r.w - 5) % 3) >> 1), oy: 2 + (((r.h - 5) % 3) >> 1) };
    }

    for (let y = oy; y < oy + oh; y++) for (let x = ox; x < ox + ow; x++) grid[y][x] = '#';
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
        if (roomHas(r, x, y)) grid[y][x] = '.';
    }
}

export function generateDungeon(seed, params = {}) {
    const p = { size: 'm', theme: 'crypt', density: 0.5, secrets: true, danger: 'medium', tags: '', ...params };
    const tagSet = new Set(String(p.tags || '').toLowerCase().split(/[,\s]+/).map(s => s.trim()).filter(Boolean));

    // Size tag overrides (OPD vocabulary); den wins — a den is small by definition.
    let sizeKey = p.size;
    if (tagSet.has('small')) sizeKey = 's';
    if (tagSet.has('large')) sizeKey = 'l';
    if (tagSet.has('huge')) sizeKey = 'huge';
    if (tagSet.has('den')) sizeKey = 'den';
    const [W, H] = SIZES[sizeKey] || SIZES.m;
    const model = makeEnvelope('dungeon', seed, p);
    model.size = { w: W, h: H, unit: 'tile' };

    // Layout stream folds in every layout-affecting param (including the
    // theme — each theme carves a genuinely different map), so cosmetic
    // changes (name regen etc.) never move the rooms. Layout tags join the
    // key only when present, so tag-less maps keep their old layout.
    const layoutTags = LAYOUT_TAGS.filter(t => tagSet.has(t));
    const layoutRng = new Rng(`${seed}/layout:${p.size}:${p.theme}:${p.density}`
        + (layoutTags.length ? ':' + layoutTags.join(',') : ''));
    const grid = Array.from({ length: H }, () => Array(W).fill('#'));

    const built = (p.theme === 'caves')
        ? carveCaves(grid, W, H, layoutRng)
        : carveBsp(grid, W, H, layoutRng, p, tagSet);
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
            // never crumble a door frame — doors must keep walls on both sides
            if (snapshot[y][x - 1] === '+' || snapshot[y][x + 1] === '+'
                || snapshot[y - 1][x] === '+' || snapshot[y + 1][x] === '+') continue;
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
                // keep the center clear — glyphs and map labels live there
                if (px === r.cx && py === r.cy) continue;
                if (grid[py][px] === '.') grid[py][px] = '#';
            }
        }
    }
    if (tuning?.pools) {
        // sewer: flooded basins. Flood floor cells with no wall in the
        // 4-neighborhood → a 1-tile dry walkway survives along any wall
        // shape (rect rooms flood exactly like before).
        for (const r of rooms) {
            if (r.i === entranceI || r.i === exitI) continue;
            if (r.w < 5 || r.h < 3 || !flavorRng.chance(tuning.pools)) continue;
            const wet = [];
            for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
                if (grid[y][x] !== '.') continue;
                if (grid[y - 1]?.[x] === '#' || grid[y + 1]?.[x] === '#'
                    || grid[y][x - 1] === '#' || grid[y][x + 1] === '#') continue;
                wet.push([x, y]);
            }
            if (!wet.length) continue;
            for (const [x, y] of wet) grid[y][x] = '~';
            r.flooded = true;
        }
    }

    /* ---- explicit connectivity guarantee: every room center must be
     *      reachable from the entrance on foot; carve a rescue path if a
     *      future pass ever breaks that (deterministic, no RNG). ---- */
    {
        const walk = c => c === '.' || c === '+' || c === '<' || c === '>' || c === '~';
        const seen = Array.from({ length: H }, () => new Uint8Array(W));
        const ex = rooms[entranceI].cx, ey = rooms[entranceI].cy;
        const q = [[ex, ey]];
        seen[ey][ex] = 1;
        for (let qi = 0; qi < q.length; qi++) {
            const [x, y] = q[qi];
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = x + dx, ny = y + dy;
                if (seen[ny]?.[nx] === 0 && walk(grid[ny][nx])) { seen[ny][nx] = 1; q.push([nx, ny]); }
            }
        }
        for (const r of rooms) {
            if (seen[r.cy][r.cx]) continue;
            let x = r.cx, y = r.cy;
            while (x !== ex) { x += Math.sign(ex - x); if (grid[y][x] === '#') grid[y][x] = '.'; }
            while (y !== ey) { y += Math.sign(ey - y); if (grid[y][x] === '#') grid[y][x] = '.'; }
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

    /* ---- locked door/gate + key: lock a bridge edge so the depths need
     *      a key. Layout-side stream → stable under danger/content tags.
     *      The key always lands on the entrance side (no softlock). ---- */
    const lockRng = layoutRng.sub('locks');
    let lock = null;
    if (rooms.length >= 6 && lockRng.chance(0.8)) {
        const reachWithout = (skip) => {
            const seen = new Set([entranceI]);
            const q = [entranceI];
            for (let qi = 0; qi < q.length; qi++) {
                for (const e of edges) {
                    if (e === skip) continue;
                    const o = e.a === q[qi] ? e.b : e.b === q[qi] ? e.a : null;
                    if (o !== null && !seen.has(o)) { seen.add(o); q.push(o); }
                }
            }
            return seen;
        };
        const bridges = edges
            .filter(e => e.kind !== 'secret')
            .map(e => ({ e, near: reachWithout(e) }))
            .filter(c => c.near.size < rooms.length && c.near.size > 1);
        if (bridges.length) {
            const guarding = bridges.filter(c => !c.near.has(exitI));
            const chosen = lockRng.pick(guarding.length ? guarding : bridges);
            chosen.e.locked = true;
            if (chosen.e.kind === 'corridor') chosen.e.kind = 'gate';
            // near side only (no softlock); never the hidden vault — a key
            // behind a secret door would gate the lock on finding the vault
            const nearRooms = rooms.filter(r => chosen.near.has(r.i) && r.i !== entranceI && r.i !== secretI);
            const keyRoom = nearRooms.length ? lockRng.pick(nearRooms) : rooms[entranceI];
            lock = {
                a: chosen.e.a, b: chosen.e.b, keyRoomI: keyRoom.i,
                kindWord: chosen.e.kind === 'gate' ? 'gate' : 'door',
            };
        }
    }

    /* ---- purposes (deterministic order: room index) ---- */
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
    }

    /* ---- content pass: encounters, loot, traps, hazards, dressing,
     *      hooks. Its own stream folds in the content-affecting params
     *      (danger, tags) so content reshuffles independently of layout. ---- */
    const contentRng = new Rng(`${seed}/content:${p.theme}:${p.danger}:${[...tagSet].sort().join(',')}`);
    populateDungeon(rooms, {
        theme: p.theme, danger: p.danger, tags: tagSet,
        entranceI, exitI, secretI, degree: deg, lock,
    }, contentRng);

    // Flatten each room's atmosphere (dressing + hazard + flags) into the
    // legacy `notes` string; the richer typed content lives in `content`.
    for (const r of rooms) {
        const parts = [...(r.content?.dressing || [])];
        if (r.content?.hazard) parts.push(r.content.hazard);
        if (r.flooded) parts.push('flooded with murky, waist-deep water');
        if (r.i === exitI && exitI !== entranceI) parts.push('a stair leads down into darkness');
        r.notes = parts.join('; ');
    }

    /* ---- assemble the model ---- */
    const nameRng = new Rng(`${seed}/names`);
    model.name = nameFor(nameRng, 'dungeon');

    for (const r of rooms) {
        const tags = [];
        if (r.i === entranceI) tags.push('entrance');
        if (r.i === exitI && exitI !== entranceI) tags.push('exit');
        if (r.i === secretI) tags.push('secret');
        const ent = {
            id: 'r' + (r.i + 1), kind: 'room',
            name: titleCase(r.purpose), purpose: r.purpose,
            x: r.x, y: r.y, w: r.w, h: r.h,
            tags, notes: r.notes, content: r.content,
        };
        if (r.shape && r.shape !== 'rect') ent.shape = r.shape;
        model.entities.push(ent);
    }
    doors.forEach(([x, y], i) => model.entities.push({ id: 'd' + (i + 1), kind: 'door', x, y }));
    model.edges = edges.map(e => {
        const out = {
            a: 'r' + (e.a + 1), b: 'r' + (e.b + 1), kind: e.kind,
            dir: compass(rooms[e.a].cx, rooms[e.a].cy, rooms[e.b].cx, rooms[e.b].cy),
        };
        if (e.locked) out.locked = true;
        if (e.at) out.at = e.at;
        if (e.at2) out.at2 = e.at2;
        return out;
    });
    model.layers.grid = rleEncode(grid.map(row => row.join('')));
    return model;
}

/* ------------------------------------------------------------------
 *  BSP rooms + corridors
 * ------------------------------------------------------------------ */
function carveBsp(grid, W, H, rng, p, tagSet = new Set()) {
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

    // Shapes: separate stream + fixed room order → same seed keeps the
    // same rects, corridor order and loop picks; only walls re-sculpt.
    const shapeRng = rng.sub('shapes');
    for (const r of rooms) assignShape(r, shapeRng, p.theme, grid);

    const isWall = (x, y) => grid[y]?.[x] === undefined || grid[y][x] === '#';

    function carveCorridor(A, B) {
        // Endpoints from the shape's guaranteed-floor sub-rect (always
        // exactly 2 draws, so the main stream stays draw-aligned).
        const ptIn = r => {
            const [x0, x1, y0, y1] = innerRect(r);
            let px = rng.int(x0, x1);
            const py = rng.int(y0, y1);
            if (isPillar(r, px, py)) px += px + 1 <= x1 ? 1 : -1;
            return [px, py];
        };
        const [x1, y1] = ptIn(A), [x2, y2] = ptIn(B);
        const path = [];
        let x = x1, y = y1;
        const stepX = () => { while (x !== x2) { x += Math.sign(x2 - x); path.push([x, y]); } };
        const stepY = () => { while (y !== y2) { y += Math.sign(y2 - y); path.push([x, y]); } };
        if (rng.chance(0.5)) { stepX(); stepY(); } else { stepY(); stepX(); }

        // Door candidates: the first cell after leaving A's SHAPE (the actual
        // wall pierce, not the bbox), the last before entering B's.
        let doorA = null, doorB = null;
        for (const c of path) if (!roomHas(A, c[0], c[1])) { doorA = c; break; }
        for (let i = path.length - 1; i >= 0; i--) if (!roomHas(B, path[i][0], path[i][1])) { doorB = path[i]; break; }

        for (const [px, py] of path) if (grid[py][px] === '#') grid[py][px] = '.';

        const placed = [];
        for (const d of [doorA, doorB]) {
            if (!d) continue;
            const [px, py] = d;
            const narrow = (isWall(px - 1, py) && isWall(px + 1, py)) || (isWall(px, py - 1) && isWall(px, py + 1));
            if (grid[py][px] === '.' && narrow) {
                grid[py][px] = '+';
                doors.push([px, py]);
                placed.push(d);
            }
        }
        return placed;
    }

    // Wall-adjacent rooms usually get a direct door punched through the
    // shared wall (OPD look); everything else gets an L-corridor.
    function connectPair(A, B) {
        const gaps = directGap(A, B, grid);
        if (gaps.length && rng.chance(0.8)) {
            const cells = rng.pick(gaps);
            for (const [x, y] of cells) grid[y][x] = '.';
            const [dx, dy] = cells[0];
            grid[dy][dx] = '+';
            doors.push([dx, dy]);
            edges.push({ a: A.i, b: B.i, kind: 'door', at: [dx, dy] });
            return;
        }
        const placed = carveCorridor(A, B);
        const e = { a: A.i, b: B.i, kind: 'corridor' };
        if (placed[0]) e.at = placed[0];
        if (placed[1]) e.at2 = placed[1];
        edges.push(e);
    }

    // Connect sibling subtrees bottom-up through the BSP tree.
    function connect(n) {
        if (!n.a) return n.room;
        const ra = connect(n.a), rb = connect(n.b);
        if (ra && rb) {
            connectPair(ra, rb);
            return rng.chance(0.5) ? ra : rb;
        }
        return ra || rb;
    }
    connect(tree);

    // Extra loops: make the graph non-tree, more interesting to narrate.
    let loopTries = rng.int(1, 3) + Math.round(p.density * 2) + (tune.loopBonus || 0);
    if (tagSet.has('loops')) loopTries += 3;
    if (tagSet.has('linear')) loopTries = 0;          // pure tree
    for (let i = 0; i < loopTries && rooms.length > 3; i++) {
        const A = rng.pick(rooms), B = rng.pick(rooms);
        if (A === B) continue;
        if (edges.some(e => (e.a === A.i && e.b === B.i) || (e.a === B.i && e.b === A.i))) continue;
        if (Math.abs(A.cx - B.cx) + Math.abs(A.cy - B.cy) > 24) continue;
        connectPair(A, B);
    }

    // Door sanity: a later corridor can carve alongside an earlier door and
    // widen its frame — demote any door that is no longer narrow, and keep
    // edge door-cell refs (at/at2) pointing only at real '+' cells.
    const stillNarrow = ([x, y]) =>
        (isWall(x - 1, y) && isWall(x + 1, y)) || (isWall(x, y - 1) && isWall(x, y + 1));
    for (let i = doors.length - 1; i >= 0; i--) {
        const d = doors[i];
        if (stillNarrow(d)) continue;
        grid[d[1]][d[0]] = '.';
        doors.splice(i, 1);
        for (const e of edges) {
            if (e.at && e.at[0] === d[0] && e.at[1] === d[1]) delete e.at;
            if (e.at2 && e.at2[0] === d[0] && e.at2[1] === d[1]) delete e.at2;
        }
    }
    for (const e of edges) {
        if (!e.at && e.at2) { e.at = e.at2; delete e.at2; }
        if (e.kind === 'door' && !e.at) e.kind = 'corridor';   // doorway lost its door
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
    const rooms = centers.map(([cx, cy], i) => {
        // cap extents at half the distance to the nearest sibling cavern so
        // room boxes never contain another cavern's center
        let nd = Infinity;
        for (let j = 0; j < centers.length; j++) {
            if (j !== i) nd = Math.min(nd, Math.hypot(centers[j][0] - cx, centers[j][1] - cy));
        }
        const cap = Math.min(7, Number.isFinite(nd) ? Math.floor((nd - 1) / 2) : 7);
        const extent = (dx, dy) => {
            let d = 0;
            while (d < cap && open[cy + dy * (d + 1)]?.[cx + dx * (d + 1)]) d++;
            return d;
        };
        const l = extent(-1, 0), r = extent(1, 0);
        const t = extent(0, -1), b = extent(0, 1);
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
