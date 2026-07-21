/* ------------------------------------------------------------------
 *  Generator popups: local canvas popup, Watabou iframe popup,
 *  the generator picker and the shared "new map" flow.
 * ------------------------------------------------------------------ */
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from '../../../../popup.js';

import { GENERATORS, CUSTOM_KEY, buildUrl, parseUrl, randomSeed } from '../core/generators.js';
import * as Local from '../procgen/index.js';
import { t } from '../core/i18n.js';
import { getSettings, toast } from '../core/settings.js';
import { newId } from '../core/store.js';

/** Build a fresh saved-map object for a local (procgen) generator, with the
 *  auto title / thumbnail / description all derived from the model. Shared by
 *  the local generator popup and the world→region zoom picker. */
function buildLocalMapObject(generatorKey, seed, params) {
    const def = GENERATORS[generatorKey];
    const probe = { generator: generatorKey, seed, params };
    return {
        id: newId(),
        generator: generatorKey,
        title: Local.mapName(probe) || `${def?.label || generatorKey} ${seed}`,
        url: '', seed, params,
        thumbnail: Local.getThumbDataUrl(probe),
        description: Local.describeMap(probe),
        descSource: 'local',
        localVersion: 1,
        memory: { mode: 'none', lorebook: null, entryUid: null, depth: getSettings().defaultDepth },
    };
}

/* ------------------------------------------------------------------
 *  Local generator popup (canvas preview, no iframe)
 * ------------------------------------------------------------------ */
async function openLocalGeneratorPopup(generatorKey, existingMap = null) {
    const def = GENERATORS[generatorKey];
    if (!def) return null;

    let seed = existingMap?.seed ?? randomSeed();

    const $wrap = $('<div class="mg-genpopup mg-local"></div>');
    const $bar = $('<div class="mg-bar"></div>');
    const $seed = $('<input type="text" class="text_pole mg-seed" />').val(String(seed));
    const $rand = $(`<button class="menu_button" title="${t('gen_random')}">🎲</button>`);
    $bar.append($('<span class="mg-ctl mg-seedwrap"></span>').append($(`<span>${t('gen_seed')}</span>`), $seed, $rand));

    // Clickable tag chips for a text field: toggle keywords in the input so
    // nobody has to memorize the tag vocabulary. Exclusive groups (sizes,
    // loops/linear) clear their siblings on pick.
    function buildChipRow(f, $input) {
        const parse = () => new Set(String($input.val()).toLowerCase()
            .split(/[,\s]+/).map(x => x.trim()).filter(Boolean));
        const $row = $('<div class="mg-chips"></div>');
        const $chips = f.chips.map(tag => $('<span class="mg-chip"></span>').text(tag).attr('data-tag', tag));
        const sync = () => {
            const set = parse();
            for (const $ch of $chips) $ch.toggleClass('on', set.has($ch.attr('data-tag')));
        };
        for (const $ch of $chips) {
            $ch.on('click', () => {
                const tag = $ch.attr('data-tag');
                const set = parse();
                if (set.has(tag)) {
                    set.delete(tag);
                } else {
                    for (const group of f.chipExclusive || []) {
                        if (group.includes(tag)) for (const g of group) set.delete(g);
                    }
                    set.add(tag);
                }
                $input.val([...set].join(', '));
                sync();
                refresh();
            });
            $row.append($ch);
        }
        $input.on('input change', sync);
        sync();
        return $row;
    }

    const controls = [];
    const chipRows = [];
    for (const f of def.paramSchema || []) {
        const cur = existingMap?.params?.[f.k] ?? f.def;
        let $c;
        if (f.type === 'select') {
            $c = $('<select class="text_pole mg-param"></select>');
            for (const o of f.opts) $c.append($('<option></option>').val(o).text(o));
            $c.val(String(cur));
        } else if (f.type === 'range') {
            $c = $(`<input type="range" min="${f.min}" max="${f.max}" step="${f.step}" class="mg-param" />`).val(cur);
        } else if (f.type === 'text') {
            $c = $('<input type="text" class="text_pole mg-param" />').val(cur == null ? '' : String(cur));
            if (f.ph) $c.attr('placeholder', t(f.ph));
            if (f.chips?.length) chipRows.push(buildChipRow(f, $c));
        } else {
            $c = $('<input type="checkbox" class="mg-param" />').prop('checked', !!cur);
        }
        controls.push({ f, $c });
        if (f.type === 'bool') {
            $bar.append($('<label class="mg-radio"></label>').append($c, document.createTextNode(' ' + t(f.i18n))));
        } else {
            $bar.append($('<span class="mg-ctl"></span>').append($(`<span>${t(f.i18n)}</span>`), $c));
        }
    }

    const $img = $('<img class="mg-local-preview" alt="map preview" />');

    function currentParams() {
        const p = {};
        for (const { f, $c } of controls) {
            if (f.type === 'bool') p[f.k] = $c.prop('checked');
            else if (f.type === 'range') p[f.k] = Number($c.val());
            else p[f.k] = String($c.val());
        }
        return p;
    }
    function refresh() {
        try {
            const src = Local.getRenderDataUrl({ generator: generatorKey, seed, params: currentParams() });
            if (src) $img.attr('src', src);
        } catch (e) {
            console.error('[MapGenerators] local render failed', e);
        }
    }
    $rand.on('click', () => { seed = randomSeed(); $seed.val(String(seed)); refresh(); });
    $seed.on('change', () => { seed = String($seed.val()).trim() || seed; refresh(); });
    for (const { $c } of controls) $c.on('change', refresh);

    $wrap.append($bar, ...chipRows, $img);
    refresh();

    const result = await callGenericPopup($wrap, POPUP_TYPE.CONFIRM, '', {
        wide: true, large: true, wider: true, allowVerticalScrolling: true,
        okButton: t('gen_save'), cancelButton: 'Close',
    });
    if (result !== POPUP_RESULT.AFFIRMATIVE) return null;

    const params = currentParams();
    const probe = { generator: generatorKey, seed, params };
    if (existingMap) {
        existingMap.seed = seed;
        existingMap.params = params;
        existingMap.url = '';
        existingMap.thumbnail = Local.getThumbDataUrl(probe);
        if (existingMap.descSource === 'local' || !String(existingMap.description || '').trim()) {
            existingMap.description = Local.describeMap(probe);
            existingMap.descSource = 'local';
        }
        return existingMap;
    }
    return buildLocalMapObject(generatorKey, seed, params);
}

