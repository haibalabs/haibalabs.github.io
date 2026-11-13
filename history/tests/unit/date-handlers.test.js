import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTimeToSortableValue,
  formatHistoricalDate,
  extractYear,
  extractDateComponents,
  numericDateParts,
  eventDateLabel,
  eventSortableValue,
  eventTiebreak,
  eventYear
} from '../../modules/date-handlers.js';

const TOLERANCE = 0.0001;

function assertSortValue(input, expected) {
  const result = parseTimeToSortableValue(input);
  const actual = result?.sortableValue ?? 0;
  assert.ok(
    Math.abs(actual - expected) < TOLERANCE,
    `"${input}": expected ${expected}, got ${actual}`
  );
}

// ---------------------------------------------------------------------------
// Sorting tests — ported from date-testing.html window.sortTestCases
// ---------------------------------------------------------------------------

describe('parseTimeToSortableValue — Plain Years', () => {
  it('parses "970"', () => assertSortValue("970", 970.0861));
  it('parses "1066"', () => assertSortValue("1066", 1066.0861));
  it('parses "2000"', () => assertSortValue("2000", 2000.0861));
});

describe('parseTimeToSortableValue — Seasonal', () => {
  it('parses "Spring 1153"', () => assertSortValue("Spring 1153", 1153.3361));
  it('parses "Summer 905"', () => assertSortValue("Summer 905", 905.5861));
  it('parses "Spring 905"', () => assertSortValue("Spring 905", 905.3361));
  it('parses "Winter 1242"', () => assertSortValue("Winter 1242", 1242.0861));
});

describe('parseTimeToSortableValue — Prehistoric', () => {
  it('parses "13.8 billion years ago"', () => assertSortValue("13.8 billion years ago", -13799999999.913935));
  it('parses "55 million years ago"', () => assertSortValue("55 million years ago", -54999999.913934425));
  it('parses "1 million years ago"', () => assertSortValue("1 million years ago", -999999.9139344261));
  it('parses "c. 13.8 billion years ago"', () => assertSortValue("c. 13.8 billion years ago", -13799999999.913935));
  it('parses "c. 55 million years ago"', () => assertSortValue("c. 55 million years ago", -54999999.913934425));
  it('parses "c. 1 million years ago"', () => assertSortValue("c. 1 million years ago", -999999.9139344261));
});

describe('parseTimeToSortableValue — BCE/BC', () => {
  it('parses "50-10-10 BC"', () => assertSortValue("50-10-10 BC", -49.13934426));
  it('parses "3000 BCE"', () => assertSortValue("3000 BCE", -2999.9139));
  it('parses "1200 BC"', () => assertSortValue("1200 BC", -1199.9139));
  it('parses "c. 1 BC"', () => assertSortValue("c. 1 BC", -0.9139));
  it('parses "c. -0018"', () => assertSortValue("c. -0018", -17.91393443));
  it('parses "c. -0326"', () => assertSortValue("c. -0326", -325.9139344));
  it('parses "-0013-01-01"', () => assertSortValue("-0013-01-01", -12.91393443));
  it('parses "-0001-01-01"', () => assertSortValue("-0001-01-01", -0.9139344262));
  it('parses "-0438-01-01"', () => assertSortValue("-0438-01-01", -437.9139344));
  it('parses "-0001-01"', () => assertSortValue("-0001-01", -0.9139344262));
  it('parses "-0023"', () => assertSortValue("-0023", -22.91393443));
  it('parses "-0002"', () => assertSortValue("-0002", -1.913934426));
  it('parses "-0381"', () => assertSortValue("-0381", -380.9139344));
  it('parses "-206"', () => assertSortValue("-206", -205.9139344));
  it('parses "15 44 BC"', () => assertSortValue("15 44 BC", -43.91393443));
  it('parses "spring -0119"', () => assertSortValue("spring -0119", -118.6639344));
  it('parses "c. -0510 to -0430"', () => assertSortValue("c. -0510 to -0430", -509.9139344));
  it('parses "-0780-01-01/-0560-01-01"', () => assertSortValue("-0780-01-01/-0560-01-01", -779.9139344));
});

