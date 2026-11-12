import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { displayDate, recordDisplayDate } from '../../modules/world-images.js';

describe('displayDate — the image date, plainly', () => {
  it('cleans the date shapes the source metadata uses', () => {
    const cases = [
      ['2023-04-29', '2023-04-29'], ['2014-06-28 13:40:57', '2014-06-28'], ['1864', '1864'], ['1925-05', '1925'],
      ['18 th century date QS:P,+1750-00-00T00:00:00Z/7', '18th century'], ['late 19th century', 'late 19th century'],
      ['circa 1550 date QS:P,+1550-00-00T00:00:00Z/9,P1480,Q5727902', 'c. 1550'], ['c. 1880s', 'c. 1880s'],
      ['between 1890 and 1900 date QS:P,+1890-00-00T00:00:00Z/9', '1890–1900'], ['1810/1867', '1810–1867'],
      ['before 1900 date QS:P,+1900-00-00T00:00:00Z/9', 'before 1900'],
      ['Taken on 5 October 2007, 10:21 (according to Exif data)', '2007'], ['Taken in October 1907', '1907'],
      ['7/4/2015', '2015'], ['Published on August 14, 1976', '1976'], ['27 - 29 September 1981', '1981'],
      ['between circa 1461 and circa 1470 date QS:P,+1450-00-00T00:00:00Z/7,P1480,Q5727902', 'c. 1461–1470'],
      ['1928–1929 circa', 'c. 1928–1929'], ['2007-01-01/2017-12-31', '2007–2017'],
      ['1847 (28 March 2010 (original upload date))', '1847'],
      ['20 November 2025 (upload date) - Taken on 27 April 2011', '2011'],
    ];
    for (const [raw, shown] of cases) assert.equal(displayDate(raw), shown, raw);
  });
  it('keeps an era and shows nothing rather than a year that changes the meaning', () => {
    assert.equal(displayDate('7th century BC'), '7th century BC');
    assert.equal(displayDate('500 BC'), '500 BC');
    const unsafe = [null, undefined, '', 'Unknown date', '06.11.06', '-0085-01-01', 'Since 1966', 'Ming Dynasty (1368-1644)',
      'Unknown date, photoshopped: 2010-04-16', 'Sommer 1945 oder Folgejahre', 'Late 2nd, early 3rd century AD',
      '1 August 2008 (original upload date)', '20:36, 12 April 2010 (UTC)', 'Published in London. by T. Cadel in 1786.',
      'circa 1505 date QS:P,+1505-00-00T00:00:00Z/9,P1480,Q5727902 (1893 facsimile) .',
      'before March 2007', 'after 1 July 2007', 'before 1925-05'];
    for (const raw of unsafe) assert.equal(displayDate(raw), null, String(raw));
  });
  it('a reviewed display_date is shown as written, and an explicit null shows no date', () => {
    assert.equal(recordDisplayDate({ display_date: 'c. 1550', image_date: '2010-04-16' }), 'c. 1550');
    assert.equal(recordDisplayDate({ display_date: null, image_date: 'Unknown date, photoshopped: 2010-04-16' }), null);
    assert.equal(recordDisplayDate({ display_date: null, image_date: '1864' }), null);
    assert.equal(recordDisplayDate({ image_date: '1864' }), '1864');
  });
});
