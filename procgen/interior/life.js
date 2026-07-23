/* ------------------------------------------------------------------
 *  Building-interior "life" pass.
 *
 *  assignLife(rooms, opts) → { entities }.
 *
 *  Four probabilistic-presence layers laid over an already-populated
 *  building — visitors, one event, a menu, and rumors — each mirroring
 *  the dungeon inhabitants pattern: every layer draws from its OWN
 *  independent sub-stream so the presence of one never shifts another.
 *
 *  Stream discipline (rng.js):
 *    - root stream keys on `${seed}/life:${kind}` — condition and wealth
 *      are NOT in the key. Condition is gated by LOGIC (the live layers
 *      only fire when condition === 'lived-in'), so flipping a building
 *      lived-in → abandoned keeps the same latent life for that seed.
 *    - each layer owns a fixed sub-stream: .sub('visitors'),
 *      .sub('event'), .sub('menu'), .sub('rumors'); rolls are drawn in a
 *      fixed order within each so a layer's output is a pure function of
 *      the seed regardless of whether the others fired.
 *
 *  Reads the room objects but never mutates them. Deterministic: no
 *  Date.now()/Math.random(), only the passed seed streams.
 * ------------------------------------------------------------------ */
import { Rng } from '../rng.js';
import { expand } from '../content/grammar.js';
import { nameFor, RESIDENT_TRAITS } from '../names.js';

const idNum = id => parseInt(String(id).replace(/\D/g, ''), 10) || 0;
const byId = (a, b) => idNum(a.id) - idNum(b.id);

/* ---------------- layer 1: visitors ---------------- */

const VISITOR_PRESENCE = {
    tavern: 0.9, caravanserai: 0.85, temple: 0.7, shop: 0.6, barracks: 0.5,
    keep: 0.5, smithy: 0.5, manor: 0.4, mill: 0.4, warehouse: 0.3, house: 0.25,
};

/* Role pools — repetition IS the weight (a plain rng.pick over these). */
const VISITOR_ROLES = {
    tavern: ['patron', 'patron', 'patron', 'traveller', 'traveller', 'off-duty guard', 'bard'],
    caravanserai: ['merchant lodger', 'merchant lodger', 'drover', 'drover', 'traveller'],
    temple: ['worshipper', 'worshipper', 'worshipper', 'pilgrim', 'mourner'],
    shop: ['customer', 'customer', 'haggler'],
    warehouse: ['labourer', 'labourer', 'tally-clerk'],
    keep: ['messenger', 'envoy', 'petitioner'],
    barracks: ['recruit', 'recruit', 'messenger'],
    manor: ['petitioner', 'petitioner', 'guest'],
    mill: ['farmer'],
    house: ['neighbour'],
    smithy: ['forge customer'],
};

const NAMEABLE_ROLES = new Set(['patron', 'merchant lodger', 'bard', 'guest']);

/* Visitor trait pools (pick 1, avoid dupes per building where possible).
 * traveller / petitioner / messenger are shared across kinds by key;
 * manor 'guest' reuses RESIDENT_TRAITS.guest from names.js. */
