// wikipedia-lookup.js
// The Wikipedia lookups the Suggest an edit form makes as the author types: whether a link is a
// real article (not missing, not a disambiguation page), and a title search for people, with the
// short description that tells namesakes apart. Both use Wikipedia's public REST API, which
// allows cross-origin requests without a key.
import { normalizeWikipediaUrl } from './world-edits.js';

const articleTitle = (url) => decodeURIComponent(new URL(url).pathname.replace(/^\/wiki\//, ''));

/**
 * What Wikipedia says about an article link.
 *
 * @param {string} link
 * @returns {Promise<{ ok: true, title: string, description: string }
 *   | { ok: false, problem: string } | { ok: null, problem: string }>} ok null when Wikipedia
 *   could not be reached, which doesn't block sending
 */
export async function articleInfo(link) {
    const url = normalizeWikipediaUrl(link);
    if (!url) return { ok: false, problem: 'Use a link to a Wikipedia article, like en.wikipedia.org/wiki/Battle_of_Hastings.' };
    const { host } = new URL(url);
    let response;
    try {
        response = await fetch(`https://${host}/api/rest_v1/page/summary/${encodeURIComponent(articleTitle(url))}`);
    } catch {
        return { ok: null, problem: "Couldn't reach Wikipedia to check this link." };
    }
    if (response.status === 404) return { ok: false, problem: 'There is no Wikipedia article at that link.' };
    if (!response.ok) return { ok: null, problem: "Couldn't reach Wikipedia to check this link." };
    const page = await response.json();
    if (page.type === 'disambiguation') return { ok: false, problem: 'That link is a disambiguation page. Pick the article about this event.' };
    return { ok: true, title: page.title ?? articleTitle(url).replace(/_/g, ' '), description: page.description ?? '' };
}

/**
 * Up to five Wikipedia articles whose title matches the text, for linking a person.
 *
 * @param {string} text
 * @param {string} [host]
 * @returns {Promise<{ title: string, description: string, url: string }[]>}
 */
export async function searchArticles(text, host = 'en.wikipedia.org') {
    const q = String(text ?? '').trim();
    if (!q) return [];
    try {
        const response = await fetch(`https://${host}/w/rest.php/v1/search/title?q=${encodeURIComponent(q)}&limit=5`);
        if (!response.ok) return [];
        const { pages = [] } = await response.json();
        return pages.map(page => ({
            title: page.title,
            description: page.description ?? '',
            // keys are raw titles ("Who?"); encoded, a "?" or "#" stays part of the title
            url: `https://${host}/wiki/${encodeURIComponent(page.key)}`,
        }));
    } catch {
        return [];
    }
}
