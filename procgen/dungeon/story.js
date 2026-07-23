/* ------------------------------------------------------------------
 *  Dungeon backstory pass.
 *
 *  buildStory(ctx) → { lore, entities:[loreEntity] }.
 *
 *  Draws a three-beat history — who BUILT the place, how it FELL, what
 *  holds it NOW — at one of three completeness levels. A 'full' story
 *  also echoes into 2-3 rooms (r.storyEcho), so the layout carries the
 *  lore instead of dumping it all in one lore card. The lore entity is
 *  emitted ONLY when there is a story to tell (completeness !== 'none'),
 *  so describe.js can gate purely on its presence.
 *
 *  Stream: `${seed}/story:${theme}:${sortedTags}` — independent of the
 *  inhabitants stream, so story presence is a pure function of the seed.
 *  The boss name (if any) threads into the NOW beat.
 * ------------------------------------------------------------------ */
import { Rng } from '../rng.js';
import { expand, cap } from '../content/grammar.js';

/* Theme-keyed tables; each pick is a plain string (may carry {a|b}
 * alternation, expanded on the story stream). 'any' is the fallback. */
const STORY_BUILDER = {
    crypt: ['a dynasty of river-kings', 'an order of grave-priests', 'a line of embalmer-lords',
        'a cult that worshipped the patient dark'],
    ruins: ['a forgotten city-state', 'an order of scholar-mages', 'a people whose name is lost',
        'the last court of a drowned kingdom'],
    stronghold: ['a border-legion sworn to a dead crown', 'a warlord who feared no siege',
        'an order of oathbound knights', 'a garrison that never stood down'],
    sewer: ['the engineers of a proud old city', 'a guild of tunnel-wrights',
        'the vault-keepers of a sunken treasury'],
    caves: ['a clan of deep-delvers', 'miners chasing a vein that sang',
        'hermits who fled the surface world'],
    any: ['a people long since dust', 'builders whose purpose is guessed at', 'an age that kept no records'],
};
const STORY_FALL = {
    crypt: ['a plague sealed the doors from inside', 'the last rites were never finished',
        'the dead were laid to rest, and would not stay so'],
    ruins: ['a long siege ended in fire and salt', 'the ground itself gave way one night',
        'the wards failed and something walked in'],
    stronghold: ['the garrison was betrayed at its own gate', 'a mutiny left no hand on the wall',
        'the relief that was promised never came'],
    sewer: ['a flood drowned the lower works in a single night', 'the great sluice jammed and never reopened',
        'the diggers broke into something better left sealed'],
    caves: ['the deep vein ran out, and then ran red', 'a collapse trapped the delvers below',
        'they dug too far and woke what waited'],
    any: ['ruin came quickly, and left few to tell it', 'the doors were shut from within and stayed shut',
        'whatever ended it left no clean account'],
};
/* NOW beat: with a boss present, name it; otherwise a generic close. */
const STORY_NOW_BOSS = [
    'now BOSS rules its silence', 'now BOSS keeps the halls, and keeps them jealously',
    'now BOSS holds the throne of it', 'now only BOSS answers the knock of a footstep'];
const STORY_NOW_GENERIC = [
    'now only echoes keep the halls', 'now the dark has the run of the place',
    'now nothing walks here but what crawled in after', 'now the silence has grown teeth'];

const ECHO_TPL = ['faded murals depict BUILDER', 'a carved frieze recalls BUILDER',
    'a defaced dedication to BUILDER lingers on the wall', 'a broken statue honours BUILDER still'];

const idNum = id => parseInt(String(id).replace(/\D/g, ''), 10) || 0;

function pickTheme(rng, table, theme) {
    const pool = table[theme] || table.any || [];
    if (!pool.length) return '';
    return expand(rng.pick(pool), rng, {});
}

/**
 * @param {object} ctx { roomsAll, p, seed, tagSet, boss (may be null) }
 * @returns {{ lore:object, entities:Array }}
 */
export function buildStory(ctx) {
    const { roomsAll = [], p = {}, seed, tagSet = new Set(), boss = null } = ctx;
    const sortedTags = [...tagSet].sort().join(',');
    const rng = new Rng(`${seed}/story:${p.theme}:${sortedTags}`);

    const completeness = rng.weighted([['full', 45], ['partial', 35], ['none', 20]]);
    if (completeness === 'none') return { lore: { completeness: 'none' }, entities: [] };

    const bossName = boss && boss.name ? boss.name : null;
    const nowBeat = () => bossName
        ? expand(rng.pick(STORY_NOW_BOSS), rng, {}).replace(/BOSS/g, bossName)
        : expand(rng.pick(STORY_NOW_GENERIC), rng, {});

    let builder = null, fall = null, now = null, text = '';
    if (completeness === 'full') {
        builder = pickTheme(rng, STORY_BUILDER, p.theme);
        fall = pickTheme(rng, STORY_FALL, p.theme);
        now = nowBeat();
        text = `These halls were raised by ${builder}. Then ${fall}. ${cap(now)}.`;
    } else {
        /* partial — one beat only: the builders OR the fall */
        if (rng.chance(0.5)) {
            builder = pickTheme(rng, STORY_BUILDER, p.theme);
            text = `These halls were raised by ${builder}.`;
        } else {
            fall = pickTheme(rng, STORY_FALL, p.theme);
            text = `Legend holds that ${fall}.`;
        }
    }

    const lore = { id: 'lore1', kind: 'lore', name: 'History', completeness, text };
    if (builder) lore.builder = builder;
    if (fall) lore.fall = fall;
    if (now) lore.now = now;

    /* full → echo the builders into 2-3 non-entrance rooms */
    if (completeness === 'full' && builder && roomsAll.length) {
        const cand = roomsAll
            .filter(r => !(r.tags || []).includes('entrance'))
            .sort((a, b) => idNum(a.id) - idNum(b.id));
        const k = Math.min(cand.length, rng.int(2, 3));
        for (const r of rng.shuffle(cand).slice(0, k)) {
            r.storyEcho = expand(rng.pick(ECHO_TPL), rng, {}).replace(/BUILDER/g, builder);
        }
    }

    return { lore, entities: [lore] };
}