describe('parseTimeToSortableValue — AD/CE', () => {
  it('parses "500 CE"', () => assertSortValue("500 CE", 500.0861));
  it('parses "750 CE"', () => assertSortValue("750 CE", 750.0861));
  it('parses "c. 40 AD"', () => assertSortValue("c. 40 AD", 40.0861));
  it('parses "c. 286 AD"', () => assertSortValue("c. 286 AD", 286.0861));
  it('parses "c. October 1172"', () => assertSortValue("c. October 1172", 1172.836066));
  it('parses "Around AD 13"', () => assertSortValue("Around AD 13", 13.0861));
  it('parses "c. 613 AD"', () => assertSortValue("c. 613 AD", 613.0861));
  it('parses "c.0790"', () => assertSortValue("c.0790", 790.0861));
  it('parses "c.0090"', () => assertSortValue("c.0090", 90.0861));
  it('parses "c.0003"', () => assertSortValue("c.0003", 3.0861));
});

describe('parseTimeToSortableValue — Full Dates', () => {
  it('parses "6 October 907"', () => assertSortValue("6 October 907", 907.8497));
  it('parses "December 1, 1493"', () => assertSortValue("December 1, 1493", 1494.0027));
  it('parses "1941-12-10"', () => assertSortValue("1941-12-10", 1942.0273));
  it('parses "1941-05-22"', () => assertSortValue("1941-05-22", 1941.4768));
  it('parses "10 May 1941"', () => assertSortValue("10 May 1941", 1941.4440));
  it('parses "May 5th 1941"', () => assertSortValue("May 5th 1941", 1941.4303));
  it('parses "May 1941"', () => assertSortValue("May 1941", 1941.4194));
  it('parses "3/9/2004"', () => assertSortValue("3/9/2004", 2004.27459));
});

describe('parseTimeToSortableValue — Ranges', () => {
  it('parses "8th-9th century"', () => assertSortValue("8th-9th century", 700.0861));
  it('parses "1331-1333"', () => assertSortValue("1331-1333", 1331.0861));
  it('parses "96-104"', () => assertSortValue("96-104", 96.0861));
  it('parses "1-27"', () => assertSortValue("1-27", 1.0861));
  it('parses "1941-07-01 to 1942-12-31"', () => assertSortValue("1941-07-01 to 1942-12-31", 1941.5861));
  it('parses "April 1941 to June 1941"', () => assertSortValue("April 1941 to June 1941", 1941.3361));
});

// The Battles of Yarmuk and Qadisiyyah were placed in years 15 and 16: the left day of a day-first range in one
// month was read as the year.
describe('day-first ranges in one month — the earliest day, in the written year', () => {
  for (const [time, year, month, day, label] of [
    ['15–20 August 636', 636, 8, 15, 'August 15th, 636 AD'],
    ['16–19 November 636', 636, 11, 16, 'November 16th, 636 AD'],
    ['2–4 March 44 BC', -44, 3, 2, 'March 2nd, 44 BC'],
  ]) {
    it(`"${time}" is ${label}, where the card shows it and where the timeline places it`, () => {
      const parsed = parseTimeToSortableValue(time);
      assert.deepEqual([parsed.year, parsed.month, parsed.day], [year, month, day]);
      const event = { enhanced_time: time };
      assert.equal(eventDateLabel(event), label);
      assert.equal(eventYear(event), year);
      assert.equal(extractYear(eventSortableValue(event)), year);
    });
  }
});

// Forms in the live release that also read a day or a month number as the year.
describe('ranges across two months, and months as numbers, keep the written year', () => {
  for (const [time, year, month, day, label] of [
    ['June 22 - July 12, 1148', 1148, 6, 22, 'June 22nd, 1148 AD'],
    ['September 23 - December 3, 1283', 1283, 9, 23, 'September 23rd, 1283'],
    ['August 26 - August 29, 1968', 1968, 8, 26, 'August 26th, 1968'],
    ['30 July – 2 August 1914', 1914, 7, 30, 'July 30th, 1914'],
    ['05-06 0171', 171, 5, 1, 'May, 171 AD'],
  ]) {
    it(`"${time}" is ${label}`, () => {
      const parsed = parseTimeToSortableValue(time);
      assert.deepEqual([parsed.year, parsed.month, parsed.day], [year, month, day]);
      assert.equal(eventDateLabel({ enhanced_time: time }), label);
    });
  }
  it('leaves a season range with its own years alone ("Spring 12 - Summer 14" is spring 12)', () => {
    const parsed = parseTimeToSortableValue('Spring 12 - Summer 14');
    assert.deepEqual([parsed.year, parsed.season], [12, 'spring']);
  });
});

