/* ------------------------------------------------------------------
 *  Building-interior history pass.
 *
 *  buildLore(rooms, opts) → { entities:[loreEntity] }.
 *
 *  Draws a three-beat history — who BUILT the place, what CHANGE passed
 *  through it, what holds it NOW — at one of three completeness levels.
 *  A 'full' history also echoes into 1-2 rooms (r.loreEcho), so a
 *  physical trace of the story survives in the walls instead of living
 *  only in one lore card. The lore entity is emitted ONLY when there is
 *  a history to tell (completeness !== 'none'), so describe.js can gate
 *  purely on its presence.
 *
 *  Stream: `${seed}/lore:${kind}` — the building CONDITION is deliberately
 *  kept OUT of the stream key. It only selects which tables/weights are
 *  read, never advances the PRNG differently, so flipping a building
 *  between lived-in / abandoned / looted keeps the SAME underlying
 *  history wherever the beats overlap (the builder pool in particular is
 *  condition-independent). Fixed draw order: completeness roll → builder
 *  → change → now → echoes, mirroring the dungeon story pass.
 * ------------------------------------------------------------------ */
import { Rng } from '../rng.js';
import { expand, cap } from '../content/grammar.js';

/* BUILDER beat — who raised it. Shared pool (condition-independent),
 * plus a couple of kind-specific overrides appended for flavour. Picks
 * may carry {a|b} alternation, expanded on the lore stream. */
const BUILDER_SHARED = [
    "a masons' guild flush with cathedral money",
    "a widow with her husband's prize-money and no use for advice",
    'a veteran paid off whole after the border wars',
    'a merchant house at the very top of its luck',
    "a farmer's son come home rich and keen to prove it",
    'the town itself, by subscription and long argument',
    "a lord's youngest, given the building of it to keep him busy",
    'no one remembers — the deeds burned with the old records',
];
const BUILDER_KIND = {
    temple: ['an order of {friars|lay brothers} long since recalled'],
    keep: ['a family that mattered more then than now'],
    manor: ['a family that mattered more then than now'],
};

/* CHANGE beat — what passed through it. Pool chosen by condition. */
const CHANGE_LIVED = [
    'good years and lean have passed through it about evenly',
    'it changed hands once over a debt, amicably enough',
    'a fire took the roof a generation back; the beams still show it',
    'the trade shifted, and the place bent with it',
    'three owners in, the name over the door has stopped meaning anyone',
];
const CHANGE_SHARED = [   // abandoned + looted both draw from this
    'debt took it whole, and the bailiffs took the movables',
    'a scandal moved the family out between one market-day and the next',
    'fire gutted the back rooms, and the money to mend them never came',
    'the heirs quarrelled it into ruin through the courts',
];
const CHANGE_ABANDONED_EXTRA = [   // abandoned only
    'a plague-summer emptied it, and superstition has kept it so',
    'the trade it served dried up, and it followed',
];

/* NOW beat — what holds it today. Pool chosen by condition. */
const NOW_LIVED = [
    'now it keeps its people warm and its accounts roughly honest',
    'now it stands much as it was built, and means to go on doing',
    'now new hands run it, and the old name sticks regardless',
];
const NOW_ABANDONED = [
    'now only the wind pays rent',
    'now the town walks past it a little faster after dark',
    'now it waits, weathertight in patches, for a buyer or a fire',
];
const NOW_LOOTED = [
    'now it stands stripped to the walls, and the walls saw nothing',
    'now the door swings for anyone who wants what little is left',
    'now even the scavengers have stopped bothering',
];

/* Room echoes (full completeness only): a short physical trace. */
const ECHO_POOL = [
    'a datestone over the lintel, the year worn to guesses',
    "initials and a mason's mark cut low on the wall",
    'a painted-over sign still ghosts through the whitewash',
    'scorch-marks above the old beam, whitewashed but not fooled',
    "a child's height-marks climb one doorframe, stopping abruptly",
    'a coin of the old minting, nailed above the door for luck',
];

/* Non-entrance rooms whose purpose suggests age get first refusal. */
const AGED_PURPOSE = /cellar|crypt|attic|strongroom|store/i;

/**
 * @param {Array} rooms  { id, level, name, purpose, tags, ... } — may gain r.loreEcho
 * @param {object} opts  { kind, condition, wealth, seed, formerOwner, entranceId }
 * @returns {{ entities: Array }}
 */
export function buildLore(rooms, opts) {
    const {
        kind, condition = 'lived-in', seed,
        formerOwner = null, entranceId,
    } = opts || {};
    const rng = new Rng(`${seed}/lore:${kind}`);

    /* Completeness: an abandoned/looted building usually explains itself. */
    const weights = condition === 'lived-in'
        ? [['full', 30], ['partial', 30], ['none', 40]]
        : [['full', 50], ['partial', 35], ['none', 15]];
    const completeness = rng.weighted(weights);
    if (completeness === 'none') return { entities: [] };

    const builderPool = BUILDER_SHARED.concat(BUILDER_KIND[kind] || []);
    const changePool = condition === 'lived-in' ? CHANGE_LIVED
        : condition === 'abandoned' ? CHANGE_SHARED.concat(CHANGE_ABANDONED_EXTRA)
            : CHANGE_SHARED;   // looted
    const nowPool = condition === 'lived-in' ? NOW_LIVED
        : condition === 'looted' ? NOW_LOOTED
            : NOW_ABANDONED;

    /* NOW beat: for abandoned/looted with a known former owner, half the
     * time name them ahead of the beat, weaving as the dungeon pass does. */
    const nowBeat = () => {
        const beat = expand(rng.pick(nowPool), rng, {});
        if ((condition === 'abandoned' || condition === 'looted')
            && formerOwner && formerOwner.name && rng.chance(0.5)) {
            return `${formerOwner.name} kept it last; ` + beat;
        }
        return beat;
    };

    let builder = null, change = null, now = null, text = '';
    if (completeness === 'full') {
        builder = expand(rng.pick(builderPool), rng, {});
        change = expand(rng.pick(changePool), rng, {});
        now = nowBeat();
        text = `It was raised by ${builder}. Then ${change}. ${cap(now)}.`;
    } else {
        /* partial — one beat only: the builder OR the change */
        if (rng.chance(0.5)) {
            builder = expand(rng.pick(builderPool), rng, {});
            text = `It was raised by ${builder}.`;
        } else {
            change = expand(rng.pick(changePool), rng, {});
            text = `The old folk say ${change}.`;
        }
    }

    const lore = { id: 'lore1', kind: 'lore', name: 'History', completeness, text };
    if (builder) lore.builder = builder;
    if (change) lore.fall = change;   // stored as `fall` to match the dungeon lore shape
    if (now) lore.now = now;

    /* full → echo the history into 1-2 non-entrance rooms (aged first) */
    if (completeness === 'full' && rooms && rooms.length) {
        const nonEntrance = rooms.filter(r => r.id !== entranceId);
        const aged = nonEntrance.filter(r => AGED_PURPOSE.test(r.purpose || ''));
        const rest = nonEntrance.filter(r => !AGED_PURPOSE.test(r.purpose || ''));
        const ordered = rng.shuffle(aged).concat(rng.shuffle(rest));
        const k = Math.min(ordered.length, rng.int(1, 2));
        const echoes = rng.shuffle(ECHO_POOL);   // no duplicates: draw distinct
        for (let i = 0; i < k; i++) {
            ordered[i].loreEcho = expand(echoes[i], rng, {});
        }
    }

    return { entities: [lore] };
}
