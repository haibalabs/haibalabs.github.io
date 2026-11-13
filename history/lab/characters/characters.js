// Character cards (lab prototype, ?lab=characters). A person named on an event card who is one of the profiled
// characters (characters.json) opens their card, pinned above the timeline with only their events under it. The card
// folds to one line once the events scroll. Its map button shows the places named in those events on the map, in
// date order; the globe button adds the rest of world history; Wikipedia opens in the article panel; Close puts
// the timeline back. An event belongs to a character when one of its people is written with the character's exact
// name, as in Ariadne's prototype; none of these links is reviewed.
import { getMapLocation, isValidCoordinates } from '../../modules/map-utils.js';

const FOLD_AT = 60;
const UNFOLD_AT = 8;
let active = null;

const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const figureName = figure => (typeof figure === 'string' ? figure : figure?.name ?? '');

export async function setCharacters(lab, on) {
    if (!on) {
        active?.stop();
        active = null;
        return;
    }
    if (active) return;
    const response = await fetch(new URL('characters.json', import.meta.url));
    if (!response.ok) throw new Error(`Could not load the characters (${response.status})`);
    active = new Characters(lab, (await response.json()).characters);
}

class Characters {
    constructor(lab, characters) {
        this.lab = lab;
        this.characters = characters;
        this.byName = new Map(characters.flatMap(c => c.names.map(name => [name, c])));
        this.current = null;
        this.withWorld = false;
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
            const mine = this.cardIds.has(card.dataset.eventId);
            card.classList.toggle('character-event', mine);
            card.classList.toggle('character-other', this.withWorld && !mine);
        }
    }

    open(character) {
        this.current = character;
        this.events = this.eventsOf(character);
        this.ids = new Set(this.events.map(event => event.event_id));
        // the timeline's own key for each card (data-event-id), which the map and the marks go by
        const index = this.lab.eventManager.placeIndex;
        this.cardIds = new Set(this.events.map(event => index.idFor(event)));
        this.withWorld = false;
        this.render();
        this.lab.uiManager.showOnlyEvents(this.ids);
        this.wrapper.scrollTop = 0;
        this.fold();
        if (this.layer) this.showPlaces();
        this.mark();
    }

    render() {
        const c = this.current;
        const life = c => (c ? `${escapeHtml(c.display)}${c.place ? `<span class="character-place">, ${escapeHtml(c.place)}</span>` : ''}` : '?');
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
                <div class="character-head">
                    <h2>${escapeHtml(c.name)}</h2>
                    <p class="character-life">${life(c.birth)} – ${life(c.death)}</p>
                </div>
                <div class="character-more"><div>
                    <p class="character-title">${escapeHtml(c.title)}</p>
                    <p class="character-summary">${escapeHtml(c.summary)}</p>
                </div></div>
                <div class="character-actions">
                    <button type="button" class="character-btn" data-action="places" aria-pressed="false" title="Places in these events" aria-label="Places in these events"><i class="fa-light fa-map-location-dot" aria-hidden="true"></i></button>
                    <button type="button" class="character-btn" data-action="world" aria-pressed="false" title="Show world history around these events" aria-label="Show world history around these events"><i class="fa-light fa-earth-americas" aria-hidden="true"></i></button>
                    <button type="button" class="character-btn" data-action="article" title="Read about ${escapeHtml(c.name)} on Wikipedia"><i class="fa-light fa-scroll" aria-hidden="true"></i><span class="character-label">Wikipedia</span></button>
                    <span class="character-count">${this.events.length} event${this.events.length === 1 ? '' : 's'}</span>
                    <button type="button" class="character-close" data-action="close" title="Close" aria-label="Close ${escapeHtml(c.name)}'s card"><i class="fa-light fa-xmark" aria-hidden="true"></i></button>
                </div>
            </div>
            ${c.image?.file ? `<p class="character-credit">Portrait: <a href="${escapeHtml(c.image.page)}" target="_blank" rel="noopener">${escapeHtml(c.image.file.replace(/^File:/, ''))}</a>, ${escapeHtml(c.image.license ?? '')}</p>` : ''}
        </div>`;
        this.bar.querySelector('[data-action="places"]').setAttribute('aria-pressed', String(Boolean(this.layer)));
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
        if (this.layer) {
            this.layer.remove();
            this.layer = null;
            button.setAttribute('aria-pressed', 'false');
            return;
        }
        button.setAttribute('aria-pressed', 'true');
        this.lab.panelManager.openMapPanel();
        setTimeout(() => {
            this.lab.map.invalidateSize();
            this.showPlaces();
        }, 300);
    }

    // The places named in the character's events, numbered in the order they first appear, joined in that order.
    showPlaces() {
        this.layer?.remove();
        const places = new Map();
        for (const event of this.events) {
            const point = getMapLocation(event.locations);
            if (!isValidCoordinates(point)) continue;
            const key = point.join(',');
            if (!places.has(key)) places.set(key, { point, events: [] });
            places.get(key).events.push(event);
        }
        const list = [...places.values()];
        this.layer = L.layerGroup().addTo(this.lab.map);
        if (list.length > 1) L.polyline(list.map(p => p.point), { className: 'character-route', interactive: false }).addTo(this.layer);
        list.forEach((place, i) => {
            const marker = L.marker(place.point, {
                icon: L.divIcon({ className: 'character-stop', html: `<span>${i + 1}</span>`, iconSize: [22, 22] }),
                title: place.events.map(e => e.name).join('\n'),
                keyboard: true,
            }).addTo(this.layer);
            marker.on('click', () => this.lab.uiManager.scrollToEventId(this.lab.eventManager.placeIndex.idFor(place.events[0])));
        });
        if (list.length) this.lab.map.fitBounds(L.latLngBounds(list.map(p => p.point)), { padding: [40, 40], maxZoom: 6 });
    }

    world(button) {
        this.withWorld = !this.withWorld;
        button.setAttribute('aria-pressed', String(this.withWorld));
        this.lab.uiManager.showOnlyEvents(this.withWorld ? null : this.ids);
        this.mark();
    }

    article(button) {
        this.lab.panelManager.handleInfoClick(this.current.wikipedia_url, button);
    }

    close() {
        this.current = null;
        this.layer?.remove();
        this.layer = null;
        this.resize?.disconnect();
        this.panelWatch?.disconnect();
        this.bar?.remove();
        this.bar = null;
        this.wrapper.parentElement.classList.remove('has-character');
        this.wrapper.parentElement.style.removeProperty('--character-height');
        for (const card of this.content.querySelectorAll('.character-event, .character-other')) card.classList.remove('character-event', 'character-other');
        this.lab.uiManager.showOnlyEvents(null);
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
