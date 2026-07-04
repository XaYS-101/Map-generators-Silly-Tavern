/* ------------------------------------------------------------------
 *  Shared model envelope + small geometry/grid codecs.
 *
 *  Every generator returns:
 *  {
 *    v: 1, type, seed, params,          // exact inputs → fully regenerable
 *    name,                              // generated title
 *    size: { w, h, unit },              // map units ('tile'|'cell'|'m'|'u')
 *    entities: [ { id, kind, name?, purpose?, x?, y?, w?, h?, pts?, tags?, notes? } ],
 *    edges:    [ { a, b, kind, dir?, locked? } ],   // connectivity graph
 *    layers:   { ... }                  // bulky per-type geometry; stripped from JSON export
 *  }
 * ------------------------------------------------------------------ */

export function makeEnvelope(type, seed, params) {
    return {
        v: 1,
        type,
        seed: String(seed),
        params: { ...params },
        name: '',
        size: null,
        entities: [],
        edges: [],
        layers: {},
    };
}

/* 8-way compass; screen coordinates (y grows down → +y is South). */
const DIRS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E', NE: 'SW', SW: 'NE', NW: 'SE', SE: 'NW' };

export function compass(ax, ay, bx, by) {
    const ang = Math.atan2(by - ay, bx - ax);
    const idx = Math.round(ang / (Math.PI / 4));
    return DIRS[(idx + 8) % 8];
}

export function oppositeDir(d) { return OPPOSITE[d] || d; }

export const DIR_WORDS = {
    N: 'north', S: 'south', E: 'east', W: 'west',
    NE: 'northeast', NW: 'northwest', SE: 'southeast', SW: 'southwest',
};

/* Run-length codec for tile grids (rows of single chars, no digits
 * among tile codes). "####" → "4#". */
export function rleEncode(rows) {
    return rows.map(r => r.replace(/(.)\1{2,}/g, (m, c) => m.length + c)).join('\n');
}

export function rleDecode(s) {
    return String(s).split('\n').map(r => r.replace(/(\d+)(\D)/g, (_, n, c) => c.repeat(Number(n))));
}