const VISITOR_TRAITS = {
    patron: [
        'nurses the same ale past all reason',
        "argues last year's harvest like a battle lost",
        'buys rounds with coin nobody saw him earn',
        'laughs first and loudest at every telling',
        'watches the door between sips',
        'drinks against a slate already long',
        'sworn off the dice, currently rolling',
        'came in for one, four ago',
    ],
    traveller: [
        'boots still pale with road-dust',
        'asks every stranger about the road ahead',
        'eats like the next meal is not promised',
        'keeps the pack close and the knife closer',
        'pays in odd coin from somewhere far',
        'gives fewer answers than he collects',
    ],
    'off-duty guard': [
        'drinks with his back to the wall, off duty or not',
        'half out of uniform and wholly into the ale',
        "settles other men's quarrels out of habit",
        'grumbles about the sergeant to anyone still listening',
        'pretends not to notice things it would be work to notice',
    ],
    bard: [
        'tunes longer than he plays',
        'knows every ballad but the one requested',
        'plays for supper and sings for spite',
        "harvests the room's gossip verse by verse",
        "passes the hat with a general's timing",
        '"between patrons", as he puts it',
    ],
    worshipper: [
        'mouths the responses half a beat behind',
        'lights the same candle at the same hour daily',
        'prays loudly enough for the neighbours to note it',
        'bargains with the god in a whisper',
        'attends more faithfully than he believes',
    ],
    pilgrim: [
        'footsore, and proud of every mile',
        'carries a token worn smooth with thumbing',
        'under a vow he will not name',
        'sleeps wherever the floor allows',
        'measures every shrine against the one back home',
    ],
    mourner: [
        'wears borrowed black',
        'lights a candle and cannot seem to leave it',
        'weeps dry-eyed, the tears long since spent',
        'asks the priest questions with no good answers',
    ],
    customer: [
        'handles everything, buys little',
        'came for one thing, leaving with three',
        "quotes a rival's price from memory",
        'counts the change twice, slowly',
        'sent by a spouse, with a list and no discretion',
        'browses nearest the door, and the shopkeeper has noticed',
    ],
    haggler: [
        'has walked out twice already, and returned twice',
        'names half the asking price and holds the stare',
        'finds a flaw invented on the spot',
        'haggles for the sport more than the saving',
    ],
    'forge customer': [
        'come to collect a blade that is not ready',
        "watches the hammer-work like it's his coin ringing",
        'turns a new-forged knife over and over in the light',
        'argues the price of sharpening, never the work',
    ],
    'merchant lodger': [
        'inventories the room before unpacking it',
        'talks freight and tolls through every meal',
        "sleeps within arm's reach of his ledger",
        'pays for quiet and asks questions anyway',
        "counts the yard's wagons from the gallery each dawn",
        'trusts the keeper, tips the stablehand, watches both',
    ],
    drover: [
        'smells of oxen and long patience',
        'eats standing, out of habit',
        'slips out between courses to check the beasts',
        "knows the road's wells better than its lords",
        'saving every coin for a wagon of his own',
    ],
    'tally-clerk': [
        'counts aloud and hates interruption',
        'chalk behind one ear, ink on both hands',
        'suspects the ledger less than the men',
        'has found something he has not reported yet',
    ],
    labourer: [
        'stripped to shirtsleeves whatever the weather',
        'works to a chant half the bay has picked up',
        'rests exactly as long as no one is watching',
        'knows which crates ride light, and says nothing',
    ],
    petitioner: [
        'rehearses a grievance under his breath',
        'has waited since dawn and will wait longer',
        'clutches papers gone soft with handling',
        'was promised an answer last quarter-day',
        'has brought a gift, small, and visible',
    ],
    guest: RESIDENT_TRAITS.guest,
    messenger: [
        'mud to the knee, message first',
        'will not sit until it is delivered',
        'repeats the wording under his breath',
        'waits on a reply with the horse still saddled',
    ],
    envoy: [
        'travels with more retinue than message',
        'smiles as though the terms are already agreed',
        "admires the walls with a builder's eye, or a besieger's",
        'insists the visit is only a courtesy',
    ],
    recruit: [
        'boots too new, everything else too big',
        'salutes anything with a straight back',
        'homesick and hiding it badly',
        'polishes kit that has never seen mud',
        'volunteered, and is rethinking it',
    ],
    neighbour: [
        'brought a dish and a question',
        'borrows a tool and lends a rumour',
        'lingers at the door, half in, half out',
        'came about the fence, stayed for the fire',
        "knows the family's business a shade too well",
    ],
    farmer: [
        'sits on his sacks like a throne',
        "argues the miller's toll every season, and pays it every season",
        'watches his own grain into the hopper, personally',
        'talks weather the way priests talk scripture',
        'brought the eldest along to learn the waiting',
    ],
};

function visitorCount(rng, kind, wealth) {
    switch (kind) {
        case 'tavern': return rng.int(2, 4) + (wealth === 'wealthy' ? 1 : 0);
        case 'caravanserai': return rng.int(1, 4);
        case 'warehouse': return rng.int(1, 3);
        case 'temple': return rng.int(1, 3);
        case 'shop': case 'keep': return rng.int(1, 2);
        case 'barracks': case 'manor': case 'mill': return rng.int(0, 2);
        case 'house': case 'smithy': return rng.int(0, 1);
        default: return 0;
    }
}

/* ---------------- layer 2: event ---------------- */

const EVENT_CHANCE = {
    tavern: 0.6, caravanserai: 0.5, temple: 0.4, shop: 0.35, smithy: 0.35,
    barracks: 0.35, warehouse: 0.35, keep: 0.3, manor: 0.3, mill: 0.3, house: 0.3,
};

