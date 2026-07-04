/* ------------------------------------------------------------------
 *  Library popup: the per-chat list of saved maps.
 * ------------------------------------------------------------------ */
import { getContext } from '../../../../extensions.js';
import { callGenericPopup, POPUP_TYPE } from '../../../../popup.js';

import { GENERATORS, defFor } from '../core/generators.js';
import { t } from '../core/i18n.js';
import { toast } from '../core/settings.js';
import { getChatMaps, persistChat } from '../core/store.js';
import { clearInject, disableLorebookEntry } from '../core/memory.js';
import { openMapEditor } from './editor.js';
import { createNewMap, openLocalLightbox } from './popups.js';

export async function openLibrary() {
    const $lib = $('<div class="mg-library"></div>');

    function render() {
        $lib.empty();
        const ctx = getContext();
        if (!ctx?.chatMetadata) {
            $lib.append($(`<p class="mg-empty">${t('lib_chat_only')}</p>`));
        } else {
            const maps = getChatMaps();
            if (!maps.length) $lib.append($(`<p class="mg-empty">${t('lib_empty')}</p>`));
            for (const map of maps) {
                const def = GENERATORS[map.generator];
                const $card = $('<div class="mg-card"></div>');
                const memBadge = map.memory?.mode && map.memory.mode !== 'none'
                    ? `<span class="mg-badge">${map.memory.mode === 'lorebook' ? '📖' : '💉'}</span>` : '';
                $card.append($(`
                    <div class="mg-card-main">
                        ${map.thumbnail ? `<img class="mg-thumb" src="${map.thumbnail}">` : '<div class="mg-thumb mg-noimg">🗺️</div>'}
                        <div class="mg-card-text">
                            <div class="mg-card-title">${$('<i>').text(map.title).html()} ${memBadge}</div>
                            <div class="mg-card-sub">${def?.label || map.generator}</div>
                        </div>
                    </div>`));
                const $open = $(`<button class="menu_button" title="${t('col_open')}">↗</button>`);
                const $edit = $(`<button class="menu_button" title="${t('col_edit')}">✎</button>`);
                const $del = $(`<button class="menu_button" title="${t('col_delete')}">🗑</button>`);
                $open.on('click', () => {
                    if (defFor(map).embed === 'local') { openLocalLightbox(map); return; }
                    window.open(map.url, '_blank', 'noopener');
                });
                $edit.on('click', async () => { if (await openMapEditor(map)) render(); });
                $del.on('click', async () => {
                    clearInject(map);
                    await disableLorebookEntry(map);
                    const maps2 = getChatMaps();
                    const i = maps2.indexOf(map);
                    if (i >= 0) maps2.splice(i, 1);
                    persistChat();
                    toast(t('deleted'));
                    render();
                });
                $card.append($('<div class="mg-card-actions"></div>').append($open, $edit, $del));
                $lib.append($card);
            }
        }

        // "New map" → generator picker
        const $new = $(`<button class="menu_button mg-new">${t('lib_new')}</button>`);
        $new.on('click', async () => {
            const map = await createNewMap();
            if (map) { await openMapEditor(map, { isNew: true }); render(); }
        });
        $lib.append($new);
    }

    render();
    await callGenericPopup($lib, POPUP_TYPE.TEXT, '', {
        wide: true, large: true, allowVerticalScrolling: true, okButton: 'Close',
    });
}
