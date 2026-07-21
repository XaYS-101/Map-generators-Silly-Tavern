/* ------------------------------------------------------------------
 *  Building-interior content database + populate pass.
 *
 *  The structural generator (gen-interior.js + interior/*) lays out
 *  the rooms; populateInterior() walks them in array order and hangs a
 *  structured `content` object on each — furniture / dressing / trace /
 *  valuables / secret / key / hook — plus a flattened `notes` string.
 *  describe.js turns the typed fields into LLM-facing prose (it decides
 *  how to surface valuables / secret / key / hook — those are kept OUT
 *  of `notes`).
 *
 *  Mirrors content/dungeon.js: authored English lives here as
 *  tag-weighted grammar tables (see grammar.js). Determinism: every
 *  pick comes from the seeded Rng handed in by the caller
 *  (`${seed}/content:...`) — no Date.now()/Math.random().
 * ------------------------------------------------------------------ */
import { expand } from './grammar.js';
import { furnitureFor } from '../names.js';

/* Shorthand: tag every entry in `arr` with `tags` (strings → {t,tags}). */
const tag = (tags, arr) => arr.map(x => (typeof x === 'string' ? { t: x, tags } : { ...x, tags }));

export const TABLES = {
    /* -------- dressing (atmosphere), by wealth tier -------- */
    dress: [
        ...tag(['poor'], [
            'patched curtains hang crooked at the window', 'a threadbare rug worn through to the boards',
            'smoke-stained walls the colour of old tea', 'a cracked pane stuffed with a twist of rag',
            'tallow-smoke has greyed the low ceiling', 'the floorboards warp and complain underfoot',
        ]),
        ...tag(['average'], [
            'a swept floor and plain, serviceable furnishings', 'a trimmed lamp stands ready on its bracket',
            'whitewashed walls gone dull with the years', 'honest wear on sturdy, unremarkable furniture',
            'a shelf of well-used everyday things',
        ]),
        ...tag(['wealthy'], [
            'silver sconces catch and throw the light', 'velvet drapes pool richly at the sill',
            'polished panelling and a waxed, gleaming floor', 'a gilt-framed mirror doubles the room',
            'fresh rushes strewn with sweet herbs', 'a fine carpet muffles every footfall',
        ]),
    ],
    /* -------- one secret cache per building -------- */
    secret: tag(['any'], [
        'a loose floorboard lifts on a small cache beneath', 'a false panel in the wall swings silently aside',
        'a hollowed roof-beam conceals a wrapped bundle', 'a strongbox lies buried under the {hearthstone|straw|dirt floor}',
        'a stone in the {chimney-breast|back wall} pulls free of its niche', 'a cavity behind a loose brick holds a knotted purse',
    ]),
    /* -------- valuables, present vs already rifled -------- */
    valuable: tag(['any'], [
        'a locked coffer of silver', 'a strongbox bolted to the floor', 'a small chest heavy with coin',
        'a purse of good coin tucked out of sight', 'a rack of plate too fine for daily use',
        'a strongbox and a ledger to match it',
    ]),
    valuable_looted: tag(['any'], [
        'a coffer pried open and licked clean', 'a strongbox smashed off its bolts and emptied',
        'a chest tipped out, only splinters and dust left', 'a lockbox forced and abandoned gaping',
    ]),
};

/* Kind-specific atmosphere — plain strings, picked directly. */
const KIND_DRESS = {
    tavern: ['stale ale and old woodsmoke hang thick in the air', 'a fiddle-tune seems to linger in the smoke-dark beams'],
    smithy: ['forge-heat presses close even by the door', 'iron-scale and soot grime every surface'],
    barracks: ['boot-polish and oiled steel scent the air', 'a bugle-call schedule is nailed up by the door'],
    warehouse: ['dust hangs in the slatted bars of daylight', 'the air lies heavy with tar, hemp, and far-off spice'],
    caravanserai: ['road-dust cakes every threshold and sill', 'a dozen travellers’ tongues murmur beyond the walls'],
    mill: ['fine grain-dust films every beam and breath', 'the floor trembles faintly with the turning wheel'],
    temple: ['incense-smoke curls slow in the still air', 'candle-wax has fossilised down every ledge'],
    manor: ['beeswax polish and cut flowers scent the hall', 'thick carpet swallows the sound of every step'],
    keep: ['cold stone and torch-smoke breathe from the walls', 'a draught carries the distant clank of the watch'],
    house: ['woodsmoke and cooking-fat linger warm and close', 'a cat has left its hair on every soft thing'],
    shop: ['the mingled smell of goods, dust, and oiled wood', 'a little bell hangs ready above the door'],
};

/* Trace of what happened here, by building condition. */
const TRACE = {
    'lived-in': [
        'embers still glow warm in the hearth', 'a half-eaten meal sits cooling on the table',
        'fresh rushes and the smell of a recent fire', 'someone’s cloak hangs damp on a peg',
        'a chair pushed back as if just vacated', 'a lamp left burning low against the dark',
    ],
    abandoned: [
        'dust-sheets shroud the furniture in grey', 'cobwebs curtain every corner and beam',
        'cold ash lies heaped in a long-dead hearth', 'a loose shutter bangs somewhere on the wind',
        'grime and drifted leaves have crept across the floor', 'everything wears a soft, undisturbed fur of dust',
    ],
    looted: [
        'furniture lies overturned and splintered', 'a lock hangs smashed from a wrenched door',
        'a chest gapes emptied, its lid torn back', 'a dark stain has soaked and dried into the boards',
        'drawers hang pulled out and dumped', 'the floor is a wreck of scattered, trampled belongings',
    ],
};

