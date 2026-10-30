import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseWikipediaUrl } from '../../modules/wikipedia-url.js';
import { PanelManager } from '../../modules/panel-manager.js';

const REVISION = 'https://en.wikipedia.org/w/index.php?oldid=1382417751';

describe('Wikipedia article and revision URLs', () => {
    it('pins the actual October2026 source revision in both links', () => {
        const parsed = parseWikipediaUrl(REVISION);
        const api = new URL(parsed.apiUrl);
        assert.equal(api.origin + api.pathname, 'https://en.wikipedia.org/w/api.php');
        assert.equal(api.searchParams.get('oldid'), '1382417751');
        assert.equal(api.searchParams.has('page'), false);
        assert.equal(api.searchParams.has('redirects'), false);
        assert.equal(parsed.viewUrl, REVISION);
    });

    for (const [input, title] of [
        ['https://en.wikipedia.org/wiki/October_2026', 'October_2026'],
        ['https://en.wikipedia.org/wiki/Caf%C3%A9', 'Café'],
        ['https://en.wikipedia.org/wiki/100%25_coverage', '100%_coverage'],
        ['https://en.wikipedia.org/wiki/Literal_%2520', 'Literal_%20'],
        ['https://en.wikipedia.org/wiki/Who%3F%23Example', 'Who?#Example'],
        ['https://en.wikipedia.org/wiki/A+B?utm_source=test#Section', 'A+B'],
        ['https://en.wikipedia.org/w/index.php?title=Who%3F%23Example', 'Who?#Example'],
        ['https://en.wikipedia.org/w/index.php?title=Literal_%2520', 'Literal_%20'],
        ['https://en.wikipedia.org/w/index.php?title=October+2026&action=view', 'October 2026'],
    ]) {
        it(`decodes the title once: ${input}`, () => {
            const parsed = parseWikipediaUrl(input);
            assert.equal(parsed.title, title);
            assert.equal(new URL(parsed.apiUrl).searchParams.get('page'), title);
            assert.equal(parseWikipediaUrl(parsed.viewUrl).title, title.replace(/ /g, '_'));
        });
    }

    it('normalizes mobile, language and pasted article hosts to HTTPS', () => {
        for (const [input, host] of [
            ['http://en.m.wikipedia.org/wiki/October_2026', 'en.wikipedia.org'],
            ['en.wikipedia.org/wiki/October_2026', 'en.wikipedia.org'],
            ['https://fr.m.wikipedia.org/wiki/Paris', 'fr.wikipedia.org'],
            ['https://www.wikipedia.org/wiki/Paris', 'en.wikipedia.org'],
        ]) {
            const parsed = parseWikipediaUrl(input);
            assert.equal(new URL(parsed.apiUrl).hostname, host);
            assert.equal(new URL(parsed.viewUrl).protocol, 'https:');
        }
    });

    it('oldid takes precedence over a title and preserves a section link', () => {
        for (const path of ['/w/index.php?title=October_2026&oldid=1382417751', '/wiki/October_2026?oldid=1382417751']) {
            const parsed = parseWikipediaUrl('https://en.m.wikipedia.org' + path + '#Events');
            assert.equal(new URL(parsed.apiUrl).searchParams.get('oldid'), '1382417751');
            assert.equal(new URL(parsed.apiUrl).searchParams.has('page'), false);
            assert.equal(parsed.viewUrl, REVISION + '#Events');
        }
    });

    it('rejects missing, ambiguous, malformed or non-Wikipedia selectors', () => {
        for (const input of [undefined, null, '', {}, 'not a URL', 'https://example.org/wiki/Page',
            'https://en.wikipedia.org.evil.test/wiki/Page', 'https://evil.test/?oldid=1382417751',
            'https://en.wikipedia.org@evil.test/wiki/Page', 'https://user@en.wikipedia.org/wiki/Page',
            'https://en.wikipedia.org:444/wiki/Page', 'javascript:alert(1)', 'ftp://en.wikipedia.org/wiki/Page',
            'https://en.wikipedia.org/', 'https://en.wikipedia.org/wiki/', 'https://en.wikipedia.org/w/index.php',
            'https://en.wikipedia.org/w/index.php?title=', 'https://en.wikipedia.org/wiki/%20',
            'https://en.wikipedia.org/wiki/%E0%A4', 'https://en.wikipedia.org/w/index.php?title=%ZZ',
            'https://en.wikipedia.org/wiki/%00', 'https://en.wikipedia.org/w/index.php?title=A&title=B',
            ...['', '0', '-1', '1.5', 'undefined', '1e3', '1&oldid=2'].map(oldid =>
                `https://en.wikipedia.org/w/index.php?title=Valid_title&oldid=${oldid}`),
        ]) assert.equal(parseWikipediaUrl(input), null, String(input));
    });
});

function panelFixture(t, apiResponse = { parse: { title: 'October 2026', text: { '*': '<p>Saved revision</p>' }, sections: [] } }) {
    const panel = Object.create(PanelManager.prototype);
    panel.infoPanel = { classList: { contains: () => true } };
    panel.infoFrame = { srcdoc: '' };
    panel.bringInfoToFront = () => {};
    panel.showInfoPanelLoading = () => {};
    panel.showWikiError = (span, url, message) => { panel.error = message; };
    const requests = [];
    t.mock.method(globalThis, 'fetch', async url => {
        requests.push(new URL(url));
        return new Response(JSON.stringify(apiResponse), { status: 200 });
    });
    t.mock.method(console, 'error', () => {});
    return { panel, requests };
}

describe('Wikipedia info panel integration', () => {
    it('fetches actual oldid and renders the pinned outbound revision', async t => {
        const { panel, requests } = panelFixture(t);
        await panel.handleInfoClick(REVISION, {});
        assert.equal(requests.length, 1);
        assert.equal(requests[0].searchParams.get('oldid'), '1382417751');
        assert.equal(requests[0].searchParams.has('page'), false);
        assert.match(panel.infoFrame.srcdoc, /<p>Saved revision<\/p>/);
        assert.ok(panel.infoFrame.srcdoc.includes(`href="${REVISION}"`));
        assert.equal(panel.error, undefined);
    });
    it('fetches an encoded legacy article without decoding a literal percent twice', async t => {
        const { panel, requests } = panelFixture(t);
        await panel.handleInfoClick('https://en.wikipedia.org/wiki/Literal_%2520', {});
        assert.equal(requests[0].searchParams.get('page'), 'Literal_%20');
        assert.ok(panel.infoFrame.srcdoc.includes('href="https://en.wikipedia.org/wiki/Literal_%2520"'));
    });
    it('invalid URLs never fetch an undefined page and show an error', async t => {
        const { panel, requests } = panelFixture(t);
        for (const input of [undefined, 'https://en.wikipedia.org/w/index.php?oldid=undefined', 'https://example.org/wiki/Page',
            'https://en.wikipedia.org/wiki/%ZZ']) {
            await panel.handleInfoClick(input, {});
            assert.match(panel.error, /Invalid Wikipedia article or revision link/);
            assert.match(panel.infoFrame.srcdoc, /Content unavailable/);
        }
        assert.equal(requests.length, 0);
    });
    it('an unavailable revision does not silently fetch the latest article', async t => {
        const { panel, requests } = panelFixture(t, { error: { code: 'nosuchrevid' } });
        await panel.handleInfoClick(REVISION, {});
        assert.equal(requests.length, 1);
        assert.match(panel.error, /Wikipedia content not found/);
        assert.match(panel.infoFrame.srcdoc, /Content unavailable/);
    });
});
