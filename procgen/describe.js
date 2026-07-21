/* ------------------------------------------------------------------
 *  Deterministic model → LLM-facing text.
 *
 *  describe(model) → { prose, ascii, json }
 *   - prose: token-dense structured English the AI reads
 *   - ascii: minimap (dungeon/interior only — grid-native maps)
 *   - json:  compact machine-readable model without bulky layers
 *
 *  No RNG here: fixed entity ordering ⇒ same model → same text.
 * ------------------------------------------------------------------ */
import { compass, oppositeDir, rleDecode, DIR_WORDS } from './schema.js';
import { BIOME_LABELS } from './names.js';

export function compactJson(model) {
    const { layers, ...rest } = model;
    return JSON.stringify(rest);
}

export function describe(model) {
    switch (model?.type) {
        case 'dungeon': return describeDungeon(model);
        case 'interior': return describeInterior(model);
        case 'region': return describeRegion(model);
        case 'town': return describeTown(model);
        case 'world': return describeWorld(model);
        default: return { prose: model?.name || '', ascii: null, json: model ? compactJson(model) : '{}' };
    }
}

const idNum = id => id.replace(/^\D+/, '');

function exitsOf(model, id) {
    const secretWord = model.params?.theme === 'caves' ? 'concealed passage' : 'secret door';
    return model.edges
        .filter(e => e.a === id || e.b === id)
        .map(e => {
            const other = e.a === id ? e.b : e.a;
            const dir = e.a === id ? e.dir : oppositeDir(e.dir);
            const kind = e.kind === 'secret' ? secretWord : e.kind;
            return `${dir}→${idNum(other)} (${kind}${e.locked ? ', locked' : ''})`;
        });
}

/** Compass word for an entity relative to the map center. */
function placeDir(model, x, y) {
    const cx = (model.size?.w ?? 100) / 2, cy = (model.size?.h ?? 100) / 2;
    if (Math.hypot(x - cx, y - cy) < Math.max(cx, cy) * 0.2) return 'center';
    return DIR_WORDS[compass(cx, cy, x, y)];
}

/* ------------------------------------------------------------------
 *  Dungeon
 * ------------------------------------------------------------------ */
function describeDungeon(model) {
    const rooms = model.entities
        .filter(e => e.kind === 'room')
        .sort((a, b) => Number(idNum(a.id)) - Number(idNum(b.id)));
    const entrance = rooms.find(r => r.tags?.includes('entrance'));
    const exit = rooms.find(r => r.tags?.includes('exit'));
    const theme = model.params.theme || 'crypt';

    const lines = [];
    lines.push(`== ${model.name} (dungeon, seed "${model.seed}", ${rooms.length} rooms) ==`);
    let ov = `Overview: A ${theme === 'caves' ? 'natural cave system' : `${theme} complex`} of ${rooms.length} chambers on one level.`;
    if (entrance) ov += ` The entrance (Room ${idNum(entrance.id)}) lies to the ${placeDir(model, entrance.x + entrance.w / 2, entrance.y + entrance.h / 2)}`;
    if (exit) ov += `; the deepest chamber (Room ${idNum(exit.id)}, ${exit.name}) lies to the ${placeDir(model, exit.x + exit.w / 2, exit.y + exit.h / 2)}`;
    ov += '.';
    const DANGER_TONE = {
        safe: 'The place seems long abandoned and largely safe.',
        low: 'Danger is light — scattered vermin and a few old traps.',
        medium: 'Danger is moderate; several chambers are still occupied.',
        deadly: 'This is a deadly place — expect guarded halls and lethal traps.',
    };
    ov += ' ' + (DANGER_TONE[model.params.danger] || DANGER_TONE.medium);
    const lockedE = model.edges.find(e => e.locked);
    if (lockedE) {
        ov += ` A locked ${lockedE.kind === 'gate' ? 'gate' : 'door'} between rooms ${idNum(lockedE.a)} and ${idNum(lockedE.b)} bars the way; its key is hidden in one of the chambers.`;
    }
    lines.push(ov);
    lines.push('', 'Rooms:');

    const MAX = 16;
    let main = rooms, rest = [];
    if (rooms.length > MAX) {
        // key/hook rooms must reach the AI even on huge maps
        const score = r => (r.tags?.length ? 100 : 0)
            + (r.content?.key ? 50 : 0) + (r.content?.hook ? 15 : 0)
            + exitsOf(model, r.id).length * 5 + r.w * r.h * 0.1;
        const ranked = [...rooms].sort((a, b) => score(b) - score(a));
        const keep = new Set(ranked.slice(0, MAX).map(r => r.id));
        main = rooms.filter(r => keep.has(r.id));
        rest = rooms.filter(r => !keep.has(r.id));
    }
    const SHAPE_WORD = { round: 'round', octagon: 'octagonal', cross: 'cross-shaped', columned: 'columned' };
    for (const r of main) {
        const exits = exitsOf(model, r.id);
        const tags = (r.tags || []).filter(t => t !== 'secret');
        const tagTxt = tags.length ? ` [${tags.join(', ')}]` : '';
        const shapeTxt = SHAPE_WORD[r.shape] ? ', ' + SHAPE_WORD[r.shape] : '';
        const c = r.content || {};
        const segs = [];
        if (r.notes) segs.push(r.notes);           // dressing + hazard + flags
        if (c.encounter) segs.push('foe: ' + c.encounter);
        if (c.treasure) segs.push('loot: ' + c.treasure);
        if (c.trap) segs.push('trap: ' + c.trap);
        if (c.key) segs.push('key: ' + c.key);
        if (c.hook) segs.push('clue: ' + c.hook);
        const body = segs.length ? ' — ' + segs.join('; ') : '';
        lines.push(`${idNum(r.id)}. ${r.name} (${r.w}x${r.h}${shapeTxt})${tagTxt}${body}. Exits: ${exits.join(', ') || 'none'}.`);
    }
    if (rest.length) {
        lines.push(`…plus ${rest.length} minor chambers (${rest.map(r => `${idNum(r.id)}: ${r.purpose}`).join(', ')}).`);
    }

    return { prose: lines.join('\n'), ascii: gridAscii(model), json: compactJson(model) };
}

