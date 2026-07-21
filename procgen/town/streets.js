/* ------------------------------------------------------------------
 *  Town stage 2: streets — organic road growth.
 *
 *  Main rays from the plaza rim with heading jitter, branch lanes
 *  rejected when too close to existing roads. LAYOUT draw order:
 *  rayBase → per ray (ang jitter + growth) → per branch point
 *  (nextAt, side, ang, maxLen, recurse chance).
 * ------------------------------------------------------------------ */
import { segPointDist } from './geom.js';

export function buildStreets(ctx) {
    const { rng, preset, extent, water, plaza } = ctx;
    const MARGIN = ctx.margin;

    const roads = [];       // { id, kind:'main'|'lane', pts }
    const segments = [];    // { x1,y1,x2,y2, roadId }
    let roadId = 0;

    function addSegments(pts, id) {
        for (let i = 1; i < pts.length; i++) {
            segments.push({ x1: pts[i - 1][0], y1: pts[i - 1][1], x2: pts[i][0], y2: pts[i][1], roadId: id });
        }
    }
    function tooCloseToRoads(x, y, minD, excludeId) {
        for (const s of segments) {
            if (s.roadId === excludeId) continue;
            if (segPointDist(x, y, s) < minD) return true;
        }
        return false;
    }

    function growRoad(fromX, fromY, heading, kind, maxLen) {
        const id = roadId++;
        const pts = [[fromX, fromY]];
        const step = kind === 'main' ? 26 : 22;
        let x = fromX, y = fromY, len = 0;
        while (len < maxLen) {
            heading += rng.float(-0.21, 0.21);
            const nx = x + Math.cos(heading) * step;
            const ny = y + Math.sin(heading) * step;
            if (nx < MARGIN || ny < MARGIN || nx > extent - MARGIN || ny > extent - MARGIN) break;
            if (water.shoreY != null && ny > water.shoreY - 8) break;
            if (kind !== 'main' && tooCloseToRoads(nx, ny, 17, id)) break;
            pts.push([nx, ny]);
            x = nx; y = ny; len += step;
        }
        if (pts.length < 3) { roadId--; return null; }
        const road = { id, kind, pts };
        roads.push(road);
        addSegments(pts, id);
        return road;
    }

    // main rays from the plaza
    const rayBase = rng.float(0, Math.PI * 2);
    const mains = [];
    for (let i = 0; i < preset.rays; i++) {
        const ang = rayBase + (Math.PI * 2 * i) / preset.rays + rng.float(-0.25, 0.25);
        const r = growRoad(plaza.x + Math.cos(ang) * plaza.r, plaza.y + Math.sin(ang) * plaza.r, ang, 'main', extent);
        if (r) mains.push(r);
    }

    // branch lanes
    function branchFrom(road, depth) {
        if (depth > preset.depth) return;
        const pts = road.pts;
        let nextAt = rng.int(preset.branchEvery[0], preset.branchEvery[1]);
        let acc = 0;
        for (let i = 1; i < pts.length; i++) {
            acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
            if (acc < nextAt) continue;
            acc = 0;
            nextAt = rng.int(preset.branchEvery[0], preset.branchEvery[1]);
            const tangent = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
            const side = rng.chance(0.5) ? 1 : -1;
            const ang = tangent + side * (Math.PI / 2 + rng.float(-0.35, 0.35));
            const lane = growRoad(pts[i][0], pts[i][1], ang, 'lane', rng.int(60, 160));
            if (lane && rng.chance(0.5)) branchFrom(lane, depth + 1);
        }
    }
    for (const m of mains) branchFrom(m, 1);

    ctx.roads = roads;
    ctx.segments = segments;
    ctx.mains = mains;
    ctx.tooCloseToRoads = tooCloseToRoads;
    ctx.bridges = [];
}
