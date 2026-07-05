/* ------------------------------------------------------------------
 *  Dungeon content database + populate pass.
 *
 *  All authored English text lives here as tag-weighted tables (see
 *  grammar.js for the template syntax). populateDungeon() walks the
 *  rooms in fixed index order and attaches a structured `content`
 *  object to each — encounter / treasure / trap / hazard / dressing /
 *  hook — that describe.js turns into the LLM-facing prose.
 *
 *  Tables are tagged by dungeon THEME (crypt|ruins|stronghold|sewer|
 *  caves) and by 'any'.  A query like [mob#crypt] draws crypt- or
 *  any-tagged entries; user tags can override the *creature* theme
 *  independently of the layout theme (undead in a stronghold, etc.).
 *
 *  Determinism: no Date.now()/Math.random() — every pick comes from
 *  the seeded Rng handed to populateDungeon().
 * ------------------------------------------------------------------ */
import { expand } from './grammar.js';

/* Shorthand: tag every entry in `arr` with `tags` (strings → {t,tags}). */
const tag = (tags, arr) => arr.map(x => (typeof x === 'string' ? { t: x, tags } : { ...x, tags }));

export const TABLES = {
    /* -------- creatures: plural mobs -------- */
    mob: [
        ...tag(['crypt'], ['skeletal warriors', 'gaunt ghouls', 'grave-shades', 'clattering animated bones', 'crawling severed hands', 'shrouded tomb-guardians']),
        ...tag(['ruins'], ['giant spiders', 'feral goblins', 'a pack of lean wolves', 'chittering stirges', 'thorn-bound sprites', 'ragged bandit squatters']),
        ...tag(['stronghold'], ['mercenary sentries', 'hobgoblin soldiers', 'skeletal guards in mouldered livery', 'disciplined crossbowmen', 'a brace of war-hounds']),
        ...tag(['sewer'], ['swarming rats', 'wererat scavengers', 'blind cave-fishers', 'pallid filth-crawlers', 'bloated leeches the size of cats']),
        ...tag(['caves'], ['fluttering cave bats', 'giant centipedes', 'blind chalk-white crawlers', 'kobold miners', 'pallid cave-goblins']),
        ...tag(['any'], [{ t: 'dire rats', w: 2 }, 'restless dead', 'scuttling vermin']),
    ],
    /* -------- creatures: singular "boss" foes (article baked in) -------- */
    solo: [
        ...tag(['crypt'], ['a gaunt wraith wreathed in killing cold', 'a mummified priest-king', 'a bound revenant', 'a barrow-wight in corroded mail']),
        ...tag(['ruins'], ['a moss-covered troll', 'a great spider fat with old venom', 'a displaced ogre', 'an ancient guardian of cracked stone']),
        ...tag(['stronghold'], ['a scarred mercenary captain', 'a hobgoblin warlord', 'a long-dormant iron golem', "a knight's animated armour"]),
        ...tag(['sewer'], ['a bloated filth-beast', 'a scarred giant crocodile', 'a hulking wererat chieftain', 'a translucent devouring ooze']),
        ...tag(['caves'], ['a lumbering cave ogre', 'a fungal horror riddled with bursting spores', 'a blind cave-drake', 'a tentacled lurker in the ceiling-dark']),
        ...tag(['any'], ['a mad hermit who believes himself king of this place', 'a lone survivor gone feral']),
    ],
    qty: tag(['any'], ['a pair of', 'three', 'a handful of', 'a nest of', 'a shambling knot of', 'half a dozen', 'several', 'a pack of']),
    npc: tag(['any'], [
        'a terrified prisoner huddles in a rusted cage',
        'a wounded rival delver, wary but willing to parley',
        'a hermit who claims to ward this place against what lies deeper',
        "a merchant's shade, endlessly counting phantom coins",
    ]),

    /* -------- treasure, by tier -------- */
    treasure_low: tag(['any'], [
        'a scatter of tarnished coins', 'a cracked but serviceable shield',
        'mouldering supplies and a still-good waterskin', 'a bundle of usable torches and a flask of oil',
        'a rusted weapon that could be made to serve again', 'a few links of good chain and a sound iron key',
    ]),
    treasure_mid: [
        ...tag(['crypt'], ['a silver reliquary, tarnished but sound', 'an illuminated prayer-book worth a small fortune', 'a set of silver funerary censers']),
        ...tag(['stronghold'], ['a strongbox of old coinage', "a captain's signet and a purse of pay-silver"]),
        ...tag(['any'], ['a pouch heavy with cut gemstones', 'a finely made sword with a jewelled hilt', 'a rolled tapestry, faded but valuable', 'a merchant-scale and a bag of trade-silver']),
    ],
    treasure_high: [
        ...tag(['crypt'], ['a crown of blackened gold', 'a sceptre topped with a stone like a frozen eye']),
        ...tag(['stronghold'], ['a suit of armour that bears neither dust nor rust', 'a banner-spear said to rally the dead to service']),
        ...tag(['any'], [
            'a blade that hums with a faint, cold light', 'a ring set with a stone that never warms',
            'a sealed grimoire bound in strange, warm hide', 'a phial of something that glows like trapped daylight',
        ]),
    ],

    /* -------- traps: trigger + effect -------- */
    trap_trigger: tag(['any'], [
        'a tripwire at ankle height', 'a pressure plate under a loose flagstone', 'a false flagstone', 'a hidden trigger-rune',
        'a counterweighted step', 'a tension-wire strung across the arch',
    ]),
    trap_effect: [
        ...tag(['stronghold'], ['a gout of flame roars from a wall-vent', 'an alarm gong wakes the whole level']),
        ...tag(['sewer'], ['a sluice-gate slams open and the chamber floods fast']),
        ...tag(['crypt'], ['a choking cloud of grave-dust billows up']),
        ...tag(['any'], [
            'a scythe-blade sweeps the passage at waist height', 'a volley of darts hisses from the wall',
            'the floor drops away into a spiked pit', 'a slab of ceiling crashes down', 'a hook-weighted net drops from above',
        ]),
    ],

    /* -------- hazards (environmental), by theme -------- */
    hazard: [
        ...tag(['crypt'], ['the air hangs foul with grave-gas, thick enough to gutter a torch', 'the flagstones tilt over a collapsed vault below']),
        ...tag(['ruins'], ['the floor is a lattice of cracks over a lightless drop', 'a whole section of ceiling sags, ready to fall at a loud word']),
        ...tag(['stronghold'], ['an old oil-trench rings the floor beneath a gaping murder-hole', 'a portcullis hangs half-dropped on a frayed chain']),
        ...tag(['sewer'], ['flammable gas pools unseen up near the ceiling', 'the channel drops without warning into a drowned sump', 'the current here can drag a careless step under']),
        ...tag(['caves'], ['a fissure splits the floor, its depth swallowed by the dark', 'loose scree makes every step treacherous', 'a low pocket holds stale, breath-stealing air']),
        ...tag(['any'], ['a soft patch of floor betrays a hidden drop', 'the ceiling drips something that smokes where it lands']),
    ],

    /* -------- dressing (atmosphere), by theme -------- */
    dressing: [
        ...tag(['crypt'], ['burial niches gape empty in the walls', "a funeral fresco, the mourners' faces scratched away", 'wax has fossilised down the cold sconces', 'a sarcophagus lid lies cracked aside', "dust lies thick but for something's recent trail"]),
        ...tag(['ruins'], ['roots have pried the flagstones into a slow stone wave', 'a shattered statue, one hand still raised in warning', 'birdsong filters down through a hole in the ceiling', 'ivy has claimed the far wall entirely', 'a mosaic floor, half its tiles long gone']),
        ...tag(['stronghold'], ['a faded muster-roll is still nailed to the wall', 'weapon racks stand rusted and all but empty', 'a cold hearth wide enough to stand inside', 'boot-scuffed flagstones and the ghosts of old drill-marks', 'a war-banner rotted down to grey threads']),
        ...tag(['sewer'], ['the walls weep a constant film of slime', 'a rusted sluice-gate jammed forever half-open', 'the stench here settles like a physical weight', 'pale roots dangle from a cracked overhead pipe', 'the standing water wears a skin of grey scum']),
        ...tag(['caves'], ['pale fungus glows faintly in the seams of the rock', 'water drips in an endless, patient rhythm', 'crystals catch and scatter what little light there is', 'the walls run slick with cold condensation', 'old pick-marks scar one wall, the diggers long gone']),
        ...tag(['any'], ['old bloodstains, long since dried to brown', 'a cold draft breathes from somewhere unseen', 'deep gouges score the far wall', 'a scatter of clean-picked bones in one corner', 'the silence here has a waiting quality']),
    ],
};

