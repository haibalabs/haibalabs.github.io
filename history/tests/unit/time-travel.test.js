import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { label } from '../../modules/time-travel.js';

describe('loading trip readout', () => {
  it('reads deep time in billions, millions and thousands of years', () => {
    assert.equal(label(-13.8e9), '13.8 billion years ago');
    assert.equal(label(-540e6), '540 million years ago');
    assert.equal(label(-2.5e6), '2.5 million years ago');
    assert.equal(label(-300000), '300,000 years ago');
  });

  it('moves to the next unit when rounding reaches it', () => {
    assert.equal(label(-999999), '1 million years ago');
    assert.equal(label(-999990000), '1 billion years ago');
    assert.equal(label(-9999), '10,000 years ago');
  });

  it('has no year 0 and writes years from 1000 as the pill does', () => {
    assert.equal(label(0), '1 BC');
    assert.equal(label(-44), '44 BC');
    assert.equal(label(500), '500 AD');
    assert.equal(label(1914), '1914');
  });
});
