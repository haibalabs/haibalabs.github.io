// world-edits.js
// Proposed edits to world events (WORLD-EDITS.md): the fields an edit may change, how the
// form's values become field-level changes, the checks run in the browser before an edit is
// sent, and the four statuses an editor sees. Firestore access is in edit-store.js and the
// screens in edit-ui.js.
import { eventProblem, NAME_MAX } from './timeline-model.js';
import { sha256Hex } from './world-images.js';

// The fields every form has. Locations are edited per position as location[0] … location[4]
// (WORLD-EDITS.md, Location edits); isEditField() accepts both.
export const EDIT_FIELDS = ['name', 'enhanced_time', 'enhanced_description', 'figures', 'categories', 'wikipedia_url', 'image'];
export const FIELD_LABELS = {
    name: 'Name', enhanced_time: 'Date', enhanced_description: 'Description',
    figures: 'People', categories: 'Category', wikipedia_url: 'Wikipedia article', image: 'Image',
};
// Positions an edit can reach, as firestore.rules lists them; events with more keep the rest as they are.
export const LOCATION_SLOTS = 5;
export const locationField = (index) => `location[${index}]`;

/** The position a location field names, or null for any other field. */
export function locationIndex(field) {
    const match = /^location\[(\d+)\]$/.exec(String(field));
    return match && Number(match[1]) < LOCATION_SLOTS ? Number(match[1]) : null;
}

export const isEditField = (field) => EDIT_FIELDS.includes(field) || locationIndex(field) !== null;

export function fieldLabel(field) {
    const index = locationIndex(field);
    return index === null ? FIELD_LABELS[field] ?? field : `Location ${index + 1}`;
}

// --- locations (WORLD-EDITS.md, Location edits) ---

export const LOCATION_TEXT_FIELDS = ['name', 'city', 'region', 'country', 'historical_name'];
export const LOCATION_TEXT_MAX = 200;
// What a point stands for, the map's vocabulary (DOTS in map-browser.js); a point with none recorded
// is drawn as a dot (Rachid, 10-31).
export const PRECISIONS = ['site', 'settlement', 'approximate', 'region', 'country', 'polity'];

const validPoint = (point) => Array.isArray(point) && point.length === 2
    && point.every(Number.isFinite) && Math.abs(point[0]) <= 90 && Math.abs(point[1]) <= 180;

/**
 * A location in the form edits compare: its five text fields trimmed, its point (from `point`, or an
 * event location's geography) and that point's precision, and the identified place or Wikidata item
 * it was picked from. Null when it names nothing.
 *
 * @param {object|null|undefined} value - an edit's location, or an event location
 * @returns {{ name: string, city: string, region: string, country: string, historical_name: string,
 *   point: number[]|null, precision: string|null, place_id?: string, wikidata?: string }|null}
 */
export function normalizeLocation(value) {
    if (!value || typeof value !== 'object') return null;
    const location = Object.fromEntries(LOCATION_TEXT_FIELDS.map(key => [key, String(value[key] ?? '').normalize('NFC').trim()]));
    const point = value.point ?? value.geography?.coordinates ?? null;
    location.point = validPoint(point) ? [Number(point[0]), Number(point[1])] : null;
    const precision = value.precision ?? value.geography?.precision;
    location.precision = location.point && PRECISIONS.includes(precision) ? precision : null;
    if (value.place_id) location.place_id = String(value.place_id);
    if (value.wikidata) location.wikidata = String(value.wikidata);
    return LOCATION_TEXT_FIELDS.some(key => location[key]) || location.point ? location : null;
}

/** A location's text as one line: "Allianz Arena, Munich, Germany". */
export function locationText(location) {
    const parts = [location?.name, location?.city, location?.region, location?.country].map(part => String(part ?? '').trim()).filter(Boolean);
    return parts.filter((part, i) => parts.indexOf(part) === i).join(', ');
}

/**
 * An edit's location in the dataset's shape, for the events visitors see. A point lands as
 * geography status "corrected", which T7 leaves alone, tagged with where it came from. A point
 * with no recorded precision keeps none, so the map draws it as a dot.
 *
 * @param {object} location - normalized
 * @param {string} verification - e.g. "community_edit:edt_…@r2" or "personal"
 */
