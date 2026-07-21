/* ------------------------------------------------------------------
 *  Shared vector-geometry helpers for the town pipeline (RNG-free).
 *  Extracted from gen-town.js so every stage module and the tests can
 *  use the same primitives.
 * ------------------------------------------------------------------ */

/** Axis-aligned w×d rect rotated by ang around (cx, cy). */
export function rectPoly(cx, cy, w, d, ang) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const hw = w / 2, hd = d / 2;
    return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]
        .map(([x, y]) => [cx + x * ca - y * sa, cy + x * sa + y * ca]);
}

export function centroid(poly) {
    let sx = 0, sy = 0;
    for (const [x, y] of poly) { sx += x; sy += y; }
    return [sx / poly.length, sy / poly.length];
}

export function scalePoly(poly, f) {
    const [cx, cy] = centroid(poly);
    return poly.map(([x, y]) => [cx + (x - cx) * f, cy + (y - cy) * f]);
}

export function segPointDist(x, y, s) {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const l2 = dx * dx + dy * dy;
    if (!l2) return Math.hypot(x - s.x1, y - s.y1);
    let t = ((x - s.x1) * dx + (y - s.y1) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(x - (s.x1 + t * dx), y - (s.y1 + t * dy));
}

export function distToPolyline(x, y, pts) {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
        best = Math.min(best, segPointDist(x, y, { x1: pts[i - 1][0], y1: pts[i - 1][1], x2: pts[i][0], y2: pts[i][1] }));
    }
    return best;
}

/** SAT for convex quads. */
export function polysIntersect(a, b) {
    for (const poly of [a, b]) {
        for (let i = 0; i < poly.length; i++) {
            const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
            const nx = y1 - y2, ny = x2 - x1;
            let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
            for (const [qx, qy] of a) { const d = qx * nx + qy * ny; aMin = Math.min(aMin, d); aMax = Math.max(aMax, d); }
            for (const [qx, qy] of b) { const d = qx * nx + qy * ny; bMin = Math.min(bMin, d); bMax = Math.max(bMax, d); }
            if (aMax < bMin || bMax < aMin) return false;
        }
    }
    return true;
}

/** Segment (a1→a2) × segment (b1→b2) intersection point or null.
 *  Used for gates (road × wall) and bridges (road × river). */
export function segIntersect(a1, a2, b1, b2) {
    const d1x = a2[0] - a1[0], d1y = a2[1] - a1[1];
    const d2x = b2[0] - b1[0], d2y = b2[1] - b1[1];
    const den = d1x * d2y - d1y * d2x;
    if (Math.abs(den) < 1e-9) return null;   // parallel / degenerate
    const t = ((b1[0] - a1[0]) * d2y - (b1[1] - a1[1]) * d2x) / den;
    const u = ((b1[0] - a1[0]) * d1y - (b1[1] - a1[1]) * d1x) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return [a1[0] + t * d1x, a1[1] + t * d1y];
}

/** First intersection of a polyline with another polyline, or null.
 *  Returns { x, y, ai, bi } (segment indices on both lines). */
export function polylineIntersect(aPts, bPts) {
    for (let i = 1; i < aPts.length; i++) {
        for (let j = 1; j < bPts.length; j++) {
            const hit = segIntersect(aPts[i - 1], aPts[i], bPts[j - 1], bPts[j]);
            if (hit) return { x: hit[0], y: hit[1], ai: i, bi: j };
        }
    }
    return null;
}
