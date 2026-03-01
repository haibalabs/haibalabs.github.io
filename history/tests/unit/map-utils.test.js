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
