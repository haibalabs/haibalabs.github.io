// image-resize.js
// Turns a chosen photo into the two copies that are stored (see history-dp docs/site/PERSONAL-IMAGES.md): the displayed
// photo, at most 1600 px on its long edge, and a 400 px thumbnail for cards. Both are re-encoded
// through a canvas, which applies the camera orientation and drops every piece of metadata,
// including GPS location. The original is never uploaded.

export const FULL_EDGE = 1600;
export const THUMB_EDGE = 400;
// Matches the limits in firebase/storage.rules.
export const MAX_FULL_BYTES = 2 * 1024 * 1024;
export const MAX_THUMB_BYTES = 200 * 1024;

/**
 * The displayed photo and its thumbnail, as WebP, or JPEG where the browser cannot encode WebP.
 *
 * @param {Blob} file - the chosen image file
 * @returns {Promise<{ full: Blob, thumb: Blob, width: number, height: number, mime: string }>}
 */
export async function resizePhoto(file) {
    let bitmap;
    try {
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
        throw new Error('This file could not be read as a photo. Choose a JPEG, PNG or WebP image.');
    }
    try {
        const full = await encode(bitmap, FULL_EDGE, MAX_FULL_BYTES);
        const thumb = await encode(bitmap, THUMB_EDGE, MAX_THUMB_BYTES, full.mime);
        return { full: full.blob, thumb: thumb.blob, width: full.width, height: full.height, mime: full.mime };
    } finally {
        bitmap.close();
    }
}

async function encode(bitmap, edge, maxBytes, mime = 'image/webp') {
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    // a white backdrop, so transparent PNGs do not turn black as JPEG
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);

    for (const quality of [0.82, 0.65, 0.5]) {
        let blob = await toBlob(canvas, mime, quality);
        // browsers that cannot encode WebP fall back to PNG; use JPEG instead
        if (!blob || blob.type !== mime) {
            mime = 'image/jpeg';
            blob = await toBlob(canvas, mime, quality);
        }
        if (blob && blob.size <= maxBytes) return { blob, width, height, mime };
    }
    throw new Error('This photo is too detailed to store. Try another photo.');
}

function toBlob(canvas, mime, quality) {
    return new Promise(resolve => canvas.toBlob(resolve, mime, quality));
}
