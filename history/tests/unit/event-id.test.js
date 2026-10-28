import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_ID_PATTERN, newEventId } from '../../modules/event-id.js';

describe('newEventId — IDs for events created in the browser', () => {
  it('matches the canonical event_id pattern and is unique', () => {
    const a = newEventId(), b = newEventId();
    assert.match(a, EVENT_ID_PATTERN);
    assert.notEqual(a, b);
  });
});