/** ASCII minimap from layers.grid with room ids at centroids.
 *  New multi-floor interiors → one captioned map per floor, stacked;
 *  everything else (dungeon, legacy single-floor interior) → one map. */
function gridAscii(model) {
    if (model.type === 'interior' && model.layers?.floors?.length) {
        const floors = [...model.layers.floors].sort((a, b) => a.level - b.level);
        const blocks = [];
        for (const f of floors) {
            const block = gridAsciiOne(model, f.grid, true);
            if (block) blocks.push(`[${f.label}]\n${block}`);
        }
        return blocks.length ? blocks.join('\n\n') : null;
    }
    if (!model.layers?.grid) return null;
    return gridAsciiOne(model, model.layers.grid, !!model.layers.cellGrid);
}

/** Render one grid (RLE) to an ASCII block + legend. */
function gridAsciiOne(model, gridRle, isCellGrid) {
    if (!gridRle) return null;
    let rows = rleDecode(gridRle).map(r => r.split(''));
    if (!rows.length || !rows[0].length) return null;
    const wide = rows[0].length > 64;
    if (wide) rows = rows.map(row => row.filter((_, i) => i % 2 === 0));

    let legend;
    if (isCellGrid) {
        // interior grids already store the room letter in every cell
        legend = `legend: each char = 1 m of that room's floor (a=room 1, b=room 2…), # = outside${wide ? ' (compressed 2:1 horizontally)' : ''}`;
    } else {
        const rooms = model.entities.filter(e => e.kind === 'room');
        rooms.forEach((r) => {
            const label = (Number(idNum(r.id))).toString(36).toUpperCase();
            let cx = Math.floor(r.x + r.w / 2);
            const cy = Math.floor(r.y + r.h / 2);
            if (wide) cx = Math.floor(cx / 2);
            const row = rows[cy];
            if (!row) return;
            if (row[cx] === '<' || row[cx] === '>') cx += (row[cx + 1] && row[cx + 1] !== '#') ? 1 : -1;
            if (row[cx] && row[cx] !== '#') row[cx] = label;
        });
        legend = `legend: # wall, . floor, ~ water, + door, < entrance, > exit; room ids 1-9 then A=10, B=11…${wide ? ' (map compressed 2:1 horizontally)' : ''}`;
    }
    return rows.map(r => r.join('')).join('\n') + '\n' + legend;
}

/* ------------------------------------------------------------------
 *  Interior
 * ------------------------------------------------------------------ */
/* Floors of an interior model; legacy single-floor models (layers.grid,
 * no floors array) are synthesized into one Ground floor. */
function interiorFloors(model) {
    if (model.layers?.floors?.length) return [...model.layers.floors];
    return [{
        level: 0, label: 'Ground floor',
        grid: model.layers?.grid, outline: model.layers?.outline, cut: model.layers?.cut,
        w: model.size?.w, h: model.size?.h,
    }];
}

/* Prose display order: Ground floor, then Upper, then Cellar. */
function floorDisplayKey(level) {
    if (level === 0) return 0;
    if (level > 0) return level;         // upper floors ascend after ground
    return 100 - level;                  // cellars sink to the end
}

const INT_WEALTH_FLAVOR = { poor: 'a threadbare', average: 'a modest', wealthy: 'a well-appointed' };
const INT_CONDITION_CLAUSE = {
    abandoned: 'long abandoned — dust and cobwebs throughout',
    looted: 'ransacked — doors forced and valuables gone',
};
const NUM_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
function numberWord(n) { return NUM_WORDS[n] || String(n); }
function indefArticle(word) { return /^[aeiou]/i.test(word) ? 'an' : 'a'; }
function pluralize(word) {
    if (/(s|x|z|ch|sh)$/i.test(word)) return word + 'es';
    if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + 'ies';
    return word + 's';
}
const STAIR_OPP = { up: 'down', down: 'up' };

