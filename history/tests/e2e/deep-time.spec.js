import { test, expect } from '@playwright/test';
import { stubFirebase } from './firebase-stub.js';

// Deep-time records on the normal site: labels the parser can't read are placed by their
// navigation position (sort_years_ago, sort_tiebreak) and shown as written.
const id = (n) => `evt_${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const event = (n, name, extra) => ({ event_id: id(n), name, enhanced_description: `${name}.`, categories: ['science'],
  figures: [], locations: [], confidence: 'high', ...extra });
// listed out of order on purpose
const WORLD = [
  event(5, 'Animal life diversifies in the Cambrian', { enhanced_time: 'c. 539 million years ago', sort_years_ago: 539000000, sort_tiebreak: 15 }),
  event(2, 'The first atomic nuclei form', { enhanced_time: 'Within minutes after the Big Bang', sort_years_ago: 13800000000, sort_tiebreak: 2 }),
  event(6, 'Humans settle the first villages', { enhanced_time: '10,000 BC' }),
  event(3, 'The universe becomes transparent', { enhanced_time: 'c. 380,000 years after the Big Bang', sort_years_ago: 13799620000, sort_tiebreak: 3 }),
  event(1, 'Big Bang', { enhanced_time: 'c. 13.8 billion years ago', sort_years_ago: 13800000000, sort_tiebreak: 1 }),
  event(4, 'Early humans leave traces', { enhanced_time: 'c. 300,000 years ago' }),
];

test('deep-time cards are in order and show their labels as written', async ({ page }) => {
  await stubFirebase(page);
  await page.route('**/canonical-t2.json', route => route.fulfill({ json: WORLD }));
  await page.goto('/history/index.html');
  await page.waitForSelector('#timeline-content .event');
  const names = await page.locator('#timeline-content .event .event-header').allInnerTexts();
  const order = ['Big Bang', 'The first atomic nuclei form', 'The universe becomes transparent', 'Animal life diversifies in the Cambrian',
    'Early humans leave traces', 'Humans settle the first villages'];
  const positions = order.map(name => names.findIndex(text => text.includes(name)));
  expect(positions.every(p => p >= 0)).toBe(true);
  expect(positions).toEqual([...positions].sort((a, b) => a - b));

  const card = (name) => page.locator('#timeline-content .event').filter({ has: page.locator('.event-header', { hasText: name }) });
  await expect(card('The first atomic nuclei form')).toContainText('Within minutes after the Big Bang');
  await expect(card('The universe becomes transparent')).toContainText('c. 380,000 years after the Big Bang');
  await expect(card('Early humans leave traces')).toContainText('c. 300,000 years ago');
  await expect(card('Humans settle the first villages')).toContainText('10,000 BC');
});
