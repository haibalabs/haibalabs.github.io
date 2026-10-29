// world-edits.js
// Proposed edits to world events (WORLD-EDITS.md): the fields an edit may change, how the
// form's values become field-level changes, the checks run in the browser before an edit is
// sent, and the four statuses an editor sees. Firestore access is in edit-store.js and the
// screens in edit-ui.js.
import { eventProblem, NAME_MAX } from './timeline-model.js';
import { sha256Hex } from './world-images.js';

// Phase 1 fields; location and image arrive in phase 4.
export const EDIT_FIELDS = ['name', 'enhanced_time', 'enhanced_description', 'figures', 'categories', 'wikipedia_url'];
export const FIELD_LABELS = {
    name: 'Name', enhanced_time: 'Date', enhanced_description: 'Description',
    figures: 'People', categories: 'Category', wikipedia_url: 'Wikipedia article',
};
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
    switch (field) {
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
 * @param {object} values - field -> the form's value, for any of EDIT_FIELDS
 * @returns {Object<string, { before: *, after: * }>}
 */
export function changesFor(event, values) {
    const changes = {};
    for (const field of EDIT_FIELDS) {
        if (!(field in values)) continue;
        const before = normalizeField(field, event[field]);
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
 * @param {object} values - field -> the form's value, for any of EDIT_FIELDS
 * @returns {Object<string, { before: null, after: * }>}
 */
export function newEventChanges(values) {
    const changes = {};
    for (const field of EDIT_FIELDS) {
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
        switch (field) {
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