const EVENT_SCENES = {
    tavern: [
        { label: 'dice game', line: 'a dice game in the corner has gone too quiet to be friendly' },
        { label: 'brewing brawl', line: 'two {carters|boatmen|off-duty guards} are one insult from a brawl, and the room is picking sides' },
        { label: 'a long ballad', line: 'the bard is deep in a long ballad and the room, for once, is letting him finish' },
        { label: 'hooded stranger', line: 'a hooded stranger has taken the corner table and paid too much for the privilege' },
        { label: 'a toast', line: "someone's {betrothal|good harvest|firstborn} is being toasted well past sense" },
        { label: 'news from the road', line: 'the whole room has gone quiet to hear a traveller tell the news from down the road' },
    ],
    temple: [
        { label: 'a service', line: 'a service is under way, the responses rising and falling' },
        { label: 'funeral', line: 'a funeral has just come in behind a plain coffin, the bell still counting' },
        { label: 'festival dressing', line: 'the nave is being dressed for a festival — greenery, banners, and argument' },
        { label: 'a penitent', line: 'a penitent has been flat on the stones since dawn, and the priest has stopped suggesting he get up' },
    ],
    caravanserai: [
        { label: 'caravan arriving', line: 'a caravan is coming in — the courtyard is all beasts, bales, and shouting' },
        { label: 'caravan departing', line: 'a caravan musters to leave at first light; the drovers check every strap twice, swearing softly' },
        { label: 'partnership dissolved', line: 'two merchants are dissolving a partnership in public, bale by bale' },
        { label: 'road news', line: 'word of trouble on the road has the whole yard comparing routes and prices' },
    ],
    smithy: [
        { label: 'a rush order', line: "a rush order has the forge roaring — a lord's man waits, and keeps saying so" },
        { label: 'quench-testing', line: 'the smith is quench-testing blades and the customer flinches at every hiss' },
        { label: 'a botched weld', line: 'an apprentice is ruining a weld under muttered instruction' },
    ],
    shop: [
        { label: 'a bitter haggle', line: 'a haggle has gone past the price and into the personal' },
        { label: 'a loud return', line: 'a customer is returning something, loudly, with witnesses' },
        { label: 'a delivery', line: "a delivery is being counted in, twice, to nobody's satisfaction" },
    ],
    barracks: [
        { label: 'yard drill', line: "drill in the yard — a sergeant counts cadence like he's owed money" },
        { label: 'kit inspection', line: "kit inspection, and somebody's bedroll has just failed it" },
        { label: 'payday dice', line: 'pay has come, and the dice are out before the coin is warm' },
    ],
    manor: [
        { label: 'a dinner', line: 'a dinner is assembling — the servants move at a controlled run' },
        { label: 'unexpected guest', line: 'the household is being turned out to receive a guest nobody warned the cook about' },
        { label: 'the accounts', line: "the steward is taking the quarter's accounts, and someone will leave that room the poorer" },
    ],
    keep: [
        { label: 'audience day', line: 'audience day — petitioners queue the length of the hall, rehearsing' },
        { label: 'a rider arrives', line: 'a rider has just come in and the guard have gone tight-lipped' },
        { label: 'watch change', line: 'the watch is changing, all clatter and passwords' },
    ],
    warehouse: [
        { label: 'an audit', line: 'an inventory audit is under way, and a shortfall has just surfaced' },
        { label: 'a loading', line: "a wagon is loading against the light, and everyone's hurry shows" },
        { label: 'a manifest dispute', line: 'the tally-clerk and a carter are fighting through a manifest line by line' },
    ],
    mill: [
        { label: 'millstone repairs', line: 'the millstone is up on blocks and the miller is elbow-deep in the works, blaspheming quietly' },
        { label: 'grain queue', line: 'grain-carts queue in the yard, and the line is doing the tempers no good' },
    ],
    house: [
        { label: 'family supper', line: 'the family is at supper, one chair kept empty {out of custom|for someone late}' },
        { label: 'a quarrel', line: 'a quarrel over {money|the eldest|the fence} pauses politely at the sound of the door' },
    ],
};

/* ---------------- layer 3: menu ---------------- */

