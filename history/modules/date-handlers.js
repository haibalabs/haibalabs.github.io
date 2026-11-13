// date-handlers.js

//  ===============================
//  1) Helper: Convert date to sort value
//  ===============================
function dateToSortValue(year, month, day) {
  // Adjust month/day to numeric if missing
  year = parseInt(year) || 0;
  month = parseInt(month) || 1;
  day = parseInt(day) || 1;
  return year + (month / 12) + (day / 366);
}

function parseYear(yearStr) {
  // Handle negative years
  const isNegative = yearStr.startsWith('-');
  // Remove leading zeros but keep last zero if it's a zero year
  const cleanYear = yearStr.replace(/^-?0+(?=\d)/, isNegative ? '-' : '');
  return parseInt(cleanYear) || 0;
}
  
  // ===============================
  // 2) Helper: Map “early/mid/late” to approximate day or month
  // ===============================
  // Example logic (feel free to adjust):
  //   - Early month => day = 1
  //   - Mid month   => day = 15
  //   - Late month  => day = 25
  //   - Early spring => month = 3, day = 21
  //   - Late spring => month = 5, day = 1
  // This is subjective—decide on your own rules.
  
  function adjustForApproxWords(dateObj) {
  const { approxModifier, season } = dateObj;

  // 1) If there's a season, do your existing season-based logic
  if (season) {
    // Simple default seasons
    const seasonBase = {
      winter: 1,   // January
      spring: 4,   // April
      summer: 7,   // July
      autumn: 10,  // October
      fall: 10
    };
    dateObj.month = seasonBase[season.toLowerCase()] || 1;

    // If it’s "early/mid/late spring", you might shift from April to March/May/June, etc.
    if (approxModifier === 'early') {
      if (dateObj.month === 4) dateObj.month = 3; // "early spring" => March
      dateObj.day = 1;
    } else if (approxModifier === 'mid') {
      if (dateObj.month === 4) dateObj.month = 5; // "mid spring" => May
      dateObj.day = 1;
    } else if (approxModifier === 'late') {
      if (dateObj.month === 4) dateObj.month = 6; // "late spring" => June
      dateObj.day = 1;
    }

    return dateObj;
  }

  // 2) If no season, check whether month is specified (i.e., not 1 from a default fallback)
  //    We'll decide "month=1" means no user-specified month, unless you set month=1 intentionally.
  const hasSpecifiedMonth = (dateObj.month !== 1 || dateObj.originalMonthParsed);

  if (hasSpecifiedMonth) {
    // We have a month but not necessarily a day (or day=1 from default).
    // So "early" => day=1, "mid" => day=15, "late" => day=28 (or 25; up to you).
    if (approxModifier === 'early') {
      dateObj.day = 1;
    } else if (approxModifier === 'mid') {
      dateObj.day = 15;
    } else if (approxModifier === 'late') {
      // 28 is safer if you’re worried about February
      dateObj.day = 28;
    }
  } else {
    // 3) No season, no month => it's just a year
    // "early" => January 1, "mid" => June 1, "late" => December 1
    if (approxModifier === 'early') {
      dateObj.month = 1;
      dateObj.day = 1;
    } else if (approxModifier === 'mid') {
      dateObj.month = 6;
      dateObj.day = 1;
    } else if (approxModifier === 'late') {
      dateObj.month = 12;
      dateObj.day = 1;
    }
  }

  return dateObj;
}  
  
    // ===============================
    // 3) Stage One: Preprocess and standardize string
    // ===============================
    // - Remove trivial words: “approx.”, “circa”, “c.”, “(approximate)”, “date”
    // - Convert synonyms of “before,” “by,” “after,” etc. into known placeholders,
    //   or store them in an “approxTime” field if you want to handle them.
    // - Identify “early / mid / late” and store as approxModifier
  /**
   * The calendar day named by a whole-string numeric date with a three- or four-digit year, such
   * as 1/25/1976: month first, as the event form suggests, and day first only when the first
   * number cannot be a month (25/1/1976). Null when the text is not in that form or names no
   * real day (2/30/1976, 13/13/1976).
   *
   * @param {string} text
   * @returns {{ year: number, month: number, day: number }|null}
   */
  export function numericDateParts(text) {
    const match = String(text).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{3,4})$/);
    if (!match) return null;
    const [a, b, year] = match.slice(1).map(Number);
    const [month, day] = a > 12 ? [b, a] : [a, b];
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    return year >= 1 && monthDays && day >= 1 && day <= monthDays ? { year, month, day } : null;
  }

  function preprocessTimeString(time) {
  
    let cleaned = time.toLowerCase().trim();

    // "10,000 BC" or "300,000 years ago": thousands separators go first, before the leading-zero
    // rule below turns ",000" into ",0". A comma followed by a space ("July 7, 756") is untouched.
    cleaned = cleaned.replace(/\b\d{1,3}(?:,\d{3})+\b/g, m => m.replace(/,/g, ''));

    // Remove leading zeros from any number, keeping at least one digit
    cleaned = cleaned.replace(/\b0+(\d+)\b/g, '$1'); 
    cleaned = cleaned.replace(/[\(\)"]/g, '');
    cleaned = cleaned.replace(/\bapproximate\s+date\s+in\b/gi, '');
    cleaned = cleaned.replace(/\bapproximate\s+date\:?/gi, '');
    cleaned = cleaned.replace(/\bapproximate\s+date\b/gi, '');
    cleaned = cleaned.replace(/\bapproximate\b/gi, '');
    cleaned = cleaned.replace(/\bapprox\.?/gi, '');
    cleaned = cleaned.replace(/\bdate\s+in\b/gi, '');
    cleaned = cleaned.replace(/^c\.\s*/i, '').replace(/^circa\s*/i, '');
    cleaned = cleaned.replace(/\b(around|in|between|by|before|after)\b\s*/gi, '');
    //cleaned = cleaned.replace(/^-0+(?=\d)/, '-');

    // unify dash
    cleaned = cleaned.replace(/[–—]/g, '-');

    // remove extra spaces
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    // A numeric date such as 1/25/1976 becomes ISO 1976-1-25; anything else is left alone.
    const numeric = numericDateParts(cleaned);
    if (numeric) cleaned = `${numeric.year}-${numeric.month}-${numeric.day}`;

    let approxModifier = '';
    if (cleaned.includes('early ')) {
      approxModifier = 'early';
      cleaned = cleaned.replace(/\bearly\b\s*/i, '');
    } else if (cleaned.includes('mid ')) {
      approxModifier = 'mid';
      cleaned = cleaned.replace(/\bmid\b\s*/i, '');
    } else if (cleaned.includes('late ')) {
      approxModifier = 'late';
      cleaned = cleaned.replace(/\blate\b\s*/i, '');
    }
  
    // support slashes for dates => convert to hyphens
    cleaned = cleaned.replace(/\//g, '-');
  
    // "march and july 1222" => "march - july 1222"
    cleaned = cleaned.replace(/\sand\s/i, ' - ');

     // "march or april 914" => "march - april 914"
     cleaned = cleaned.replace(/\sor\s/i, ' - ');   
  
    // "1209-spring" => "spring 1209"
    cleaned = cleaned.replace(
      /(-?\d{1,4})-(spring|summer|autumn|fall|winter)/i,
      '$2 $1'
    );

    cleaned = cleaned.replace(
        /\b(\d{1,2})(?:st|nd|rd|th)\s+of\s+an\s+unspecified\s+month\s+in\s+(\d{1,4})\b/,
        (_, day, year) => {
          // e.g. "21st of an unspecified month in 764" => "764-1-21" or "january 21, 764" 
          return `${year}-1-${day}`;
        }
      );
  
    return {
      original: time,
      text: cleaned.trim(),
      approxModifier
    };
  }
  
   // ===============================
   // 4) Stage Two: Check if it’s a range
   // ===============================
   // - For “Jan 100 – Feb 101” or “100-101” etc., parse the left side.
   // - For day ranges “July 25-27, 677,” parse the earliest day (25).
function extractRangeOrDayRange(inputText) {
/*    let isBC = false;
    if (inputText.match(/\s*(bc|bce)\b/i) || inputText.startsWith('-')) {
      isBC = true;
      inputText = inputText.replace(/\s*(bc|bce)\b/i, '').trim();
      if (inputText.startsWith('-')) {
          inputText = inputText.substring(1); // Remove leading minus
      }
    }*/

    // A season followed by a negative year ("spring -119") is BC; a season followed by a dash and
    // another word ("spring - summer 934", from "spring and summer") is a span, not BC.
    let isBC = false;
    if (inputText.match(/\s*(bc|bce)\b/i) ||
        inputText.startsWith('-') ||
        inputText.match(/(spring|summer|autumn|fall|winter)\s+-\d/i)) {
        isBC = true;
        inputText = inputText.replace(/\s*(bc|bce)\b/i, '').trim();
        if (inputText.startsWith('-')) {
            inputText = inputText.substring(1);
        } else if (inputText.match(/(spring|summer|autumn|fall|winter)\s+-\d/i)) {
            inputText = inputText.replace(/\s+-(?=\d)/, ' ');
        }
    }

    // 1) If it matches a full ISO date
    if (/^\d{1,4}-\d{1,2}-\d{1,2}$/.test(inputText)) {
      return {
        isRange: false,
        isBC: isBC,
        rangeStart: inputText,
        rangeEnd: ''
      };
    }
  
    // 2) "8th-9th century" check
    //   const centuryRangeRegex = /(\d+)(st|nd|rd|th)\s*century\s*[–—-]\s*(\d+)(st|nd|rd|th)\s*century/;
    // Capture "8th" as one piece, "9th" as another:
    // const centuryRangeRegex = /((?:\d+)(?:st|nd|rd|th))\s*century\s*[–—-]\s*((?:\d+)(?:st|nd|rd|th))\s*century/i;
    const centuryRangeRegex = /(\d+(?:st|nd|rd|th))(?:\s+century)?\s*[–—-]\s*(\d+(?:st|nd|rd|th))\s+century/i;
    if (centuryRangeRegex.test(inputText)) {
        const match = inputText.match(centuryRangeRegex);
        // match[1] = "8th"
        // match[2] = "9th"
        const leftPart = `${match[1]} century`;   // => "8th century"
        const rightPart = `${match[2]} century`;  // => "9th century"
        return {
        isRange: true,
        isBC: isBC,
        rangeStart: leftPart,
        rangeEnd: rightPart
        };
    }
  
    // 3) Day-range with a month name ("July 25-27, 677") => pick earliest day
    const dayRangeWithMonthRegex = /([a-zA-Z]+)\s+(\d{1,2})[–—-](\d{1,2})(?:,\s*(\d{1,4}))?/;
    if (dayRangeWithMonthRegex.test(inputText)) {
      const match = inputText.match(dayRangeWithMonthRegex);
      const monthName = match[1];
      const earliestDay = match[2];
      const optionalYear = match[4] ? `, ${match[4]}` : '';
      const reconstructed = `${monthName} ${earliestDay}${optionalYear}`;
      return {
        isRange: false,
        isBC: isBC,
        rangeStart: reconstructed.trim(),
        rangeEnd: ''
      };
    }

    // 3b) Day-first range in one month ("15-20 august 636") => the earliest day of that month. Without this the
    //     split below reads the left day alone as a year (year 15).
    const dayFirstRange = inputText.match(/^(\d{1,2})\s*-\s*(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december),?\s+(\d{1,4})$/);
    if (dayFirstRange) {
      return {
        isRange: false,
        isBC: isBC,
        rangeStart: `${dayFirstRange[1]} ${dayFirstRange[3]} ${dayFirstRange[4]}`,
        rangeEnd: ''
      };
    }

    // 3c) Months as numbers before a year ("5-6 171", May to June 171) => the first month of that year, not year 5
    const monthNumbers = inputText.match(/^(\d{1,2})\s*-\s*(\d{1,2})\s+(\d{3,4})$/);
    if (monthNumbers && monthNumbers.slice(1, 3).every(m => Number(m) >= 1 && Number(m) <= 12)) {
      const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
      return {
        isRange: false,
        isBC: isBC,
        rangeStart: `${monthNames[Number(monthNumbers[1]) - 1]} ${monthNumbers[3]}`,
        rangeEnd: ''
      };
    }

    // 4) Try spaced range: "X to Y", "X - Y", "X – Y"
    let rangeSeparatorRegex = /\s+(?:to|[–—-])\s+/;
    let rangeSplit = inputText.split(rangeSeparatorRegex);
  
    let leftPart, rightPart;
    if (rangeSplit.length === 1) {
      // 4B) Fallback: if no spaced match, try raw "xxxx-xxxx" or "Month-Month Year"
      rangeSeparatorRegex = /^(.*?)[–—-](.*?)$/; 
      const match = inputText.match(rangeSeparatorRegex);
      if (!match) {
        return { isRange: false, isBC: isBC,rangeStart: inputText, rangeEnd: '' };
      }
      leftPart  = match[1].trim();
      rightPart = match[2].trim();
    } else {
      // 4A) We do have a spaced range
      [leftPart, rightPart] = rangeSplit.map(s => s.trim());
    }
  
    // -------------------------------
    // 5) UNIFY THE REWRITING HERE
    // -------------------------------
    // If leftPart is a bare month, and rightPart is "Month Year",
    // we want "LeftMonth YEAR" so the single parser sees e.g. "November 803".
    function isBareMonth(txt) {
      // You might want a more robust check using a list of months if you handle "November" vs "Sept" vs "Spring", etc.
      return /^[a-z]+$/i.test(txt);
    }
    function isMonthYear(txt) {
      return /^[a-z]+\s+\d{1,4}$/i.test(txt);
    }
  
    if (isBareMonth(leftPart) && isMonthYear(rightPart)) {
      // e.g., leftPart="November", rightPart="December 803" => year=803 => leftPart="November 803"
      // or "February - March 902" => leftPart="February", rightPart="March 902" => year=902 => leftPart="February 902"
      const rightMatch = rightPart.match(/^([a-z]+)\s+(\d{1,4})$/i);
      if (rightMatch) {
        // If you want the year from the right side
        const year = rightMatch[2];
        leftPart = `${leftPart} ${year}`;
      }
    }

    // A range across two months written with the year only once ("june 22 - july 12, 1148", "30 july - 2 august
    // 1914"): the left side takes the right side's year, instead of reading its day as a year. Only when the right
    // side has a day as well as the year, so a season range ("spring 12 - summer 14") keeps its years.
    const rightYear = rightPart.match(/^(?:[a-z]+\s+\d{1,2},?|\d{1,2}\s+[a-z]+,?)\s+(\d{1,4})$/i);
    if (rightYear && (/^[a-z]+\s+\d{1,2}$/i.test(leftPart) || /^\d{1,2}\s+[a-z]+$/i.test(leftPart))) {
      leftPart = /^\d/.test(leftPart) ? `${leftPart} ${rightYear[1]}` : `${leftPart}, ${rightYear[1]}`;
    }

    return {
      isRange: true,
      isBC: isBC,
      rangeStart: leftPart,
      rangeEnd: rightPart
    };
  }

  /**
   * ===============================
   * 5) Stage Three: Parse single date
   * ===============================
   * - Based on your existing single-date code plus expansions for BC/BCE, AD/CE, centuries, decades, seasons, etc.
   */
  function parseSingleDate(dateStr, approxModifier, originalDate, isBC) {
    const months = [
      'january','february','march','april','may','june',
      'july','august','september','october','november','december'
    ];
  
    // We'll store intermediate info in an object for further manipulation
    let parsed = { year: 0, month: 1, day: 1, season: null, approxModifier,
      originalMonthParsed: false, originalDayParsed: false
     };
  
    // Detect if it’s something like “winter”, “spring”, etc.
    const seasons = { winter:1, spring:4, summer:7, autumn:10, fall:10 };
    for (let s of Object.keys(seasons)) {
      if (dateStr.includes(s)) {
        parsed.season = s;
        // Don’t set parsed.month yet; we’ll do that later in adjustForApproxWords
        dateStr = dateStr.replace(s, '').trim();
        break;
      }
    }

    // // 1) BC / BCE
    // let isBC = false;
    // if (dateStr.match(/\s*(bc|bce)\b/i)) {
    //     isBC = true;
    //     dateStr = dateStr.replace(/\s*(bc|bce)\b/i, '').trim();
    // }

    // e.g., "July 7, 756 AD" or "july 7, 756 ce"
    let monthDayYearAD = dateStr.match(
        /^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{1,4})\s+(ad|ce)$/i
    );
    if (monthDayYearAD) {
        const [, monthName, dayStr, yearStr] = monthDayYearAD;
        const mIdx = months.indexOf(monthName.toLowerCase());
        if (mIdx >= 0) {
          parsed.year = parseInt(yearStr);
          parsed.month = mIdx + 1;
          parsed.day = parseInt(dayStr);
          // “AD” or “CE” means a positive year (which we already do).
          // If you had “BC” or “BCE,” you’d set it negative.
          return adjustForApproxWords(parsed);
        }
    }
    
    // 2) AD / CE (existing generic block for strings like "756 AD" with no month/day)
    if (/\b(\d+)\s*(ad|ce)\b/i.test(dateStr) || /\b(ad|ce)\s*(\d+)\b/i.test(dateStr)) {
        const adYear = dateStr.match(/\d+/)[0];
        parsed.year = parseInt(adYear);
        return adjustForApproxWords(parsed);
    }    
  
    // 2) AD / CE
    if (/\b(\d+)\s*(ad|ce)\b/i.test(dateStr) || /\b(ad|ce)\s*(\d+)\b/i.test(dateStr)) {
      const adYear = dateStr.match(/\d+/)[0];
      parsed.year = parseInt(adYear);
      return adjustForApproxWords(parsed);
    }
  
    // 3) “730s” => year = 730
    let decadeMatch = dateStr.match(/(\d{1,4})s\b/);
    if (decadeMatch) {
      parsed.year = parseInt(decadeMatch[1]);
      if (isBC) {
        parsed.year = -Math.abs(parsed.year);
      }
      return adjustForApproxWords(parsed);
    }
  
    // 4) “8th century” => year = 700
    let centuryMatch = dateStr.match(/(\d+)(st|nd|rd|th)\s+century/);
    if (centuryMatch) {
      let c = parseInt(centuryMatch[1]);
      // 1st century => 0–99 => pick 0
      // 2nd century => 100–199 => pick 100
      // 8th century => 700
      parsed.year = (c - 1) * 100;
      if (isBC) {
        parsed.year = -Math.abs(parsed.year);
      }
      return adjustForApproxWords(parsed);
    }
  
    // 5) million/billion years ago
    if (dateStr.includes('billion years ago')) {
      const val = parseFloat(dateStr.match(/\d+(\.\d+)?/)[0]);
      return { year: -val * 1000000000, month: 1, day: 1 };
    }
    if (dateStr.includes('million years ago')) {
      const val = parseFloat(dateStr.match(/\d+(\.\d+)?/)[0]);
      return { year: -val * 1000000, month: 1, day: 1 };
    }
    // "300000 years ago", "70 thousand years ago": counted back from 1950, the "before present"
    // convention, so "12,000 years ago" sorts next to "10,000 BC". Million and billion years ago
    // above keep counting from year 0, where the difference is too small to show.
    const yearsAgo = dateStr.match(/^(\d+(?:\.\d+)?)\s*(thousand\s+)?years?\s+ago$/);
    if (yearsAgo) {
      const years = parseFloat(yearsAgo[1]) * (yearsAgo[2] ? 1000 : 1);
      return { year: Math.round(1950 - years), month: 1, day: 1 };
    }
  
    // 6) ISO “YYYY-MM-DD”
  //  let isoMatch = dateStr.match(/^(\d{1,4})-(\d{1,2})-(\d{1,2})$/);
    let isoMatch = dateStr.match(/^(-?\d+)-(\d{1,2})-(\d{1,2})$/);
    if (isoMatch) {
      parsed.year = parseInt(isoMatch[1]);
      parsed.month = parseInt(isoMatch[2]);
      parsed.day = parseInt(isoMatch[3]);
      parsed.originalMonthParsed = true;
      parsed.originalDayParsed = true;
      if (isBC) {
        parsed.year = -Math.abs(parsed.year);
      }
      return adjustForApproxWords(parsed);
    }
  
    // 7) year-month “YYYY-MM”
    let yearMonthMatch = dateStr.match(/^(\d{1,4})-(\d{1,2})$/);
    if (yearMonthMatch) {
      parsed.year = parseInt(yearMonthMatch[1]);
      parsed.month = parseInt(yearMonthMatch[2]);
      parsed.originalMonthParsed = true;
      if (isBC) {
        parsed.year = -Math.abs(parsed.year);
      }
      return adjustForApproxWords(parsed);
    }
  
    // 8) “Month YYYY” or “month day YYYY”
    let monthYearMatch = dateStr.match(/^([a-z]+)\s+(\d{1,4})$/);
    if (monthYearMatch) {
      const mIdx = months.indexOf(monthYearMatch[1]);
      if (mIdx >= 0) {
        parsed.year = parseInt(monthYearMatch[2]);
        parsed.month = mIdx + 1;
        parsed.originalMonthParsed = true;
        if (isBC) {
          parsed.year = -Math.abs(parsed.year);
        }
        return adjustForApproxWords(parsed);
      }
    }
  
    // 9) “Month day, YYYY” variants (with st|nd|rd|th)
    let monthDayYear = dateStr.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{1,4})$/);
    if (monthDayYear) {
      const mIdx = months.indexOf(monthDayYear[1]);
      if (mIdx >= 0) {
        parsed.year = parseInt(monthDayYear[3]);
        parsed.month = mIdx + 1;
        parsed.day = parseInt(monthDayYear[2]);
        parsed.originalMonthParsed = true;
        parsed.originalDayParsed = true;
        if (isBC) {
          parsed.year = -Math.abs(parsed.year);
        }
        return adjustForApproxWords(parsed);
      }
    }
  
    // 10) “day month year” => “6 October 907”
    // day month year (any digit length >= 1)
    let dayMonthYear = dateStr.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+),?\s+(\d{1,4})$/);
    if (dayMonthYear) {
      const mIdx = months.indexOf(dayMonthYear[2]);
      if (mIdx >= 0) {
        parsed.year = parseInt(dayMonthYear[3]);
        parsed.month = mIdx + 1;
        parsed.day = parseInt(dayMonthYear[1]);
        parsed.originalMonthParsed = true;
        parsed.originalDayParsed = true;
        if (isBC) {
          parsed.year = -Math.abs(parsed.year);
        }
        return adjustForApproxWords(parsed);
      }
    }
  
    // 11) “Month/Month YYYY” => pick earliest month
    let monthSlashMonth = dateStr.match(/^([a-z]+)\/([a-z]+)\s+(\d{1,4})$/);
    if (monthSlashMonth) {
      let m1 = months.indexOf(monthSlashMonth[1]);
      let m2 = months.indexOf(monthSlashMonth[2]);
      if (m1 >= 0 && m2 >= 0) {
        parsed.year = parseInt(monthSlashMonth[3]);
        parsed.month = Math.min(m1, m2) + 1;
        parsed.originalMonthParsed = true;
        if (isBC) {
          parsed.year = -Math.abs(parsed.year);
        }
        return adjustForApproxWords(parsed);
      }
    }
  
    // 12) “YYYY” => just a year; a BC year may be longer ("10000 BC")
    let yearOnlyMatch = dateStr.match(isBC ? /^(\d{1,7})$/ : /^(\d{1,4})$/);
    if (yearOnlyMatch) {
      parsed.year = parseInt(yearOnlyMatch[1]);
      if (isBC) {
        parsed.year = -Math.abs(parsed.year);
      }
      return adjustForApproxWords(parsed);
    }

    // 13) "10 954" => Month=10, Year=954
    //   - only do this if day-range and month-year didn't match
    const spaceMonthYearMatch = dateStr.match(/^(\d{1,2})\s+(\d{2,4})$/);
    if (spaceMonthYearMatch) {
        let monthNumber = parseInt(spaceMonthYearMatch[1], 10);
        let yearNumber = parseInt(spaceMonthYearMatch[2], 10);

        // If your month must be <= 12, do a sanity check:
        if (monthNumber >= 1 && monthNumber <= 12) {
        parsed.month = monthNumber;
        parsed.year = yearNumber;
        parsed.day = 1;
        parsed.originalMonthParsed = true;
        if (isBC) {
          parsed.year = -Math.abs(parsed.year);
        }
        return adjustForApproxWords(parsed);
        }
        // "15 44 bc": a day of an unnamed month; keep only the year, claiming no month or day
        if (monthNumber >= 13 && monthNumber <= 31) {
          parsed.year = isBC ? -Math.abs(yearNumber) : yearNumber;
          return adjustForApproxWords(parsed);
        }
    }

    console.warn(`Unrecognized date format: "${originalDate}"`);
  
    // If everything fails:
    return adjustForApproxWords(parsed);
  }
  
  /**
   * ===============================
   * 6) Final function: parseTimeToSortableValue
   * ===============================
   * - Orchestrates all the stages.
   */
  export function parseTimeToSortableValue(inputTime) {
    if (!inputTime) return 0;
  
    // 1) Preprocess
    const prep = preprocessTimeString(String(inputTime));
    const { text, approxModifier } = prep;
  
    // 2) Check if range
    const rangeInfo = extractRangeOrDayRange(text);
  
    // 3) If it’s a range, we parse only rangeStart (earliest)
    const dateObj = parseSingleDate(rangeInfo.rangeStart, approxModifier, inputTime, rangeInfo.isBC);
    
    // 4) Convert final dateObj to numeric
//    return dateToSortValue(dateObj.year, dateObj.month, dateObj.day);
    const result = {
      sortableValue: dateToSortValue(dateObj.year, dateObj.month, dateObj.day),
      year: dateObj.year,
      month: dateObj.month,
      day: dateObj.day,
      season: dateObj.season,
      approxModifier,
      hasMonth: dateObj.originalMonthParsed || dateObj.season,
      hasDay: dateObj.originalDayParsed,
      isBC: dateObj.year < 0
    };

    return result;
  }