function describeInterior(model) {
    const rooms = model.entities
        .filter(e => e.kind === 'room')
        .sort((a, b) => Number(idNum(a.id)) - Number(idNum(b.id)));
    const kind = model.params.building || 'building';
    const condition = model.params.condition;
    const floors = interiorFloors(model);

    const lines = [];
    // 1) Header
    lines.push(`== ${model.name} (${kind} floor plan, seed "${model.seed}", ${rooms.length} rooms) ==`);

    // 2) Overview
    const wealth = INT_WEALTH_FLAVOR[model.params.wealth] || 'a modest';
    let ov = `Overview: ${capital(wealth)} ${kind}`;
    const condClause = INT_CONDITION_CLAUSE[condition];
    if (condClause) ov += `, ${condClause}`;
    if (floors.length > 1) {
        const labels = [...floors].sort((a, b) => a.level - b.level).map(f => (f.label || 'floor').toLowerCase());
        ov += `, spanning ${andList(labels)}`;
    }
    ov += '.';
    const entranceEdge = model.edges.find(e => e.b === 'street' || e.a === 'street');
    if (entranceEdge) {
        const roomId = entranceEdge.a === 'street' ? entranceEdge.b : entranceEdge.a;
        const room = rooms.find(r => r.id === roomId);
        const dir = entranceEdge.a === 'street' ? oppositeDir(entranceEdge.dir) : entranceEdge.dir;
        if (room) ov += ` The street entrance (${DIR_WORDS[dir] || dir} side) opens into the ${room.name}.`;
    }
    lines.push(ov);

    // 3) People
    const occupants = model.entities.filter(e => e.kind === 'occupant');
    if (occupants.length) {
        const owner = occupants[0];
        let line = `People: kept by ${owner.name} the ${owner.purpose}`;
        if (owner.notes) line += ` — ${owner.notes}`;
        const rest = occupants.slice(1);
        if (rest.length) {
            const byRole = new Map();
            for (const o of rest) byRole.set(o.purpose, (byRole.get(o.purpose) || 0) + 1);
            const parts = [...byRole].map(([role, n]) =>
                n === 1 ? `${indefArticle(role)} ${role}` : `${numberWord(n)} ${pluralize(role)}`);
            line += `; also ${andList(parts)} about`;
        }
        lines.push('', line + '.');
    } else if (model.layers?.formerOwner || model.formerOwner) {
        const fo = model.layers?.formerOwner || model.formerOwner;
        lines.push('', `Once kept by ${fo.name} the ${fo.role}; no one lives here now.`);
    }

    // 4/5) Rooms grouped by floor (display order), each floor capped at 12
    const roomExits = (r) => {
        const out = [];
        for (const e of model.edges) {
            if (e.a !== r.id && e.b !== r.id) continue;
            const other = e.a === r.id ? e.b : e.a;
            const dir = e.a === r.id ? e.dir : oppositeDir(e.dir);
            if (e.kind === 'stair') {
                const sdir = e.a === r.id ? (e.dir || 'up') : (STAIR_OPP[e.dir] || 'down');
                const o = rooms.find(x => x.id === other);
                out.push(`stairs ${sdir}→${other}${o ? ` (${o.name})` : ''}`);
                continue;
            }
            if (other === 'street') { out.push(`${dir}→street (door)${e.locked ? ' (locked)' : ''}`); continue; }
            const o = rooms.find(x => x.id === other);
            out.push(`${dir}→${idNum(other)}${o ? ` (${o.name})` : ''}${e.locked ? ' (locked)' : ''}`);
        }
        return out;
    };
    const roomLine = (r) => {
        let line = `${idNum(r.id)}. ${r.name} (${r.w}x${r.h})`;
        if (r.notes) line += ` — ${r.notes}`;
        line += '.';
        const c = r.content || {};
        if (c.valuables) line += ` ${c.valuables}`;
        if (c.secret) line += ` ${c.secret}`;
        if (c.key) line += ` ${c.key}`;
        const exits = roomExits(r);
        line += ` Doors: ${exits.join(', ') || 'none'}.`;
        return line;
    };
    const isSpecial = (r) => r.tags?.includes('entrance') || r.tags?.includes('stairs')
        || (r.content && (r.content.key || r.content.secret || r.content.hook));
    const score = (r) => {
        let sc = r.w * r.h * 0.1;
        if (r.tags?.includes('entrance')) sc += 100;
        if (r.tags?.includes('stairs')) sc += 100;
        if (r.content?.key) sc += 60;
        if (r.content?.secret) sc += 50;
        if (r.content?.hook) sc += 40;
        return sc;
    };

    const ordered = [...floors].sort((a, b) => floorDisplayKey(a.level) - floorDisplayKey(b.level));
    for (const f of ordered) {
        const fr = rooms.filter(r => (r.level ?? 0) === f.level);
        if (!fr.length) continue;
        let main = fr, rest = [];
        if (fr.length > 12) {
            const must = fr.filter(isSpecial);
            const others = fr.filter(r => !isSpecial(r)).sort((a, b) => score(b) - score(a));
            const keep = new Set(others.slice(0, Math.max(0, 12 - must.length)).map(r => r.id));
            main = fr.filter(r => isSpecial(r) || keep.has(r.id));
            rest = fr.filter(r => !main.includes(r));
        }
        lines.push('', `${f.label || 'Floor'}:`);
        for (const r of main) lines.push(roomLine(r));
        if (rest.length) lines.push(`…plus ${rest.length} more room${rest.length > 1 ? 's' : ''}.`);
    }

    // 6) Hook line last
    const hookRoom = rooms.find(r => r.content?.hook);
    if (hookRoom) lines.push('', `Something happened here: ${hookRoom.content.hook}`);

    return { prose: lines.join('\n'), ascii: gridAscii(model), json: compactJson(model) };
}

