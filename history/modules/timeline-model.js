// timeline-model.js
// Validation and field mapping for personal timelines (see PERSONAL-TIMELINES.md). No browser or
// Firebase imports, so the rules here are unit-tested in Node.
import { numericDateParts, parseTimeToSortableValue } from './date-handlers.js';

export const TITLE_MAX = 120;
export const NAME_MAX = 300;

// Event fields stored in a personal timeline; everything else on a local event is display state.
const EVENT_FIELDS = ['event_id', 'name', 'enhanced_time', 'enhanced_description', 'categories',
    'locations', 'figures', 'wikipedia_url', 'confidence', 'image',
    // an image shown from its link, with its credit (image-link.js), instead of a private photo
    'image_url', 'image_preview'];

// The image role of a photo in a personal timeline (see PERSONAL-IMAGES.md).
export const PERSONAL_PHOTO_ROLE = 'personal_photo';

export function newTimelineId() {
    return `tl_${crypto.randomUUID()}`;
}

/**
 * A timeline's generation: "<seconds>_<nanoseconds>" of its createdAt, exactly as stored. Photo
 * paths carry it, so files from a deleted timeline never surface in one recreated with its ID.
 *
 * @param {{ seconds: number, nanoseconds: number }} createdAt - a Firestore Timestamp
 * @returns {string}
 */
export function timelineGeneration(createdAt) {
    return `${createdAt.seconds}_${createdAt.nanoseconds}`;
}

/**
 * Why a timeline title is not acceptable, or null if it is.
 *
 * @param {string} title
 * @returns {string|null}
 */
export function titleProblem(title) {
    const trimmed = String(title ?? '').trim();
    if (!trimmed) return 'Give the timeline a name.';
    if (trimmed.length > TITLE_MAX) return `Keep the name under ${TITLE_MAX + 1} characters.`;
    return null;
}

/**
 * Why an event cannot be saved to a timeline, or null if it can. The date must be one the
 * timeline can place: the parser returns year 0, which does not exist historically, for text it
 * does not recognize.
 *
 * @param {{ name?: string, enhanced_time?: string }} event
 * @returns {string|null}
 */
export function eventProblem(event) {
    const name = String(event.name ?? '').trim();
    if (!name) return 'Give the event a name.';
    if (name.length > NAME_MAX) return `Keep the event name under ${NAME_MAX + 1} characters.`;
    const time = String(event.enhanced_time ?? '').trim();
    if (!time) return 'Give the event a date.';
    const parsed = parseTimeToSortableValue(time);
    if (!parsed || typeof parsed !== 'object' || parsed.year === 0 || !numericDateIsRead(time, parsed)) {
        return `"${time}" is not a date the timeline can place. Try forms like 1931, March 1931, 1/25/1976, 44 BC or Spring 1950.`;
    }
    return null;
}

// Text with a slashed numeric date (n/n/n) is accepted only if that date names a real day, as
// month/day/year (1/25/1976) or year/month/day (1941/7/1), and the parser read exactly that day.
// Otherwise (early 1/25/1976, 2/30/1976, 1/25/76, 1/25/0001, two such dates) the parser falls
// back to reading a single number as the year and would silently save an unrelated date.
function numericDateIsRead(time, parsed) {
    const triples = [...time.matchAll(/(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/g)];
    if (triples.length === 0) return true;
    if (triples.length > 1) return false;
    const [, a, b, c] = triples[0];
    const expected = a.length >= 3 && Number(b) <= 12
        ? numericDateParts(`${b}/${c}/${a}`)
        : numericDateParts(`${a}/${b}/${c}`);
    return Boolean(expected) && parsed.year === expected.year && parsed.month === expected.month
        && parsed.day === expected.day;
}

/**
 * The fields of an event as stored in a personal timeline.
 *
 * @param {object} event
 * @returns {object}
 */
export function toTimelineEventDoc(event) {
    const out = {};
    for (const field of EVENT_FIELDS) {
        if (event[field] !== undefined && event[field] !== null && event[field] !== '') out[field] = event[field];
    }
    return out;
}

/**
 * The timeline ID in a page address, or null.
 *
 * @param {string} search - location.search
 * @returns {string|null}
 */
export function timelineIdFromSearch(search) {
    const id = new URLSearchParams(search).get('timeline');
    return id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}