/**
 * Extracts the year from a sortable time value
 * @param {number} sortableTime - The sortable time value (year + month/12 + day/366)
 * @returns {number} - The extracted year
 */
export function extractYear(sortableTime) {
    // If input is a date string, try to get its sortable value first
    if (typeof sortableTime === 'string') {
        sortableTime = parseTimeToSortableValue(sortableTime).sortableValue;
    }

    // Convert to number if it's a string
    sortableTime = Number(sortableTime);
    
    // Handle invalid input
    if (isNaN(sortableTime)) {
        console.warn('Invalid sortable time value:', sortableTime);
        return 0;
    }

    // The year is the integer part of the sortable time
    // Use Math.floor to handle negative years correctly
    return Math.floor(sortableTime);
}

/**
 * Extract full date components from sortable time
 * @param {number} sortableTime - The sortable time value
 * @returns {{year: number, month: number, day: number}} - Date components
 */
export function extractDateComponents(sortableTime) {
    // Convert to number if it's a string
    sortableTime = Number(sortableTime);
    
    // Handle invalid input
    if (isNaN(sortableTime)) {
        console.warn('Invalid sortable time value:', sortableTime);
        return { year: 0, month: 1, day: 1 };
    }

    // Extract year (integer part)
    const year = Math.floor(sortableTime);
    
    // Get decimal part
    const decimal = sortableTime - year;
    
    // Extract month (first decimal part * 12)
    const monthDecimal = decimal * 12;
    const month = Math.floor(monthDecimal) + 1;
    
    // Extract day (remaining decimal * 366)
    const dayDecimal = (monthDecimal - Math.floor(monthDecimal)) * 366;
    const day = Math.floor(dayDecimal) + 1;
    
    return { year, month, day };
}

