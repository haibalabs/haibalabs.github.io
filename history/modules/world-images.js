// world-images.js
// Independently reviewed world-event images: the released set every visitor sees
// (releases/README.md). Each record names the position of its event in one exact events file,
// identified by its SHA-256. Images are attached
// only when the bytes the page loaded have that hash, every index is valid and unique, and every
// target event is still the record loaded from the file: not replaced, not edited, with its file
// fields unchanged. If any check fails, nothing is attached and the reason is reported. There is no
// fallback matching by title. events.json itself carries no images.

// Reviewed images every visitor sees (releases/README.md).
export const RELEASE_URL = 'releases/released-images-v1.json';

// The image roles a record may have; any other role is refused. The viewer shows no role label: the
// caption and the date qualification say what the image is and when (Rachid, 2026-10-26).
// scientific_context is a modern observation or specimen photo that is evidence for an early event,
// such as a fossil or a zircon-bearing rock. contextual_photo is a photograph of the event's subject on
// another occasion, such as the bridge on its opening day for its later collapse. artifact is an object
// from the event's history in any medium, such as the Rosetta Stone in its museum, not a picture of the event.
export const IMAGE_ROLES = new Set(['event_photo', 'event_aftermath', 'portrait', 'site', 'map', 'symbol',
    'retrospective_illustration', 'scientific_context', 'contextual_photo', 'artifact']);

// Credits come from source metadata and can run to thousands of characters. The viewer shows at most
// this many, ending at a word, so the image, license and source link stay on screen.
export const CREDIT_LIMIT = 280;

/**
 * A credit short enough for the viewer, or the credit itself when it already is.
 *
 * @param {string} credit
 * @returns {{ text: string, shortened: boolean }}
 */
export function shortCredit(credit) {
    credit = String(credit ?? '');
    if (credit.length <= CREDIT_LIMIT) return { text: credit, shortened: false };
    const cut = credit.slice(0, CREDIT_LIMIT);
    const space = cut.lastIndexOf(' ');
    return { text: `${(space > CREDIT_LIMIT / 2 ? cut.slice(0, space) : cut).trimEnd()}…`, shortened: true };
}

const MONTH = String.raw`(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?`;
const DAYS = String.raw`\d{1,2}(?:\s?[-–~]\s?\d{1,2})?`;
// One date, reduced to its year: 1864, 1880s, 500 BC, 1925-05, 1960/06/23, 7/4/2015, 5 October 2007,
// October 1907, August 14, 1976, 27 - 29 September 1981
const YEAR_SHAPES = [
    String.raw`(?<y>\d{3,4}s?)(?:\s?(?<era>BCE?|AD|CE))?`,
    String.raw`(?<y>\d{4})[-/]\d{2}(?:[-/]\d{2})?`,
    String.raw`\d{1,2}[/.-]\d{1,2}[/.-](?<y>\d{4})`,
    String.raw`(?:${DAYS}\s)?${MONTH},?\s(?<y>\d{4})`,
    String.raw`${MONTH}\s${DAYS},?\s(?<y>\d{4})`,
].map(shape => new RegExp(`^${shape}$`, 'i'));

const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');

// A date with its qualifier ("c. ", "before ", "after "), or null when the text is not one of the
// shapes above or a century. "before" and "after" take only a year or a century, since reducing
// "before March 2007" to "before 2007" would move the bound.
function datePart(text) {
    const q = text.match(/^(circa|c\.|ca\.|about|before|after)\s*(.*)$/i);
    const qualifier = !q ? '' : /^(before|after)$/i.test(q[1]) ? `${q[1].toLowerCase()} ` : 'c. ';
    const rest = q ? q[2] : text;
    const century = rest.match(/^(early |mid-|late )?(\d{1,2})\s?(?:st|nd|rd|th) century(?:\s(BCE?|AD|CE))?$/i);
    if (century) {
        return { qualifier, when: `${(century[1] ?? '').toLowerCase()}${ordinal(Number(century[2]))} century${century[3] ? ` ${century[3].toUpperCase()}` : ''}` };
    }
    for (const shape of /^(before|after)/.test(qualifier) ? YEAR_SHAPES.slice(0, 1) : YEAR_SHAPES) {
        const m = rest.match(shape);
        if (m) return { qualifier, when: m.groups.y + (m.groups.era ? ` ${m.groups.era.toUpperCase()}` : '') };
    }
    return null;
}

