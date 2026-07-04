/* ------------------------------------------------------------------
 *  Settings drawer (Extensions → Map Generators).
 * ------------------------------------------------------------------ */
import { saveSettingsDebounced } from '../../../../../script.js';
import { callGenericPopup, POPUP_TYPE, POPUP_RESULT } from '../../../../popup.js';

import { t, applyTranslations } from '../core/i18n.js';
import { DEFAULT_SETTINGS, getSettings, toast } from '../core/settings.js';
import { chatStore, getChatMaps, persistChat } from '../core/store.js';
import {
    applyLorebook,
    disableLorebookEntry,
    clearAllInjects,
    reinjectForCurrentChat,
} from '../core/memory.js';
import { PANELS, addWandButton, renderAllPanels } from './panels.js';
import { openLibrary } from './library.js';

export const SETTINGS_HTML = `
<div class="map-generators-settings">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b data-mg-i18n="ext_title">Map Generators</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <label class="checkbox_label">
                <input type="checkbox" id="mg_enabled" />
                <span data-mg-i18n="enabled">Enable extension</span>
            </label>
            <label for="mg_language" data-mg-i18n="language">Language</label>
            <select id="mg_language" class="text_pole">
                <option value="en">English</option>
                <option value="ru">Русский</option>
            </select>
            <label for="mg_depth" data-mg-i18n="default_depth">Injection depth</label>
            <input type="number" id="mg_depth" class="text_pole" min="0" max="100" />
            <label class="checkbox_label">
                <input type="checkbox" id="mg_second" />
                <span data-mg-i18n="enable_second">Second floating viewer</span>
            </label>
            <div class="mg-row" style="margin-top:8px">
                <input type="button" class="menu_button" id="mg_open_lib" data-mg-i18n="[value]open_library" value="Open Map Library…" />
            </div>
            <small class="mg-hint" data-mg-i18n="attribution"></small>
            <h4 data-mg-i18n="reset_header">Reset</h4>
            <input type="button" class="menu_button" id="mg_reset" data-mg-i18n="[value]reset_button" value="Delete all extension data" />
        </div>
    </div>
</div>`;

export function wireSettings() {
    const s = getSettings();
    $('#mg_enabled').prop('checked', s.enabled).on('change', async function () {
        s.enabled = $(this).prop('checked'); saveSettingsDebounced();
        reinjectForCurrentChat();
        // Lorebook entries must follow the toggle too: disable them when the
        // extension is turned off, re-apply when it comes back.
        for (const map of getChatMaps()) {
            if (map.memory?.mode !== 'lorebook') continue;
            try {
                if (s.enabled) await applyLorebook(map);
                else await disableLorebookEntry(map);
            } catch (e) { console.error('[MapGenerators] lorebook toggle failed', e); }
        }
    });
    $('#mg_language').val(s.language).on('change', function () {
        s.language = $(this).val(); saveSettingsDebounced();
        applyTranslations(document.querySelector('.map-generators-settings'));
    });
    $('#mg_depth').val(s.defaultDepth).on('change', function () {
        s.defaultDepth = Number($(this).val()) || 4; saveSettingsDebounced();
    });
    $('#mg_second').prop('checked', s.secondEnabled).on('change', function () {
        s.secondEnabled = $(this).prop('checked'); saveSettingsDebounced();
        addWandButton();                       // add/remove the second wand entry
        if (s.secondEnabled) PANELS.b.toggle(true);   // show it right away
        else PANELS.b.toggle(false);                  // hide if disabled
    });
    $('#mg_open_lib').on('click', openLibrary);
    $('#mg_reset').off('click.mg').on('click.mg', async () => {
        const ok = await callGenericPopup(t('reset_confirm'), POPUP_TYPE.CONFIRM);
        if (ok !== POPUP_RESULT.AFFIRMATIVE) return;

        // 1) Drop all active prompt injections.
        clearAllInjects();

        // 2) Clear the current chat's maps (disable their lorebook entries first).
        const store = chatStore();
        if (store) {
            for (const map of [...store.maps]) { try { await disableLorebookEntry(map); } catch { /* noop */ } }
            store.maps = [];
            persistChat();
        }

        // 3) Reset settings IN PLACE so existing change-handler closures stay valid.
        const cur = getSettings();
        for (const k of Object.keys(cur)) delete cur[k];
        Object.assign(cur, structuredClone(DEFAULT_SETTINGS));
        saveSettingsDebounced();

        // 4) Hide both docked panels, clear their dragged geometry, refresh UI.
        $('#mapGenPanel, #mapGenPanel2').each((_, el) => {
            el.classList.remove('mg-maximized');
            el.style.left = el.style.top = el.style.width = el.style.height = el.style.right = '';
        }).hide();
        $('#mapgen_wand_container2').remove();
        $('#mg_enabled').prop('checked', cur.enabled);
        $('#mg_language').val(cur.language);
        $('#mg_depth').val(cur.defaultDepth);
        $('#mg_second').prop('checked', cur.secondEnabled);
        applyTranslations(document.querySelector('.map-generators-settings'));
        renderAllPanels();

        toast(t('reset_done'), 'success');
    });
}