export function toEventLocation(location, verification) {
    const event = Object.fromEntries(LOCATION_TEXT_FIELDS.map(key => [key, location[key] ?? '']));
    if (location.place_id) event.place_id = location.place_id;
    if (location.wikidata) event.wikidata = location.wikidata;
    event.geography = location.point
        ? { status: 'corrected', ...(location.precision ? { precision: location.precision } : {}), coordinates: [...location.point], verification }
        : null;
    return event;
}

// --- images (WORLD-EDITS.md, The image record) ---

export const IMAGE_SOURCES = ['commons', 'upload', 'link'];
const IMAGE_TEXT_FIELDS = ['source', 'image_url', 'source_url', 'caption', 'credit', 'license_name', 'license_url',
    'rights_statement', 'file_page', 'display_date', 'image_role'];
export const CAPTION_MAX = 500;
export const CREDIT_MAX = 300;
export const RIGHTS_MAX = 1000;
// The uploader's grant (Rachid, 2026-10-27): permission to show, not an open license.
export const UPLOAD_RIGHTS = 'I took this photo or have the right to share it, and I give HistoriLine permission to show it on the site with the credit below.';
export const UPLOAD_LICENSE = 'Used with permission';

/**
 * An image record in the form edits compare: every displayed field trimmed (null when empty) and,
 * for an upload, its file. Null when it has neither a URL nor a file.
 */
export function normalizeImage(value) {
    if (!value || typeof value !== 'object') return null;
    const image = Object.fromEntries(IMAGE_TEXT_FIELDS.map(key => {
        const text = value[key] == null ? '' : String(value[key]).normalize('NFC').trim();
        return [key, text || null];
    }));
    if (value.asset) {
        const { path, sha256, bytes, width, height } = value.asset;
        image.asset = { path: String(path ?? ''), sha256: String(sha256 ?? ''), bytes: Number(bytes) || 0, width: Number(width) || 0, height: Number(height) || 0 };
    }
    if (value.release_pair_id) image.release_pair_id = String(value.release_pair_id);
    return image.image_url || image.asset ? image : null;
}

/** The image a world event shows now, as an image record ("release" for one the data file or a release gave it). */
export function eventImage(event) {
    if (!event?.image_url) return null;
    const preview = event.image_preview ?? {};
    return normalizeImage({
        source: preview.source ?? 'release', image_url: event.image_url, source_url: preview.source_url,
        caption: preview.caption, credit: preview.credit, license_name: preview.license_name, license_url: preview.license_url,
        display_date: preview.date, image_role: preview.role, rights_statement: preview.rights_statement, file_page: preview.file_page,
        release_pair_id: preview.release_pair_id,
    });
}

/** Shows an image record on an event the way released images are shown, or removes the event's image (null). */
export function setEventImage(event, image) {
    if (!image) {
        delete event.image_url;
        delete event.image_preview;
        return;
    }
    event.image_url = image.image_url;
    event.image_preview = {
        source: image.source, caption: image.caption, role: image.image_role, credit: image.credit,
        license_name: image.license_name, license_url: image.license_url, source_url: image.source_url,
        date: image.display_date, rights_statement: image.rights_statement, file_page: image.file_page,
        ...(image.release_pair_id ? { release_pair_id: image.release_pair_id } : {}),
    };
}

/** A field's value as an event holds it, in the form edits compare. */
export function eventFieldValue(event, field) {
    const index = locationIndex(field);
    if (index !== null) return normalizeLocation(event?.locations?.[index]);
    if (field === 'image') return eventImage(event);
    return normalizeField(field, event?.[field]);
}
export const DAILY_LIMIT = 50;
export const DESCRIPTION_MAX = 4000;
export const PERSON_MAX = 200;
export const PEOPLE_MAX = 40;
export const REASON_MAX = 1000;
export const SOURCES_MAX = 5;

export function newEditId() {
    return `edt_${crypto.randomUUID()}`;
}