/* Purpose-specific dressing — plain strings, picked directly (not via
 * tag-filter, so there's no cross-purpose fallback). */
export const PURPOSE_DRESS = {
    shrine: ['a defaced idol still faces the door', 'melted candle-stubs crowd a cracked altar'],
    treasury: ['iron-bound chests stand pried open and empty', 'a broken counting-scale and drifts of torn ledgers'],
    ossuary: ['skulls are stacked shoulder-high along every wall', 'bones lie sorted by kind in grim tidiness'],
    'hidden vault': ['a false wall stands a finger-width ajar', 'scratch-marks ring a hairline seam in the stone'],
    armory: ['empty weapon-stands wait in disciplined rows', 'a whetstone wheel furred over with rust'],
    'guard room': ['a table with abandoned dice and a spilled cup', 'an arrow-slit overlooks the corridor beyond'],
    'entry hall': ['a broken portcullis, its teeth sprung', 'cold torch-sconces flank a set of long-dead warning signs'],
};

const KEY_PATTERNS = [
    '{a rusted iron|a blackened bronze|a heavy brass|a notched steel} key {hangs on a nail here|lies buried in the debris|rests in the grip of a long-dead hand|sits at the bottom of a cracked urn} — it opens the locked %K% between rooms %A% and %B%',
    'among the clutter, {a ring of old keys|a single ornate key on a rotted cord} — one fits the locked %K% between rooms %A% and %B%',
];