const BREW_FIRST = [
    'Blackroot', "Widow's", "Ferryman's", "Bishop's", "Hangman's", "Sexton's",
    "Mother's", 'Copper', 'Marsh', 'Winter', 'Drowned', 'Hedgerow', 'Gallows', 'Old Pike',
];
const BREW_SECOND = [
    'Bitter', 'Ruin', 'Stout', 'Mercy', 'Comfort', 'Courage',
    'Regret', 'Porter', 'Sting', 'Cordial', 'Warmer', 'Blessing',
];

const DISHES = {
    poor: [
        "grey pease-pottage that has met yesterday's",
        'barley stew, more barley than stew',
        'bread and dripping, the bread doing the heavy work',
        'thin fish soup on fish-days, thinner otherwise',
        'boiled turnip with a rumour of bacon',
        'oat porridge, salted if you ask nicely',
        "yesterday's loaf fried in today's fat",
    ],
    average: [
        'mutton stew with proper dumplings',
        'a game pie with a crust to be proud of',
        'roast fowl and bread sauce',
        'fried river-trout and a heel of brown bread',
        'pork sausages split and hissing from the pan',
        'a bacon-and-onion pudding, heavy as duty',
        'stewed eel with parsley, better than it sounds',
    ],
    wealthy: [
        'venison in a wine-dark sauce',
        'roast pheasant sent up dressed in its own plumage',
        'spiced capon glazed with honey',
        'a whole salmon poached in ale',
        'lamprey pie in the old style',
        'beef in pastry with a sauce the cook will not discuss',
    ],
};
const ROAD_DISHES = [
    'flatbread and spiced lentils off the brazier',
    'skewered mutton dusted with far-country spice',
    'dates, hard cheese, and road-bread',
    'a saffron-yellow rice the drovers queue for',
];

const SIDES = {
    poor: ['pickled cabbage', 'a heel of dark bread', 'hard cheese, harder biscuit', 'onions, boiled honest'],
    average: ['buttered roots', 'a fresh wheaten loaf', 'a wedge of tolerable cheese', 'stewed apples'],
    wealthy: ['white manchet bread', 'candied parsnips', 'olives come a long way', 'a dish of sugared almonds'],
};

const PRICES = {
    poor: ['1 cp', '2 cp'],
    average: ['3 cp', '5 cp'],
    wealthy: ['1 sp', '2 sp'],
};

const SECOND_DRINK = {
    poor: ['small beer'],
    average: ['small beer', 'wine, decent', 'wine, the good'],
    wealthy: ['wine, decent', 'wine, the good'],
};

const PRICE_LINES = {
    poor: [
        'a copper buys the stew and no questions',
        'two coppers the plate, bread included, complaints extra',
    ],
    average: [
        'a handful of coppers a plate, and worth most of them',
        'silver stretches to supper, a bed, and change',
    ],
    wealthy: [
        'silver-a-plate, and the plate is worth looking at',
        'prices named only after a look at your coat',
    ],
};

/* ---------------- layer 4: rumors ---------------- */

const RUMOR_CHANCE = { tavern: 0.75, caravanserai: 0.75, temple: 0.5, shop: 0.5 };

const RUMORS_SHARED = [
    'they say something has moved into the {old ruin|barrow|watchtower} {up the valley|on the ridge|past the ford}',
    'nothing has come down the {north|old|coast} road in {three days|a week} — not even the post-rider',
    'lights on the {hills|marsh|old walls} again these three nights, and no shepherd will own them',
    "{a woodcutter|the reeve's girl|a tinker|a whole out-farm family} has gone missing, and the search found only {a hat|cold fires|nothing at all}",
    "there's a feud ripening between {the miller and the smith|two old families|neighbouring farms} over {water|a boundary stone|a broken betrothal}",
    "treasure talk again: {a dying soldier|a drunk pedlar|somebody's grandfather} swore there's {coin|plate|a hoard} under the {old bridge|barrow|ruin}",
    'war talk from {the south|over the border|the coast} — levies counted and grain bought up quiet',
    'something has been at the {sheep|calves|hen-houses}, and the tracks are wrong for wolf',
    'a stranger has been asking after {old names|the ruin|a family long gone}, and paying well for answers',
    "the {ford|high pass|crossroads} is watched, they say — tolls taken by men wearing no lord's badge",
    '{smoke|riders|fires} seen on the {ridge|moor} where nobody has business being',
    'the well at {an out-farm|the crossroads} has {turned foul|gone strange}, and the priest was sent for',
    'a {drover|pedlar} swears he heard bells from under the {lake|mire}, and he was sober, mostly',
    'old debts are being called in all over town, and nobody will name the creditor',
];

