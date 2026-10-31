// timeline-nav.js
// Era crumbs and the spine scrubber. Reads events and positions from the managers and moves the
// timeline with uiManager's jumpToDate / jumpToStart / jumpToEnd.
import { eventSortableValue, extractYear } from './date-handlers.js';

// Conventional, mostly Western periodization.
const ERAS = [
    { name: 'Deep time',               from: -Infinity, to: -3000, hue: '#5b6075' },
    { name: 'Ancient world',           from: -3000, to: -500, hue: '#b06a35' },
    { name: 'Classical antiquity',     from: -500,  to: 500,  hue: '#c0533a' },
    { name: 'Early Middle Ages',       from: 500,   to: 1000, hue: '#7058a0' },
    { name: 'High & Late Middle Ages', from: 1000,  to: 1450, hue: '#b08a25' },
    { name: 'Early modern',            from: 1450,  to: 1750, hue: '#3d7a5f' },
    { name: 'Age of revolutions',      from: 1750,  to: 1914, hue: '#4a6890' },
    { name: 'World wars & Cold War',   from: 1914,  to: 1991, hue: '#7d7448' },
    { name: 'Contemporary',            from: 1991,  to: Infinity, hue: '#2a8fa0' },
];
const eraOf = y => Math.max(0, ERAS.findIndex(e => y >= e.from && y < e.to));

// Years use historical numbering, as date-handlers.js does: -44 is 44 BC and there is no year 0.
const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
function fmtYear(y) {
    if (y <= -1e9) return `${+(-y / 1e9).toFixed(1)} billion years ago`;
    if (y <= -1e6) return `${+(-y / 1e6).toFixed(1)} million years ago`;
    if (y < 0) return `${-y} BC`;
    return y < 1000 ? `${y} AD` : String(y);
}
export const centuryOf = y => (y > 0 ? Math.floor((y - 1) / 100) + 1 : -(Math.floor((Math.max(1, -y) - 1) / 100) + 1));
const centStart = c => (c > 0 ? (c - 1) * 100 + 1 : c * 100);
const centLabel = (c, short) => `${ord(Math.abs(c))} ${short ? 'c.' : 'century'}${c < 0 ? ' BC' : ''}`;
// A decade is keyed by its earliest year: the 40s BC (49–40 BC) is -49.
export const decadeOf = y => (y > 0 ? Math.floor(y / 10) * 10 : -(Math.floor(Math.max(1, -y) / 10) * 10 + 9));
const decLabel = d => (d >= 0 ? `${d}s` : `${-d - 9}s BC`);

// The decades of century c, each clipped to the century's years [from, to). Centuries start at
// year 1 of their first decade (1801), so the first and last buckets are partial; a one-year
// bucket is labelled with its year (1900).
export function decadeBuckets(c) {
    const s = centStart(c), end = s + 100, buckets = [];
    for (let d = decadeOf(s); d < end; d += 10) {
        const from = Math.max(d, s), to = Math.min(d + 10, end);
        buckets.push({ key: d, from, to, label: to - from === 1 ? fmtYear(from) : decLabel(d) });
    }
    return buckets;
}
const decadeIn = (c, y) => decadeBuckets(c).find(b => y >= b.from && y < b.to);
const eraRange = e => (e.from === -Infinity ? 'before 3000 BC' : `${fmtYear(e.from)} – ${e.to === Infinity ? 'today' : fmtYear(e.to)}`);

function lowerBound(arr, v) {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; }
    return lo;
}

const $ = id => document.getElementById(id);
let app = null, wrap, crumbs, pop, spine, track, thumb, bubble;

const yearCache = new WeakMap();
function yearOf(ev) {
    let y = yearCache.get(ev);
    if (y === undefined) {
        try { y = extractYear(eventSortableValue(ev)); } catch { y = NaN; }
        yearCache.set(ev, y);
    }
    return y;
}

