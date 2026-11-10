import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../modules/world-edits.js';
import { stubFirebase } from './firebase-stub.js';

const event = { event_id: 'evt_accepted_fixture', name: 'Harem conspiracy against Ramesses III',
  enhanced_time: '1155 BC', enhanced_description: 'The documented coup attempt.',
  confidence: 'low', confidence_origin: 'unreviewed_default', categories: ['politics'], locations: [], figures: [] };
const data = { metadata: { snapshot_id: 'fixture', timestamp: '2026-11-10T00:00:00Z', event_visibility: {
  schema_version: 'factory-event-visibility/v1', snapshot_id: 'fixture', records: [{
    record_index: 0, event_id: event.event_id, event_sha256: createHash('sha256').update(canonicalJson(event)).digest('hex'),
    reviewed_event_version: 'a'.repeat(64), acceptance_sha256: 'b'.repeat(64), verdict: 'accepted', scope: ['source','date','event'],
  }],
} }, events: [event, { ...event, event_id: 'evt_hidden', name: 'Unaccepted Harem proposal' }] };

test('accepted low-intake event appears in search, count and edit lookup; reload clears acceptance', async ({ page }) => {
  await stubFirebase(page);
  await page.route('**/visibility-fixture.json', route => route.fulfill({ json: data }));
  await page.route('**/visibility-legacy.json', route => route.fulfill({ json: { ...data, metadata: { snapshot_id: 'legacy' } } }));
  await page.goto('/history/?file=visibility-fixture.json');
  await page.locator('#searchInput').fill('Harem');
  const card = page.locator('#timeline-content .event');
  await expect(card).toHaveCount(1);
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-confidence', 'accepted');
  const result = await page.evaluate(async () => {
    const { EventManager } = await import('./modules/event-manager.js');
    const { EditUI } = await import('./modules/edit-ui.js');
    const manager = new EventManager(null);
    await manager.loadEvents('visibility-fixture.json');
    const edit = id => EditUI.prototype.worldEvent.call({ eventManager: manager }, id)?.event_id ?? null;
    const first = { count: manager.getHighMediumCount(), search: manager.getFilteredEvents('all','Harem').length,
      confidence: manager.events[0].confidence, acceptedEdit: edit('evt_accepted_fixture'), hiddenEdit: edit('evt_hidden') };
    await manager.loadEvents('visibility-legacy.json');
    return { first, reloaded: manager.getHighMediumCount() };
  });
  expect(result).toEqual({ first: { count: 1, search: 1, confidence: 'low', acceptedEdit: 'evt_accepted_fixture', hiddenEdit: null }, reloaded: 0 });
});