/* ------------------------------------------------------------------
 *  Watabou generator popup (the live iframe)
 * ------------------------------------------------------------------ */
export async function openGeneratorPopup(generatorKey, existingMap = null) {
    const def = GENERATORS[generatorKey];
    if (!def) return;

    // Built-in procedural generators render locally — separate popup.
    if (def.embed === 'local') return openLocalGeneratorPopup(generatorKey, existingMap);

    // itch.io tools: no URL/seed state and framing is unreliable, so we
    // present a launch card instead of an embedded (likely-blocked) iframe.
    if (def.embed === 'itch') {
        const $w = $('<div class="mg-itchcard"></div>');
        $w.append($(`<p>${t('itch_note')}</p>`));
        $w.append($(`<a class="menu_button" target="_blank" rel="noopener" href="${def.base}">${t('gen_open_new')}</a>`));
        const r = await callGenericPopup($w, POPUP_TYPE.CONFIRM, '', {
            wide: true, okButton: t('gen_save'), cancelButton: 'Close',
        });
        if (r !== POPUP_RESULT.AFFIRMATIVE) return null;
        if (existingMap) { existingMap.url = def.base; return existingMap; }
        return {
            id: newId(), generator: generatorKey, title: def.label,
            url: def.base, seed: null, params: {},
            thumbnail: null, description: '', descSource: 'manual',
            memory: { mode: 'none', lorebook: null, entryUid: null, depth: getSettings().defaultDepth },
        };
    }

    let seed = existingMap?.seed ?? randomSeed();
    const params = structuredClone(existingMap?.params ?? {});

    const $wrap = $('<div class="mg-genpopup"></div>');
    const $bar = $('<div class="mg-bar"></div>');

    const $seed = $(`<input type="text" class="text_pole mg-seed" />`).val(String(seed));
    const $rand = $(`<button class="menu_button" title="${t('gen_random')}">🎲</button>`);
    $bar.append($(`<span>${t('gen_seed')}</span>`), $seed, $rand);

    let $size, $tags;
    if (def.params.includes('size')) {
        $size = $(`<input type="number" class="text_pole mg-size" min="6" max="60" style="width:5em" />`).val(params.size ?? 15);
        $bar.append($(`<span>${t('gen_size')}</span>`), $size);
    }
    if (def.params.includes('tags')) {
        const ph = def.tagHint || t('gen_tags');
        $tags = $(`<input type="text" class="text_pole mg-tags" title="${t('gen_tags')}" placeholder="${ph}" />`).val((params.tags || []).join?.(',') ?? params.tags ?? '');
        $bar.append($tags);
    }

    const $frame = $(`<iframe class="mg-frame" referrerpolicy="no-referrer"></iframe>`);
    const $paste = $(`<input type="text" class="text_pole mg-paste" placeholder="${t('gen_paste')}" />`);
    const $newtab = $(`<a class="menu_button" target="_blank" rel="noopener">${t('gen_open_new')}</a>`);

    function currentParams() {
        const p = {};
        if ($size) p.size = Number($size.val()) || undefined;
        if ($tags) {
            const tg = String($tags.val()).split(',').map(s => s.trim()).filter(Boolean);
            if (tg.length) p.tags = tg;
        }
        return p;
    }
    function refresh() {
        const url = buildUrl(generatorKey, seed, currentParams());
        $frame.attr('src', url);
        $newtab.attr('href', url);
    }
    $rand.on('click', () => { seed = randomSeed(); $seed.val(String(seed)); refresh(); });
    $seed.on('change', () => { seed = $seed.val().trim() || seed; refresh(); });
    $size?.on('change', refresh);
    $tags?.on('change', refresh);
    $paste.on('change', () => {
        const parsed = parseUrl($paste.val().trim());
        if (parsed.seed) { seed = parsed.seed; $seed.val(String(seed)); }
        if (parsed.params.size && $size) $size.val(parsed.params.size);
        if (parsed.params.tags && $tags) $tags.val(parsed.params.tags);
        refresh();
    });

    $wrap.append($bar, $frame, $('<div class="mg-row"></div>').append($paste, $newtab));
    refresh();

    const result = await callGenericPopup($wrap, POPUP_TYPE.CONFIRM, '', {
        wide: true, large: true, wider: true, allowVerticalScrolling: true,
        okButton: t('gen_save'), cancelButton: 'Close',
    });
    if (result !== POPUP_RESULT.AFFIRMATIVE) return null;

    // Build / update the map object from the state WE own.
    const url = buildUrl(generatorKey, seed, currentParams());
    if (existingMap) {
        existingMap.seed = seed;
        existingMap.params = currentParams();
        existingMap.url = url;
        return existingMap;
    }
    return {
        id: newId(),
        generator: generatorKey,
        title: `${def.label} ${seed}`,
        url, seed, params: currentParams(),
        thumbnail: null,
        description: '',
        descSource: 'manual',
        memory: { mode: 'none', lorebook: null, entryUid: null, depth: getSettings().defaultDepth },
    };
}

