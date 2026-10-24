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

describe('eventProblem — slashed numeric dates must land on the day they name', () => {
  const accepted = ['1/25/1976', '01/25/1976', '25/1/1976', '1941/7/1', '2/29/2000', 'approx. 1/25/1976', '(1/25/1976)', 'c. 1/25/1976'];
  const refused = [
    '1/25/0001', '1/2/0001',                     // zero-padded years fall back to year 1
    'approx. 2/30/1976', '(2/30/1976)',          // no such day once the wrapper is removed
    'early 1/25/1976', 'late 1/25/1976',         // modifiers stop the numeric reading
    '1/25/1976 AD', '1/25/1976 BC', '1/25/76',   // era suffixes and two-digit years
    '1941/13/1', '1/25/1976 - 2/1/1976',         // no such month; two dates
  ];
  for (const time of accepted) {
    it(`accepts ${JSON.stringify(time)}`, () => assert.equal(eventProblem({ name: 'Birth', enhanced_time: time }), null));
  }
  for (const time of refused) {
    it(`refuses ${JSON.stringify(time)}`, () => assert.match(eventProblem({ name: 'Birth', enhanced_time: time }), /not a date the timeline can place/));
  }
  it('leaves dates without a slashed number alone', () => {
    for (const time of ['April/May 1097', '1786-09-01/1786-12-31', 'March 1931', '44 BC']) {
      assert.equal(eventProblem({ name: 'x', enhanced_time: time }), null, time);
    }
  });
});
