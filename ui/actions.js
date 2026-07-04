/* ------------------------------------------------------------------
 *  Chat insertion + export actions (client-only).
 * ------------------------------------------------------------------ */
import { defFor, buildExportUrl } from '../core/generators.js';
import * as Local from '../procgen/index.js';
import { t } from '../core/i18n.js';
import { toast } from '../core/settings.js';
import { downloadFile, safeFileName } from '../core/files.js';

/** Insert a clickable map link into the chat input box. */
export function insertMapLink(map) {
    if (!map) return;
    const ta = document.querySelector('#send_textarea');
    // Local maps have no URL — insert the plain title (which is also the
    // lorebook keyword, so mentioning it can trigger the entry).
    const md = (defFor(map).embed === 'local' || !map.url)
        ? `🗺️ ${map.title}`
        : `[🗺️ ${map.title}](${map.url})`;
    if (ta) {
        const v = ta.value || '';
        ta.value = v + (v && !v.endsWith(' ') ? ' ' : '') + md + ' ';
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.focus();
    }
    toast(t('link_inserted'), 'success');
}

/** Export a map: local → direct PNG+JSON download; gh → export URL. */
export function openExport(map) {
    if (!map) return;
    const def = defFor(map);
    if (def.embed === 'local') {
        const canvas = Local.getRenderCanvas(map);
        canvas?.toBlob((blob) => { if (blob) downloadFile(safeFileName(map.title) + '.png', blob); }, 'image/png');
        const json = Local.modelJson(map);
        if (json) downloadFile(safeFileName(map.title) + '.json', new Blob([json], { type: 'application/json' }));
        toast(t('files_saved'), 'success');
        return;
    }
    let url = map.url;
    if (def.embed === 'gh') url = buildExportUrl(map.generator, map.seed, map.params, def.json ? 'json' : 'png');
    window.open(url, '_blank', 'noopener');
    toast(t('export_opened'));
}
