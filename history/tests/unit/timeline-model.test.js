import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TITLE_MAX, eventProblem, newTimelineId, timelineIdFromSearch, titleProblem, toTimelineEventDoc } from '../../modules/timeline-model.js';

describe('titleProblem — timeline names', () => {
  it('accepts a normal name', () => assert.equal(titleProblem('Family history'), null));
  it('rejects empty or blank names', () => {
    assert.match(titleProblem(''), /Give the timeline a name/);
    assert.match(titleProblem('   '), /Give the timeline a name/);
  });
  it('rejects names over the limit', () => {
    assert.equal(titleProblem('x'.repeat(TITLE_MAX)), null);
    assert.match(titleProblem('x'.repeat(TITLE_MAX + 1)), /under 121 characters/);
  });
});

describe('eventProblem — events the timeline can place', () => {
  const ok = (enhanced_time) => ({ name: 'Grandmother born', enhanced_time });

  it('accepts dates the parser places', () => {
    for (const time of ['1931', 'March 1931', '44 BC', 'Spring 1950', 'c. 1900', 'May 4, 1952']) {
      assert.equal(eventProblem(ok(time)), null, time);
    }
  });
  it('rejects text the parser cannot place instead of saving it as year 0', () => {
    for (const time of ['approximate date', 'banana', 'sometime']) {
      assert.match(eventProblem(ok(time)), /not a date the timeline can place/, time);
    }
  });
  it('requires a name and a date', () => {
    assert.match(eventProblem({ enhanced_time: '1931' }), /Give the event a name/);
    assert.match(eventProblem({ name: 'A' }), /Give the event a date/);
  });
});

describe('toTimelineEventDoc — stored fields', () => {
  it('keeps event content and drops display state and empty values', () => {
    const doc = toTimelineEventDoc({
      event_id: 'evt_1', name: 'A', enhanced_time: '1931', enhanced_description: '', categories: ['culture'],
      personal: true, timelineId: 'tl_1', dirty: false, lastModified: 5, wikipedia_url: null,
    });
    assert.deepEqual(doc, { event_id: 'evt_1', name: 'A', enhanced_time: '1931', categories: ['culture'] });
  });
});

describe('timelineIdFromSearch — the ?timeline= link', () => {
  it('reads a timeline ID', () => {
    const id = newTimelineId();
    assert.equal(timelineIdFromSearch(`?file=x.json&timeline=${id}`), id);
  });
  it('ignores a missing or malformed ID', () => {
    assert.equal(timelineIdFromSearch('?file=x.json'), null);
    assert.equal(timelineIdFromSearch('?timeline=../users/admin'), null);
    assert.equal(timelineIdFromSearch('?timeline='), null);
  });
});

describe('eventProblem — numeric dates', () => {
  it('accepts a month/day/year date', () => assert.equal(eventProblem({ name: 'Birth', enhanced_time: '1/25/1976' }), null));
  it('rejects a numeric date the parser cannot read instead of placing it in an early year', () => {
    assert.match(eventProblem({ name: 'Birth', enhanced_time: '13/13/1976' }), /not a date the timeline can place/);
    assert.match(eventProblem({ name: 'Birth', enhanced_time: '2/30/1976' }), /not a date the timeline can place/);
  });
});