/**
 * A Wikipedia article URL in one form (https, the article title decoded, spaces as underscores),
 * or null when the text is not a link to a Wikipedia article. A missing scheme is allowed, as
 * people paste "en.wikipedia.org/wiki/…".
 *
 * @param {string|null|undefined} text
 * @returns {string|null}
 */
export function normalizeWikipediaUrl(text) {
    const raw = String(text ?? '').trim();
    if (!raw) return null;
    let url;
    try {
        url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
        return null;
    }
    const host = url.hostname.toLowerCase().replace(/^([a-z-]+)\.m\.wikipedia\.org$/, '$1.wikipedia.org');
    const match = url.pathname.match(/^\/wiki\/(.+)$/);
    if (!/^[a-z-]+\.wikipedia\.org$/.test(host) || !match) return null;
    let title;
    try {
        title = decodeURIComponent(match[1]);
    } catch {
        title = match[1];
    }
    // decoded for one readable form, then "%", "?" and "#" encoded again: in an article title they
    // are text ("Who?"), and left bare they would start a query or fragment and name another page
    title = title.replace(/ /g, '_').replace(/%/g, '%25').replace(/\?/g, '%3F').replace(/#/g, '%23');
    return title ? `https://${host}/wiki/${title}` : null;
}

// A person as stored: { name, wikipedia_url? }. The existing data has plain names, which read
// as people without a link.
export function normalizePerson(person) {
    if (typeof person === 'string') return { name: person.trim() };
    const name = String(person?.name ?? '').trim();
    const url = normalizeWikipediaUrl(person?.wikipedia_url);
    return url ? { name, wikipedia_url: url } : { name };
}

export const normalizeFigures = (figures) => (Array.isArray(figures) ? figures : [])
    .map(normalizePerson).filter(person => person.name);

/**
 * A field's value in the form edits compare: text trimmed, people normalized, the Wikipedia link
 * in one form, a missing value as null.
 *
 * @param {string} field - one of EDIT_FIELDS
 * @param {*} value
 */
export function normalizeField(field, value) {
    if (locationIndex(field) !== null) return normalizeLocation(value);
    switch (field) {
        case 'image': return normalizeImage(value);
        case 'figures': return normalizeFigures(value);
        case 'categories': return (Array.isArray(value) ? value : [value]).map(c => String(c ?? '').trim()).filter(Boolean);
        case 'wikipedia_url': {
            const text = String(value ?? '').trim();
            return text ? (normalizeWikipediaUrl(text) ?? text) : null;
        }
        default: {
            const text = String(value ?? '').normalize('NFC').trim();
            return text || null;
        }
    }
}

// JSON with object keys sorted, so equal values always serialize the same way.
export function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value ?? null);
}

export const sameValue = (a, b) => canonicalJson(a) === canonicalJson(b);

/**
 * The changes an edit proposes: only the fields whose value differs from the event's, each with
 * the value the author saw (before) and the proposed one (after).
 *
 * @param {object} event - the world event as shown
 * @param {object} values - field -> the form's value, for any edit field (location[i] included)
 * @returns {Object<string, { before: *, after: * }>}
 */
export function changesFor(event, values) {
    const changes = {};
    for (const field of Object.keys(values).filter(isEditField)) {
        const before = eventFieldValue(event, field);
        const after = normalizeField(field, values[field]);
        if (!sameValue(before, after)) changes[field] = { before, after };
    }
    return changes;
}

// A new event needs these; the other fields are optional.
export const REQUIRED_FIELDS = ['name', 'enhanced_time', 'enhanced_description'];
const REQUIRED_MESSAGES = {
    name: 'The event needs a name.', enhanced_time: 'The event needs a date.', enhanced_description: 'The event needs a description.',
};

/**
 * The changes a new event proposes: every field the form fills in, each with before: null.
 *
 * @param {object} values - field -> the form's value, for any edit field (location[i] included)
 * @returns {Object<string, { before: null, after: * }>}
 */
export function newEventChanges(values) {
    const changes = {};
    for (const field of Object.keys(values).filter(isEditField)) {
        const after = normalizeField(field, values[field]);
        if (after !== null && !(Array.isArray(after) && !after.length)) changes[field] = { before: null, after };
    }
    return changes;
}

