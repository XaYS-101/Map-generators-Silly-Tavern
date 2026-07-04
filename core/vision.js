/* ------------------------------------------------------------------
 *  AI vision captioning + attaching previews to chat messages.
 * ------------------------------------------------------------------ */
import { getContext } from '../../../../extensions.js';
import { t } from './i18n.js';
import { getSettings, toast } from './settings.js';
import { stripDataUrl } from './files.js';

export async function describeViaVision(dataUrl) {
    // Lazy import: shared.js pulls in caption settings; only load on demand.
    let getMultimodalCaption;
    try {
        // shared.js lives in scripts/extensions/ — three levels up from this
        // third-party extension subdirectory.
        ({ getMultimodalCaption } = await import('../../../shared.js'));
    } catch {
        toast(t('vision_no'), 'warning');
        return null;
    }
    const prompt = (getSettings().language === 'ru')
        ? 'Опиши эту фэнтезийную карту для мастера игры: тип места (город/деревня/подземелье/регион), районы и ключевые объекты, стены/ворота/река/побережье, общая атмосфера. 3–5 предложений.'
        : 'Describe this fantasy map for a game master: kind of place (city/village/dungeon/region), districts and key features, walls/gates/river/coast, overall mood. 3–5 sentences.';
    try {
        const caption = await getMultimodalCaption(stripDataUrl(dataUrl), prompt);
        return (caption || '').trim() || null;
    } catch (e) {
        console.error('[MapGenerators] vision caption failed', e);
        toast(t('vision_bad'), 'error');
        return null;
    }
}

/** Attach a base64 PNG preview to the most recent chat message. */
export function insertPreviewIntoChat(dataUrl) {
    const ctx = getContext();
    if (!ctx?.chat?.length) return;
    const idx = ctx.chat.length - 1;
    const msg = ctx.chat[idx];
    msg.extra = msg.extra || {};
    if (!Array.isArray(msg.extra.media)) msg.extra.media = [];
    msg.extra.media.push({ url: dataUrl, type: 'image' });
    // appendMediaToMessage uses jQuery methods (.find/.attr) on the element,
    // so pass a jQuery object — a raw DOM node throws and nothing renders.
    const $block = $(`#chat .mes[mesid="${idx}"]`);
    if ($block.length) ctx.appendMediaToMessage(msg, $block);
    ctx.saveChat?.();
}
