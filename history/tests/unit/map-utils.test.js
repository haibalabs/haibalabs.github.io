import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getLocationKey } from '../../modules/map-utils.js';

// Test cases ported from map-testing.html
const testCases = [
  {
    input: { name: "École Saint Gabriel", city: "Rabat", region: "", country: "Morocco", historical_name: "" },
    expected: "École Saint Gabriel, Rabat, Morocco"
  },
  {
    input: { name: "", city: "Rabat", region: "", country: "Morocco", historical_name: "" },
    expected: "Rabat, Morocco"
  },
  {
    input: { name: "United States", city: "Various", region: "Various", country: "United States", historical_name: "United States" },
    expected: "United States"
  },
  {
    input: { name: "Paris, France", city: "Paris", region: "Île-de-France", country: "France" },
    expected: "Paris, France, Île-de-France"
  },
  {
    input: { name: "Germany", city: "various locations in Germania Inferior", region: "various regions", country: "Germany", historical_name: "Germania Inferior" },
    expected: "Germany"
  },
  {
    input: { name: "Germany", city: "Various", region: "Various", country: "Germany", historical_name: "Teutonic tribes" },
    expected: "Germany"
  },
  {
    input: { name: "China", city: "various locations", region: "various regions", country: "China", historical_name: "Han Dynasty" },
    expected: "China"
  },
  {
    input: { name: "Parthia, Iran", city: "various locations", region: "various regions", country: "Iran", historical_name: "Parthia" },
    expected: "Parthia, Iran"
  },
  // TODO: getLocationKey should simplify "Various locations in Western Europe" → "Western Europe"
  // {
  //   input: { name: "Various locations in Western Europe", city: "N/A", region: "N/A", country: "Various countries in Western Europe", historical_name: "N/A" },
  //   expected: "Western Europe"
  // },
  // TODO: getLocationKey should strip country for region-only names like "Pacific Northwest"
  // {
  //   input: { name: "Pacific Northwest", city: "N/A", region: "N/A", country: "United States/Canada", historical_name: "N/A" },
  //   expected: "Pacific Northwest"
  // },
  {
    input: { name: "Paris, Texas, United States", city: "Paris", region: "Texas", country: "United States" },
    expected: "Paris, Texas, United States"
  }
];

describe('getLocationKey', () => {
  testCases.forEach(({ input, expected }) => {
    it(`returns "${expected}"`, () => {
      assert.equal(getLocationKey(input), expected);
    });
  });
});

import { getCoordinates, getMapLocation, LocationVerifier } from '../../modules/map-utils.js';

describe('canonical locations and saved corrections', () => {
  it('uses embedded coordinates without a geocoding request', async () => {
    const location = { name: 'Paris', geography: { coordinates: [48.8, 2.3], status: 'reused' } };
    assert.deepEqual(getMapLocation([location]), [48.8, 2.3]);
    assert.deepEqual(await getCoordinates(getMapLocation([location]), new Map()), [48.8, 2.3]);
    assert.equal(await getCoordinates([100, 0], new Map()), null);
  });

  it('applies corrections to every location and preserves place IDs', () => {
    const verifier = new LocationVerifier();
    verifier.isInitialized = true;
    verifier.locationMappings.set('Old town', { corrected: [1, 2] });
    const event = { locations: ['Paris', { name: 'Old town', country: 'Country', place_id: 'p1',
      geography: { coordinates: [3, 4], status: 'reused' } }] };
    verifier.verifyEventLocation(event);
    assert.equal(event.locations[0].name, 'Paris');
    assert.equal(event.locations[1].place_id, 'p1');
    assert.deepEqual(event.locations[1].geography.coordinates, [1, 2]);
    assert.deepEqual(getMapLocation([event.locations[1]]), [1, 2]);
  });

  it('a text correction invalidates an older cached point', () => {
    const verifier = new LocationVerifier();
    verifier.isInitialized = true;
    verifier.locationMappings.set('Old town', { corrected: 'New town' });
    const event = { locations: [{ name: 'Old town', geography: { coordinates: [3, 4], status: 'reused' } }] };
    verifier.verifyEventLocation(event);
    assert.equal(event.locations[0].geography.coordinates, null);
    assert.equal(getMapLocation(event.locations), 'New town');
  });

  it('keeps already-corrected snapshot coordinates when the correction agrees', () => {
    const verifier = new LocationVerifier();
    verifier.isInitialized = true;
    verifier.locationMappings.set('Old town', { corrected: 'New town' });
    const event = { locations: [{ name: 'Old town', corrected: 'New town', geography: {
      coordinates: [3, 4], correction: 'New town', status: 'corrected' } }] };
    verifier.verifyEventLocation(event);
    assert.deepEqual(getMapLocation(event.locations), [3, 4]);
  });
});