describe('parseTimeToSortableValue — Special Formats', () => {
  it.todo('parses "September, 2004"'); // expected: 2004.752732 — "Month, Year" with comma not yet supported
  it.todo('parses "1970-05"'); // expected: 1970.419399 — YYYY-MM format not yet supported (ignores month)
  it('parses "10 0037"', () => assertSortValue("10 0037", 37.83606557));
  it('parses "12 0965"', () => assertSortValue("12 0965", 966.0027322));
  it('parses "00010-01-01"', () => assertSortValue("00010-01-01", 10.08606557));
  it('parses "20th century"', () => assertSortValue("20th century", 1900.086066));
  it('parses "Approximate date: 1156"', () => assertSortValue("Approximate date: 1156", 1156.086066));
  it('parses "10 954"', () => assertSortValue("10 954", 954.8360656));
  it('parses "Approximate date in 613"', () => assertSortValue("Approximate date in 613", 613.0860656));
  it('parses "July 25-27, 677"', () => assertSortValue("July 25-27, 677", 677.6516393));
  it('parses "circa 698-700"', () => assertSortValue("circa 698-700", 698.0860656));
  it('parses "720 or 721"', () => assertSortValue("720 or 721", 720.0860656));
  it('parses "730s"', () => assertSortValue("730s", 730.0860656));
  it('parses "744 (approximate)"', () => assertSortValue("744 (approximate)", 744.0860656));
  it.todo('parses "21st of an unspecified month in 764"'); // expected: 764.1407104 — natural language year extraction not yet supported
  it('parses "approximate date 766"', () => assertSortValue("approximate date 766", 766.0860656));
  it('parses "November-December 803"', () => assertSortValue("November-December 803", 803.9193989));
  it('parses "Approximate 828"', () => assertSortValue("Approximate 828", 828.0860656));
  it('parses "by 869"', () => assertSortValue("by 869", 869.0860656));
  it('parses "March\u2013April 878"', () => assertSortValue("March\u2013April 878", 878.2527322));
  it('parses "February - March 902"', () => assertSortValue("February - March 902", 902.1693989));
  it('parses "March or April 914"', () => assertSortValue("March or April 914", 914.2527322));
  it('parses "Spring and Summer 934"', () => assertSortValue("Spring and Summer 934", 934.3360656));
  it('parses "Summer to Autumn 1006"', () => assertSortValue("Summer to Autumn 1006", 1006.586066));
  it.todo('parses "Winter 1069-1070"'); // expected: 1070.084699 — winter spanning year boundary not yet supported
  it('parses "Approx. 1091"', () => assertSortValue("Approx. 1091", 1091.086066));
  it('parses "April/May 1097"', () => assertSortValue("April/May 1097", 1097.336066));
  it('parses "Early October 1126"', () => assertSortValue("Early October 1126", 1126.836066));
  it('parses "Late spring 1147"', () => assertSortValue("Late spring 1147", 1147.502732));
  it.todo('parses "Late summer/early autumn 1161"'); // expected: 1161.752732 — compound season format not yet supported
  it('parses "After April 18, 1161"', () => assertSortValue("After April 18, 1161", 1161.382514));
  it('parses "Mid 1203"', () => assertSortValue("Mid 1203", 1203.502732));
  it('parses "Late 1203"', () => assertSortValue("Late 1203", 1204.002732));
  it('parses "1209-Spring"', () => assertSortValue("1209-Spring", 1209.336066));
  it('parses "Between March and July 1222"', () => assertSortValue("Between March and July 1222", 1222.252732));
  it('parses "Before July 1263"', () => assertSortValue("Before July 1263", 1263.586066));
  it('parses "AD 1-5"', () => assertSortValue("AD 1-5", 1.086065574));
  it('parses "July 7, 756 AD"', () => assertSortValue("July 7, 756 AD", 756.602459));
  it('parses "Around AD 10"', () => assertSortValue("Around AD 10", 10.08606557));
  it('parses "14 AD - 16 AD"', () => assertSortValue("14 AD - 16 AD", 14.08606557));
  it('parses "Winter, AD 18"', () => assertSortValue("Winter, AD 18", 18.08606557));
  it('parses "approx. 600 AD"', () => assertSortValue("approx. 600 AD", 600.0860656));
  it('parses "1941/7/1"', () => assertSortValue("1941/7/1", 1941.586066));
  it('parses "approximate date"', () => assertSortValue("approximate date", 0.0860655737704918));
});

// ---------------------------------------------------------------------------
// Formatting tests — ported from date-testing.html window.parseTestCases
// ---------------------------------------------------------------------------