// Years and estimated tops of the current filtered list, rebuilt when the list or its height changes.
const view = { list: null, years: new Float64Array(0), tops: new Float64Array(0), total: 0 };
function refresh() {
    const ui = app.uiManager;
    const list = app.eventManager.getFilteredEvents(ui.currentFilter, ui.currentSearch);
    if (list !== view.list) {
        view.list = list;
        view.years = Float64Array.from(list, yearOf);
        view.total = -1;
    }
    if (ui.totalHeight !== view.total) {
        view.total = ui.totalHeight;
        view.tops = Float64Array.from(list, (_, i) => ui.positions.get(i) ?? i * ui.defaultEventHeight);
        return true;
    }
    return false;
}
// Distance from the top of the scroll area to the first event.
const contentOffset = () => $('timeline-content').getBoundingClientRect().top - wrap.getBoundingClientRect().top + wrap.scrollTop;
const countBetween = (a, b) => lowerBound(view.years, b) - lowerBound(view.years, a);

// Year of the event under a reading line a little below the top of the timeline.
function currentYear() {
    const i = Math.min(view.years.length - 1, Math.max(0, lowerBound(view.tops, wrap.scrollTop - contentOffset() + 140) - 1));
    return view.years[i] ?? 0;
}

function goToYear(y) {
    const ui = app.uiManager;
    if (y <= view.years[0]) return ui.jumpToStart();
    ui.jumpToDate(Math.round(y));
}
function stepDecade(dir, y) {
    const d = decadeOf(y), ys = view.years;
    const i = dir > 0 ? lowerBound(ys, d + 10) : lowerBound(ys, d) - 1;
    if (i >= 0 && i < ys.length) goToYear(decadeOf(ys[i]));
}
function stepCentury(dir, y) {
    const s = centStart(centuryOf(y)), ys = view.years;
    const i = dir > 0 ? lowerBound(ys, s + 100) : lowerBound(ys, s) - 1;
    if (i >= 0 && i < ys.length) goToYear(centStart(centuryOf(ys[i])));
}