/* ------------------------------------------------------------------
 *  Region
 * ------------------------------------------------------------------ */
/** Widest point of a river (for ranking); tolerates 2-tuple pts. */
function riverSize(r) {
    let mw = 0;
    for (const p of r.pts) if (p.length > 2 && p[2] > mw) mw = p[2];
    return mw || r.pts.length;
}

const CLIMATE_CLAUSE = { cold: 'a cold northern land', hot: 'a hot southern land' };
const FLAVOR_SENTENCE = {
    wasteland: 'Much of it is parched wasteland.',
    volcanic: 'Volcanic activity scars the land with ash and cinders.',
    blighted: 'A creeping blight corrupts the wilds.',
};

function describeRegion(model) {
    const ents = model.entities;
    const settlements = ents.filter(e => e.kind === 'settlement');
    const pois = ents.filter(e => e.kind === 'poi');
    const rivers = ents.filter(e => e.kind === 'river');
    const lakes = ents.filter(e => e.kind === 'lake');
    const bridges = ents.filter(e => e.kind === 'bridge');
    const biomes = ents.filter(e => e.kind === 'biome');
    const riverById = new Map(rivers.map(r => [r.id, r]));
    const lakeById = new Map(lakes.map(l => [l.id, l]));
    const KM_PER_CELL = model.layers?.cellKm ?? 1.5;
    const KM_PER_DAY = 30;

    const lines = [];
    lines.push(`== ${model.name} (region map, seed "${model.seed}") ==`);
    const mask = model.params.mask || 'island';
    const landTxt = { island: 'An island landmass surrounded by open sea', coast: 'A coastal region', inland: 'An inland region' }[mask] || 'A region';
    let ov = `Overview: ${landTxt}`;
    const climateClause = CLIMATE_CLAUSE[model.params.climate];
    if (climateClause) ov += `, ${climateClause}`;
    ov += `, roughly ${Math.round(model.size.w * KM_PER_CELL)}x${Math.round(model.size.h * KM_PER_CELL)} km.`;
    const flavorSentence = FLAVOR_SENTENCE[model.params.flavor];
    if (flavorSentence) ov += ` ${flavorSentence}`;
    const named = biomes.filter(b => b.name).slice(0, 5);
    if (named.length) {
        ov += ` Notable features: ${named.map(b => `${b.name} (${BIOME_LABELS[b.purpose] || b.purpose}) in the ${placeDir(model, b.x, b.y)}`).join('; ')}.`;
    }
    lines.push(ov);

    if (settlements.length) {
        lines.push('', 'Settlements:');
        for (const s of settlements.slice(0, 8)) {
            let line = `- ${s.name} (${s.purpose}), in the ${placeDir(model, s.x, s.y)}`;
            if (s.tags?.length) line += `, ${s.tags.join(', ')}`;
            const others = settlements.filter(o => o !== s);
            if (others.length) {
                let nearest = others[0], nd = Infinity;
                for (const o of others) {
                    const d = Math.hypot(o.x - s.x, o.y - s.y);
                    if (d < nd) { nd = d; nearest = o; }
                }
                const days = Math.max(1, Math.round(nd * KM_PER_CELL / KM_PER_DAY));
                line += `; ~${days} day${days > 1 ? 's' : ''} ${DIR_WORDS[compass(s.x, s.y, nearest.x, nearest.y)]} to ${nearest.name}`;
            }
            lines.push(line + '.');
        }
        if (settlements.length > 8) lines.push(`…plus ${settlements.length - 8} smaller settlements.`);
    }

    if (pois.length) {
        lines.push('', 'Points of interest:');
        for (const p of pois.slice(0, 6)) {
            lines.push(`- ${p.name ? p.name + ', ' : ''}${p.purpose}, in the ${placeDir(model, p.x, p.y)}${p.notes ? ' — ' + p.notes : ''}.`);
        }
    }

    if (rivers.length) {
        // named rivers first, then the largest unnamed ones
        const namedRivers = rivers.filter(r => r.name);
        const unnamedRivers = rivers.filter(r => !r.name).sort((a, b) => riverSize(b) - riverSize(a));
        const riverList = [...namedRivers, ...unnamedRivers].slice(0, 5);
        lines.push('', 'Rivers:');
        for (const r of riverList) {
            const a = r.pts[0], b = r.pts[r.pts.length - 1];
            const tags = r.tags || [];
            let end;
            if (tags.includes('to-sea')) {
                if (tags.includes('delta')) end = 'reaches the sea in a broad delta';
                else if (tags.includes('estuary')) end = 'meets the sea in a wide estuary';
                else end = `flows ${DIR_WORDS[compass(a[0], a[1], b[0], b[1])]} into the sea`;
            } else {
                const toLake = tags.find(t => t.startsWith('to-lake:'));
                const trib = tags.find(t => t.startsWith('tributary:'));
                if (toLake && lakeById.has(toLake.slice(8))) {
                    end = `empties into ${lakeById.get(toLake.slice(8)).name || 'a lake'}`;
                } else if (trib) {
                    const parent = riverById.get(trib.slice(10));
                    end = parent && parent.name ? `joins ${parent.name}` : 'joins a larger river';
                } else {
                    end = `flows ${DIR_WORDS[compass(a[0], a[1], b[0], b[1])]} into the lowlands`;
                }
            }
            let line = `- ${r.name ? capital(r.name) : 'A river'} rises in the ${placeDir(model, a[0], a[1])} and ${end}`;
            if (r.name) {
                const n = rivers.filter(o => o.tags?.includes('tributary:' + r.id)).length;
                if (n > 0) line += `, fed by ${n} tributar${n > 1 ? 'ies' : 'y'}`;
            }
            lines.push(line + '.');
        }
    }

    if (lakes.length) {
        const namedLakes = lakes.filter(l => l.name);
        const unnamedLakes = lakes.filter(l => !l.name).sort((a, b) => (b.w || 0) - (a.w || 0)).slice(0, 2);
        const lakeList = [...namedLakes, ...unnamedLakes].slice(0, 4);
        if (lakeList.length) {
            lines.push('', 'Lakes:');
            for (const l of lakeList) {
                let line = `- ${l.name || 'A mountain lake'}, in the ${placeDir(model, l.x, l.y)}`;
                const feeder = rivers.find(r => r.name && r.tags?.includes('to-lake:' + l.id));
                if (feeder) line += `, fed by ${feeder.name}`;
                lines.push(line + '.');
            }
        }
    }

    const roadEdges = model.edges.filter(e => e.kind === 'road');
    if (roadEdges.length) {
        const byId = new Map(settlements.map(s => [s.id, s]));
        const roadLines = [];
        // k-th road edge ⇒ entity 'rd'+(k+1); bridges reference that id
        for (let k = 0; k < roadEdges.length && roadLines.length < 6; k++) {
            const e = roadEdges[k];
            const a = byId.get(e.a), b = byId.get(e.b);
            if (!a || !b) continue;
            const brs = bridges.filter(br => br.road === 'rd' + (k + 1));
            let clause = '';
            if (brs.length === 1) {
                const br = brs[0];
                const riv = br.river ? riverById.get(br.river) : null;
                const cross = riv && riv.name ? riv.name : 'the river';
                clause = `, crossing ${cross} by ${br.purpose === 'ford' ? 'a shallow ford' : 'a stone bridge'}`;
            } else if (brs.length > 1) {
                const fords = brs.filter(br => br.purpose === 'ford').length;
                const stone = brs.length - fords;
                const parts = [];
                if (stone > 0) parts.push(`${stone} bridge${stone > 1 ? 's' : ''}`);
                if (fords > 0) parts.push(`${fords} ford${fords > 1 ? 's' : ''}`);
                clause = `, crossing rivers by ${parts.join(' and ')}`;
            }
            roadLines.push(`- ${a.name}–${b.name}${clause}.`);
        }
        if (roadLines.length) lines.push('', 'Roads:', ...roadLines);
    }

    return { prose: lines.join('\n'), ascii: null, json: compactJson(model) };
}

