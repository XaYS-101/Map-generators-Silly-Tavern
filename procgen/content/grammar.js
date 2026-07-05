/* ------------------------------------------------------------------
 *  Tiny deterministic template grammar for the content database.
 *
 *  expand(template, rng, tables) → string. All randomness comes from
 *  the passed-in seeded Rng, so the same template + same rng stream
 *  always yields the same text (determinism contract, see rng.js).
 *
 *  Syntax:
 *    {a|b|c}          weighted alternation; weight via ":N"  ->  {a|b:3|c}
 *    [table]          pick a weighted entry from tables.table, expand it
 *    [table#tag]      same, but only entries tagged with that tag
 *                     (comma-separate for several: [table#crypt,any])
 *    {article:X}      expand X, prefix "a"/"an" by its first letter
 *
 *  Tables are { name: [ { t, tags?, w? }, ... ] }.  An entry matches a
 *  requested tag if it carries that tag OR the universal tag 'any'.
 *  Unknown tables / no-match filters degrade to '' or the full list —
 *  a generator must never throw.
 * ------------------------------------------------------------------ */

const DEPTH_MAX = 12;

/** Scan from `start` (an `open` char) to its matching `close`, nesting-aware. */
function matchBracket(s, start, open, close) {
    let depth = 0;
    for (let i = start; i < s.length; i++) {
        if (s[i] === open) depth++;
        else if (s[i] === close && --depth === 0) return i;
    }
    return s.length - 1; // unbalanced → treat the rest as inner
}

/** Split on `sep` only at bracket-depth 0 (so nested {}/[] stay intact). */
function splitTop(s, sep) {
    const parts = [];
    let depth = 0, cur = '';
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '{' || c === '[') depth++;
        else if (c === '}' || c === ']') depth--;
        if (c === sep && depth === 0) { parts.push(cur); cur = ''; }
        else cur += c;
    }
    parts.push(cur);
    return parts;
}

export function article(word) {
    const m = String(word).match(/[a-z0-9]/i);
    const first = m ? m[0].toLowerCase() : '';
    return (/[aeiou]/.test(first) ? 'an ' : 'a ') + word;
}

export function cap(s) {
    s = String(s);
    return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function resolveAlt(inner, rng, tables, depth) {
    if (inner.startsWith('article:')) {
        return article(expand(inner.slice(8), rng, tables, depth + 1));
    }
    const opts = splitTop(inner, '|').map(raw => {
        const m = raw.match(/:(\d+)\s*$/);
        return m ? { text: raw.slice(0, m.index), w: Number(m[1]) } : { text: raw, w: 1 };
    });
    if (opts.length === 1) return expand(opts[0].text, rng, tables, depth + 1);
    const chosen = rng.weighted(opts.map(o => [o.text, o.w]));
    return expand(chosen, rng, tables, depth + 1);
}

function resolveRef(inner, rng, tables, depth) {
    const [name, tagStr] = inner.split('#');
    const list = tables?.[name.trim()];
    if (!Array.isArray(list) || !list.length) return '';
    const tags = tagStr ? tagStr.split(',').map(t => t.trim()).filter(Boolean) : [];
    let pool = list;
    if (tags.length) {
        const hit = list.filter(e => {
            const et = e.tags || [];
            return et.includes('any') || tags.some(t => et.includes(t));
        });
        if (hit.length) pool = hit; // no match → fall back to the whole table
    }
    const entry = rng.weighted(pool.map(e => [e, e.w ?? 1]));
    return expand(entry.t, rng, tables, depth + 1);
}

export function expand(template, rng, tables, depth = 0) {
    if (template == null) return '';
    const s = String(template);
    if (depth > DEPTH_MAX) return s;
    let out = '', i = 0;
    while (i < s.length) {
        const ch = s[i];
        if (ch === '{') {
            const end = matchBracket(s, i, '{', '}');
            out += resolveAlt(s.slice(i + 1, end), rng, tables, depth);
            i = end + 1;
        } else if (ch === '[') {
            const end = matchBracket(s, i, '[', ']');
            out += resolveRef(s.slice(i + 1, end), rng, tables, depth);
            i = end + 1;
        } else {
            out += ch;
            i++;
        }
    }
    return out;
}
