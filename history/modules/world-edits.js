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
    return created && field in created ? normalizeField(field, created[field]) : fallback;
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

// The world event a new-event edit describes, in the dataset's shape.
export function newEventRecord(edit) {
    const record = { event_id: edit.event_id, confidence: 'high', locations: [], figures: [], categories: [] };
    for (const [field, change] of Object.entries(edit.changes)) {
        if (change.after !== null) record[field] = change.after;
    }
    return record;
}

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
 * @returns {Promise<object>} the next overlay, its version one higher
 */
export async function withApproval(overlay, edit, fields, approvedAt) {
    const next = structuredClone(overlay ?? emptyOverlay());
    next.patches ??= {};
    next.created ??= {};
    next.version = (overlay?.version ?? 0) + 1;
    const receipt = { edit_id: edit.edit_id, revision: edit.revision, approved_at: approvedAt };
    if (edit.kind === 'create') {
        if (next.created[edit.event_id]) throw new Error('This new event is already published.');
        const record = newEventRecord(edit);
        next.created[edit.event_id] = { record, record_sha256: await recordSha256(record), ...receipt };
        return next;
    }
    for (const field of fields) {
        const change = edit.changes[field];
        if (!change) throw new Error(`The edit doesn't change "${field}".`);
        const patches = (next.patches[edit.event_id] ??= {});
        const patch = patches[field];
        const before = publishedValue(next, edit.event_id, field, change.before);
        const step = { ...receipt, before, after: change.after };
        if (patch) {
            patch.chain.push(step);
            patch.value = change.after;
        } else {
            patches[field] = { base: change.before, prior_bases: [], value: change.after, chain: [step] };
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