const HOOK_PATTERNS = [
    "scratched into the wall: 'the way {down|out|deeper} lies past the {guarded|drowned|sealed} hall'",
    'a torn journal page warns of {the traps|the restless dead|the deep water|what guards the vault} ahead',
    'a crude map is daubed here in {chalk|soot|dried blood}, an X marking room %N%',
    "someone has scrawled, over and over: 'do not open the {iron|red|last} door'",
    "a dying scrawl, barely legible: 'it hears you in the dark — go quietly'",
];

const DANGER = { safe: 0, low: 1, medium: 2, deadly: 3 };
/* user creature-tags → which theme's mob/solo tables to draw from */
const CREATURE_TAG = { undead: 'crypt', haunted: 'crypt', bandits: 'stronghold', guards: 'stronghold', beasts: 'caves', vermin: 'sewer' };
const ENC_BASE = [0.15, 0.35, 0.55, 0.8];

/**
 * Fill each room's `content`. Mutates the room objects (adds `.content`).
 * @param {Array} rooms   room objects { i, purpose, w, h, flooded? }
 * @param {object} ctx    { theme, danger, tags:Set, entranceI, exitI, secretI, degree:number[] }
 * @param {import('../rng.js').Rng} rng  dedicated content stream
 */
export function populateDungeon(rooms, ctx, rng) {
    const { theme, danger = 'medium', tags = new Set(), entranceI, exitI, secretI, degree = [] } = ctx;
    const dN = DANGER[danger] ?? 2;
    const encTheme = [...tags].map(t => CREATURE_TAG[t]).find(Boolean) || theme;
    const empty = tags.has('empty');
    const richer = tags.has('treasure');
    const encMul = empty ? 0.4 : (tags.has('deadly') ? 1.3 : 1);
    const P = tpl => expand(tpl, rng, TABLES);

    for (const r of rooms) {
        const c = {};
        const isEntrance = r.i === entranceI;
        const isExit = r.i === exitI;
        const isSecret = r.i === secretI;
        const deg = degree[r.i] ?? 0;
        const deadEnd = deg <= 1 && !isEntrance;

        // ---- dressing (1-2 atmosphere lines) ----
        const dress = [P(`[dressing#${theme}]`)];
        const pflav = PURPOSE_DRESS[r.purpose];
        if (pflav && rng.chance(0.6)) dress.push(rng.pick(pflav));
        else if (rng.chance(0.4)) dress.push(P('[dressing#any]'));
        c.dressing = [...new Set(dress.filter(Boolean))];

        // ---- encounter ----
        let enc = null;
        const encChance = ENC_BASE[dN] * encMul;
        const want = isSecret ? dN > 0 : rng.chance((isEntrance ? 0.5 : 1) * encChance);
        if (want) {
            const bossy = isSecret || isExit || deg >= 3;
            if (dN === 0 && !isSecret) {
                enc = rng.chance(0.5)
                    ? P('[npc]')
                    : P(`signs of [mob#${encTheme}] — {gnawed bones and droppings|a fouled nest|fresh tracks in the dust} — but they are gone for now`);
            } else if (rng.chance(bossy ? 0.5 : 0.2)) {
                enc = P(`[solo#${encTheme}] {broods here in the dark|prowls this chamber|lies in wait|has made this place its lair}`);
            } else {
                enc = P(`[qty] [mob#${encTheme}] {lair here|nest in the {rubble|shadows|filth|dark}|prowl the chamber|are gathered here|stir at your approach}`);
            }
        }
        if (enc) c.encounter = enc;

        // ---- treasure ----
        let tier = null;
        if (isSecret) tier = 'high';
        else if (r.purpose === 'treasury' || r.purpose === 'hidden vault') tier = rng.chance(0.5) ? 'high' : 'mid';
        else if (r.purpose === 'shrine' || r.purpose === 'ossuary') tier = 'mid';
        else if (deadEnd && rng.chance(0.4)) tier = rng.chance(0.6) ? 'low' : 'mid';
        else if (enc && !isEntrance && rng.chance(0.25)) tier = 'low'; // guarded scraps
        if (richer && tier) tier = tier === 'low' ? 'mid' : 'high';
        else if (richer && rng.chance(0.3)) tier = 'mid';
        if (tier) c.treasure = P(`[treasure_${tier}]`);

        // ---- trap ----
        let trap = false;
        if (isSecret && dN > 0) trap = true;
        else if (c.treasure && rng.chance(0.2 + 0.15 * dN)) trap = true;
        else if (deadEnd && rng.chance(0.1 * dN)) trap = true;
        else if (tags.has('deadly') && rng.chance(0.2)) trap = true;
        if (trap && !isEntrance) c.trap = P('[trap_trigger] is rigged so that [trap_effect]');

        // ---- hazard ----
        if (r.flooded) {
            if (rng.chance(0.4)) c.hazard = P('[hazard#sewer]');
        } else {
            const hz = (theme === 'sewer' || theme === 'caves') ? 0.22 : 0.12;
            if (rng.chance(hz)) c.hazard = P(`[hazard#${theme}]`);
        }

        r.content = c;
    }

    // ---- key for the locked door/gate: always on the entrance side ----
    if (ctx.lock) {
        const kr = rooms.find(r => r.i === ctx.lock.keyRoomI);
        if (kr?.content) {
            const tpl = rng.pick(KEY_PATTERNS)
                .replace(/%K%/g, ctx.lock.kindWord)
                .replace(/%A%/g, String(ctx.lock.a + 1))
                .replace(/%B%/g, String(ctx.lock.b + 1));
            kr.content.key = expand(tpl, rng, TABLES);
        }
    }

    // ---- hooks: 1-2 narrative clues threaded through the level ----
    const nHooks = empty ? 1 : (dN >= 2 ? 2 : 1);
    const cand = rooms.filter(r => r.i !== entranceI && r.i !== exitI && r.i !== secretI);
    const targetNum = (secretI >= 0 ? secretI : (exitI >= 0 ? exitI : 0)) + 1;
    for (const r of rng.shuffle(cand).slice(0, Math.min(nHooks, cand.length))) {
        const tpl = rng.pick(HOOK_PATTERNS).replace('%N%', String(targetNum));
        r.content.hook = expand(tpl, rng, TABLES);
    }
}
