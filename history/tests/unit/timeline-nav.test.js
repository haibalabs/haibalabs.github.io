import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { centuryOf, decadeOf, decadeBuckets } from '../../modules/timeline-nav.js';

// Every year of century c falls in exactly one of its decade buckets.
function assertCovers(c) {
  const buckets = decadeBuckets(c);
  const from = buckets[0].from, to = buckets[buckets.length - 1].to;
  assert.equal(to - from, 100, `century ${c} spans 100 years`);
  for (let y = from; y < to; y++) {
    assert.equal(centuryOf(y), c, `${y} belongs to century ${c}`);
    const hits = buckets.filter(b => y >= b.from && y < b.to);
    assert.equal(hits.length, 1, `${y} is in exactly one bucket`);
    assert.equal(hits[0].key, decadeOf(y), `${y} is in its own decade`);
  }
}

describe('decadeBuckets — every year of a century is counted once', () => {
  for (const c of [19, 20, 21, 1, -1, -2]) {
    it(`covers century ${c}`, () => assertCovers(c));
  }

  it('ends the 19th century with a one-year 1900 bucket', () => {
    const buckets = decadeBuckets(19);
    assert.deepEqual(buckets[0], { key: 1800, from: 1801, to: 1810, label: '1800s' });
    assert.deepEqual(buckets.at(-1), { key: 1900, from: 1900, to: 1901, label: '1900' });
  });

  it('starts the 20th century at 1901 and ends it with 2000', () => {
    const buckets = decadeBuckets(20);
    assert.deepEqual(buckets[0], { key: 1900, from: 1901, to: 1910, label: '1900s' });
    assert.deepEqual(buckets.at(-1), { key: 2000, from: 2000, to: 2001, label: '2000' });
  });

  it('runs the 1st century BC from 100 BC to 1 BC', () => {
    const buckets = decadeBuckets(-1);
    assert.deepEqual(buckets[0], { key: -109, from: -100, to: -99, label: '100 BC' });
    assert.deepEqual(buckets.at(-1), { key: -9, from: -9, to: 0, label: '0s BC' });
  });

  it('runs the 1st century from 1 AD to 100 AD', () => {
    const buckets = decadeBuckets(1);
    assert.deepEqual(buckets[0], { key: 0, from: 1, to: 10, label: '0s' });
    assert.deepEqual(buckets.at(-1), { key: 100, from: 100, to: 101, label: '100 AD' });
  });
});
