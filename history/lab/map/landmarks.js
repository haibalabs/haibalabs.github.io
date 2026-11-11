// Lab only: the approved landmark rounds, until the published release serves its landmark table, in the
// historiline-landmarks/v1 shape the site's own layer reads (modules/landmark-layer.js). Round 1 is T121's
// 49 landmarks with Iris's T122 icons (sha256 8745375f), round 2 is T124's 175 (sha256 7f396431). An icon
// is landmarks/icons/<sha256>.webp; a landmark whose icon isn't made yet gets a lettered marker.
import { LandmarkLayer } from '../../modules/landmark-layer.js';

const ROUND_URLS = ['landmarks/round-1.json', 'landmarks/round-2.json'].map(path => new URL(path, import.meta.url).href);
const iconUrl = sha256 => new URL(`landmarks/icons/${sha256}.webp`, import.meta.url).href;

async function loadRounds() {
    const rounds = await Promise.all(ROUND_URLS.map(async url => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
        const { format, landmarks } = await response.json();
        if (format !== 'historiline-landmarks/v1') throw new Error(`${url} is not historiline-landmarks/v1.`);
        return landmarks;
    }));
    // a landmark is its QID: a later round never repeats an earlier one, but if it did the first is kept
    const byQid = new Map();
    for (const landmark of rounds.flat()) if (!byQid.has(landmark.wikidata_qid)) byQid.set(landmark.wikidata_qid, landmark);
    return [...byQid.values()];
}

export async function labLandmarks(browser) {
    return new LandmarkLayer(browser, await loadRounds(), { iconUrl, placeholders: true });
}