// Deep-time records whose label can't be parsed ("Within minutes after the Big Bang") carry a
// navigation position instead: sort_years_ago, counted back from 1950, and sort_tiebreak for records
// at the same position. These are ordering proxies, not exact dates; every other event is placed by
// its enhanced_time as before.
const hasNavigationPosition = (event) => Number.isFinite(event?.sort_years_ago);

/**
 * An event's position on the timeline.
 *
 * @param {{ enhanced_time?: string, sort_years_ago?: number }} event
 * @returns {number}
 */
export function eventSortableValue(event) {
    return hasNavigationPosition(event)
        ? 1950 - event.sort_years_ago
        : parseTimeToSortableValue(event?.enhanced_time).sortableValue;
}

// An event's year: from its navigation position when it has one, otherwise as parsed.
export function eventYear(event) {
    return hasNavigationPosition(event)
        ? Math.floor(1950 - event.sort_years_ago)
        : parseTimeToSortableValue(event?.enhanced_time)?.year;
}

// The order between events at the same position: sort_tiebreak first, then load order.
export const eventTiebreak = (event) => (Number.isFinite(event?.sort_tiebreak) ? event.sort_tiebreak : 0);

/**
 * An event's date as the card shows it: a record with a navigation position shows its label as
 * written; any other event is formatted from its enhanced_time.
 *
 * @param {{ enhanced_time?: string, sort_years_ago?: number }} event
 * @returns {string}
 */
