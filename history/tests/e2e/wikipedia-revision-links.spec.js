import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// A minimal real panel, with every browser request fulfilled locally or aborted.
// Avoid loading unrelated app services/CDNs for this regression.
const modules = new URL('../../modules/', import.meta.url);
const revision = 'https://en.wikipedia.org/w/index.php?oldid=1382417751';
const html = `<!doctype html><html><body>
<div class="timeline-wrapper"></div><div id="map-panel"></div><div id="info-panel" class="open">
<iframe id="info-frame"></iframe></div><button id="toggle-map"></button><button id="toggle-info"></button>
<span id="wiki" class="clickable">Wikipedia</span></body></html>`;

async function openPanel(page) {
    const requests = [];
    const blocked = [];
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin === 'http://wikipedia-panel.test') {
            if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
            const name = url.pathname.slice('/modules/'.length);
            if (url.pathname.startsWith('/modules/') && ['panel-manager.js', 'map-utils.js', 'world-labels.js', 'wikipedia-url.js'].includes(name)) {
                return route.fulfill({ contentType: 'application/javascript', body: readFileSync(new URL(name, modules), 'utf8') });
            }
        }
        if (url.origin === 'https://en.wikipedia.org' && url.pathname === '/w/api.php') {
            requests.push(url);
            return route.fulfill({ json: { parse: { title: 'October 2026',
                text: { '*': '<p>Frozen October revision fixture.</p>' }, sections: [] } } });
        }
        blocked.push(url.href);
        return route.abort();
    });
    await page.goto('http://wikipedia-panel.test/');
    await page.evaluate(async () => {
        const { PanelManager } = await import('/modules/panel-manager.js');
        window.panel = new PanelManager({}, {}, new Map(), () => {});
    });
    return { requests, blocked };
}

test('actual October revision fetch and rendered outbound link stay pinned', async ({ page }) => {
    const { requests, blocked } = await openPanel(page);
    await page.evaluate(url => {
        const link = document.querySelector('#wiki');
        link.addEventListener('click', () => window.panel.handleInfoClick(url, link));
    }, revision);
    await page.locator('#wiki').click();
    await expect(page.frameLocator('#info-frame').locator('p')).toHaveText('Frozen October revision fixture.');
    const link = page.frameLocator('#info-frame').getByRole('link', { name: 'View on Wikipedia ↗' });
    await expect(link).toHaveAttribute('href', revision);
    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get('oldid')).toBe('1382417751');
    expect(requests[0].searchParams.has('page')).toBe(false);
    expect(blocked).toEqual([]);
});

test('mobile legacy title is decoded once and remains a valid rendered article link', async ({ page }) => {
    const { requests, blocked } = await openPanel(page);
    await page.evaluate(() => window.panel.handleInfoClick('https://en.m.wikipedia.org/wiki/Literal_%2520', document.querySelector('#wiki')));
    await expect(page.frameLocator('#info-frame').getByRole('link', { name: 'View on Wikipedia ↗' }))
        .toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Literal_%2520');
    expect(requests).toHaveLength(1);
    expect(requests[0].searchParams.get('page')).toBe('Literal_%20');
    expect(blocked).toEqual([]);
});

test('invalid revision and malformed URL show errors without any API fetch', async ({ page }) => {
    const { requests, blocked } = await openPanel(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const url of ['https://en.wikipedia.org/w/index.php?oldid=undefined', 'https://en.wikipedia.org/wiki/%ZZ']) {
        await page.evaluate(value => window.panel.handleInfoClick(value, document.querySelector('#wiki')), url);
        await expect(page.frameLocator('#info-frame').locator('body')).toContainText('Content unavailable');
    }
    await expect(page.locator('#wiki')).toHaveClass('disabled');
    await expect(page.locator('.toast').last()).toContainText('Invalid Wikipedia article or revision link');
    expect(requests).toEqual([]);
    expect(blocked).toEqual([]);
    expect(errors).toEqual([]);
});
