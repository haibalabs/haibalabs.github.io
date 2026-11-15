import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishedWorld } from '../../modules/published-data.js';
import { LocationVerifier } from '../../modules/map-utils.js';
import { clearPlaceLabels, placeLabel, setPlaceLabels } from '../../modules/world-labels.js';

const legacy = (status, coordinates, precision = 'approximate') =>
    ({ status, coordinates, precision, verification: 'not_independently_verified' });

// A release in the published format: two shards, four places, and the cases the format review named.
function release() {
    const places = [
        { index: 0, place_id: 'plc_alpha', label: 'Alpha City, Country' },
        { index: 1, place_id: 'plc_none', label: null },
        { index: 2, place_id: 'plc_written' },
        { index: 3, place_id: 'plc_merged', label: 'Merged Place, Land', status: 'resolved', point: [10, 20],
            precision: 'settlement', verification: 'batch_audit:t7-location-batch-01' },
    ];
    const image = { image_url: 'https://img.example/a.jpg', thumbnail_url: 'https://img.example/a-thumb.jpg',
        source_url: 'https://commons.example/a', caption: 'The square. Image date: 1890.', credit: 'A photographer',
        license_name: 'CC BY 4.0', license_url: 'https://cc.example/by4', rights_statement: 'Free to share',
        rights_basis: 'license', image_role: 'site', image_date: '1890', display_date: null,
        date_qualification: 'A later view of the site', event_issue_ids: [] };
    const shards = [
        { format: 'historiline-events/v1', shard: 'd000', family: 'dated', events: [
            { event_id: 'evt_alpha', event_version: 'v1', name: 'Alpha', enhanced_time: '1500', confidence: 'high',
                visible: true, accepted: true, categories: [], figures: [], enhanced_description: 'A.', wikipedia_url: '',
                image, locations: [{ name: 'Alpha', city: '', region: '', country: '', historical_name: '', place: 0,
                    placement: 'legacy', geography: legacy('reused', [1, 2]) }] },
        ] },
        { format: 'historiline-events/v1', shard: 'd001', family: 'dated', events: [
            { event_id: 'evt_placed', event_version: 'v2', name: 'Placed', enhanced_time: '1600', confidence: 'high',
                visible: true, categories: [], figures: [], enhanced_description: 'P.', wikipedia_url: '',
                locations: [{ name: 'Bravo', city: '', region: '', country: '', historical_name: '', place: 2,
                    placement: 'placed', placed: 3, geography: legacy('reused', [5, 6]) }] },
            { event_id: 'evt_conflict', event_version: 'v3', name: 'Conflict', enhanced_time: '1700', confidence: 'low',
                visible: false, categories: [], figures: [], enhanced_description: 'C.', wikipedia_url: '',
                locations: [{ name: 'Old town', city: '', region: '', country: '', historical_name: '', place: 2,
                    placement: 'placed', placed: 3, geography: legacy('missing', null, 'unknown') }] },
            { event_id: 'evt_held', event_version: 'v4', name: 'Held', enhanced_time: '1800', confidence: 'medium',
                visible: true, categories: [], figures: [], enhanced_description: 'H.', wikipedia_url: '',
                locations: [{ name: 'Nowhere', city: '', region: '', country: '', historical_name: '', place: 1,
                    placement: 'held', reason: 'mention_country_unknown', geography: legacy('ambiguous', null) }] },
        ] },
    ];
    const manifest = { format: 'historiline-manifest/v1', created_at: '2026-11-10T12:00:00Z',
        shards: shards.map(s => ({ id: s.shard, count: s.events.length })),
        places: { buckets: 64, files: [{ bucket: 0, count: places.length }] } };
    return { manifest, manifestUrl: 'data/manifest.json', shards,
        buckets: [{ format: 'historiline-places/v1', bucket: 0, places }] };
}

// What EventManager.loadPublished does with the events: verify each one's locations, then place them.
function load(world, corrections = []) {
    const verifier = new LocationVerifier();
    for (const c of corrections) verifier.locationMappings.set(c.standardized_location, { corrected: c.corrected_location });
    verifier.isInitialized = true;
    const events = world.events.map(event => ({ ...event }));
    for (const event of events) verifier.verifyEventLocation(event);
    world.placeLocations(events);
    return Object.fromEntries(events.map(event => [event.event_id, event]));
}

test('served events come back in shard order, in the shape a data file gives', () => {
    const world = publishedWorld(release());
    assert.deepEqual(world.events.map(e => e.event_id), ['evt_alpha', 'evt_placed', 'evt_conflict', 'evt_held']);
    assert.equal(world.timestamp, Date.parse('2026-11-10T12:00:00Z'));
    for (const event of world.events) {
        assert.equal('visible' in event, false);
        assert.equal('accepted' in event, false);
        for (const location of event.locations) {
            for (const field of ['place', 'placed', 'placement', 'reason', 'lookup_cause']) assert.equal(field in location, false, field);
        }
    }
    const alpha = world.events[0];
    assert.equal(alpha.locations[0].place_id, 'plc_alpha');
    assert.deepEqual(alpha.locations[0].geography, legacy('reused', [1, 2]));
});

