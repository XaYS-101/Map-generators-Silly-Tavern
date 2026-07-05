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

/** ASCII minimap from layers.grid with room ids at centroids. */
function gridAscii(model) {
    if (!model.layers?.grid) return null;
    let rows = rleDecode(model.layers.grid).map(r => r.split(''));
    const wide = rows[0].length > 64;
    if (wide) rows = rows.map(row => row.filter((_, i) => i % 2 === 0));

    let legend;
    if (model.layers.cellGrid) {
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
function describeInterior(model) {
    const rooms = model.entities
        .filter(e => e.kind === 'room')
        .sort((a, b) => Number(idNum(a.id)) - Number(idNum(b.id)));
    const kind = model.params.building || 'building';

    const lines = [];
    lines.push(`== ${model.name} (${kind} floor plan, seed "${model.seed}", ${rooms.length} rooms) ==`);
    const entranceEdge = model.edges.find(e => e.b === 'street' || e.a === 'street');
    let ov = `Overview: A single-story ${kind}, ${model.size.w}x${model.size.h} m.`;
    if (entranceEdge) {
        const roomId = entranceEdge.a === 'street' ? entranceEdge.b : entranceEdge.a;
        const room = rooms.find(r => r.id === roomId);
        const dir = entranceEdge.a === 'street' ? oppositeDir(entranceEdge.dir) : entranceEdge.dir;
        if (room) ov += ` The street entrance (${DIR_WORDS[dir] || dir} side) opens into the ${room.name}.`;
    }
    lines.push(ov, '', 'Rooms:');

    for (const r of rooms.slice(0, 12)) {
        const exits = model.edges
            .filter(e => e.a === r.id || e.b === r.id)
            .map(e => {
                const other = e.a === r.id ? e.b : e.a;
                const dir = e.a === r.id ? e.dir : oppositeDir(e.dir);
                if (other === 'street') return `${dir}→street (door)`;
                const o = rooms.find(x => x.id === other);
                return `${dir}→${idNum(other)}${o ? ` (${o.name})` : ''}`;
            });
        lines.push(`${idNum(r.id)}. ${r.name} (${r.w}x${r.h})${r.notes ? ' — ' + r.notes : ''}. Doors: ${exits.join(', ') || 'none'}.`);
    }
    if (rooms.length > 12) lines.push(`…plus ${rooms.length - 12} more rooms.`);

    return { prose: lines.join('\n'), ascii: gridAscii(model), json: compactJson(model) };
}

/* ------------------------------------------------------------------
 *  Region
 * ------------------------------------------------------------------ */
function describeRegion(model) {
    const ents = model.entities;
    const settlements = ents.filter(e => e.kind === 'settlement');
    const pois = ents.filter(e => e.kind === 'poi');
    const rivers = ents.filter(e => e.kind === 'river');
    const biomes = ents.filter(e => e.kind === 'biome');
    const KM_PER_CELL = model.layers?.cellKm ?? 1.5;
    const KM_PER_DAY = 30;

    const lines = [];
    lines.push(`== ${model.name} (region map, seed "${model.seed}") ==`);
    const mask = model.params.mask || 'island';
    const landTxt = { island: 'An island landmass surrounded by open sea', coast: 'A coastal region', inland: 'An inland region' }[mask] || 'A region';
    let ov = `Overview: ${landTxt}, roughly ${Math.round(model.size.w * KM_PER_CELL)}x${Math.round(model.size.h * KM_PER_CELL)} km.`;
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
        lines.push('', 'Rivers:');
        for (const r of rivers.slice(0, 4)) {
            const a = r.pts[0], b = r.pts[r.pts.length - 1];
            lines.push(`- ${r.name || 'A river'} rises in the ${placeDir(model, a[0], a[1])} and flows ${DIR_WORDS[compass(a[0], a[1], b[0], b[1])]} ${r.tags?.includes('to-sea') ? 'into the sea' : 'into the lowlands'}.`);
        }
    }

    const roads = model.edges.filter(e => e.kind === 'road');
    if (roads.length) {
        const byId = new Map(settlements.map(s => [s.id, s]));
        const roadTxt = roads.slice(0, 6)
            .map(e => {
                const a = byId.get(e.a), b = byId.get(e.b);
                return (a && b) ? `${a.name}–${b.name}` : null;
            })
            .filter(Boolean);
        if (roadTxt.length) lines.push('', `Roads connect: ${roadTxt.join(', ')}.`);
    }

    return { prose: lines.join('\n'), ascii: null, json: compactJson(model) };
}

/* ------------------------------------------------------------------
 *  Town
 * ------------------------------------------------------------------ */
function describeTown(model) {
    const ents = model.entities;
    const landmarks = ents.filter(e => e.kind === 'landmark');
    const buildings = ents.filter(e => e.kind === 'building');
    const districts = ents.filter(e => e.kind === 'district');
    const wall = ents.find(e => e.kind === 'wall');
    const river = ents.find(e => e.kind === 'river');
    const plaza = ents.find(e => e.kind === 'plaza');
    const size = model.params.size || 'town';

    const lines = [];
    lines.push(`== ${model.name} (${size}, seed "${model.seed}") ==`);
    let ov = `Overview: A ${size} of some ${landmarks.length + buildings.length} buildings`;
    if (model.params.water === 'river') ov += ', straddling a river';
    if (model.params.water === 'coast') ov += ', on the coast';
    if (wall) {
        const gates = (wall.tags || []).join(', ');
        ov += `, ringed by a wall${gates ? ` with gates to the ${gates}` : ''}`;
    }
    ov += '.';
    lines.push(ov);

    if (landmarks.length) {
        lines.push('', 'Landmarks:');
        for (const l of landmarks.slice(0, 10)) {
            let pos = 'near the center';
            if (plaza) {
                const d = Math.hypot(l.x - plaza.x, l.y - plaza.y);
                pos = d < 60 ? 'on the market square' : `${d < 140 ? 'a short walk' : 'further out'} ${DIR_WORDS[compass(plaza.x, plaza.y, l.x, l.y)]} of the square`;
            }
            lines.push(`- ${l.name ? `${l.name} (${l.purpose})` : capital(l.purpose)}, ${pos}${l.notes ? ' — ' + l.notes : ''}.`);
        }
    }

    if (districts.length) {
        lines.push('', 'Districts:');
        for (const d of districts.slice(0, 5)) {
            lines.push(`- ${d.name}, in the ${placeDir(model, d.x, d.y)}${d.notes ? ' — ' + d.notes : ''}.`);
        }
    }

    if (buildings.length) {
        lines.push('', `Besides these, some ${buildings.length} ordinary houses, shops and workshops line the streets.`);
    }

    return { prose: lines.join('\n'), ascii: null, json: compactJson(model) };
}

function capital(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