/* One narrative hook per building, by condition. */
const HOOK = {
    'lived-in': [
        'the fire was still lit and a meal half-eaten when the door was left standing open',
        'a child’s shoe lies dropped on the stair, as though its owner were snatched away',
        'the day-book’s last entry breaks off in the middle of a word',
        'every place is set at the table, but not one chair is warm',
    ],
    abandoned: [
        'dust lies over everything but for a single, recent set of footprints crossing it',
        'the shutters were nailed fast from the inside before whoever it was left',
        'a calendar on the wall stops dead at one day, ringed in charcoal',
        'the door was left barred — from the inside, with no one within',
    ],
    looted: [
        'someone searched the place in a hurry — and, by the wreckage, never found what they came for',
        'the strongbox was carried off whole, chain, bolts, and all',
        'every floorboard has been pried up but one',
        'they emptied every room but the last, then left in a hurry',
    ],
};

/* Rooms that fittingly hold something worth stealing (higher chance). */
const VALUABLE_ROOMS = new Set([
    'strongroom', 'office', "owner's room", "keeper's room", "captain's quarters",
    "lord's chamber", 'reliquary', 'treasury', 'sanctum', 'study', 'solar',
    'master bedroom', 'private booth',
]);
function isValuableRoom(purpose) {
    const p = purpose || '';
    return /bedroom|chamber/.test(p) || VALUABLE_ROOMS.has(p);
}

const VAL_BASE = { poor: 0.1, average: 0.25, wealthy: 0.5 };

const KEY_PATTERN =
    'the {iron|brass|blackened} key to the {cellar|strongroom|store|back} door hangs ' +
    '{behind the bar|on the owner’s belt hook|under the counter|on a nail by the hearth|in a locked drawer}';

/**
 * Fill each room's typed `content` and flattened `notes`. Mutates rooms.
 * @param {Array} rooms  { id, level, purpose, tags, w, h }, array order = walk order
 * @param {object} ctx   { kind, wealth, condition, entranceId, keyRooms:[{roomId,doorId}], stairRoomIds:[] }
 * @param {import('../rng.js').Rng} rng  dedicated content stream (`${seed}/content:...`)
 */
export function populateInterior(rooms, ctx, rng) {
    const { kind, wealth = 'average', condition = 'lived-in', entranceId, keyRooms = [] } = ctx;
    const P = tpl => expand(tpl, rng, TABLES);
    const looted = condition === 'looted';
    const abandoned = condition === 'abandoned';
    const livedIn = condition === 'lived-in';

    /* ---- secret cache: one deep/small room, deterministic (no rng) ----
     * prefer a non-entrance room, smallest footprint, ties broken by id. */
    const secretCand = rooms.filter(r => r.id !== entranceId);
    const secretPool = secretCand.length ? secretCand : rooms;
    let secretId = null;
    for (const r of secretPool) {
        const a = r.w * r.h;
        if (secretId === null) { secretId = r.id; continue; }
        const cur = secretPool.find(x => x.id === secretId);
        const ca = cur.w * cur.h;
        if (a < ca || (a === ca && String(r.id) < String(secretId))) secretId = r.id;
    }

    /* ---- lived-in traces are sparse: pick 1-2 rooms up front ---- */
    let traceSet = null;
    if (livedIn) {
        const n = Math.min(rooms.length, rng.int(1, 2));
        traceSet = new Set(rng.shuffle(rooms.map(r => r.id)).slice(0, n));
    }

    for (const r of rooms) {
        const c = {};

        // ---- furniture: 1-3 deduped (ported from the old interior pass) ----
        const nFurn = rng.int(1, r.w * r.h > 20 ? 3 : 2);
        const furn = new Set();
        for (let i = 0; i < nFurn; i++) furn.add(furnitureFor(rng, r.purpose));
        c.furniture = [...furn];

        // ---- dressing: 0-2 atmosphere lines ----
        const dress = [];
        if (rng.chance(0.7)) dress.push(P(`[dress#${wealth}]`));
        const kd = KIND_DRESS[kind];
        if (kd && rng.chance(0.5)) dress.push(rng.pick(kd));
        c.dressing = [...new Set(dress.filter(Boolean))].slice(0, 2);

        // ---- valuables: chance by wealth, higher in fitting rooms ----
        let vChance = (VAL_BASE[wealth] ?? 0.25) * (isValuableRoom(r.purpose) ? 2 : 1);
        if (looted) vChance *= 0.2;                       // looters mostly cleared them out
        vChance = Math.min(vChance, 0.85);
        if (rng.chance(vChance)) c.valuables = looted ? P('[valuable_looted]') : P('[valuable]');

        // ---- trace of the building's condition ----
        let trace = null;
        if (livedIn) {
            if (traceSet.has(r.id)) trace = rng.pick(TRACE['lived-in']);
        } else if (rng.chance(0.8)) {                     // abandoned/looted: most rooms
            trace = rng.pick(abandoned ? TRACE.abandoned : TRACE.looted);
        }
        if (trace) c.trace = trace;

        // ---- secret cache (typed only; describe surfaces it) ----
        if (r.id === secretId) c.secret = '[hidden] ' + P('[secret]');

        // ---- flatten: furniture + dressing + trace only ----
        r.content = c;
        r.notes = [...c.furniture, ...c.dressing, ...(trace ? [trace] : [])].join('; ');
    }

    // ---- keys: one line into each keyRoom's content (typed only) ----
    for (const { roomId } of keyRooms) {
        const kr = rooms.find(r => r.id === roomId);
        if (kr?.content) kr.content.key = P(KEY_PATTERN);
    }

    // ---- hook: exactly one for the whole building, on the entrance room ----
    const entrance = rooms.find(r => r.id === entranceId) || rooms[0];
    if (entrance?.content) {
        entrance.content.hook = expand(rng.pick(HOOK[condition] || HOOK['lived-in']), rng, TABLES);
    }
}