/* ------------------------------------------------------------------
 *  Town
 * ------------------------------------------------------------------ */
const WEALTH_WORD = { poor: 'poor', average: 'modest', wealthy: 'prosperous' };
const TRADE_WORD = {
    farming: 'farming', trade: 'trading', fishing: 'fishing',
    mining: 'mining', garrison: 'garrison', temple: 'temple',
};
const SITE_CLAUSE = { hillside: 'built on a hillside', crossroads: 'grown around a crossroads' };
const CONDITION_SENTENCE = {
    declining: 'Trade has thinned and shutters stay closed.',
    ruined: 'Much of the town lies in ruin.',
};
/* District function → placename phrase; 'general' omits the parenthetical. */
const DISTRICT_FN_WORD = {
    docks: 'the docks', mining: 'the mining quarter', garrison: 'the garrison',
    temple: 'the temple quarter', trade: 'the market quarter', farming: 'the farmlands',
    noble: 'the noble quarter', slums: 'the slums',
};
/* Verb tying a resident to their landmark, by role. */
const RESIDENT_VERB = {
    priest: 'tended by', abbot: 'tended by',
    noble: 'held by', castellan: 'held by',
    captain: 'commanded by', elder: 'led by',
};

/** Join a list into "a", "a and b", or "a, b and c". */
function andList(arr) {
    if (arr.length <= 1) return arr[0] || '';
    if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
    return `${arr.slice(0, -1).join(', ')} and ${arr[arr.length - 1]}`;
}