/* ------------------------------------------------------------------
 *  Picker + shared "new map" flow
 * ------------------------------------------------------------------ */
export async function pickGenerator() {
    const $grid = $('<div class="mg-pick"></div>');
    let chosen = null;
    const addBtn = (label, key) => {
        const $b = $(`<button class="menu_button mg-pick-btn">${label}</button>`);
        $b.on('click', () => { chosen = key; $b.closest('dialog')[0]?.querySelector('.popup-button-ok')?.click(); });
        $grid.append($b);
    };
    const defs = Object.values(GENERATORS);
    $grid.append($(`<div class="mg-pick-head">${t('local_group')}</div>`));
    for (const def of defs.filter(d => d.embed === 'local')) addBtn(def.label, def.key);
    $grid.append($(`<div class="mg-pick-head">${t('watabou_group')}</div>`));
    for (const def of defs.filter(d => d.embed !== 'local')) addBtn(def.label, def.key);
    addBtn(t('custom_add'), CUSTOM_KEY);
    await callGenericPopup($grid, POPUP_TYPE.TEXT, '', { okButton: 'Close', wide: true });
    return chosen;
}

/** Full picker → popup flow shared by the library and the panels. */
export async function createNewMap() {
    const pick = await pickGenerator();
    if (!pick) return null;
    if (pick === CUSTOM_KEY) {
        const url = await callGenericPopup(t('custom_url_prompt'), POPUP_TYPE.INPUT, '');
        const raw = (typeof url === 'string') ? url.trim() : '';
        if (!raw) return null;
        let label;
        try { label = new URL(raw).host || 'Custom'; } catch { toast(t('custom_bad_url'), 'error'); return null; }
        return {
            id: newId(), generator: CUSTOM_KEY, customLabel: label, title: label,
            url: raw, seed: null, params: {}, thumbnail: null,
            description: '', descSource: 'manual',
            memory: { mode: 'none', lorebook: null, entryUid: null, depth: getSettings().defaultDepth },
        };
    }
    return openGeneratorPopup(pick);
}

