import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTimeToSortableValue,
  formatHistoricalDate,
  extractYear,
  extractDateComponents
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
  it.todo('parses "15 44 BC"'); // expected: -43.91393443 — "day year BC" format not yet supported
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
  it.todo('parses "3/9/2004"'); // expected: 2004.27459 — M/D/YYYY format not yet supported
});

describe('parseTimeToSortableValue — Ranges', () => {
  it('parses "8th-9th century"', () => assertSortValue("8th-9th century", 700.0861));
  it('parses "1331-1333"', () => assertSortValue("1331-1333", 1331.0861));
  it('parses "96-104"', () => assertSortValue("96-104", 96.0861));
  it('parses "1-27"', () => assertSortValue("1-27", 1.0861));
  it('parses "1941-07-01 to 1942-12-31"', () => assertSortValue("1941-07-01 to 1942-12-31", 1941.5861));
  it('parses "April 1941 to June 1941"', () => assertSortValue("April 1941 to June 1941", 1941.3361));
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
  it.todo('parses "Spring and Summer 934"'); // expected: 934.3360656 — compound season format not yet supported
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