function describeTown(model) {
    const ents = model.entities;
    const p = model.params || {};
    const landmarks = ents.filter(e => e.kind === 'landmark');
    const buildings = ents.filter(e => e.kind === 'building');
    const districts = ents.filter(e => e.kind === 'district');
    const roads = ents.filter(e => e.kind === 'road');
    const bridges = ents.filter(e => e.kind === 'bridge');
    const piers = ents.filter(e => e.kind === 'pier');
    const gates = ents.filter(e => e.kind === 'gate');
    const wall = ents.find(e => e.kind === 'wall');
    const river = ents.find(e => e.kind === 'river');
    const coast = ents.find(e => e.kind === 'coast');
    const plaza = ents.find(e => e.kind === 'plaza');
    const size = p.size || 'town';

    const lines = [];
    lines.push(`== ${model.name} (${size}, seed "${model.seed}") ==`);

    // 1) Overview
    const wealth = WEALTH_WORD[p.wealth] || 'modest';
    const trade = TRADE_WORD[p.trade];
    const n = landmarks.length + buildings.length;
    let ov = `Overview: A ${wealth}${trade ? ' ' + trade : ''} ${size} of ~${n} buildings`;
    const siteClause = SITE_CLAUSE[p.site];
    if (siteClause) ov += `, ${siteClause}`;
    if (river || p.water === 'river') ov += ', straddling a river';
    else if (coast || p.water === 'coast') ov += ', on the coast';
    if (wall) {
        const type = wall.type === 'stone' ? 'stone' : 'palisade';
        const dirs = gateDirs(gates, wall);
        ov += `, ringed by a ${type} wall`;
        if (dirs.length) ov += ` with gates to the ${andList(dirs)}`;
        if (wall.breaches?.length) ov += ', now breached in places';
    }
    ov += '.';
    const cond = CONDITION_SENTENCE[p.condition];
    if (cond) ov += ` ${cond}`;
    lines.push(ov);

    // 2) Landmarks (resident inline)
    if (landmarks.length) {
        lines.push('', 'Landmarks:');
        for (const l of landmarks.slice(0, 10)) {
            const label = l.name ? `${l.name} (${l.purpose})` : capital(l.purpose);
            let line = `- ${label}, ${plazaPos(plaza, l)}`;
            const r = l.resident;
            if (r) {
                const verb = RESIDENT_VERB[r.role] || 'kept by';
                line += ` — ${verb} ${r.name}${r.trait ? ', ' + r.trait : ''}`;
            } else if (l.notes) {
                line += ` — ${l.notes}`;
            }
            lines.push(line + '.');
        }
    }

    // 3) Districts
    if (districts.length) {
        lines.push('', 'Districts:');
        for (const d of districts.slice(0, 6)) {
            const fnWord = d.fn && d.fn !== 'general' ? DISTRICT_FN_WORD[d.fn] : null;
            lines.push(`- ${d.name}${fnWord ? ` (${fnWord})` : ''}, in the ${placeDir(model, d.x, d.y)}.`);
        }
    }

    // 4) Getting around
    const around = [];
    const gd = gateDirs(gates, wall);
    if (gd.length) around.push(`gates open to the ${andList(gd)}`);
    const outDirs = roadsOut(model, roads);
    if (outDirs.length) {
        around.push(`${outDirs.length} main road${outDirs.length > 1 ? 's' : ''} leave toward the ${andList(outDirs)}`);
    }
    if (bridges.length && river) {
        around.push(bridges.length === 1 ? 'a bridge crosses the river' : `${bridges.length} bridges cross the river`);
    }
    if (piers.length) around.push(`${piers.length === 1 ? 'a pier reaches' : piers.length + ' piers reach'} into the water`);
    if (around.length) lines.push('', 'Getting around: ' + capital(around.join('; ')) + '.');

    // 5) Condition (only when not thriving)
    if (p.condition && p.condition !== 'thriving') {
        const abandoned = buildings.filter(b => b.state === 'abandoned').length;
        const ruined = buildings.filter(b => b.state === 'ruined' || b.state === 'rubble').length;
        const parts = [];
        if (abandoned) parts.push(`${abandoned} building${abandoned > 1 ? 's' : ''} stand${abandoned > 1 ? '' : 's'} abandoned`);
        if (ruined) parts.push(`${ruined} lie${ruined > 1 ? '' : 's'} in ruin`);
        if (wall?.breaches?.length) parts.push(`the wall is breached in ${wall.breaches.length} place${wall.breaches.length > 1 ? 's' : ''}`);
        if (parts.length) lines.push('', 'Condition: ' + capital(andList(parts)) + '.');
    }

    return { prose: lines.join('\n'), ascii: null, json: compactJson(model) };
}

