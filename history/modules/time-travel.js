// time-travel.js
// What the page shows while the world events load: the era pill counts from the Big Bang to today in
// each era's colour, a band fills along the bottom of the bar, and placeholder cards stand in for the
// events (Rachid's pick from the UI lab, 2026-10-31). timeline-nav.js takes the pill over once the first
// events are drawn.

import { ERAS } from './timeline-nav.js';

// The trip's stops, evenly spaced in time, so recent centuries get as long as deep time.
const STOPS = [-13.8e9, -4.5e9, -540e6, -66e6, -2.5e6, -300000, -10000, -3000, -500, 500, 1000, 1450, 1750, 1914, 1991, 2026];
const TRIP_MS = 1900;

const hueOf = (year) => ERAS.find(e => year < e.to).hue;
/** The readout for a year. Each unit is chosen after rounding, so no value reads as "1,000,000 years ago". */
export function label(year) {
    const ago = -year;
    const billions = +(ago / 1e9).toFixed(1), millions = +(ago / 1e6).toFixed(1), thousands = Math.round(ago / 1000);
    if (billions >= 1) return `${billions} billion years ago`;
    if (millions >= 1) return `${millions} million years ago`;
    if (thousands >= 10) return `${(thousands * 1000).toLocaleString('en-US')} years ago`;
    // historical numbering has no year 0, and years from 1000 read as the pill writes them
    if (year <= 0) return `${Math.max(1, ago)} BC`;
    return year < 1000 ? `${year} AD` : String(year);
}
function yearAt(t) {
    const f = t * (STOPS.length - 1), i = Math.min(STOPS.length - 2, Math.floor(f));
    return Math.round(STOPS[i] + (STOPS[i + 1] - STOPS[i]) * (f - i));
}

/**
 * Starts the trip and returns a function that ends it, clearing the pill, band and placeholders.
 * The trip loops until then; with reduced motion it holds still on the Big Bang.
 *
 * @returns {() => void}
 */
export function startTimeTravel() {
    const crumbs = document.getElementById('crumbs');
    const content = document.getElementById('timeline-content');
    const header = document.querySelector('.header');
    if (!crumbs || !content || !header) return () => {};

    crumbs.innerHTML = '<span class="crumb travel" aria-live="off"><span class="era-dot"></span><span class="travel-readout"></span></span>';
    const dot = crumbs.querySelector('.era-dot'), readout = crumbs.querySelector('.travel-readout');
    const band = document.createElement('div');
    band.className = 'travel-band';
    band.innerHTML = '<i></i>';
    band.firstChild.style.background = `linear-gradient(90deg, ${ERAS.map(e => e.hue).join(', ')})`;
    header.append(band);
    const skeleton = document.createElement('div');
    skeleton.className = 'travel-skeleton';
    skeleton.setAttribute('aria-hidden', 'true');
    skeleton.innerHTML = '<div><span></span><span></span><span></span><span></span></div>'.repeat(3);
    content.append(skeleton);

    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t0 = performance.now();
    let raf = 0;
    const draw = (now) => {
        // a frame's timestamp can be slightly earlier than t0
        const t = still ? 0 : (Math.max(0, now - t0) % TRIP_MS) / TRIP_MS, year = yearAt(t);
        readout.textContent = label(year);
        dot.style.background = hueOf(year);
        band.firstChild.style.transform = `scaleX(${t})`;
        // a render before the events arrive empties the content; the placeholders come back
        if (!skeleton.isConnected && !content.querySelector('.event')) content.append(skeleton);
        if (!still) raf = requestAnimationFrame(draw);
    };
    draw(t0);

    return () => {
        cancelAnimationFrame(raf);
        band.remove();
        skeleton.remove();
        // timeline-nav.js redraws the pill from the first events
        if (crumbs.querySelector('.travel')) crumbs.innerHTML = '';
    };
}