/**
 * An image's date as the viewer shows it after the caption, with no label, or null when the source
 * metadata has no date it can safely summarize. A full ISO date is shown as is; a date in one of a
 * few known shapes is reduced to its year or century, keeping its era, "c.", "before", "after" and
 * ranges. Wikidata qualifiers, Exif notes, times of day and "Taken on" or "Published in" are dropped
 * first, and so are upload dates and signature timestamps, which are not the image's date. Anything
 * else, such as "Unknown date, photoshopped: 2010-04-16" or "Sommer 1945 oder Folgejahre", shows
 * nothing rather than a year that changes its meaning (Rachid, 2026-10-26; Iris's review of PR 25).
 *
 * @param {string|null|undefined} raw - the record's image_date
 * @returns {string|null}
 */
export function displayDate(raw) {
    if (typeof raw !== 'string') return null;
    const text = raw
        .replace(/\s*date QS:\S*/gi, '')
        .replace(new RegExp(String.raw`(?:${DAYS}\s)?${MONTH},?\s\d{4}\s\((?:original )?upload date\)`, 'gi'), '')
        .replace(/^\d{1,2}:\d{2},.*\(UTC\)$/, '')
        .replace(/\(according to Exif data\)|\[\s*\d+\s*\]|\(\s*\)/gi, '')
        .replace(/(?:,?\s|T)\d{1,2}:\d{2}(?::\d{2})?(?:\s[A-Z]{2,4})?(?:\s\(UTC[+-]\d+\))?/g, '')
        .replace(/^[\s.,;:]*(?:[–-]\s+)?|[\s.,;:–-]+$/g, '')
        .replace(/^(?:taken (?:on|in)|(?:first )?published(?: in| on)?)\s+/i, '')
        .trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const circaAfter = /\s+circa$/i.test(text);
    const body = text.replace(/\s+circa$/i, '').replace(/^between\s+/i, '');
    const one = datePart(body);
    if (one) return (one.qualifier || (circaAfter ? 'c. ' : '')) + one.when;
    for (const sep of body.matchAll(/\s+(?:and|to)\s+|\s*[–/]\s*|\s+-\s+/gi)) {
        const a = datePart(body.slice(0, sep.index));
        const b = datePart(body.slice(sep.index + sep[0].length));
        if (!a || !b || /before|after/.test(a.qualifier + b.qualifier)) continue;
        return (a.qualifier || b.qualifier || (circaAfter ? 'c. ' : '')) + (a.when === b.when ? a.when : `${a.when}–${b.when}`);
    }
    return null;
}

// The date shown for a record: a reviewed display_date as written, where an explicit null means the
// review found no supported date; the raw image_date only when the export has no display_date.
export const recordDisplayDate = (record) => ('display_date' in record
    ? (typeof record.display_date === 'string' && record.display_date.trim()) || null
    : displayDate(record.image_date));

// A caption as the viewer shows it: without a trailing "Image date: …" sentence, since the viewer
// shows the date itself.
export const displayCaption = (caption) => caption.replace(/\s*Image date:[^.]*\.?\s*$/i, '').trim();

/**
 * A caption split into plain and italic runs: some captions mark a work's title *like this*
 * (Rachid, 2026-10-28: show it in italics). A lone asterisk stays as text.
 *
 * @param {string} caption
 * @returns {{ text: string, italic: boolean }[]}
 */
export function captionRuns(caption) {
    return String(caption ?? '').split(/\*([^*\s](?:[^*]*[^*\s])?)\*/)
        .map((text, i) => ({ text, italic: i % 2 === 1 }))
        .filter(run => run.text);
}