/** Gate compass words (gate entities preferred, wall.tags as fallback). */
function gateDirs(gates, wall) {
    const seen = new Set();
    const out = [];
    const add = d => { const w = DIR_WORDS[d] || d; if (d && !seen.has(w)) { seen.add(w); out.push(w); } };
    if (gates.length) for (const g of gates) for (const d of (g.tags || [])) add(d);
    else if (wall) for (const d of (wall.tags || [])) add(d);
    return out;
}

/** Legacy plaza-relative position phrasing for a landmark. */
function plazaPos(plaza, l) {
    if (!plaza) return 'near the center';
    const d = Math.hypot(l.x - plaza.x, l.y - plaza.y);
    if (d < 60) return 'on the market square';
    return `${d < 140 ? 'a short walk' : 'further out'} ${DIR_WORDS[compass(plaza.x, plaza.y, l.x, l.y)]} of the square`;
}

/** Compass dirs of main roads whose endpoints reach the map edge. */
function roadsOut(model, roads) {
    const w = model.size?.w ?? 100, h = model.size?.h ?? 100;
    const cx = w / 2, cy = h / 2;
    const m = Math.max(w, h) * 0.06;
    const seen = new Set();
    const out = [];
    for (const r of roads) {
        if (r.purpose !== 'main' || !r.pts?.length) continue;
        for (const q of [r.pts[0], r.pts[r.pts.length - 1]]) {
            if (q[0] <= m || q[0] >= w - m || q[1] <= m || q[1] >= h - m) {
                const word = DIR_WORDS[compass(cx, cy, q[0], q[1])];
                if (!seen.has(word)) { seen.add(word); out.push(word); }
                break;
            }
        }
    }
    return out;
}

/* ------------------------------------------------------------------
 *  World (nations, continents, seas, trade — a political gazetteer)
 * ------------------------------------------------------------------ */
const WORLD_LANDMASS = {
    pangea: 'a single vast supercontinent',
    continents: 'several continents',
    archipelago: 'scattered island chains',
    shattered: 'a shattered sea of islands',
};
const WORLD_CLIMATE = { iceage: ', gripped by an ice age', hot: ', sweltering under a merciless sun' };
const FLAVOR_WORDS = {
    maritime: 'seafaring', steppe: 'horse-lord', forest: 'woodland', desert: 'desert',
    mountain: 'mountain', fen: 'marsh', jungle: 'jungle', ashen: 'ash-born',
};
const REL_WORDS = { war: 'at war with', rivalry: 'rivals of', alliance: 'allied with', trade: 'trading with' };
const REL_ORDER = ['war', 'rivalry', 'alliance', 'trade'];

/** Relation clause for one nation, grouped by kind in a fixed order. */
function relationClauses(model, nation, nationById) {
    const byRel = { war: [], rivalry: [], alliance: [], trade: [] };
    for (const e of model.edges) {
        if (e.kind !== 'relation' || !byRel[e.rel]) continue;
        const other = e.a === nation.id ? e.b : (e.b === nation.id ? e.a : null);
        if (!other) continue;
        const on = nationById.get(other);
        if (on) byRel[e.rel].push(on.name);
    }
    const parts = [];
    for (const rel of REL_ORDER) if (byRel[rel].length) parts.push(`${REL_WORDS[rel]} ${byRel[rel].join(', ')}`);
    return parts.join('; ');
}

/** Resolve a route's two endpoint ids (capN/cK) to display names. */
function routeEnds(r, nameById) {
    return `${nameById.get(r.a) || r.a}–${nameById.get(r.b) || r.b}`;
}

/** Nearest nation whose centroid is within ~N/4 cells of (x,y), else null. */
function nearestNation(model, x, y, nations) {
    const thresh = Math.max(model.size?.w ?? 100, model.size?.h ?? 100) / 4;
    let best = null, bd = Infinity;
    for (const n of nations) {
        const d = Math.hypot(n.x - x, n.y - y);
        if (d < bd) { bd = d; best = n; }
    }
    return best && bd <= thresh ? best : null;
}