/** Full-size view of a locally rendered map. */
export async function openLocalLightbox(map) {
    const src = Local.getRenderDataUrl(map);
    if (!src) return;
    const $box = $('<div class="mg-lightbox"></div>').append(
        $('<img alt="map" />').attr('src', src),
    );
    await callGenericPopup($box, POPUP_TYPE.TEXT, '', {
        wide: true, large: true, wider: true, allowVerticalScrolling: true, okButton: 'Close',
    });
}

/* ------------------------------------------------------------------
 *  World → region zoom picker
 *
 *  Shows the world map full-width; clicking a spot derives a Region
 *  (local) map for that world cell and returns it as a NEW saved-map
 *  object (the caller pushes it into the chat library). Returns null
 *  if the popup is dismissed without a pick.
 * ------------------------------------------------------------------ */
export async function openWorldZoomPicker(worldMap) {
    const model = Local.buildModel(worldMap);
    const canvas = Local.getRenderCanvas(worldMap);
    const src = Local.getRenderDataUrl(worldMap);
    const N = model?.layers?.N;
    if (!model || !canvas || !src || !N) return null;

    // Mirror render.js canvasDims for the 'world' type so a click maps to a
    // grid cell: cell = floor((canvasX − ox) / s), clamped to [0, N−1].
    const s = Math.max(2, Math.round(900 / N));
    const ox = 44, oy = 44;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    let chosen = null;

    const $wrap = $('<div class="mg-zoompick"></div>');
    $wrap.append($(`<p class="mg-zoomhint">${t('zoom_hint')}</p>`));
    const $img = $('<img class="mg-zoom-img" alt="world map" style="width:100%;cursor:crosshair;" />').attr('src', src);
    $wrap.append($img);

    $img.on('click', async (ev) => {
        // Account for CSS scaling: the displayed width may differ from the
        // canvas's intrinsic pixel width.
        const el = ev.currentTarget;
        const rect = el.getBoundingClientRect();
        const offsetX = ev.clientX - rect.left;
        const offsetY = ev.clientY - rect.top;
        const canvasX = offsetX * (canvas.width / rect.width);
        const canvasY = offsetY * (canvas.height / rect.height);
        const wx = clamp(Math.floor((canvasX - ox) / s), 0, N - 1);
        const wy = clamp(Math.floor((canvasY - oy) / s), 0, N - 1);
        try {
            const { deriveRegionParams } = await import('../procgen/world/zoom.js');
            const { seed, params } = deriveRegionParams(model, wx, wy);
            chosen = buildLocalMapObject('lregion', seed, params);
        } catch (e) {
            console.error('[MapGenerators] world→region zoom failed', e);
            return;
        }
        // Close the popup (single Close button); the picked map is returned below.
        el.closest('dialog')?.querySelector('.popup-button-ok')?.click();
    });

    await callGenericPopup($wrap, POPUP_TYPE.TEXT, '', {
        wide: true, large: true, wider: true, allowVerticalScrolling: true, okButton: 'Close',
    });
    return chosen;
}
