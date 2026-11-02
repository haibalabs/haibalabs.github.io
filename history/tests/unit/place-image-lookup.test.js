import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { localPlaces, matchPlaces, PlaceSearch, precisionFromDescription, searchWikidata } from '../../modules/place-search.js';
import { commonsFileTitle, commonsImage, creditLine, imageFromLink, plainText } from '../../modules/image-link.js';
import { tileFor } from '../../modules/location-picker.js';

const loc = (name, place_id, coordinates, precision = 'settlement', country = '') => ({
    name, city: '', region: '', country, historical_name: '', place_id, geography: { status: 'identified', precision, coordinates },
});
const EVENTS = [
    { locations: [loc('Munich', 'plc_m', [48.137, 11.575], 'settlement', 'Germany')] },
    { locations: [loc('Munich', 'plc_m', [48.137, 11.575], 'settlement', 'Germany'), loc('Allianz Arena', 'plc_a', [48.2188, 11.6247], 'site', 'Germany')] },
    { locations: [loc('Asunción', 'plc_as', [-25.28, -57.63], 'settlement', 'Paraguay')] },
    { locations: [{ name: 'Nowhere', place_id: 'plc_n', geography: { coordinates: null } }] },
    { personal: true, locations: [loc('My house', 'plc_h', [1, 1])] },
];

// a fetch that answers Wikidata's three calls from fixed data
function wikidataFetch(entities) {
    return async (url) => {
        const params = new URL(url).searchParams;
        if (params.get('action') === 'wbsearchentities') return { json: async () => ({ search: Object.keys(entities).filter(id => !id.startsWith('C')).map(id => ({ id })) }) };
        const ids = params.get('ids').split('|');
        return { json: async () => ({ entities: Object.fromEntries(ids.map(id => [id, entities[id]])) }) };
    };
}
const claim = (value) => [{ rank: 'normal', mainsnak: { datavalue: { value } } }];

describe('place search — the loaded events’ places first', () => {
    it('lists each place with a point once, counting its events, and skips personal events', () => {
        const places = localPlaces(EVENTS);
        assert.deepEqual(places.map(p => [p.label, p.count]), [['Munich, Germany', 2], ['Allianz Arena, Germany', 1], ['Asunción, Paraguay', 1]]);
    });

    it('matches the start of a label or of a word, without accents, most used first', () => {
        const places = localPlaces(EVENTS);
        assert.deepEqual(matchPlaces(places, 'mun').map(p => p.label), ['Munich, Germany']);
        assert.deepEqual(matchPlaces(places, 'arena').map(p => p.label), ['Allianz Arena, Germany']);
        assert.deepEqual(matchPlaces(places, 'asuncion').map(p => p.label), ['Asunción, Paraguay']);
        assert.deepEqual(matchPlaces(places, 'g').map(p => p.label), []);
    });

    it('reads what a Wikidata item is from its description', () => {
        assert.equal(precisionFromDescription('city in Bavaria, Germany'), 'settlement');
        assert.equal(precisionFromDescription('country in Central Europe'), 'country');
        assert.equal(precisionFromDescription('state of Germany'), 'region');
        assert.equal(precisionFromDescription('football stadium in Munich, Germany'), 'site');
    });

    it('takes Wikidata items with coordinates on Earth, with their country', async () => {
        const fetch = wikidataFetch({
            Q131: { labels: { en: { value: 'Allianz Arena' } }, descriptions: { en: { value: 'football stadium in Munich, Germany' } }, claims: { P625: claim({ latitude: 48.2188, longitude: 11.6247, globe: 'http://www.wikidata.org/entity/Q2' }), P17: claim({ id: 'C183' }) } },
            Q2: { labels: { en: { value: 'Mars crater' } }, claims: { P625: claim({ latitude: 1, longitude: 1, globe: 'http://www.wikidata.org/entity/Q111' }) } },
            Q3: { labels: { en: { value: 'No point' } }, claims: {} },
            C183: { labels: { en: { value: 'Germany' } } },
        });
        const results = await searchWikidata('Allianz', fetch);
        assert.equal(results.length, 1);
        assert.equal(results[0].label, 'Allianz Arena, Germany');
        assert.deepEqual(results[0].location.point, [48.2188, 11.6247]);
        assert.equal(results[0].location.precision, 'site');
        assert.equal(results[0].location.wikidata, 'Q131');
        assert.deepEqual(await searchWikidata('Allianz', async () => { throw new Error('offline'); }), []);
    });

    it('leaves out Wikidata items already listed from the events', async () => {
        const search = new PlaceSearch(() => EVENTS, { wikidata: async () => [{ label: 'Munich, Germany' }, { label: 'Munich, North Dakota' }] });
        const local = search.local('Munich');
        assert.deepEqual((await search.remote('Munich', local)).map(p => p.label), ['Munich, North Dakota']);
    });
});