const HTML_TAG = /<\/?[a-z!][^>]*>/i;

function isHttpUrl(text) {
    try {
        return ['http:', 'https:'].includes(new URL(text).protocol);
    } catch {
        return false;
    }
}

/**
 * Why an edit can't be sent, or null. These are the checks that need no network; the Wikipedia
 * lookups are done by the form as the author types.
 *
 * @param {{ kind?: 'update'|'create', changes: object, reason?: string, sources?: string[] }} edit
 * @returns {string|null}
 */
export function editProblem({ kind = 'update', changes, reason = '', sources = [] }) {
    if (kind === 'create') {
        const missing = REQUIRED_FIELDS.find(field => !changes?.[field]);
        if (missing) return REQUIRED_MESSAGES[missing];
    }
    const fields = Object.keys(changes ?? {});
    if (!fields.length) return 'Change at least one field before sending.';
    const texts = [];
    for (const field of fields) {
        const after = changes[field].after;
        if (locationIndex(field) !== null) {
            const problem = locationProblem(after, kind);
            if (problem) return problem;
            if (after) texts.push(...LOCATION_TEXT_FIELDS.map(key => after[key]));
            continue;
        }
        switch (field) {
            case 'image': {
                const problem = imageProblem(after);
                if (problem) return problem;
                if (after) texts.push(after.caption ?? '', after.credit ?? '', after.rights_statement ?? '');
                break;
            }
            case 'name':
                if (!after) return REQUIRED_MESSAGES.name;
                if (after.length > NAME_MAX) return `Keep the event name under ${NAME_MAX + 1} characters.`;
                texts.push(after);
                break;
            case 'enhanced_time': {
                if (!after) return REQUIRED_MESSAGES.enhanced_time;
                const problem = eventProblem({ name: 'event', enhanced_time: after });
                if (problem) return problem;
                break;
            }
            case 'enhanced_description':
                if (!after) return REQUIRED_MESSAGES.enhanced_description;
                if (after.length > DESCRIPTION_MAX) return `Keep the description under ${DESCRIPTION_MAX + 1} characters.`;
                texts.push(after);
                break;
            case 'figures':
                if (after.length > PEOPLE_MAX) return `List at most ${PEOPLE_MAX} people.`;
                for (const person of after) {
                    if (person.name.length > PERSON_MAX) return `Keep each person's name under ${PERSON_MAX + 1} characters.`;
                    texts.push(person.name);
                }
                break;
            case 'categories':
                if (!after.length) return 'Choose a category.';
                break;
            case 'wikipedia_url':
                if (after && !normalizeWikipediaUrl(after)) return 'Use a link to a Wikipedia article, like en.wikipedia.org/wiki/Battle_of_Hastings.';
                break;
            default:
                return `"${field}" can't be edited here.`;
        }
    }
    if (texts.some(text => HTML_TAG.test(text))) return 'Use plain text: remove the HTML tags.';
    if (String(reason).length > REASON_MAX) return `Keep the note under ${REASON_MAX + 1} characters.`;
    if (sources.length > SOURCES_MAX) return `Give at most ${SOURCES_MAX} sources.`;
    if (sources.some(source => !isHttpUrl(source))) return 'Each source must be a web link starting with http:// or https://.';
    return null;
}

// Why a proposed location can't be sent, or null. Removing one (null) is an update only.
function locationProblem(location, kind) {
    if (location === null) return kind === 'create' ? 'Remove the empty place, or fill it in.' : null;
    if (LOCATION_TEXT_FIELDS.some(key => location[key].length > LOCATION_TEXT_MAX)) {
        return `Keep each part of a place under ${LOCATION_TEXT_MAX + 1} characters.`;
    }
    if (!location.name && !location.city && !location.country) return 'Give each place a name, a city or a country.';
    return null;
}

const isHttps = (text) => {
    try {
        return new URL(text).protocol === 'https:';
    } catch {
        return false;
    }
};

/**
 * Why a proposed image can't be sent, or null. Removing the image (null) is allowed. A Commons image
 * or a link carries its URL; an upload carries its file and the uploader's grant, and gets its public
 * URL only when it is approved.
 *
 * @param {object|null} image - normalized
 * @returns {string|null}
 */