test('accepted marks the events of the visibility index, whatever their confidence', () => {
    assert.deepEqual([...publishedWorld(release()).acceptedIds], ['evt_alpha']);
});

test('an image record becomes the image and preview a released image gives', () => {
    const alpha = publishedWorld(release()).events[0];
    assert.equal(alpha.image_url, 'https://img.example/a.jpg');
    assert.deepEqual(alpha.image_preview, { caption: 'The square.', role: 'site', credit: 'A photographer',
        license_name: 'CC BY 4.0', license_url: 'https://cc.example/by4', source_url: 'https://commons.example/a',
        date: null, under_review: false });
    assert.equal('image' in alpha, false);
});

test('a placed location takes its reviewed place, ID and geography, after the corrections', () => {
    const events = load(publishedWorld(release()));
    const location = events.evt_placed.locations[0];
    assert.equal(location.place_id, 'plc_merged');
    assert.deepEqual(location.geography, { status: 'resolved', coordinates: [10, 20], precision: 'settlement',
        verification: 'batch_audit:t7-location-batch-01' });
});

test('a manual point that disagrees with the reviewed place keeps the location as loaded, written place and all', () => {
    const events = load(publishedWorld(release()), [{ standardized_location: 'Old town', corrected_location: [1, 2] }]);
    const location = events.evt_conflict.locations[0];
    assert.equal(location.place_id, 'plc_written');
    assert.deepEqual(location.corrected, [1, 2]);
    assert.equal(location.geography.status, 'corrected');
    assert.deepEqual(location.geography.coordinates, [1, 2]);
});

test('a manual point that agrees with the reviewed place lets the place apply', () => {
    const events = load(publishedWorld(release()), [{ standardized_location: 'Old town', corrected_location: [10, 20] }]);
    assert.equal(events.evt_conflict.locations[0].place_id, 'plc_merged');
    assert.equal(events.evt_conflict.locations[0].geography.status, 'resolved');
});

test('a continent written on its own keeps its name and place but draws no point, even with a manual one', () => {
    const world = release();
    world.shards[1].events.push({ event_id: 'evt_continent', event_version: 'v5', name: 'Continent', enhanced_time: '1850',
        confidence: 'high', visible: true, categories: [], figures: [], enhanced_description: 'N.', wikipedia_url: '',
        locations: [{ name: 'North America', city: '', region: '', country: '', historical_name: '', place: 2,
            placement: 'held', reason: 'continent_no_point', geography: legacy('reused', [47, -105]) },
        { name: 'Alpha', city: '', region: '', country: '', historical_name: '', place: 0,
            placement: 'legacy', geography: legacy('reused', [1, 2]) }] });
    world.manifest.shards[1].count += 1;
    const events = load(publishedWorld(world), [{ standardized_location: 'North America', corrected_location: [47, -105] }]);
    const [continent, alpha] = events.evt_continent.locations;
    assert.equal(continent.name, 'North America');
    assert.equal(continent.place_id, 'plc_written');
    assert.equal('geography' in continent, false);
    assert.equal('corrected' in continent, false);
    assert.equal(continent.verified, false);
    // the event's other places are drawn as before
    assert.deepEqual(alpha.geography, legacy('reused', [1, 2]));
});

test('a held location keeps its legacy geography', () => {
    const events = load(publishedWorld(release()));
    assert.deepEqual(events.evt_held.locations[0].geography, legacy('ambiguous', null));
    assert.equal(events.evt_held.locations[0].place_id, 'plc_none');
});

test('labels keep a null label apart from no label', () => {
    const world = publishedWorld(release());
    assert.deepEqual(world.labels.labels, { plc_alpha: 'Alpha City, Country', plc_none: null, plc_merged: 'Merged Place, Land' });
    setPlaceLabels(world.labels);
    try {
        assert.equal(placeLabel({ place_id: 'plc_alpha' }), 'Alpha City, Country');
        assert.equal(placeLabel({ place_id: 'plc_none' }), null);
        assert.equal(placeLabel({ place_id: 'plc_written' }), undefined);
    } finally {
        clearPlaceLabels();
    }
});

test('placements follow load position, so two events with one ID keep their own locations', () => {
    const repeated = release();
    const [, conflict] = repeated.shards[1].events;
    // a second evt_placed whose location is legacy: it must not take the first one's reviewed place
    repeated.shards[1].events.splice(1, 1, { ...conflict, event_id: 'evt_placed',
        locations: [{ ...conflict.locations[0], placement: 'legacy', placed: undefined }] });
    repeated.manifest.shards[1].count = repeated.shards[1].events.length;
    const world = publishedWorld(repeated);
    const verifier = new LocationVerifier();
    verifier.isInitialized = true;
    const events = world.events.map(event => ({ ...event }));
    for (const event of events) verifier.verifyEventLocation(event);
    world.placeLocations(events);
    const both = events.filter(event => event.event_id === 'evt_placed');
    assert.equal(both.length, 2);
    assert.equal(both[0].locations[0].place_id, 'plc_merged');
    assert.equal(both[1].locations[0].place_id, 'plc_written');
});

test('an event naming a place no bucket has fails the load', () => {
    const broken = release();
    broken.shards[0].events[0].locations[0].place = 99;
    assert.throws(() => publishedWorld(broken), /names place 99, which no bucket has/);
});