describe('formatHistoricalDate', () => {
  it('formats "c. 13.8 billion years ago"', () => {
    assert.equal(formatHistoricalDate("c. 13.8 billion years ago"), "c. 13.8 billion years ago");
  });
  it.todo('formats "1970-05" as "May 1970"'); // currently returns "1970" — YYYY-MM format not yet supported
  it('formats "50-10-10 BC"', () => {
    assert.equal(formatHistoricalDate("50-10-10 BC"), "October 10th, 50 BC");
  });
  it('formats "1941-12-10"', () => {
    assert.equal(formatHistoricalDate("1941-12-10"), "December 10th, 1941");
  });
  it('formats "6 October 907"', () => {
    assert.equal(formatHistoricalDate("6 October 907"), "October 6th, 907 AD");
  });
  it('formats "c. 1 BC"', () => {
    assert.equal(formatHistoricalDate("c. 1 BC"), "1 BC");
  });
  it.todo('formats "approximate date" as "unknown date"'); // currently returns "0 AD"
});

// ---------------------------------------------------------------------------
// Sort order invariants
// ---------------------------------------------------------------------------

describe('Sort order invariants', () => {
  it('prehistoric events sort before BCE events', () => {
    const prehistoric = parseTimeToSortableValue("c. 13.8 billion years ago");
    const bce = parseTimeToSortableValue("3000 BCE");
    assert.ok(prehistoric.sortableValue < bce.sortableValue,
      `prehistoric (${prehistoric.sortableValue}) should be < BCE (${bce.sortableValue})`);
  });

  it('BCE events sort before CE events', () => {
    const bce = parseTimeToSortableValue("3000 BCE");
    const ce = parseTimeToSortableValue("500 CE");
    assert.ok(bce.sortableValue < ce.sortableValue,
      `BCE (${bce.sortableValue}) should be < CE (${ce.sortableValue})`);
  });

  it('earlier CE years sort before later CE years', () => {
    const earlier = parseTimeToSortableValue("500 CE");
    const later = parseTimeToSortableValue("1066");
    assert.ok(earlier.sortableValue < later.sortableValue,
      `500 CE (${earlier.sortableValue}) should be < 1066 (${later.sortableValue})`);
  });

  it('events within same year sort by month/day', () => {
    const may = parseTimeToSortableValue("1941-05-22");
    const dec = parseTimeToSortableValue("1941-12-10");
    assert.ok(may.sortableValue < dec.sortableValue,
      `May (${may.sortableValue}) should be < December (${dec.sortableValue})`);
  });

  it('seasons sort correctly within a year', () => {
    const spring = parseTimeToSortableValue("Spring 905");
    const summer = parseTimeToSortableValue("Summer 905");
    assert.ok(spring.sortableValue < summer.sortableValue,
      `Spring (${spring.sortableValue}) should be < Summer (${summer.sortableValue})`);
  });
});

describe('numeric dates typed in the event form', () => {
  it('reads month/day/year, the form placeholder\'s format', () => {
    const parsed = parseTimeToSortableValue('1/25/1976');
    assert.deepEqual([parsed.year, parsed.month, parsed.day], [1976, 1, 25]);
    assert.equal(formatHistoricalDate('1/25/1976'), 'January 25th, 1976');
    assert.equal(formatHistoricalDate('01/25/1976'), 'January 25th, 1976');
  });

  it('reads day first only when the first number cannot be a month', () => {
    assert.equal(formatHistoricalDate('25/1/1976'), 'January 25th, 1976');
    assert.equal(formatHistoricalDate('3/4/1950'), 'March 4th, 1950');
  });

  it('accepts three-digit years and leap days', () => {
    assert.equal(formatHistoricalDate('12/31/999'), 'December 31st, 999 AD');
    assert.equal(parseTimeToSortableValue('2/29/2000').day, 29);
  });

  it('leaves impossible dates unconverted', () => {
    assert.notEqual(parseTimeToSortableValue('13/13/1976').year, 1976);
    assert.notEqual(parseTimeToSortableValue('2/30/1976').year, 1976);
    assert.notEqual(parseTimeToSortableValue('2/29/1900').year, 1900);
  });

  it('does not touch ISO date ranges from the world data', () => {
    assert.equal(parseTimeToSortableValue('1786-09-01/1786-12-31').year, 1786);
    assert.equal(parseTimeToSortableValue('1876-06-25/26').year, 1876);
  });
});

