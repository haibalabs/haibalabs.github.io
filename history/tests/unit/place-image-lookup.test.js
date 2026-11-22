import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    localPlaces, matchPlaces, pastedPoint, PlaceSearch, precisionFromDescription, reverseOpenStreetMap, searchOpenStreetMap, searchWikidata,
} from '../../modules/place-search.js';
import { commonsFileTitle, commonsImage, creditLine, imageFromLink, plainText } from '../../modules/image-link.js';

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

describe('place search — places missing from Wikidata', () => {
    // Nominatim's answers for "Lycée Hassan II Marrakech" and "Marrakesh", trimmed
    const address = { road: 'Boulevard Mohammed VI', suburb: 'Guéliz', city: 'Marrakesh', state: 'Marrakech-Safi', country: 'Morocco' };
    const NOMINATIM = [
        { lat: '31.6284835', lon: '-8.0147650', category: 'highway', type: 'bus_stop', addresstype: 'highway', name: 'Lycee Hassan II', display_name: 'Lycee Hassan II, Boulevard Mohammed VI, Marrakesh, Morocco', address },
        { lat: '31.6284599', lon: '-8.0143315', category: 'amenity', type: 'school', addresstype: 'amenity', name: 'Lycee Hassan II', display_name: 'Lycee Hassan II, Boulevard Mohammed VI, Marrakesh, Morocco', address },
        { lat: '31.6258', lon: '-7.9891', category: 'boundary', type: 'administrative', addresstype: 'city', name: 'Marrakesh', display_name: 'Marrakesh, Marrakech-Safi, Morocco', address: { city: 'Marrakesh', state: 'Marrakech-Safi', country: 'Morocco' } },
        { lat: '31.17', lon: '-7.34', category: 'boundary', type: 'administrative', addresstype: 'country', name: 'Morocco', display_name: 'Morocco', address: { country: 'Morocco' } },
    ];

    it('takes OpenStreetMap places with what they are as precision, skipping a bus stop named after the school', async () => {
        const results = await searchOpenStreetMap('Lycée Hassan II', async () => ({ json: async () => NOMINATIM }));
        assert.deepEqual(results.map(r => [r.label, r.location.precision]), [
            ['Lycee Hassan II, Marrakesh, Morocco', 'site'], ['Marrakesh, Marrakech-Safi, Morocco', 'settlement'], ['Morocco', 'country'],
        ]);
        assert.deepEqual(results[0].location.point, [31.6284599, -8.0143315]);
        assert.equal('wikidata' in results[0].location, false);
        assert.deepEqual(await searchOpenStreetMap('Lycée Hassan II', async () => { throw new Error('offline'); }), []);
    });

    it('lists an OpenStreetMap place once, and not when Wikidata or the events already have it', async () => {
        const search = new PlaceSearch(() => [], { openStreetMap: async () => [{ label: 'Rabat, Morocco' }, { label: 'ENSIAS, Rabat, Morocco' }, { label: 'ENSIAS, Rabat, Morocco' }] });
        assert.deepEqual((await search.osm('ENSIAS', [{ label: 'Rabat, Morocco' }])).map(p => p.label), ['ENSIAS, Rabat, Morocco']);
    });

    it('fills a pasted point’s city, region and country from OpenStreetMap', async () => {
        const fetch = async () => ({ json: async () => ({ name: '', address: { road: 'Avenue Mohammed Ben Abdallah Regragui', city: 'Rabat', state: 'Rabat-Salé-Kénitra', country: 'Morocco' } }) });
        assert.deepEqual(await reverseOpenStreetMap([33.9843, -6.8676], fetch), { name: '', city: 'Rabat', region: 'Rabat-Salé-Kénitra', country: 'Morocco' });
        assert.equal(await reverseOpenStreetMap([0, 0], async () => ({ json: async () => ({ error: 'Unable to geocode' }) })), null);
    });

    it('reads pasted coordinates in decimal and in degrees, minutes and seconds', () => {
        assert.deepEqual(pastedPoint('31.6296148, -8.0505967'), { point: [31.6296148, -8.0505967], name: '' });
        assert.deepEqual(pastedPoint('32.7157 -117.1611'), { point: [32.7157, -117.1611], name: '' });
        assert.deepEqual(pastedPoint('31.6296° N, 8.0506° W'), { point: [31.6296, -8.0506], name: '' });
        const dms = pastedPoint('31°37\'46.6"N 8°03\'02.2"W').point;
        assert.ok(Math.abs(dms[0] - 31.62961) < 1e-5 && Math.abs(dms[1] + 8.05061) < 1e-5);
        // longitude first, when its letter says so
        assert.deepEqual(pastedPoint('8.0506 W, 31.6296 N').point, [31.6296, -8.0506]);
        for (const text of ['95.1, 10.2', '10.2, 190.5', 'Rabat', '1 2', 'Route 66', '10.5 N, 20.5 N']) assert.equal(pastedPoint(text), null, text);
    });

    it('reads the point and place name from a map link, the pin before the view', () => {
        const google = 'https://www.google.com/maps/place/Cpge+Ibn+Timiya/@31.6295995,-8.0501794,487m/data=!3m1!1e3!4m6!3m5!1s0xdafe94b94ca7077:0x865153e6579cc5bc!8m2!3d31.6296148!4d-8.0505967!16s%2Fg%2F1ptwj7s_g?entry=tts';
        assert.deepEqual(pastedPoint(google), { point: [31.6296148, -8.0505967], name: 'Cpge Ibn Timiya' });
        assert.deepEqual(pastedPoint('google.com/maps/@32.7157,-117.1611,15z'), { point: [32.7157, -117.1611], name: '' });
        assert.deepEqual(pastedPoint('https://www.google.com/maps?q=33.9843,-6.8676'), { point: [33.9843, -6.8676], name: '' });
        assert.deepEqual(pastedPoint('https://www.openstreetmap.org/?mlat=31.62846&mlon=-8.01433#map=19/31.62846/-8.01433'), { point: [31.62846, -8.01433], name: '' });
        assert.deepEqual(pastedPoint('https://www.openstreetmap.org/#map=17/31.62846/-8.01433'), { point: [31.62846, -8.01433], name: '' });
        assert.deepEqual(pastedPoint('https://maps.apple.com/?ll=32.7157,-117.1611&q=Midway'), { point: [32.7157, -117.1611], name: 'Midway' });
        assert.deepEqual(pastedPoint('https://maps.app.goo.gl/zKbsRWnnHp4yRvMX6'), { short: true });
        assert.equal(pastedPoint('https://www.google.com/maps/search/ensias'), null);
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
