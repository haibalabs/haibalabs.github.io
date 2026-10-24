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
test('duplicate persisted IDs fail, legacy identities are scoped to the loaded session', () => {
    assert.throws(() => new PlaceEventIndex([events[0], events[0]]), /Duplicate event identity/);
    const index = new PlaceEventIndex([{ name: 'A' }, { name: 'A' }]);
    assert.equal(index.events.size, 2);
});
test('different points for the same place remain distinct', () => {
    const index = new PlaceEventIndex([{ event_id: 'a', locations: [point('x', [0, 1]), point('x', [1, 2])] }]);
    assert.equal(index.points.size, 2);
    assert.equal(index.query({ placeId: 'x' }).size, 1);
});