describe('numericDateParts — the shared month/day/year reading', () => {
  it('reads month first, and day first only when the first number cannot be a month', () => {
    assert.deepEqual(numericDateParts('1/25/1976'), { year: 1976, month: 1, day: 25 });
    assert.deepEqual(numericDateParts('25/1/1976'), { year: 1976, month: 1, day: 25 });
    assert.deepEqual(numericDateParts('3/4/950'), { year: 950, month: 3, day: 4 });
  });
  it('returns null for other shapes and for days that do not exist', () => {
    for (const text of ['1/25/76', '1/25/19760', 'early 1/25/1976', '2/30/1976', '2/29/1900', '13/13/1976', '0/5/1976', '1976-01-25']) {
      assert.equal(numericDateParts(text), null, text);
    }
  });
});

describe('world dates that used to fall back to year 0', () => {
  it('a day of an unnamed month keeps only its year', () => {
    assert.equal(formatHistoricalDate('15 44 BC'), '44 BC');
    assert.equal(parseTimeToSortableValue('15 44 BC').hasDay, false);
  });
  it('a pair of seasons is shown and sorted at its first season', () => {
    assert.equal(formatHistoricalDate('Spring and Summer 934'), 'spring 934');
  });
  it('a season followed by a negative year is still BC', () => {
    assert.equal(formatHistoricalDate('spring -0119'), 'spring 119 BC');
    assert.equal(formatHistoricalDate('Spring and Summer 934 BC'), 'spring 934 BC');
  });
});

describe('deep time — thousands of years ago and five-digit BC years', () => {
  it('shows "years ago" dates as written', () => {
    for (const t of ['c. 300,000 years ago', '70 thousand years ago', '66 million years ago', '13.8 billion years ago']) {
      assert.equal(formatHistoricalDate(t), t);
    }
  });
  it('puts a thousands separator in five-digit years only', () => {
    assert.equal(formatHistoricalDate('10,000 BC'), '10,000 BC');
    assert.equal(formatHistoricalDate('10000 BCE'), '10,000 BC');
    assert.equal(formatHistoricalDate('9500 BC'), '9500 BC');
    assert.equal(formatHistoricalDate('1936'), '1936');
  });
  it('orders deep time correctly against BC dates', () => {
    const order = ['13.8 billion years ago', '66 million years ago', 'c. 300,000 years ago', '70 thousand years ago', 'c. 12,000 years ago', '10,000 BC', '9500 BC', '3200 BC']
      .map(t => parseTimeToSortableValue(t).sortableValue);
    assert.deepEqual(order, [...order].sort((a, b) => a - b));
  });
  it('leaves a comma followed by a space alone', () => {
    assert.equal(parseTimeToSortableValue('July 7, 756 AD').year, 756);
  });
});

describe('navigation positions — deep-time records with labels the parser cannot read', () => {
  // from Atlas's early-times date contract (opening-v2/date-contract.json)
  const bigBang = { enhanced_time: 'c. 13.8 billion years ago', sort_years_ago: 13800000000, sort_tiebreak: 1 };
  const nuclei = { enhanced_time: 'Within minutes after the Big Bang', sort_years_ago: 13800000000, sort_tiebreak: 2 };
  const light = { enhanced_time: 'c. 380,000 years after the Big Bang', sort_years_ago: 13799620000, sort_tiebreak: 3 };
  const reionization = { enhanced_time: 'c. 200 million–1 billion years after the Big Bang', sort_years_ago: 13200000000, sort_tiebreak: 6 };
  const ediacaran = { enhanced_time: 'c. 580–542 million years ago', sort_years_ago: 561000000, sort_tiebreak: 14 };

  it('shows the label as written', () => {
    assert.equal(eventDateLabel(nuclei), 'Within minutes after the Big Bang');
    assert.equal(eventDateLabel(ediacaran), 'c. 580–542 million years ago');
  });
  it('orders records at the same position by their tiebreak, and the rest by position', () => {
    const shuffled = [ediacaran, light, nuclei, reionization, bigBang];
    const ordered = shuffled.map(e => ({ e, time: eventSortableValue(e), tie: eventTiebreak(e) }))
      .sort((a, b) => a.time - b.time || a.tie - b.tie).map(x => x.e);
    assert.deepEqual(ordered, [bigBang, nuclei, light, reionization, ediacaran]);
  });
  it('gives a year from the position, counted back from 1950', () => {
    assert.equal(eventYear(ediacaran), 1950 - 561000000);
  });
  it('leaves events without a position exactly as before', () => {
    const plain = { enhanced_time: '1936-06-19' };
    assert.equal(eventSortableValue(plain), parseTimeToSortableValue('1936-06-19').sortableValue);
    assert.equal(eventYear(plain), 1936);
    assert.equal(eventDateLabel(plain), formatHistoricalDate('1936-06-19'));
    assert.equal(eventTiebreak(plain), 0);
  });
});