// Crumbs and their drill-down panel.
let crumbKey = '', openLevel = null, cur = { y: 0 };
function updateCrumbs(y) {
    const ei = eraOf(y), c = centuryOf(y), d = decadeOf(y);
    cur = { y, ei, c, d };
    if (openLevel) syncCurrent();
    const key = `${ei}|${c}|${d}|${openLevel}`;
    if (key === crumbKey) return;
    crumbKey = key;
    const deep = ei === 0;
    crumbs.innerHTML =
        `<button class="nav-button step edge" data-edge="start" title="Earliest event (Home)" aria-label="Earliest event"><i class="fa-sharp fa-light fa-backward-step"></i></button>` +
        `<button class="nav-button step" data-step="-1" title="Previous decade ( [ )"><i class="fa-light fa-chevron-left"></i></button>` +
        `<button class="crumb" data-level="era" aria-expanded="${openLevel === 'era'}"><span class="era-dot" style="background:${ERAS[ei].hue}"></span>${ERAS[ei].name}</button>` +
        (deep ? '' :
            `<span class="sep">›</span><button class="crumb" data-level="cent" aria-expanded="${openLevel === 'cent'}">${centLabel(c, true)}</button>` +
            `<span class="sep">›</span><button class="crumb" data-level="dec" aria-expanded="${openLevel === 'dec'}">${decadeIn(c, y)?.label ?? decLabel(d)}</button>`) +
        `<button class="nav-button step" data-step="1" title="Next decade ( ] )"><i class="fa-light fa-chevron-right"></i></button>` +
        `<button class="nav-button step edge" data-edge="end" title="Latest event (End)" aria-label="Latest event"><i class="fa-sharp fa-light fa-forward-step"></i></button>`;
}
function jumpToEdge(edge) {
    closePopover();
    app.uiManager.clearDateFilter();
    if (edge === 'start') app.uiManager.jumpToStart();
    else app.uiManager.jumpToEnd();
}
// Moves the open panel's highlight to the current era/century/decade without redrawing it.
function syncCurrent() {
    const want = { era: `e${cur.ei}`, cent: `c${cur.c}`, dec: `d${cur.d}` }[openLevel];
    pop.querySelectorAll('[data-cur]').forEach(b => b.classList.toggle('current', b.dataset.cur === want));
}
const heat = (n, max, hue) => (n ? `color-mix(in srgb, ${hue} ${Math.round(10 + 40 * Math.sqrt(n / max))}%, var(--surface))` : 'var(--surface-2)');
function cellsHTML(title, items, hue) {
    const max = Math.max(1, ...items.map(i => i.n));
    return `<h4>${title}</h4><div class="cells">` + items.map(it =>
        `<button data-go="${it.go}" data-cur="${it.key}" class="${it.current ? 'current' : ''}" style="background:${heat(it.n, max, hue)}" ${it.n ? '' : 'disabled'}>
            <span class="l">${it.label}</span><span class="c">${it.n.toLocaleString()}</span></button>`).join('') + `</div>`;
}
function openPopover(level) {
    openLevel = level; crumbKey = '';
    const e = ERAS[cur.ei];
    let html;
    if (level === 'era') {
        html = `<h4>Eras</h4><div class="era-list">` + ERAS.map((x, i) => {
            const n = countBetween(x.from, x.to);
            return `<button data-go="${x.from === -Infinity ? -14e9 : x.from}" data-cur="e${i}" class="${i === cur.ei ? 'current' : ''}" ${n ? '' : 'disabled'}>
                <span class="sw" style="background:${x.hue}"></span><span class="nm">${x.name}<span class="rg">${eraRange(x)}</span></span><span class="ct">${n.toLocaleString()}</span></button>`;
        }).join('') + `</div>`;
    } else if (level === 'cent') {
        const items = [];
        for (let c = centuryOf(Math.max(e.from, -3000)); c <= centuryOf(Math.min(e.to - 1, 2025)); c++) {
            if (c === 0) continue;
            // counts only the part of the century inside this era
            items.push({ go: Math.max(centStart(c), e.from), key: `c${c}`, label: centLabel(c, true), current: c === cur.c,
                n: countBetween(Math.max(centStart(c), e.from), Math.min(centStart(c) + 100, e.to)) });
        }
        html = cellsHTML(`${e.name} · centuries`, items, e.hue);
    } else {
        const items = decadeBuckets(cur.c).map(b => ({ go: b.from, key: `d${b.key}`, label: b.label, current: b.key === cur.d, n: countBetween(b.from, b.to) }));
        html = cellsHTML(`${centLabel(cur.c)} · decades`, items, e.hue);
    }
    html += `<div class="pop-foot"><input id="popYear" placeholder="Go to year… 1066, 44 BC" autocomplete="off">
        <button data-edge="start">Earliest</button><button data-edge="end">Latest</button></div>`;
    pop.innerHTML = html;
    pop.classList.add('open');   // open before measuring: a hidden panel is 0 wide
    const r = crumbs.querySelector(`[data-level="${level}"]`)?.getBoundingClientRect();
    pop.style.left = Math.max(12, Math.min(innerWidth - pop.offsetWidth - 12, (r?.left ?? 12) - 14)) + 'px';
    updateCrumbs(cur.y);
    const input = $('popYear');
    if (matchMedia('(hover: hover)').matches) input.focus();
    input.addEventListener('keydown', ev => {
        if (ev.key !== 'Enter') return;
        const m = ev.target.value.trim().match(/^(-?\d+)\s*(bc|bce)?$/i);
        if (m) { goToYear(m[2] ? -Math.abs(+m[1]) : +m[1]); closePopover(); }
    });
}
function closePopover() { pop.classList.remove('open'); openLevel = null; crumbKey = ''; updateCrumbs(cur.y); }

