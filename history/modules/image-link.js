// image-link.js
// The image link both event forms share: a pasted Wikimedia Commons link is looked up on the Commons
// API (cross-origin with origin=*) for its full URL, author and license, as released images carry
// them; any other https link is taken as it is, with its license unknown. For world events a reviewer
// must confirm an unknown license before the image is published (world-edits.js,
// imageNeedsConfirmation; Rachid, 2026-10-31).
import { normalizeImage } from './world-edits.js';

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
const IMAGE_WIDTH = 1600;

/**
 * The Commons file a link names ("File:Allianz Arena.jpg"), or null when it is not a Commons link.
 * Accepts a file page (commons.wikimedia.org/wiki/File:…, any language's /wiki/Datei:… on Commons
 * included) and an upload.wikimedia.org file or thumbnail URL.
 */
export function commonsFileTitle(link) {
    let url;
    try {
        const raw = String(link ?? '').trim();
        url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
        return null;
    }
    const host = url.hostname.toLowerCase().replace(/^commons\.m\./, 'commons.');
    let name = null;
    if (host === 'commons.wikimedia.org') {
        const page = url.pathname.match(/^\/wiki\/(.+)$/)?.[1] ?? url.searchParams.get('title');
        if (page) name = decodeURIComponent(page).replace(/^[^:]+:/, '');
    } else if (host === 'upload.wikimedia.org') {
        // /wikipedia/commons/a/ab/Name.jpg, or /wikipedia/commons/thumb/a/ab/Name.jpg/800px-Name.jpg
        const parts = url.pathname.split('/');
        const at = parts.indexOf('commons');
        if (at >= 0) name = decodeURIComponent(parts[parts[at + 1] === 'thumb' ? at + 4 : at + 3] ?? '');
    }
    name = name?.replace(/_/g, ' ').trim();
    return name ? `File:${name}` : null;
}

// Commons metadata is HTML ("<a href=…>Jane Doe</a>"); the credit is its text.
export function plainText(html) {
    const text = String(html ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    return text.replace(/\s+/g, ' ').trim();
}

/**
 * An image record for a Commons file, from the Commons API's imageinfo answer.
 *
 * @param {string} title - "File:…"
 * @param {object} info - imageinfo[0], with url, thumburl, descriptionurl and extmetadata
 */
export function commonsRecord(title, info) {
    const meta = info.extmetadata ?? {};
    const value = (key) => plainText(meta[key]?.value);
    const license = value('LicenseShortName') || value('UsageTerms');
    return normalizeImage({
        source: 'commons',
        image_url: info.thumburl || info.url,
        source_url: info.descriptionurl,
        file_page: title,
        caption: value('ImageDescription').slice(0, 500),
        credit: (value('Artist') || value('Credit')).slice(0, 300),
        license_name: license,
        license_url: meta.LicenseUrl?.value || null,
        rights_statement: [license, value('UsageTerms')].filter((part, i, all) => part && all.indexOf(part) === i).join(' · ') || null,
        display_date: value('DateTimeOriginal').slice(0, 40) || null,
    });
}

/**
 * Looks up a Commons link.
 *
 * @param {string} link
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ ok: true, image: object } | { ok: false, problem: string }>}
 */
export async function commonsImage(link, fetchImpl = fetch) {
    const title = commonsFileTitle(link);
    if (!title) return { ok: false, problem: 'That is not a link to a Wikimedia Commons file.' };
    let answer;
    try {
        const response = await fetchImpl(`${COMMONS_API}?action=query&format=json&origin=*&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=${IMAGE_WIDTH}&titles=${encodeURIComponent(title)}`);
        if (!response.ok) throw new Error(String(response.status));
        answer = await response.json();
    } catch {
        return { ok: false, problem: "Couldn't reach Wikimedia Commons to read this file. Try again." };
    }
    const page = Object.values(answer.query?.pages ?? {})[0];
    const info = page?.imageinfo?.[0];
    if (!page || page.missing !== undefined || !info) return { ok: false, problem: 'There is no Commons file at that link.' };
    return { ok: true, image: commonsRecord(page.title ?? title, info) };
}

/**
 * The record for any image link: a Commons file through commonsImage, any other https link as it is,
 * with the note the author gave about where it is from.
 *
 * @param {string} link
 * @param {{ rightsNote?: string, fetchImpl?: typeof fetch }} [options]
 */
export async function imageFromLink(link, { rightsNote = '', fetchImpl = fetch } = {}) {
    const text = String(link ?? '').trim();
    if (!text) return { ok: false, problem: 'Paste a link to the image.' };
    if (commonsFileTitle(text)) return commonsImage(text, fetchImpl);
    let url;
    try {
        url = new URL(text);
    } catch {
        return { ok: false, problem: 'Use an image link that starts with https://.' };
    }
    if (url.protocol !== 'https:') return { ok: false, problem: 'Use an image link that starts with https://.' };
    return {
        ok: true,
        image: normalizeImage({ source: 'link', image_url: url.href, source_url: url.href, rights_statement: rightsNote }),
    };
}

/** "Photo: Jane Doe · CC BY-SA 4.0 · Wikimedia Commons", or what is known of it. */
export function creditLine(image) {
    if (!image) return '';
    const from = image.source === 'commons' ? 'Wikimedia Commons' : image.source === 'link' ? new URL(image.image_url).hostname : '';
    return [image.credit ? `Photo: ${image.credit}` : '', image.license_name ?? (image.source === 'link' ? 'License unknown' : ''), from]
        .filter(Boolean).join(' · ');
}