const RUMORS_EXTRA = {
    tavern: [
        'a man paid his whole slate in old coin, minted for no king anyone can name',
        "the cellar delivery came one barrel heavy, and the carter won't take it back",
    ],
    temple: [
        'the {sexton|old priest} will not go into the crypt after dark, and will not say why',
        'the offering box came up fuller than the congregation could account for',
    ],
    shop: [
        'someone has been buying up {rope|lamp-oil|salt} in every shop in town, and paying without haggling',
    ],
    caravanserai: [
        'a caravan came in {two guards short|a wagon light} and nobody in it is talking',
    ],
};

/* ------------------------------------------------------------------ */

/**
 * @param {Array} rooms  { id, level, name, purpose, tags, x, y, w, h } — READ ONLY.
 * @param {object} opts  { kind, size, wealth, condition, seed, entranceId, occupants }
 * @returns {{ entities: Array }}  visitors (vi*), event (ev1), menu (menu1), rumors (ru*).
 */
export function assignLife(rooms, opts) {
    const {
        kind, wealth = 'average', condition = 'lived-in', seed,
        entranceId, occupants = [],
    } = opts;
    const lived = condition === 'lived-in';

    const rng = new Rng(`${seed}/life:${kind}`);

    const roomById = new Map((rooms || []).map(r => [r.id, r]));
    const levelOf = id => (roomById.get(id)?.level ?? 0);
    const roomsByPurpose = p => (rooms || []).filter(r => r.purpose === p).sort(byId);

    const visitors = [];
    let event = null;
    let menu = null;
    const rumors = [];

    /* ------------------ layer 1: visitors (lived-in only) ------------------ */
    if (lived && VISITOR_PRESENCE[kind] != null) {
        const visRng = rng.sub('visitors');
        if (visRng.chance(VISITOR_PRESENCE[kind])) {
            const count = visitorCount(visRng, kind, wealth);
            const roles = VISITOR_ROLES[kind] || [];
            const rolesNoBard = roles.filter(r => r !== 'bard');
            let hasBard = false;
            let lodgerRR = 0;
            const usedTraits = {};   // role → Set of drawn trait strings

            for (let i = 0; i < count && roles.length; i++) {
                // role
                let role = visRng.pick(roles);
                if (role === 'bard') {
                    if (hasBard) role = visRng.pick(rolesNoBard.length ? rolesNoBard : roles);
                    else hasBard = true;
                }
                // placement (deterministic, no rng draw)
                let room = entranceId;
                if (kind === 'caravanserai' && role === 'merchant lodger') {
                    const gr = roomsByPurpose('guest room');
                    if (gr.length) { room = gr[lodgerRR % gr.length].id; lodgerRR++; }
                } else if (kind === 'caravanserai' && role === 'drover') {
                    const cy = roomsByPurpose('courtyard');
                    if (cy.length) room = cy[0].id;
                } else if (kind === 'manor' && role === 'guest') {
                    const g = (rooms || []).filter(r => /guest|dining/.test(r.purpose || '')).sort(byId);
                    if (g.length) room = g[0].id;
                }
                // name (roll chance first, then name, on this same stream)
                let name = null;
                if (NAMEABLE_ROLES.has(role)) {
                    if (visRng.chance(0.6)) name = nameFor(visRng, 'person');
                }
                // notes: one trait, avoiding dupes within the building where the pool allows
                const pool = VISITOR_TRAITS[role] || [];
                let notes = '';
                if (pool.length) {
                    const used = usedTraits[role] || (usedTraits[role] = new Set());
                    let avail = pool.filter(t => !used.has(t));
                    if (!avail.length) avail = pool;
                    notes = visRng.pick(avail);
                    used.add(notes);
                }
                visitors.push({
                    id: 'vi' + (i + 1), kind: 'occupant', name, purpose: role,
                    room, level: levelOf(room), notes, tags: ['visitor'],
                });
            }
        }
    }

    /* ------------------ layer 2: event (lived-in only, max 1) ------------------ */
    if (lived && EVENT_CHANCE[kind] != null) {
        const evRng = rng.sub('event');
        if (evRng.chance(EVENT_CHANCE[kind])) {
            const scenes = EVENT_SCENES[kind] || [];
            if (scenes.length) {
                const scene = evRng.pick(scenes);
                const line = expand(scene.line, evRng, {});
                event = {
                    id: 'ev1', kind: 'event', name: scene.label,
                    room: entranceId, level: levelOf(entranceId), notes: line,
                };
            }
        }
    }

    /* ------------------ layer 3: menu (tavern + caravanserai only) ------------------ */
    if (kind === 'tavern' || kind === 'caravanserai') {
        const menuRng = rng.sub('menu');
        if (lived) {
            const tier = PRICES[wealth] ? wealth : 'average';
            const priceOf = () => menuRng.pick(PRICES[tier]);

            // house brew name
            const first = menuRng.pick(BREW_FIRST);
            const second = menuRng.pick(BREW_SECOND);
            const prefix = menuRng.chance(0.4) ? 'the ' : '';
            const brew = prefix + first + ' ' + second;

            // house dish (caravanserai mixes in road extras at any tier)
            const dishPool = (DISHES[tier] || DISHES.average)
                .concat(kind === 'caravanserai' ? ROAD_DISHES : []);
            const dish = menuRng.pick(dishPool);

            // food: house dish first, then 1-2 tier sides (no dupes)
            const food = [{ t: dish, price: priceOf() }];
            const sidePool = SIDES[tier] || SIDES.average;
            const sideCount = menuRng.int(1, 2);
            const usedSides = new Set();
            for (let i = 0; i < sideCount; i++) {
                let avail = sidePool.filter(s => !usedSides.has(s));
                if (!avail.length) avail = sidePool;
                const s = menuRng.pick(avail);
                usedSides.add(s);
                food.push({ t: s, price: priceOf() });
            }

            // drink: house brew first, then optionally a second
            const drink = [{ t: brew, price: priceOf() }];
            if (menuRng.chance(0.6)) {
                const dp = SECOND_DRINK[tier] || SECOND_DRINK.average;
                drink.push({ t: menuRng.pick(dp), price: priceOf() });
            }

            const notes = menuRng.pick(PRICE_LINES[tier] || PRICE_LINES.average);

            menu = {
                id: 'menu1', kind: 'menu', room: entranceId,
                house: { brew, dish }, food, drink, tags: [wealth], notes,
            };
        } else {
            // abandoned / looted → a faded relic slate, sometimes
            if (menuRng.chance(0.4)) {
                menu = {
                    id: 'menu1', kind: 'menu', room: entranceId, tags: ['relic'],
                    notes: expand(
                        "a faded slate still lists {the day's stew|ale by the pot|beds, clean straw} at prices from a better year",
                        menuRng, {}),
                };
            }
        }
    }

    /* ------------------ layer 4: rumors (lived-in only) ------------------ */
    if (lived) {
        const ruRng = rng.sub('rumors');
        const chance = RUMOR_CHANCE[kind] ?? 0.35;
        if (ruRng.chance(chance)) {
            const count = (kind === 'tavern' || kind === 'caravanserai')
                ? ruRng.int(2, 3) : ruRng.int(1, 2);

            // carriers: owner (weight 2 for temple/tavern/shop) + all visitors
            // (weight 1, patrons weight 2 in a tavern)
            const candidates = [];
            const owner = occupants[0];
            if (owner) {
                const ow = (kind === 'temple' || kind === 'tavern' || kind === 'shop') ? 2 : 1;
                candidates.push([owner.id, ow]);
            }
            for (const v of visitors) {
                const w = (kind === 'tavern' && v.purpose === 'patron') ? 2 : 1;
                candidates.push([v.id, w]);
            }

            if (candidates.length) {
                const templates = RUMORS_SHARED.concat(RUMORS_EXTRA[kind] || []);
                const usedTpl = new Set();
                for (let i = 0; i < count; i++) {
                    const carrier = ruRng.weighted(candidates);
                    let avail = templates.filter(t => !usedTpl.has(t));
                    if (!avail.length) avail = templates;
                    const tpl = ruRng.pick(avail);
                    usedTpl.add(tpl);
                    rumors.push({
                        id: 'ru' + (i + 1), kind: 'rumor', carrier,
                        notes: expand(tpl, ruRng, {}),
                    });
                }
            }
        }
    }

    const entities = [
        ...visitors,
        ...(event ? [event] : []),
        ...(menu ? [menu] : []),
        ...rumors,
    ];
    return { entities };
}