// Fields the app itself changes after loading: the timestamp it sets, and locations, which the
// location verifier annotates. Locations are compared by their identity fields instead.
const NORMALIZED_FIELDS = new Set(['lastModified', 'locations']);
const LOCATION_FIELDS = ['name', 'city', 'region', 'country', 'historical_name', 'place_id'];

/**
 * SHA-256 of some bytes, as lowercase hex.
 *
 * @param {ArrayBuffer} bytes
 * @returns {Promise<string>}
 */
export async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Why the preview cannot be attached to the loaded data, or null if it can.
 *
 * @param {object} preview - the parsed preview file
 * @param {string} loadedSha256 - SHA-256 of the bytes the loaded events were parsed from
 * @param {number} eventCount - number of world events loaded from that file
 * @returns {string|null}
 */
export function previewProblem(preview, loadedSha256, eventCount) {
    if (loadedSha256 !== preview.source?.events_sha256) {
        return 'The loaded events file is not the one these preview images were reviewed against.';
    }
    const indexes = preview.records.map(r => r.record_index);
    const valid = indexes.every(i => Number.isInteger(i) && i >= 0 && i < eventCount);
    if (!valid || new Set(indexes).size !== indexes.length) return 'The preview file has invalid or repeated event positions.';
    if (!preview.records.every(r => IMAGE_ROLES.has(r.image_role))) return 'The preview file has an image role the site does not know.';
    return null;
}

// The identity of an event's locations: their names and places, without the coordinates and
// annotations the app or a location release adds.
export const locationIdentity = (locations) => JSON.stringify((locations ?? []).map(l => LOCATION_FIELDS.map(f => (typeof l === 'string' && f === 'name' ? l : l?.[f]) ?? null)));

// Why a loaded event is no longer the file record a preview image was reviewed for, or null.
// locations are the event's locations as loaded, before a location release changed any place.
function eventProblem(event, record, original, locations) {
    if (!event || event.personal) return 'no world event at that position';
    if (event.name !== record.event_name || event.enhanced_time !== record.enhanced_time) return 'a different event at that position';
    if (event.dirty || event.syncedRevision != null) return 'the event was changed after loading';
    if (event.image_url) return 'the event already has an image';
    for (const [key, value] of Object.entries(original)) {
        if (NORMALIZED_FIELDS.has(key)) continue;
        if (JSON.stringify(event[key]) !== JSON.stringify(value)) return `its ${key} differs from the reviewed file`;
    }
    if (locationIdentity(locations) !== locationIdentity(original.locations)) return 'its locations differ from the reviewed file';
    return null;
}

/**
 * Attaches every preview image to the event it was reviewed for, or none. Call only when
 * previewProblem() returns null.
 *
 * @param {object[]} events - the loaded world events, in file order
 * @param {object[]} records - reviewed image records (releases/released-images-v1.json)
 * @param {object[]} originals - the records of the reviewed file, as parsed from its bytes
 * @param {(event: object) => object[]} [locationsOf] - an event's locations as loaded (world-locations.js)
 * @returns {{ attached: object[], problems: { record_index: number, reason: string }[] }}
 */
export function attachPreviewImages(events, records, originals, locationsOf = (event) => event.locations) {
    const problems = [];
    for (const record of records) {
        const event = events[record.record_index];
        const reason = eventProblem(event, record, originals[record.record_index], event && locationsOf(event));
        if (reason) problems.push({ record_index: record.record_index, reason });
    }
    if (problems.length) return { attached: [], problems };
    const attached = records.map((record) => {
        const event = events[record.record_index];
        event.image_url = record.image_url;
        event.image_preview = {
            caption: displayCaption(record.caption),
            role: record.image_role,
            credit: record.credit,
            license_name: record.license_name,
            license_url: record.license_url,
            source_url: record.source_url,
            date: recordDisplayDate(record),
            under_review: (record.event_issue_ids ?? []).length > 0,
        };
        return event;
    });
    return { attached, problems };
}

// Removes the images attachPreviewImages added.
export function detachPreviewImages(attached) {
    for (const event of attached) {
        delete event.image_url;
        delete event.image_preview;
    }
}