export function eventDateLabel(event) {
    return hasNavigationPosition(event) && event.enhanced_time
        ? event.enhanced_time
        : formatHistoricalDate(event?.enhanced_time);
}

/**
 * Format a historical date string for display
 * @param {string} date - Date string to format
 * @returns {string} - Formatted date string
 */
export function formatHistoricalDate(date) {
  // Handle special cases first
  if (!date) return "unknown date";
  // deep time is shown as written ("c. 300,000 years ago", "66 million years ago")
  if (/\byears?\s+ago\b/i.test(date)) {
      return date;
  }

  // Parse the date
  const parsed = parseTimeToSortableValue(date);

  if (parsed.sortableValue === 0) {
      return "unknown date";
  }
  
  // Handle seasons
  if (parsed.season) {
      const seasonStr = parsed.approxModifier ? 
          `${parsed.approxModifier} ${parsed.season}` : 
          parsed.season;
      return `${seasonStr} ${Math.abs(parsed.year)}${parsed.isBC ? ' BC' : ''}`;
  }

  // Format day suffix
  function getDaySuffix(day) {
      if (day > 3 && day < 21) return 'th';
      switch (day % 10) {
          case 1: return 'st';
          case 2: return 'nd';
          case 3: return 'rd';
          default: return 'th';
      }
  }

  const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Build date string based on available components
  let result = '';
  
  if (parsed.hasMonth) {
      result += months[parsed.month - 1];
      if (parsed.hasDay) {
          result += ` ${parsed.day}${getDaySuffix(parsed.day)}`;
      }
  }

  // Add year
  // five-digit years and longer get a thousands separator ("10,000 BC"); 1936 stays 1936
  const absYear = Math.abs(parsed.year);
  const yearStr = absYear >= 10000 ? absYear.toLocaleString('en-US') : absYear.toString();
  if (result) {
      result += `, ${yearStr}`;
  } else {
      result = yearStr;
  }

  // Add BC/AD
  if (parsed.isBC) {
      result += ' BC';
  } else if (parsed.year < 1200) {  // Add AD for early dates
    result += ' AD';
  }

  return result;
}