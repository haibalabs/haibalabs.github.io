// The map check for the published site and staging (board T21, T116), called by check-published.mjs.
// It reads only what an already-open timeline page shows, so it works on any data layout the site loads.
//
// checkMap(page, events) takes events as { event_id, name, point: [lat, lng], precision, status, label }:
// - name is searched for when the event's card isn't on screen;
// - precision is the place's recorded precision, or null when it has none;
// - status is the place's release status: 'resolved' or 'corrected' (a manual point) draw as reviewed,
//   'reused' or null as unreviewed;
// - label is the place text the map shows after the event's name and date: its released label, else the
//   written name.
// It returns one row per event: { event_id, ok, problem }.

const TOLERANCE_DEGREES = 1e-6;
const REVIEWED = new Set(['resolved', 'corrected']);

async function checkOne(page, expected, timeout) {
    const card = page.locator(`#timeline-content .event[data-event-id=${JSON.stringify(expected.event_id)}]`);
    if (!await card.isVisible() && expected.name) await page.locator('#searchInput').fill(expected.name);
    try { await card.waitFor({ state: 'visible', timeout }); }
    catch { return 'event card not shown'; }
    const show = card.getByRole('button', { name: 'Show on map', exact: true });
    if (!await show.count()) return 'no Show on map button';
    await show.first().click();
    const dots = page.locator('.map-selected-dot[data-point]');
    try { await dots.first().waitFor({ state: 'attached', timeout }); }
    catch { return 'no point drawn'; }
    const drawn = await dots.evaluateAll(nodes => nodes.map(node => ({ ...node.dataset })));
    const [lat, lng] = expected.point;
    const at = drawn.findIndex(d => {
        const [y, x] = d.point.split(',').map(Number);
        return Math.abs(y - lat) <= TOLERANCE_DEGREES && Math.abs(x - lng) <= TOLERANCE_DEGREES;
    });
    if (at < 0) return `point ${lat},${lng} not drawn; drawn: ${drawn.map(d => d.point).join(' ')}`;
    const dot = drawn[at];
    const problems = [];
    const precision = expected.precision ?? 'unknown';
    if (dot.precision !== precision) problems.push(`precision ${dot.precision}, expected ${precision}`);
    const reviewed = String(REVIEWED.has(expected.status));
    if (dot.reviewed !== reviewed) problems.push(`drawn ${dot.reviewed === 'true' ? 'reviewed' : 'unreviewed'}, expected status ${expected.status ?? 'none'}`);
    // The first point's label is always shown; another point's shows on hover and is added last.
    // A label's spans are the name, the date and the place.
    if (at > 0) await dots.nth(at).hover({ force: true });
    // the previous selection's label can linger while it fades, so match this event's name
    const labels = page.locator('.map-event-label').filter(expected.name ? { has: page.getByText(expected.name, { exact: true }) } : {});
    const label = at > 0 ? labels.last() : labels.first();
    try { await label.waitFor({ state: 'visible', timeout }); }
    catch { problems.push('no map label'); return problems.join('; '); }
    const place = await label.evaluate(node => node.querySelector(':scope > span > span:nth-of-type(2)')?.textContent ?? null);
    if (expected.label !== undefined && place !== expected.label) problems.push(`label "${place}", expected "${expected.label}"`);
    return problems.join('; ');
}

export async function checkMap(page, events, { timeout = 5000 } = {}) {
    const search = page.locator('#searchInput');
    const before = await search.inputValue();
    const rows = [];
    try {
        for (const expected of events) {
            let problem;
            try { problem = await checkOne(page, expected, timeout); }
            catch (error) { problem = `check failed: ${error.message.split('\n')[0]}`; }
            rows.push({ event_id: expected.event_id, ok: !problem, problem: problem || null });
        }
    } finally {
        if (await search.inputValue() !== before) await search.fill(before);
    }
    return rows;
}
