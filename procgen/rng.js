/* ------------------------------------------------------------------
 *  Seeded deterministic RNG: string seed → cyrb128 hash → mulberry32.
 *
 *  Sub-stream discipline: every generator subsystem derives its own
 *  stream via rng.sub('label'), never from a shared running PRNG —
 *  so e.g. regenerating names never reshuffles the room layout.
 * ------------------------------------------------------------------ */

/** cyrb128 — string → four 32-bit hash ints (public domain). */
export function hashSeed(str) {
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (let i = 0, k; i < str.length; i++) {
        k = str.charCodeAt(i);
        h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
        h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
        h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
        h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

/** mulberry32 — 32-bit state PRNG (public domain). */
function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export class Rng {
    constructor(seedStr) {
        this.seedStr = String(seedStr);
        this._next = mulberry32(hashSeed(this.seedStr)[0]);
    }

    /** float in [0, 1) */
    next() { return this._next(); }

    float(min = 0, max = 1) { return min + (max - min) * this.next(); }

    /** integer in [min, max] inclusive */
    int(min, max) { return min + Math.floor(this.next() * (max - min + 1)); }

    pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }

    /** pairs: [[item, weight], ...] */
    weighted(pairs) {
        let total = 0;
        for (const [, w] of pairs) total += w;
        let roll = this.next() * total;
        for (const [item, w] of pairs) { roll -= w; if (roll <= 0) return item; }
        return pairs[pairs.length - 1][0];
    }

    chance(p) { return this.next() < p; }

    /** Fisher–Yates on a COPY — never mutates the input. */
    shuffle(arr) {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(this.next() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    /** Box–Muller. */
    gaussian(mean = 0, sd = 1) {
        const u = 1 - this.next();   // avoid log(0)
        const v = this.next();
        return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    /** Derived independent stream; same seed + same label → same stream. */
    sub(label) { return new Rng(this.seedStr + '/' + label); }
}
