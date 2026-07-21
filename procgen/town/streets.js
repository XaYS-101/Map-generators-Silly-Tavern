/* ------------------------------------------------------------------
 *  Town stage 2: streets — organic road growth.
 *
 *  Mains grow either as rays from the plaza (plain / hillside) or from
 *  the map-edge entry points toward the plaza (crossroads). On a
 *  hillside every step bends toward the nearest contour tangent so the
 *  roads wrap the hill. Branch lanes reject when too close to existing
 *  roads and never cross water; mains MAY bridge a river but stop at a
 *  coast. Bridges are the exact main×river crossings.
 *
 *  LAYOUT draw order: rayBase → per main (heading jitter + growth) →
 *  per branch point.
 * ------------------------------------------------------------------ */
import { segPointDist, contourTangent, lerpAngle, polylineIntersectAll } from './geom.js';

export function buildStreets(ctx) {
    const { rng, preset, extent, water, plaza, site } = ctx;
    const MARGIN = ctx.margin;
    const hillside = site.type === 'hillside' && site.contours;

    const roads = [];       // { id, kind:'main'|'lane'|'alley', pts }
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
        const step = kind === 'main' ? 26 : kind === 'alley' ? 12 : 22;
        let x = fromX, y = fromY, len = 0, wetRun = 0;
        while (len < maxLen) {
            heading += rng.float(-0.21, 0.21);
            if (hillside) heading = lerpAngle(heading, contourTangent(x, y, site.contours, heading), 0.35);
            const nx = x + Math.cos(heading) * step;
            const ny = y + Math.sin(heading) * step;
            if (nx < MARGIN || ny < MARGIN || nx > extent - MARGIN || ny > extent - MARGIN) break;
            // water rules: coast stops every road; a river only stops lanes/alleys;
            // mains may CROSS the river but must not linger along the channel
            const mx = (x + nx) / 2, my = (y + ny) / 2;
            const wet = water.inWater(nx, ny) || water.inWater(mx, my);
            if (wet && (water.type === 'coast' || kind !== 'main')) break;
            wetRun = wet ? wetRun + 1 : 0;
            if (wetRun > 1) { pts.pop(); break; }   // drop the lingering point too
            if (kind !== 'main' && tooCloseToRoads(nx, ny, 17, id)) break;
            pts.push([nx, ny]);
            x = nx; y = ny; len += step;
        }
        const minPts = kind === 'main' ? 3 : 2;
        if (pts.length < minPts) { roadId--; return null; }
        const road = { id, kind, pts };
        roads.push(road);
        addSegments(pts, id);
        return road;
    }

    // ---- main roads ----
    const mains = [];
    const rayBase = rng.float(0, Math.PI * 2);
    if (site.type === 'crossroads' && site.entries) {
        // grow FROM each edge entry heading toward the plaza (may pass it)
        for (const e of site.entries) {
            const ang = Math.atan2(plaza.y - e.y, plaza.x - e.x) + rng.float(-0.12, 0.12);
            const r = growRoad(e.x, e.y, ang, 'main', extent);
            if (r) mains.push(r);
        }
        // balance with a few short rays out of the plaza
        const extra = Math.max(0, preset.rays - site.entries.length);
        for (let i = 0; i < extra; i++) {
            const ang = rayBase + (Math.PI * 2 * i) / Math.max(1, extra) + rng.float(-0.25, 0.25);
            const r = growRoad(plaza.x + Math.cos(ang) * plaza.r, plaza.y + Math.sin(ang) * plaza.r, ang, 'main', extent * 0.45);
            if (r) mains.push(r);
        }
    } else {
        for (let i = 0; i < preset.rays; i++) {
            const ang = rayBase + (Math.PI * 2 * i) / preset.rays + rng.float(-0.25, 0.25);
            const r = growRoad(plaza.x + Math.cos(ang) * plaza.r, plaza.y + Math.sin(ang) * plaza.r, ang, 'main', extent);
            if (r) mains.push(r);
        }
    }

    // ---- branch lanes ----
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

    // ---- bridges: every exact main×river crossing (deduped) ----
    const bridges = [];
    if (water.riverPts) {
        for (const m of mains) {
            for (const hit of polylineIntersectAll(m.pts, water.riverPts)) {
                if (bridges.some(b => Math.hypot(b.x - hit.x, b.y - hit.y) < 30)) continue;
                const j = hit.bi, rp = water.riverPts;
                const angle = Math.atan2(rp[j][1] - rp[j - 1][1], rp[j][0] - rp[j - 1][0]);
                bridges.push({ x: hit.x, y: hit.y, angle, roadId: m.id });
            }
        }
    }

    ctx.roads = roads;
    ctx.segments = segments;
    ctx.mains = mains;
    ctx.tooCloseToRoads = tooCloseToRoads;
    ctx.growRoad = growRoad;
    ctx.bridges = bridges;
}
