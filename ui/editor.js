/* ------------------------------------------------------------------
 *  Map editor popup.
 * ------------------------------------------------------------------ */
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from '../../../../popup.js';

import { CUSTOM_KEY, defFor, jsonToText } from '../core/generators.js';
import * as Local from '../procgen/index.js';
import { t } from '../core/i18n.js';
import { getSettings, toast } from '../core/settings.js';
import { chatStore, persistChat } from '../core/store.js';
import { applyMemory } from '../core/memory.js';
import { readFileText, readFileDataUrl, downscaleDataUrl, downloadFile, safeFileName } from '../core/files.js';
import { describeViaVision, insertPreviewIntoChat } from '../core/vision.js';
import { openGeneratorPopup, openWorldZoomPicker } from './popups.js';

export async function openMapEditor(map, { isNew = false } = {}) {
    const def = defFor(map);
    const isLocal = def.embed === 'local';
    const isCustom = def.key === CUSTOM_KEY;

    const $f = $('<div class="mg-editor"></div>');
    const row = (label, ctrl) => $('<div class="mg-field"></div>').append($(`<label>${label}</label>`), ctrl);

    const $title = $(`<input type="text" class="text_pole" />`).val(map.title);
    const $url = $(`<input type="text" class="text_pole" readonly />`).val(map.url);
    const $reopen = $(`<button class="menu_button">${t('f_reopen')}</button>`);
    const $desc = $(`<textarea class="text_pole mg-desc" rows="5"></textarea>`).val(map.description);
    let descTouched = false;
    $desc.on('input', () => { descTouched = true; });

    const seedSummary = (m) => {
        const parts = [`${t('gen_seed')}: ${m.seed}`];
        for (const [k, v] of Object.entries(m.params || {})) parts.push(`${k}: ${v}`);
        return parts.join(' · ');
    };
    const $seedInfo = isLocal ? $('<span class="mg-static mg-seedinfo"></span>').text(seedSummary(map)) : null;

    const $jsonBtn = $(`<button class="menu_button">${t('desc_import_json')}</button>`);
    const $jsonInput = $(`<input type="file" accept=".json,application/json" hidden />`);
    const $mdBtn = $(`<button class="menu_button">${t('desc_import_md')}</button>`);
    const $mdInput = $(`<input type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden />`);
    const $visionBtn = $(`<button class="menu_button">${t('desc_vision')}</button>`);
    const $thumbBtn = $(`<button class="menu_button">${t('desc_thumb')}</button>`);
    const $pngInput = $(`<input type="file" accept="image/*" hidden />`);
    const $insertBtn = $(`<button class="menu_button">${t('desc_insert_chat')}</button>`);
    let pendingPng = map.thumbnail;
    // Local maps render their own full-res PNG — vision captioning and
    // chat preview work without any manual upload.
    let pngForVision = isLocal ? Local.getRenderDataUrl(map) : null;

    // memory controls
    const mkRadio = (val, lbl) => $(`<label class="mg-radio"><input type="radio" name="mg-mem" value="${val}"> ${lbl}</label>`);
    const $memNone = mkRadio('none', t('mem_none'));
    const $memLore = mkRadio('lorebook', t('mem_lorebook'));
    const $memInj = mkRadio('inject', t('mem_inject'));
    const $depth = $(`<input type="number" class="text_pole" min="0" max="100" style="width:5em" />`).val(map.memory?.depth ?? getSettings().defaultDepth);
    [$memNone, $memLore, $memInj].forEach($r => {
        if ($r.find('input').val() === (map.memory?.mode || 'none')) $r.find('input').prop('checked', true);
    });

    $reopen.on('click', async () => {
        const updated = await openGeneratorPopup(map.generator, map);
        if (!updated) return;
        $url.val(updated.url);
        if (isLocal) {   // reroll may have refreshed the auto description/preview
            if (updated.descSource === 'local') $desc.val(updated.description);
            pendingPng = updated.thumbnail;
            pngForVision = Local.getRenderDataUrl(updated);
            $seedInfo?.text(seedSummary(updated));
        }
    });
    $jsonBtn.on('click', () => $jsonInput.trigger('click'));
    $jsonInput.on('change', async (e) => {
        const file = e.target.files?.[0]; if (!file) return;
        try {
            const data = JSON.parse(await readFileText(file));
            // Dedicated parser if the generator has one, else generic (full, no truncation).
            $desc.val(def?.parse ? def.parse(data) : jsonToText(data));
            map.descSource = 'json';
            toast(t('json_ok'), 'success');
        } catch { toast(t('json_bad'), 'error'); }
    });
    $mdBtn.on('click', () => $mdInput.trigger('click'));
    $mdInput.on('change', async (e) => {
        const file = e.target.files?.[0]; if (!file) return;
        const text = (await readFileText(file)).trim();
        if (text) { $desc.val(text); map.descSource = 'markdown'; toast(t('md_ok'), 'success'); }
    });
    $thumbBtn.on('click', () => $pngInput.trigger('click'));
    $pngInput.on('change', async (e) => {
        const file = e.target.files?.[0]; if (!file) return;
        const full = await readFileDataUrl(file);
        pngForVision = full;                              // vision gets the full image
        pendingPng = await downscaleDataUrl(full, 320);   // metadata stores only a thumbnail
        $thumbBtn.text('✓ ' + t('desc_thumb'));
    });
    $visionBtn.on('click', async () => {
        const src = pngForVision || pendingPng;
        if (!src) { toast(t('desc_thumb'), 'warning'); return; }
        toast(t('vision_run'));
        const caption = await describeViaVision(src);
        if (caption) { $desc.val(caption); map.descSource = 'vision'; toast(t('vision_ok'), 'success'); }
    });
    $insertBtn.on('click', () => {
        const src = (isLocal ? pngForVision : null) || pendingPng;
        if (src) insertPreviewIntoChat(src);
    });

    // Local maps: client-side exports + description rebuild.
    const $localBtns = [];
    if (isLocal) {
        const $dlPng = $(`<button class="menu_button">${t('dl_png')}</button>`);
        const $dlJson = $(`<button class="menu_button">${t('dl_json')}</button>`);
        const $reDesc = $(`<button class="menu_button">${t('desc_rebuild')}</button>`);
        $dlPng.on('click', () => {
            const canvas = Local.getRenderCanvas(map);
            canvas?.toBlob((blob) => {
                if (blob) { downloadFile(safeFileName($title.val()) + '.png', blob); toast(t('files_saved'), 'success'); }
            }, 'image/png');
        });
        $dlJson.on('click', () => {
            const json = Local.modelJson(map);
            if (json) {
                downloadFile(safeFileName($title.val()) + '.json', new Blob([json], { type: 'application/json' }));
                toast(t('files_saved'), 'success');
            }
        });
        $reDesc.on('click', () => {
            $desc.val(Local.describeMap(map));
            map.descSource = 'local';
            descTouched = false;
            toast(t('desc_rebuilt'), 'success');
        });
        $localBtns.push($dlPng, $dlJson, $reDesc);

        // World maps zoom into a region: click a spot on the world to spawn a
        // new Region (local) map, saved straight into the chat library.
        if (map.generator === 'lworld') {
            const $zoom = $(`<button class="menu_button">${t('zoom_region')}</button>`);
            $zoom.on('click', async () => {
                const region = await openWorldZoomPicker(map);
                if (!region) return;
                const store = chatStore();
                if (store) { store.maps.push(region); persistChat(); }
                toast(t('zoom_created'), 'success');
            });
            $localBtns.push($zoom);
        }
    }

    $f.append(
        row(t('f_title'), $title),
        row(t('f_generator'), $(`<span class="mg-static">${def?.label || map.generator}</span>`)),
        isLocal
            ? row(t('gen_seed'), $('<div class="mg-row"></div>').append($seedInfo, $reopen))
            : row(t('f_url'), $('<div class="mg-row"></div>').append($url, ...(isCustom ? [] : [$reopen]))),
        row(t('f_description'), $desc),
        $('<div class="mg-row mg-wrap"></div>').append($jsonBtn, $mdBtn, $visionBtn, $thumbBtn, $insertBtn, ...$localBtns, $jsonInput, $mdInput, $pngInput),
        $(`<h4>${t('mem_header')}</h4>`),
        $('<div class="mg-row mg-wrap"></div>').append($memNone, $memLore, $memInj,
            $('<span class="mg-depthwrap"></span>').append($(`<span>${t('mem_depth')}</span>`), $depth)),
    );

    const result = await callGenericPopup($f, POPUP_TYPE.CONFIRM, '', {
        wide: true, allowVerticalScrolling: true, okButton: t('save'), cancelButton: 'Cancel',
    });
    if (result !== POPUP_RESULT.AFFIRMATIVE) return false;

    const title = $title.val().trim();
    if (!title) { toast(t('need_title'), 'warning'); return false; }

    map.title = title;
    map.description = $desc.val();
    if (isLocal && descTouched) map.descSource = 'manual';   // user's text survives rerolls
    map.thumbnail = pendingPng;
    map.memory = map.memory || {};
    map.memory.mode = $f.find('input[name="mg-mem"]:checked').val() || 'none';
    map.memory.depth = Number($depth.val()) || getSettings().defaultDepth;

    // Save into the chat library.
    const store = chatStore();
    if (store) {
        if (isNew) store.maps.push(map);
        persistChat();
    }
    await applyMemory(map);
    toast(t('saved'), 'success');
    return true;
}