export function imageProblem(image) {
    if (image === null) return null;
    if (!IMAGE_SOURCES.includes(image.source)) return 'Add the image as an upload or a link.';
    if (image.source !== 'upload' && !isHttps(image.image_url)) return 'Use an image link that starts with https://.';
    if ((image.caption ?? '').length > CAPTION_MAX) return `Keep the caption under ${CAPTION_MAX + 1} characters.`;
    if ((image.credit ?? '').length > CREDIT_MAX) return `Keep the credit under ${CREDIT_MAX + 1} characters.`;
    if ((image.rights_statement ?? '').length > RIGHTS_MAX) return `Keep the note on the image's rights under ${RIGHTS_MAX + 1} characters.`;
    if (image.source === 'upload') {
        if (!image.credit) return 'Say who took the photo, for its credit.';
        if (image.rights_statement !== UPLOAD_RIGHTS) return 'Confirm that you may share this photo.';
        const asset = image.asset;
        if (!asset || !/^[0-9a-f]{64}$/.test(asset.sha256) || !asset.path || !(asset.bytes > 0)) return 'The photo has not finished uploading.';
    }
    return null;
}

/**
 * The SHA-256 that ties checks and reviews to one revision of an edit (WORLD-EDITS.md,
 * "Revisions are immutable once judged").
 */
export function contentSha256({ changes, reason = '', sources = [], source_conflict = false }) {
    const text = canonicalJson({ changes, reason, sources, source_conflict });
    return sha256Hex(new TextEncoder().encode(text));
}

// The internal states (WORLD-EDITS.md, Statuses) as the four statuses editors see.
const EDITOR_STATUS = {
    submitted: 'waiting', flagged: 'waiting', ready: 'waiting', conflict: 'waiting',
    auto_rejected: 'rejected', sent_back: 'rejected', rejected: 'rejected',
    approved: 'accepted', published: 'accepted',
    merged: 'published',
    withdrawn: 'withdrawn',
};
export const EDITOR_STATUS_LABELS = {
    waiting: 'Waiting for review', rejected: 'Rejected', accepted: 'Accepted', published: 'Published', withdrawn: 'Withdrawn',
};

export const editorStatus = (edit) => EDITOR_STATUS[edit?.status] ?? 'waiting';

// Waiting for review and rejected edits can still be revised or withdrawn by their author.
export const isOpen = (edit) => ['waiting', 'rejected'].includes(editorStatus(edit));

// --- review and publication (WORLD-EDITS.md: Merging several edits on one event, Publishing to visitors) ---

// Edits an admin can decide. Without the agents' checker (phase 3), new edits stay submitted.
export const REVIEWABLE_STATUSES = ['submitted', 'flagged', 'ready', 'conflict', 'auto_rejected'];

// The overlay stays well under Firestore's 1 MiB document limit; past this, approved edits must be
// folded into the dataset before more are approved.
export const OVERLAY_MAX_BYTES = 900 * 1024;

export const emptyOverlay = () => ({ version: 0, patches: {}, created: {} });

/**
 * The value visitors see for a field: the overlay's approved value when it has one, else the value
 * the edit was written against.
 *
 * @param {object|null} overlay - world_overlay/current
 * @param {string} eventId
 * @param {string} field
 * @param {*} fallback - the dataset's value, as far as the caller knows it
 */
export function publishedValue(overlay, eventId, field, fallback) {
    const patch = overlay?.patches?.[eventId]?.[field];
    if (patch) return patch.value;
    const created = overlay?.created?.[eventId]?.record;
    return created ? eventFieldValue(created, field) : fallback;
}

/**
 * The fields of an update edit whose `before` is no longer the published value, because another
 * approval changed them since the edit was written.
 *
 * @param {object} edit
 * @param {object|null} overlay
 * @returns {string[]}
 */
export function conflictingFields(edit, overlay) {
    if (edit.kind === 'create') return [];
    return Object.entries(edit.changes ?? {})
        .filter(([field, change]) => !sameValue(publishedValue(overlay, edit.event_id, field, change.before), change.before))
        .map(([field]) => field);
}