function describeWorld(model) {
    const ents = model.entities || [];
    const byKind = k => ents.filter(e => e.kind === k);
    const continents = byKind('continent');
    const seas = byKind('sea');
    const nations = byKind('nation');
    const capitals = byKind('capital');
    const cities = byKind('city');
    const rivers = byKind('river');
    const lakes = byKind('lake');
    const routes = byKind('route');
    const wonders = byKind('wonder');
    const ruins = byKind('ruin');
    const p = model.params || {};
    const KM_PER_CELL = model.layers?.cellKm ?? 40;

    const nationById = new Map(nations.map(n => [n.id, n]));
    const nameById = new Map();
    for (const e of ents) if (e.id) nameById.set(e.id, e.name || e.id);
    const capByNation = new Map();
    for (const c of capitals) if (c.nation) capByNation.set(c.nation, c);
    const citiesByNation = new Map();
    for (const c of cities) {
        if (!c.nation) continue;
        if (!citiesByNation.has(c.nation)) citiesByNation.set(c.nation, []);
        citiesByNation.get(c.nation).push(c);
    }

    const lines = [];
    lines.push(`== ${model.name} (world map, seed "${model.seed}") ==`);

    // Overview
    let ov = 'Overview: ' + (p.age === 'ancient'
        ? 'An ancient world scarred by fallen empires.'
        : 'A young world.');
    ov += ` It spans ${WORLD_LANDMASS[p.continents] || 'several continents'}`;
    if (WORLD_CLIMATE[p.climate]) ov += WORLD_CLIMATE[p.climate];
    const w = model.size?.w ?? 0, h = model.size?.h ?? 0;
    ov += `, roughly ${Math.round(w * KM_PER_CELL)}x${Math.round(h * KM_PER_CELL)} km.`;
    lines.push(ov);

    // Continents & Seas
    if (continents.length) {
        lines.push('', 'Continents:');
        for (const c of continents) lines.push(`- ${c.name}, in the ${placeDir(model, c.x, c.y)}.`);
    }
    if (seas.length) {
        lines.push('', 'Seas:');
        for (const s of seas) lines.push(`- ${s.name}, in the ${placeDir(model, s.x, s.y)}.`);
    }

    // Nations (the core — all of them, one line each)
    if (nations.length) {
        lines.push('', 'Nations:');
        for (const n of nations) {
            const flavor = FLAVOR_WORDS[n.purpose] || n.purpose || '';
            const gov = (n.tags || []).find(t => t !== 'coastal') || 'realm';
            let line = `- ${n.name}, a ${flavor} ${gov} (${placeDir(model, n.x, n.y)})`;
            const cap = capByNation.get(n.id);
            if (cap) line += `; capital ${cap.name}`;
            const myCities = citiesByNation.get(n.id) || [];
            const ports = myCities.filter(c => c.tags?.includes('port'));
            const towns = myCities.filter(c => !c.tags?.includes('port'));
            if (ports.length) line += `, ports: ${ports.map(c => c.name).join(', ')}`;
            if (towns.length) line += `; cities: ${towns.map(c => c.name).join(', ')}`;
            const rel = relationClauses(model, n, nationById);
            if (rel) line += `; ${rel}`;
            lines.push(line + '.');
        }
    }

    // Trade (up to 6, preferring to show both modes)
    const land = routes.filter(r => r.purpose === 'land');
    const sea = routes.filter(r => r.purpose === 'sea');
    if (land.length || sea.length) {
        const tradeLines = [];
        let li = 0, si = 0;
        while (tradeLines.length < 6 && (li < land.length || si < sea.length)) {
            const takeLand = li < land.length && (tradeLines.length % 2 === 0 || si >= sea.length);
            if (takeLand) tradeLines.push(`- Caravan road: ${routeEnds(land[li++], nameById)}.`);
            else if (si < sea.length) tradeLines.push(`- Sea lane: ${routeEnds(sea[si++], nameById)}.`);
        }
        if (tradeLines.length) lines.push('', 'Trade:', ...tradeLines);
    }

    // Rivers (top 4 named) + Lakes (named) — brief
    const namedRivers = rivers.filter(r => r.name).slice(0, 4);
    if (namedRivers.length) {
        lines.push('', 'Rivers:');
        for (const r of namedRivers) {
            const a = r.pts[0], b = r.pts[r.pts.length - 1];
            const end = (r.tags || []).includes('to-sea')
                ? 'to the sea'
                : `${DIR_WORDS[compass(a[0], a[1], b[0], b[1])]}`;
            lines.push(`- ${capital(r.name)}, from the ${placeDir(model, a[0], a[1])} flowing ${end}.`);
        }
    }
    const namedLakes = lakes.filter(l => l.name).slice(0, 4);
    if (namedLakes.length) {
        lines.push('', 'Lakes:');
        for (const l of namedLakes) lines.push(`- ${l.name}, in the ${placeDir(model, l.x, l.y)}.`);
    }

    // Wonders
    if (wonders.length) {
        lines.push('', 'Wonders:');
        for (const wo of wonders) {
            let line = `- ${wo.name} (${wo.purpose}), in the ${placeDir(model, wo.x, wo.y)}`;
            const near = nearestNation(model, wo.x, wo.y, nations);
            if (near) line += `, in the lands of ${near.name}`;
            lines.push(line + '.');
        }
    }

    // Ancient ruins
    if (ruins.length) {
        lines.push('', 'Ruins of a fallen age:');
        for (const r of ruins) {
            const nation = r.nation ? nationById.get(r.nation) : null;
            lines.push(`- ${r.name}, in ${nation ? nation.name : 'the wilds'}.`);
        }
    }

    // Travel footer
    const span = Math.max(w, h);
    const days = Math.max(1, Math.round(span * KM_PER_CELL / 120));
    lines.push('', `Travel: 1 map cell ≈ ${KM_PER_CELL} km; a caravan makes ~35 km/day, a ship ~120 km/day. Crossing the map ≈ ${days} days by sea.`);

    return { prose: lines.join('\n'), ascii: null, json: compactJson(model) };
}

function capital(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
