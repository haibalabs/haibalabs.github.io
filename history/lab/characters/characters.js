// Character cards (lab prototype, ?lab=characters). A person named on an event card who is one of the profiled
// characters (characters.json) opens their card, pinned above the timeline with only their events under it. The card
// folds to one line once the events scroll. Its map button shows those events with the site's own dots and
// bubbles; the article button opens the person's article in the article panel; Close puts the timeline back where
// it was. An event belongs to a character when one of its people is written with the character's exact
// name, as in Ariadne's prototype; none of these links is reviewed.

const FOLD_AT = 60;
const UNFOLD_AT = 8;
let active = null;

const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const figureName = figure => (typeof figure === 'string' ? figure : figure?.name ?? '');

let wanted = false;

export async function setCharacters(lab, on) {
    wanted = Boolean(on);
    if (!on) {
        active?.stop();
        active = null;
        return;
    }
    if (active) return;
    const response = await fetch(new URL('characters.json', import.meta.url));
    if (!response.ok) throw new Error(`Could not load the characters (${response.status})`);
    const { characters } = await response.json();
    // the switch may have gone off, or on again, while the characters loaded
    if (wanted && !active) active = new Characters(lab, characters);
}

class Characters {
    constructor(lab, characters) {
        this.lab = lab;
        this.characters = characters;
        this.byName = new Map(characters.flatMap(c => c.names.map(name => [name, c])));
        this.current = null;
        this.css = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: new URL('characters.css', import.meta.url).href });
        document.head.append(this.css);
        this.wrapper = document.getElementById('timeline-wrapper');
        this.content = document.getElementById('timeline-content');
        // a click on a character's name opens their card instead of their article; it is caught before the name's own handler
        this.onClick = event => {
            const mention = event.target.closest?.('.figure-mention');
            const character = mention && this.byName.get(mention.dataset.figure);
            if (!character) return;
            event.stopPropagation();
            event.preventDefault();
            this.open(character);
        };
        document.addEventListener('click', this.onClick, true);
        this.onScroll = () => this.fold();
        this.wrapper.addEventListener('scroll', this.onScroll, { passive: true });
        // the timeline draws cards as they scroll into view, so names and events are marked as they appear
        this.observer = new MutationObserver(() => this.mark());
        this.observer.observe(this.content, { childList: true, subtree: true });
        this.mark();
    }

    // The world events whose people include the character by exact name, earliest first.
    eventsOf(character) {
        const names = new Set(character.names);
        const index = this.lab.eventManager.placeIndex;
        return this.lab.eventManager.events
            .filter(event => !event.personal && event.figures?.some(figure => names.has(figureName(figure))))
            .sort((a, b) => (index.years.get(index.idFor(a)) ?? 0) - (index.years.get(index.idFor(b)) ?? 0));
    }

    mark() {
        for (const mention of this.content.querySelectorAll('.figure-mention:not([data-character-checked])')) {
            mention.dataset.characterChecked = '';
            if (this.byName.has(mention.dataset.figure)) mention.classList.add('is-character');
        }
        if (!this.current) return;
        for (const card of this.content.querySelectorAll('.event[data-event-id]')) {
            card.classList.toggle('character-event', this.cardIds.has(card.dataset.eventId));
        }
    }

    open(character) {
        if (!this.current) {
            // what the timeline showed before the first card: its event filter (the staging page's new events) and
            // its search, which would hide most of the person's events; both come back when the card closes
            this.previousFilter = this.lab.eventManager.eventIdFilter ?? null;
            const search = document.getElementById('searchInput');
            this.previousSearch = search?.value ?? '';
            // the card at the top of the timeline, to come back to
            this.previousTop = this.topCard();
            if (this.previousSearch) document.getElementById('clearSearch')?.click();
        }
        this.current = character;
        this.events = this.eventsOf(character);
        this.ids = new Set(this.events.map(event => event.event_id));
        // the timeline's own key for each card (data-event-id), which the map and the marks go by
        const index = this.lab.eventManager.placeIndex;
        this.cardIds = new Set(this.events.map(event => index.idFor(event)));
        this.render();
        // the timeline draws the cards around its scroll position, so it goes to the top before the person's events
        // replace the others; a position deep in the timeline would draw only their last events, out of view
        this.wrapper.scrollTop = 0;
        this.lab.uiManager.showOnlyEvents(this.ids);
        this.fold();
        if (this.mapOn) this.showEventsOnMap();
        this.mark();
    }

    render() {
        const c = this.current;
        const life = (word, c) => (c ? `<p class="character-life">${word} ${escapeHtml(c.display)}${c.place ? `, ${escapeHtml(c.place)}` : ''}</p>` : '');
        if (!this.bar) {
            this.bar = document.createElement('section');
            this.bar.className = 'character-bar';
            this.bar.setAttribute('aria-label', 'Character');
            this.wrapper.before(this.bar);
            this.wrapper.parentElement.classList.add('has-character');
            // the timeline below gets the height the card leaves, as the card folds and unfolds
            this.resize = new ResizeObserver(() => {
                this.wrapper.parentElement.style.setProperty('--character-height', `${this.bar.offsetHeight}px`);
            });
            this.resize.observe(this.bar);
            // the card spans the timeline's width, which shrinks while a panel is open
            this.panelWatch = new MutationObserver(() => this.bar.classList.toggle('panel-open', this.wrapper.classList.contains('panel-open')));
            this.panelWatch.observe(this.wrapper, { attributes: true, attributeFilter: ['class'] });
            this.bar.classList.toggle('panel-open', this.wrapper.classList.contains('panel-open'));
            // once the fold has finished, the timeline draws the cards the extra height reveals
            this.bar.addEventListener('transitionend', event => {
                if (event.target.classList.contains('character-portrait')) this.wrapper.dispatchEvent(new Event('scroll'));
            });
        }
        this.bar.innerHTML = `<div class="character-card">
            ${c.image?.url ? `<img class="character-portrait" src="${escapeHtml(c.image.url)}" alt="">` : '<div class="character-portrait"></div>'}
            <div class="character-text">
                <h2>${escapeHtml(c.name)}</h2>
                <div class="character-more"><div>
                    ${life('Born', c.birth)}
                    ${life('Died', c.death)}
                    <p class="character-title">${escapeHtml(c.title)}</p>
                    <p class="character-summary">${escapeHtml(c.summary)}</p>
                </div></div>
                <div class="character-actions">
                    <button type="button" class="character-btn" data-action="places" aria-pressed="false" title="Places in these events" aria-label="Places in these events"><i class="fa-light fa-map-location-dot" aria-hidden="true"></i></button>
                    <button type="button" class="character-btn" data-action="article" title="Read about ${escapeHtml(c.name)}" aria-label="Read about ${escapeHtml(c.name)}"><i class="fa-light fa-scroll" aria-hidden="true"></i></button>
                </div>
            </div>
            <button type="button" class="character-close" data-action="close" title="Close" aria-label="Close ${escapeHtml(c.name)}'s card"><i class="fa-light fa-xmark" aria-hidden="true"></i></button>
        </div>`;
        this.bar.querySelector('[data-action="places"]').setAttribute('aria-pressed', String(Boolean(this.mapOn)));
        for (const button of this.bar.querySelectorAll('[data-action]')) {
            button.addEventListener('click', () => this[button.dataset.action](button));
        }
    }

    // folds the card to one line once the events scroll under it, and unfolds it back at the top
    fold() {
        if (!this.bar) return;
        const top = this.wrapper.scrollTop;
        if (top > FOLD_AT) this.bar.classList.add('folded');
        else if (top < UNFOLD_AT) this.bar.classList.remove('folded');
    }

    places(button) {
        this.mapOn = !this.mapOn;
        button.setAttribute('aria-pressed', String(this.mapOn));
        if (!this.mapOn) return this.lab.browser.clusters.configure({ always: false, only: null });
        this.lab.panelManager.openMapPanel();
        // the events go on once the map panel has opened, unless the card closed in the meantime
        clearTimeout(this.mapTimer);
        this.mapTimer = setTimeout(() => {
            if (!this.current) return;
            this.lab.map.invalidateSize();
            this.showEventsOnMap();
        }, 300);
    }

    // The person's events on the map with the site's own dots and bubbles (event-clusters.js): close events group,
    // and a dot or a bubble's list selects its event, as for any event. The map frames them all.
    showEventsOnMap() {
        const index = this.lab.eventManager.placeIndex;
        this.lab.browser.clusters.configure({ always: true, only: event => this.cardIds.has(index.idFor(event)) });
        const points = [...this.cardIds].flatMap(id => (index.eventPoints.get(id) || []).map(point => point.coordinates));
        if (points.length) this.lab.map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 6 });
    }

    // The card at the top of the timeline.
    topCard() {
        const top = this.wrapper.getBoundingClientRect().top;
        return [...this.content.querySelectorAll(':scope > .event[data-event-id]')]
            .find(card => card.getBoundingClientRect().width > 0 && card.getBoundingClientRect().bottom > top + 1)?.dataset.eventId ?? null;
    }

    article(button) {
        this.lab.panelManager.handleInfoClick(this.current.wikipedia_url, button);
    }

    close() {
        this.current = null;
        clearTimeout(this.mapTimer);
        if (this.mapOn) this.lab.browser.clusters.configure({ always: false, only: null });
        this.mapOn = false;
        this.resize?.disconnect();
        this.panelWatch?.disconnect();
        this.bar?.remove();
        this.bar = null;
        this.wrapper.parentElement.classList.remove('has-character');
        this.wrapper.parentElement.style.removeProperty('--character-height');
        for (const card of this.content.querySelectorAll('.character-event')) card.classList.remove('character-event');
        // the timeline as it was: its search, its filter, and the card that was at the top
        const search = document.getElementById('searchInput');
        if (this.previousSearch && search) {
            search.value = this.previousSearch;
            document.getElementById('clearSearch')?.classList.add('visible');
            this.lab.uiManager.currentSearch = this.previousSearch.toLowerCase();
        }
        this.lab.uiManager.showOnlyEvents(this.previousFilter ?? null);
        const target = this.previousTop;
        if (target && this.lab.uiManager.scrollToEventId(target)) {
            // the timeline measures the cards it has just drawn and moves them, so align the card once more after that
            requestAnimationFrame(() => requestAnimationFrame(() => {
                const card = this.content.querySelector(`.event[data-event-id="${CSS.escape(target)}"]`);
                if (card && !this.current) this.wrapper.scrollTop += card.getBoundingClientRect().top - this.wrapper.getBoundingClientRect().top;
            }));
        }
    }

    stop() {
        if (this.current) this.close();
        document.removeEventListener('click', this.onClick, true);
        this.wrapper.removeEventListener('scroll', this.onScroll);
        this.observer.disconnect();
        for (const mention of this.content.querySelectorAll('[data-character-checked]')) {
            delete mention.dataset.characterChecked;
            mention.classList.remove('is-character');
        }
        this.css.remove();
    }
}