// Where an approved location came from, on the event visitors see (WORLD-EDITS.md, Location edits).
export const editVerification = (edit) => `community_edit:${edit.edit_id}@r${edit.revision}`;

/**
 * Sets one field on an event in the dataset's shape: a location at its position (null marks it for
 * removal; compactLocations drops it), the image as released images are shown, or a plain field.
 */
export function setEventField(event, field, value, verification) {
    const index = locationIndex(field);
    if (index !== null) {
        event.locations = [...(event.locations ?? [])];
        while (event.locations.length < index) event.locations.push(null);
        event.locations[index] = value ? toEventLocation(value, verification) : null;
    } else if (field === 'image') {
        setEventImage(event, value);
    } else {
        event[field] = structuredClone(value);
    }
}

// Drops the locations setEventField marked for removal, once every patch on the event is applied.
export function compactLocations(event) {
    if (event.locations?.some(location => location === null)) event.locations = event.locations.filter(Boolean);
}

/**
 * The world event a new-event edit describes, in the dataset's shape.
 *
 * @param {object} edit
 * @param {string[]} [fields] - the approved fields; a new event can be approved without its image
 * @param {object} [values] - field -> the value to publish instead of the proposal (an image's confirmed credit)
 */
export function newEventRecord(edit, fields = Object.keys(edit.changes), values = {}) {
    const record = { event_id: edit.event_id, confidence: 'high', locations: [], figures: [], categories: [] };
    for (const [field, change] of Object.entries(edit.changes)) {
        const value = field in values ? values[field] : change.after;
        if (fields.includes(field) && value !== null) setEventField(record, field, value, editVerification(edit));
    }
    compactLocations(record);
    return record;
}

// Free licenses a Commons image can carry without a reviewer confirming it (WORLD-EDITS.md, checks).
const FREE_LICENSE = /^(cc0|cc[ -]by(-sa)?( \d(\.\d)?)?|public domain|pd\b)/i;

// The author's browser writes the whole record, so "Commons" counts only for an image served from Commons
// with a Commons file page; the review page also reads the license from Commons again (review-ui.js).
const COMMONS_IMAGE = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//;
const COMMONS_PAGE = /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/;
export const isCommonsImage = (image) => image?.source === 'commons' && COMMONS_IMAGE.test(image.image_url ?? '')
    && COMMONS_PAGE.test(image.source_url ?? '') && /^File:/.test(image.file_page ?? '');

/**
 * Whether a reviewer must confirm an image's license before it is published: every upload and link
 * from another site, and anything but a Commons file with a free license (Rachid, 2026-10-31).
 */
export const imageNeedsConfirmation = (image) => Boolean(image) && !(isCommonsImage(image) && FREE_LICENSE.test(image.license_name ?? ''));

export const recordSha256 = (record) => sha256Hex(new TextEncoder().encode(canonicalJson(record)));

/**
 * The overlay with an edit's approved fields published (WORLD-EDITS.md, Publishing to visitors).
 * Every field is judged against the value visitors see now, so successive approvals compose: A→B
 * then B→C leaves one patch from base A to value C, with both receipts in its chain. A new event
 * is published whole. The overlay is public, so receipts name the edit and the time, never a
 * person (Rachid, 2026-10-31); who approved stays in the private edit.
 *
 * @param {object|null} overlay - world_overlay/current, or null before the first approval
 * @param {object} edit - the edit as stored
 * @param {string[]} fields - the fields being approved (all of them for a new event)
 * @param {string} approvedAt - ISO time of the approval
 * @param {object} [values] - field -> the value to publish instead of the proposal: an image with the
 *   reviewer's confirmed credit and license, its public URL for an upload, or null to approve a new
 *   event without its image
 * @returns {Promise<object>} the next overlay, its version one higher
 */
