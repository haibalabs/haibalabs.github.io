import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlaceEventIndex, containsPoint } from '../../modules/place-event-index.js';
const point = (place_id, coordinates, precision = 'approximate', status = 'reused') => ({ place_id, name: place_id, geography: { coordinates, precision, status } });
const events = [
    { event_id: 'one', name: 'Same name', enhanced_time: '50 BC', locations: [point('west', [0, -175]), point('east', [0, 175], 'exact')] },
    { event_id: 'two', name: 'Same name', enhanced_time: '1900', locations: [point('east', [0, 175], 'exact'), point('held', [0, 0], 'exact', 'ambiguous')] },
    { event_id: 'three', enhanced_time: '1901', locations: [point('missing', [200, 0])] },
    { event_id: 'four', enhanced_time: '1902', locations: [{ ...point('manual', [0, 0], 'unknown', 'ambiguous'), corrected: [1, 2] }] }
];
test('all locations indexed, secondary matches deduplicate, names do not define identity', () => {
    const index = new PlaceEventIndex(events);
    assert.deepEqual([...index.query({ placeId: 'east' })], ['one', 'two']);
    assert.equal(index.eventPoints.get('one').length, 2);
    assert.deepEqual([...index.query({ bounds: { south: -1, north: 1, west: 170, east: -170 } })], ['one', 'two']);
    assert.equal(index.years.get('one'), -50);
});
test('ambiguous and invalid coordinates excluded; manual corrections win; unmapped retained', () => {
    const index = new PlaceEventIndex(events);
    assert.deepEqual([...index.query({ unmappedOnly: true })], ['three']);
    assert.equal(index.query().size, 4);
    assert.equal(index.places.get('held').has('two'), true);
    assert.equal(index.query({ placeId: 'held' }).size, 0);
    assert.deepEqual(index.eventPoints.get('four')[0].coordinates, [1, 2]);
    assert.deepEqual([...index.query({ includeApproximate: false })], ['one', 'two']);
});
test('bounds include edges, dateline, wrapped viewports and full world; reject invalid bounds', () => {
    assert(containsPoint({ south: 0, north: 1, west: 170, east: 190 }, [0, -175]));
    assert(containsPoint({ south: -90, north: 90, west: -180, east: 180 }, [90, 180]));
    assert(!containsPoint({ south: 2, north: 1, west: 0, east: 1 }, [1, 0]));
    assert(!containsPoint({ south: 0, north: NaN, west: 0, east: 1 }, [0, 0]));
});
test('legacy identities are scoped to the loaded session', () => {
    const index = new PlaceEventIndex([{ name: 'A' }, { name: 'A' }]);
    assert.equal(index.events.size, 2);
});
test('records sharing a persisted ID all stay, each with a distinct session identity', () => {
    const shared = 'evt_00000000-0000-4000-8000-000000000000';
    const records = [
        { event_id: shared, name: 'Siege of Paris', enhanced_time: '1870', locations: [point('paris', [48.8, 2.3])] },
        { event_id: shared, name: 'Treaty of Frankfurt', enhanced_time: '1871', locations: [point('frankfurt', [50.1, 8.7])] },
        events[0],
    ];
    const index = new PlaceEventIndex(records);
    assert.deepEqual([...index.duplicateIds], [shared]);
    assert.equal(index.events.size, 3);
    const [a, b] = [index.idFor(records[0]), index.idFor(records[1])];
    assert.notEqual(a, b);
    assert.ok(a.startsWith('session-duplicate:') && b.startsWith('session-duplicate:'));
    assert.equal(index.events.has(shared), false);
    assert.equal(index.idFor(records[2]), 'one');
    assert.deepEqual([...index.query({ placeId: 'paris' })], [a]);
    assert.deepEqual([...index.query({ placeId: 'frankfurt' })], [b]);
});
test('different points for the same place remain distinct', () => {
    const index = new PlaceEventIndex([{ event_id: 'a', locations: [point('x', [0, 1]), point('x', [1, 2])] }]);
    assert.equal(index.points.size, 2);
    assert.equal(index.query({ placeId: 'x' }).size, 1);
});
