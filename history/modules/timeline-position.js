// timeline-position.js
// Keeps the reader's place in the world timeline for this tab: the event at the top of the timeline and how far it
// sits from the top, saved when the page is left (the review page, a reload, another site) and restored on the next
// start in the same tab. An open personal timeline (?timeline=) starts where it always does.
const KEY = 'historiline:timeline-position';

function read() {
    try {
        const saved = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
        return saved && typeof saved.id === 'string' && Number.isFinite(saved.offset) ? saved : null;
    } catch {
        return null;
    }
}

// The first event card still showing at the top of the timeline, and its distance from the top.
function topEvent(container) {
    const top = container.getBoundingClientRect().top;
    for (const card of container.querySelectorAll('.event[data-event-id]')) {
        const box = card.getBoundingClientRect();
        if (box.bottom > top + 1) return { id: card.dataset.eventId, offset: box.top - top };
    }
    return null;
}

export function keepTimelinePosition(uiManager, { restore = true } = {}) {
    const container = uiManager.timelineContainer;
    const save = () => {
        if (new URL(location.href).searchParams.has('timeline')) return;
        const place = topEvent(container);
        try {
            if (place) sessionStorage.setItem(KEY, JSON.stringify(place));
        } catch {
            // storage refused (private mode): the timeline starts at its usual place next time
        }
    };
    addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
    const saved = restore && !new URL(location.href).searchParams.has('timeline') ? read() : null;
    if (!saved || !uiManager.scrollToEventId(saved.id)) return false;
    // scrollToEventId puts the card near the top; the cards around it are measured over the next frames, which moves
    // it, so it is set back where it sat each frame for half a second, or until the reader scrolls
    const until = performance.now() + 500;
    let stopped = false;
    const stop = () => { stopped = true; };
    for (const type of ['wheel', 'touchstart', 'keydown', 'pointerdown']) addEventListener(type, stop, { once: true, passive: true });
    const settle = () => {
        if (stopped || performance.now() > until) return;
        const card = [...container.querySelectorAll('.event[data-event-id]')].find(el => el.dataset.eventId === saved.id);
        const off = card ? card.getBoundingClientRect().top - container.getBoundingClientRect().top - saved.offset : 0;
        if (Math.abs(off) >= 1) container.scrollTop += off;
        requestAnimationFrame(settle);
    };
    requestAnimationFrame(() => requestAnimationFrame(settle));
    return true;
}