describe('image links — Commons credit filled in, other links as they are', () => {
    it('finds the Commons file a link names', () => {
        assert.equal(commonsFileTitle('https://commons.wikimedia.org/wiki/File:Allianz_Arena.jpg'), 'File:Allianz Arena.jpg');
        assert.equal(commonsFileTitle('commons.wikimedia.org/wiki/Datei:Allianz_Arena.jpg'), 'File:Allianz Arena.jpg');
        assert.equal(commonsFileTitle('https://upload.wikimedia.org/wikipedia/commons/a/ab/Allianz_Arena.jpg'), 'File:Allianz Arena.jpg');
        assert.equal(commonsFileTitle('https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Allianz_Arena.jpg/800px-Allianz_Arena.jpg'), 'File:Allianz Arena.jpg');
        assert.equal(commonsFileTitle('https://en.wikipedia.org/wiki/Allianz_Arena'), null);
    });

    it('reads the file’s URL, author and license, as text', async () => {
        const fetch = async () => ({ ok: true, json: async () => ({ query: { pages: { 1: { title: 'File:Allianz Arena.jpg', imageinfo: [{
            url: 'https://upload.wikimedia.org/a.jpg', thumburl: 'https://upload.wikimedia.org/thumb/1600px-a.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Allianz_Arena.jpg',
            extmetadata: { Artist: { value: '<a href="//x">Jane &amp; Co</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/4.0' }, ImageDescription: { value: 'The arena <i>at night</i>' } },
        }] } } } }) });
        const result = await commonsImage('https://commons.wikimedia.org/wiki/File:Allianz_Arena.jpg', fetch);
        assert.equal(result.ok, true);
        assert.equal(result.image.image_url, 'https://upload.wikimedia.org/thumb/1600px-a.jpg');
        assert.equal(result.image.credit, 'Jane & Co');
        assert.equal(result.image.caption, 'The arena at night');
        assert.equal(result.image.file_page, 'File:Allianz Arena.jpg');
        assert.equal(creditLine(result.image), 'Photo: Jane & Co · CC BY-SA 4.0 · Wikimedia Commons');
    });

    it('says when Commons has no such file or can’t be reached', async () => {
        const missing = async () => ({ ok: true, json: async () => ({ query: { pages: { '-1': { title: 'File:X.jpg', missing: '' } } } }) });
        assert.match((await commonsImage('commons.wikimedia.org/wiki/File:X.jpg', missing)).problem, /no Commons file/);
        assert.match((await commonsImage('commons.wikimedia.org/wiki/File:X.jpg', async () => { throw new Error('offline'); })).problem, /Couldn't reach/);
    });

    it('takes another https link with its license unknown, and refuses plain http', async () => {
        const result = await imageFromLink('https://news.example/p.jpg', { rightsNote: 'press photo' });
        assert.equal(result.image.source, 'link');
        assert.equal(result.image.rights_statement, 'press photo');
        assert.equal(creditLine(result.image), 'License unknown · news.example');
        assert.equal((await imageFromLink('http://news.example/p.jpg')).ok, false);
        assert.equal(plainText('a&nbsp;<b>b</b>'), 'a b');
    });
});

describe('the place row’s small map', () => {
    it('finds the tile holding a point and where in it the point falls', () => {
        const { url, px, py } = tileFor([0, 0], 1);
        assert.equal(url, 'https://tile.openstreetmap.org/1/1/1.png');
        assert.equal(Math.round(px), 0);
        assert.equal(Math.round(py), 0);
        // Munich's arena: column floor((11.6247 + 180) / 360 × 2^15) = 17442, and the point inside its tile
        const arena = tileFor([48.2188, 11.6247], 15);
        assert.match(arena.url, /\/15\/17442\/\d+\.png$/);
        assert.ok(arena.px >= 0 && arena.px < 256 && arena.py >= 0 && arena.py < 256);
    });
});
