import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { clearPlaceLabels, placeLabel, setPlaceLabels } from '../../modules/world-labels.js';
import { formatLocations } from '../../modules/map-utils.js';

const labels = (entries, sha = 'abc') => ({ version: 1, kind: 'world_place_label_sidecar', source: { events_sha256: sha }, labels: entries });
const kempsford = { name: 'Kempsford, England', city: '', region: '', country: '', place_id: 'plc_k' };

afterEach(clearPlaceLabels);

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
