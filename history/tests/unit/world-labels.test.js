import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clearPlaceLabels, labelProblem, placeLabel, setPlaceLabels } from '../../modules/world-labels.js';
import { formatLocations } from '../../modules/map-utils.js';
import { sha256Hex } from '../../modules/world-images.js';

const CANONICAL_BYTES = readFileSync(new URL('../../canonical-t2.json', import.meta.url));
const RELEASE = JSON.parse(readFileSync(new URL('../../releases/released-place-labels-v1.json', import.meta.url), 'utf8'));
const LOCATIONS = JSON.parse(readFileSync(new URL('../../releases/released-locations-v1.json', import.meta.url), 'utf8'));

const labels = (entries, sha = 'abc') => ({ version: 1, kind: 'world_place_label_sidecar', source: { events_sha256: sha }, labels: entries });
const kempsford = { name: 'Kempsford, England', city: '', region: '', country: '', place_id: 'plc_k' };

afterEach(clearPlaceLabels);

describe('released-place-labels-v1.json, the labels every visitor sees', () => {
  it('is bound to the canonical file and labels every place its events and the location release use', async () => {
    assert.equal(labelProblem(RELEASE, await sha256Hex(CANONICAL_BYTES)), null);
    const events = JSON.parse(CANONICAL_BYTES).events;
    const placeIds = new Set([...events.flatMap(e => (e.locations ?? []).map(l => l.place_id)), ...Object.keys(LOCATIONS.places)]);
    const missing = [...placeIds].filter(id => !Object.hasOwn(RELEASE.labels, id));
    assert.deepEqual(missing, []);
  });
});

describe('labelProblem — attach only to the exact data file labelled', () => {
  it('accepts labels and nulls for the loaded bytes', () => {
    assert.equal(labelProblem(labels({ plc_a: 'Marrakech, Morocco', plc_b: null }), 'abc'), null);
  });
  it('refuses another data file, another format and labels the site cannot show', () => {
    assert.match(labelProblem(labels({ plc_a: 'Marrakech, Morocco' }), 'other'), /not the one these labels were made for/);
    assert.match(labelProblem({ ...labels({}), kind: 'world_location_sidecar' }, 'abc'), /not a version 1/);
    assert.match(labelProblem({ ...labels({}), labels: [] }, 'abc'), /malformed/);
    for (const bad of ['', '  ', 3, {}]) assert.match(labelProblem(labels({ plc_a: bad }), 'abc'), /cannot show \(plc_a\)/);
  });
});

describe('placeLabel and formatLocations — the label in place of the written name', () => {
  it('shows the written name until labels are set, and again once they are cleared', () => {
    assert.equal(placeLabel(kempsford), undefined);
    assert.equal(formatLocations([kempsford]), 'Kempsford, England');
    setPlaceLabels(labels({ plc_k: 'Kempsford, United Kingdom' }));
    assert.equal(formatLocations([kempsford]), 'Kempsford, United Kingdom');
    clearPlaceLabels();
    assert.equal(formatLocations([kempsford]), 'Kempsford, England');
  });
  it('shows no location text for a null label, and the written name for a place without one', () => {
    setPlaceLabels(labels({ plc_k: null }));
    assert.equal(placeLabel(kempsford), null);
    assert.equal(formatLocations([kempsford]), '');
    assert.equal(formatLocations([{ ...kempsford, place_id: 'plc_other' }]), 'Kempsford, England');
    assert.equal(formatLocations([{ name: 'Rabat', city: '', region: '', country: 'Morocco' }]), 'Rabat');
  });
});