export async function withApproval(overlay, edit, fields, approvedAt, values = {}) {
    const next = structuredClone(overlay ?? emptyOverlay());
    next.patches ??= {};
    next.created ??= {};
    next.version = (overlay?.version ?? 0) + 1;
    const receipt = { edit_id: edit.edit_id, revision: edit.revision, approved_at: approvedAt };
    if (edit.kind === 'create') {
        if (next.created[edit.event_id]) throw new Error('This new event is already published.');
        const record = newEventRecord(edit, Object.keys(edit.changes), values);
        next.created[edit.event_id] = { record, record_sha256: await recordSha256(record), ...receipt };
        return next;
    }
    for (const field of fields) {
        const change = edit.changes[field];
        if (!change) throw new Error(`The edit doesn't change "${field}".`);
        const value = field in values ? normalizeField(field, values[field]) : change.after;
        const patches = (next.patches[edit.event_id] ??= {});
        const patch = patches[field];
        const before = publishedValue(next, edit.event_id, field, change.before);
        const step = { ...receipt, before, after: value };
        if (patch) {
            patch.chain.push(step);
            patch.value = value;
        } else {
            patches[field] = { base: change.before, prior_bases: [], value, chain: [step] };
        }
    }
    return next;
}

/**
 * A word-level diff of two texts, for the review page: runs of unchanged, removed and added text,
 * spaces kept with the words they follow.
 *
 * @param {string|null} before
 * @param {string|null} after
 * @returns {{ kind: 'same'|'removed'|'added', text: string }[]}
 */
export function wordDiff(before, after) {
    const a = String(before ?? '').split(/(?<=\s)/);
    const b = String(after ?? '').split(/(?<=\s)/);
    // longest common subsequence of words, from the end, so the walk below goes forward
    const lcs = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) {
        for (let j = b.length - 1; j >= 0; j--) {
            lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
        }
    }
    const runs = [];
    const push = (kind, text) => {
        if (!text) return;
        if (runs.at(-1)?.kind === kind) runs.at(-1).text += text;
        else runs.push({ kind, text });
    };
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) {
            push('same', a[i]);
            i++;
            j++;
        } else if (i < a.length && (j === b.length || lcs[i + 1][j] >= lcs[i][j + 1])) {
            push('removed', a[i++]);
        } else {
            push('added', b[j++]);
        }
    }
    return runs;
}

// The overlay's size as Firestore will store it, near enough to keep under OVERLAY_MAX_BYTES.
export const overlayBytes = (overlay) => new TextEncoder().encode(JSON.stringify(overlay)).length;

/**
 * The edit that reverts an approved edit's fields (WORLD-EDITS.md, Revert): each field goes back
 * to the value it had before that approval, starting from the value visitors see now. It is an
 * ordinary edit, approved like any other, so the revert keeps its own receipt.
 *
 * @param {object} edit - a published update edit
 * @param {object} overlay
 * @returns {Object<string, { before: *, after: * }>} its changes, empty when nothing is left to revert
 */
export function revertChanges(edit, overlay) {
    const changes = {};
    for (const [field, disposition] of Object.entries(edit.fields ?? {})) {
        if (disposition.status !== 'approved') continue;
        const step = overlay?.patches?.[edit.event_id]?.[field]?.chain?.find(s => s.edit_id === edit.edit_id);
        if (!step) continue;
        const current = publishedValue(overlay, edit.event_id, field, step.after);
        if (!sameValue(current, step.before)) changes[field] = { before: current, after: step.before };
    }
    return changes;
}

/**
 * The document a new edit is stored as, without the server-set times, which edit-store.js adds.
 * For a new event, event is { event_id, name } with the ID assigned at submission.
 *
 * @param {{ editId: string, kind?: 'update'|'create', event: object, changes: object, reason: string,
 *           sources: string[], sourceConflict: boolean, author: { uid: string, email: string },
 *           datasetSha256: string|null, contentSha: string, browserChecks: object[] }} input
 */
export function toEditDoc({ editId, kind = 'update', event, changes, reason, sources, sourceConflict, author, datasetSha256, contentSha, browserChecks }) {
    return {
        edit_id: editId,
        kind,
        event_id: event.event_id,
        event_name: event.name,
        dataset: { id: 'world-history', sha256: datasetSha256 ?? null, locations_release_sha256: null },
        changes,
        reason,
        sources,
        source_conflict: sourceConflict,
        author,
        revision: 1,
        content_sha256: contentSha,
        status: 'submitted',
        checks: { browser: browserChecks },
    };
}
