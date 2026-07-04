/* ------------------------------------------------------------------
 *  File helpers: read, downscale, download.
 * ------------------------------------------------------------------ */
export function readFileText(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsText(file);
    });
}

export function readFileDataUrl(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(file);
    });
}

export function stripDataUrl(dataUrl) {
    const i = dataUrl.indexOf('base64,');
    return i >= 0 ? dataUrl.slice(i + 'base64,'.length) : dataUrl;
}

/** Downscale an image data URL to ≤maxSide px (JPEG) — keeps thumbnails
 *  stored in chat_metadata small instead of full-size uploads. */
export function downscaleDataUrl(dataUrl, maxSide = 320) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
                if (scale >= 1) { resolve(dataUrl); return; }
                const c = document.createElement('canvas');
                c.width = Math.max(1, Math.round(img.width * scale));
                c.height = Math.max(1, Math.round(img.height * scale));
                c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                resolve(c.toDataURL('image/jpeg', 0.7));
            } catch { resolve(dataUrl); }
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });
}

export function downloadFile(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function safeFileName(s) {
    return String(s || 'map').replace(/[^\wЀ-ӿ-]+/g, '_').slice(0, 60);
}