// Spine: era bands, period names and century ticks, positioned by the list's estimated tops.
function buildSpine() {
    const sh = wrap.scrollHeight, off = contentOffset(), h = spine.clientHeight;
    if (!sh || !view.years.length) return;
    const at = y => (view.tops[Math.min(view.years.length - 1, lowerBound(view.years, y))] + off) / sh;
    let bands = '';
    ERAS.forEach((e, i) => {
        if (!countBetween(e.from, e.to)) return;
        const a = i === 0 ? 0 : at(e.from), b = i === ERAS.length - 1 ? 1 : at(e.to);
        bands += `<div class="band" style="top:${a * 100}%;height:${Math.max(0, b - a) * 100}%;background:${e.hue}"></div>`;
    });
    track.innerHTML = bands;
    const placed = [];
    let ticks = '';
    const tick = (f, text, cls = '') => {
        const px = f * h;
        if (placed.some(p => Math.abs(p - px) < 18)) return;
        placed.push(px);
        ticks += `<div class="tick ${cls}" style="top:${px}px">${text}</div>`;
    };
    // larger eras take a label spot first; colliding labels are skipped
    ERAS.map(e => ({ e, n: countBetween(e.from, e.to) })).filter(x => x.n).sort((a, b) => b.n - a.n)
        .forEach(({ e }) => tick(e.from === -Infinity ? 0 : at(e.from), e.name, 'era-tick'));
    const y0 = Math.max(view.years[0], -3000), y1 = view.years[view.years.length - 1];
    for (let c = centuryOf(y0); c <= centuryOf(y1); c++) if (c !== 0 && countBetween(centStart(c), centStart(c) + 100)) tick(at(centStart(c)), centLabel(c, true));
    spine.querySelectorAll('.tick').forEach(t => t.remove());
    spine.insertAdjacentHTML('beforeend', ticks);
}
// Puts the spine in the gutter left of the column, or on the window edge when the gutter is too
// narrow for the period names.
function placeSpine() {
    const colLeft = $('timeline').getBoundingClientRect().left;
    const gutter = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gutter')) || 200;
    document.documentElement.style.setProperty('--col-left', colLeft + 'px');
    spine.classList.toggle('edge', colLeft < gutter - 6);
}
function updateSpine(y) {
    const max = wrap.scrollHeight - wrap.clientHeight;
    const px = Math.min(1, Math.max(0, wrap.scrollTop / (max || 1))) * spine.clientHeight;
    thumb.style.top = bubble.style.top = px + 'px';
    bubble.innerHTML = `${fmtYear(y)}<small>${ERAS[eraOf(y)].name}</small>`;
}
function spineTo(clientY) {
    const r = spine.getBoundingClientRect();
    wrap.scrollTop = Math.min(1, Math.max(0, (clientY - r.top) / r.height)) * (wrap.scrollHeight - wrap.clientHeight);
}

let queued = false;
function frame() {
    queued = false;
    // nothing to show until the first events are rendered
    if (!document.querySelector('#timeline-content .event')) return;
    placeSpine();
    if (refresh()) buildSpine();
    spine.classList.add('ready');
    const y = currentYear();
    updateCrumbs(y); updateSpine(y);
}
const queue = () => { if (!queued) { queued = true; requestAnimationFrame(frame); } };

export function initTimelineNav({ eventManager, uiManager }) {
    app = { eventManager, uiManager };
    wrap = $('timeline-wrapper');
    crumbs = $('crumbs'); pop = $('popover');
    spine = $('spine'); track = $('spine-track'); thumb = $('spine-thumb'); bubble = $('spine-bubble');

    crumbs.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.step) return stepDecade(+b.dataset.step, cur.y);
        if (b.dataset.edge) return jumpToEdge(b.dataset.edge);
        openLevel === b.dataset.level ? closePopover() : openPopover(b.dataset.level);
    });
    pop.addEventListener('click', e => {
        const b = e.target.closest('button'); if (!b || b.disabled) return;
        if (b.dataset.edge) return jumpToEdge(b.dataset.edge);
        if (b.dataset.go !== undefined) goToYear(+b.dataset.go);
        else return;
        closePopover();
    });
    document.addEventListener('pointerdown', e => {
        if (pop.classList.contains('open') && !pop.contains(e.target) && !crumbs.contains(e.target)) closePopover();
    });
    document.addEventListener('keydown', e => {
        if (e.target.closest('input, textarea, select, [contenteditable]')) { if (e.key === 'Escape') closePopover(); return; }
        const k = { ']': () => stepDecade(1, cur.y), '[': () => stepDecade(-1, cur.y), '}': () => stepCentury(1, cur.y), '{': () => stepCentury(-1, cur.y), Escape: closePopover,
            Home: () => jumpToEdge('start'), End: () => jumpToEdge('end') }[e.key];
        if (k) { e.preventDefault(); k(); }
    });

    spine.addEventListener('pointerdown', e => { spine.setPointerCapture(e.pointerId); spine.classList.add('dragging'); spineTo(e.clientY); });
    spine.addEventListener('pointermove', e => { if (spine.classList.contains('dragging')) spineTo(e.clientY); });
    for (const t of ['pointerup', 'pointercancel']) spine.addEventListener(t, () => spine.classList.remove('dragging'));

    wrap.addEventListener('scroll', queue, { passive: true });
    new MutationObserver(queue).observe($('timeline-content'), { childList: true });
    new ResizeObserver(() => { view.total = -1; queue(); }).observe(document.body);
    // the wrapper width animates when a map/article panel opens
    new ResizeObserver(queue).observe(wrap);
    queue();
}
