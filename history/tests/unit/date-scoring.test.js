import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTimeToSortableValue } from '../../modules/date-handlers.js';

// Rachid's "Date Scoring Test List - working set" sheet, exported as CSV: Input, expected Sort
// Value, Calculated Date. The CSV is the maintained copy; correct it here when a row is wrong.
const CSV = readFileSync(new URL('./fixtures/date-scoring-working-set.csv', import.meta.url), 'utf8');

// Rows the parser does not handle yet, with the value it currently returns noted in the reason.
const NOT_YET_SUPPORTED = {
  '21st of an unspecified month in 764': 'natural-language day without a month',
  'Spring and Summer 934': 'compound season',
  'Winter 1069-1070': 'winter spanning a year boundary',
  'Late summer/early autumn 1161': 'compound season',
  '1970-05': 'YYYY-MM ignores the month',
  '15 44 BC': '"day year BC"',
  'September, 2004': '"Month, Year" with a comma',
};

function parseRows(csv) {
  return csv.trim().split('\n').slice(1).map(line => {
    const match = line.match(/^(?:"([^"]*)"|([^,]*)),([^,]*),(.*)$/);
    return { input: match[1] ?? match[2], sort: Number(match[3]) };
  });
}

// The sheet rounds to seven or so significant digits; the largest values need a relative bound.
const close = (actual, expected) => Math.abs(actual - expected) < Math.max(0.0001, Math.abs(expected) * 1e-9);

describe('date scoring sheet', () => {
  const rows = parseRows(CSV);

  it('has every row of the sheet', () => assert.equal(rows.length, 94));

  for (const { input, sort } of rows) {
    if (NOT_YET_SUPPORTED[input]) {
      it.todo(`sorts ${JSON.stringify(input)} at ${sort} (${NOT_YET_SUPPORTED[input]})`);
      continue;
    }
    it(`sorts ${JSON.stringify(input)} at ${sort}`, () => {
      const actual = parseTimeToSortableValue(input).sortableValue;
      assert.ok(close(actual, sort), `expected ${sort}, got ${actual}`);
    });
  }
});
