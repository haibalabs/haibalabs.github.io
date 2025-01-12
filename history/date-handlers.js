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
  function preprocessTimeString(time) {
  
    let cleaned = time.toLowerCase().trim();
    cleaned = cleaned.replace(/[\(\)"]/g, '');
    cleaned = cleaned.replace(/\bapproximate\s+date\s+in\b/gi, '');
    cleaned = cleaned.replace(/\bapproximate\s+date\:?/gi, '');
    cleaned = cleaned.replace(/\bapproximate\s+date\b/gi, '');
    cleaned = cleaned.replace(/\bapproximate\b/gi, '');
    cleaned = cleaned.replace(/\bapprox\.?/gi, '');
    cleaned = cleaned.replace(/\bdate\s+in\b/gi, '');

 //   cleaned = cleaned.replace(/^c\.\s+/, '').replace(/^circa\s+/, '');
    cleaned = cleaned.replace(/^c\.\s*(\d{4}|\d{3}|\d{2}|\d{1})/, (match, year) => {
                    // Keep the year as-is to preserve zero padding
                    return year;
                }).replace(/^circa\s+/, '');

    cleaned = cleaned.replace(/\b(around|in|between|by|before|after)\b\s*/gi, '');

    // unify dash
    cleaned = cleaned.replace(/[–—]/g, '-');

    // remove extra spaces
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
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
      /(\d{1,4})-(spring|summer|autumn|fall|winter)/i,
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
    // 1) If it matches a full ISO date
    if (/^\d{1,4}-\d{1,2}-\d{1,2}$/.test(inputText)) {
      return {
        isRange: false,
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
        rangeStart: reconstructed.trim(),
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
        return { isRange: false, rangeStart: inputText, rangeEnd: '' };
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
  
    return {
      isRange: true,
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
  function parseSingleDate(dateStr, approxModifier, originalDate) {
    const months = [
      'january','february','march','april','may','june',
      'july','august','september','october','november','december'
    ];
  
    // We'll store intermediate info in an object for further manipulation
    let parsed = { year: 0, month: 1, day: 1, season: null, approxModifier };
  
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
  
    // 1) BC / BCE
    if (/\b(\d+)\s*(bc|bce)\b/i.test(dateStr)) {
      const bcYear = dateStr.match(/\d+/)[0];
      parsed.year = -parseInt(bcYear);
      return adjustForApproxWords(parsed);
    }

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
  
    // 6) ISO “YYYY-MM-DD”
    let isoMatch = dateStr.match(/^(\d{1,4})-(\d{1,2})-(\d{1,2})$/);
    if (isoMatch) {
      parsed.year = parseInt(isoMatch[1]);
      parsed.month = parseInt(isoMatch[2]);
      parsed.day = parseInt(isoMatch[3]);
      return adjustForApproxWords(parsed);
    }
  
    // 7) year-month “YYYY-MM”
    let yearMonthMatch = dateStr.match(/^(\d{1,4})-(\d{1,2})$/);
    if (yearMonthMatch) {
      parsed.year = parseInt(yearMonthMatch[1]);
      parsed.month = parseInt(yearMonthMatch[2]);
      return adjustForApproxWords(parsed);
    }
  
    // 8) “Month YYYY” or “month day YYYY”
    let monthYearMatch = dateStr.match(/^([a-z]+)\s+(\d{1,4})$/);
    if (monthYearMatch) {
      const mIdx = months.indexOf(monthYearMatch[1]);
      if (mIdx >= 0) {
        parsed.year = parseInt(monthYearMatch[2]);
        parsed.month = mIdx + 1;
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
        return adjustForApproxWords(parsed);
      }
    }
  
    // 12) “YYYY” => just a year
    let yearOnlyMatch = dateStr.match(/^(\d{1,4})$/);
    if (yearOnlyMatch) {
      parsed.year = parseInt(yearOnlyMatch[1]);
      return adjustForApproxWords(parsed);
    }

    // 13) "10 954" => Month=10, Year=954
    //   - only do this if day-range and month-year didn't match
    const spaceMonthYearMatch = dateStr.match(/^(\d{1,2})\s+(\d{3,4})$/);
    if (spaceMonthYearMatch) {
        let monthNumber = parseInt(spaceMonthYearMatch[1], 10);
        let yearNumber = parseInt(spaceMonthYearMatch[2], 10);

        // If your month must be <= 12, do a sanity check:
        if (monthNumber >= 1 && monthNumber <= 12) {
        parsed.month = monthNumber;
        parsed.year = yearNumber;
        parsed.day = 1;
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
    const dateObj = parseSingleDate(rangeInfo.rangeStart, approxModifier, inputTime);
    
    // 4) Convert final dateObj to numeric
    return dateToSortValue(dateObj.year, dateObj.month, dateObj.day);
  }

/**
 * Extracts the year from a sortable time value
 * @param {number} sortableTime - The sortable time value (year + month/12 + day/366)
 * @returns {number} - The extracted year
 */
export function extractYear(sortableTime) {
    // If input is a date string, try to get its sortable value first
    if (typeof sortableTime === 'string') {
        sortableTime = parseTimeToSortableValue(sortableTime);
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

/**
 * Format a historical date string for display
 * @param {string} date - Date string to format
 * @returns {string} - Formatted date string
 */
export function formatHistoricalDate(date) {
    if (!date) return "Unknown Date";

    // Already formatted dates
    if (date.includes('billion years ago') || 
        date.includes('million years ago') ||
        date.includes('BCE') ||
        date.includes('AD') ||
        date.includes('CE') ||
        date.includes('BC') ||
        date.includes('c.') ||
        date.includes('circa') ||
        /^(?:Spring|Summer|Fall|Autumn|Winter)\s+\d+$/.test(date)) {
        return date;
    }

    // If it's just a year
    if (/^\d+$/.test(date)) {
        return date;
    }

    const months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];

    // Handle various date formats
    try {
        // Check if it's already in "DD Month YYYY" format
        const parts = date.split(' ');
        if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[2])) {
            // Validate if middle part is a month name
            const monthPart = parts[1].toLowerCase();
            const monthIndex = months.map(m => m.toLowerCase()).indexOf(monthPart);
            if (monthIndex !== -1) {
                // Already in correct format, just ensure proper capitalization
                return `${parts[0]} ${months[monthIndex]} ${parts[2]}`;
            }
        }

        // Handle YYYY-MM-DD format
        const isoMatch = date.match(/^(\d{1,})-(\d{1,2})-(\d{1,2})$/);
        if (isoMatch) {
            const [_, year, month, day] = isoMatch;
            return `${parseInt(day)} ${months[parseInt(month) - 1]} ${year}`;
        }

        // Handle YYYY-MM format
        const yearMonthMatch = date.match(/^(\d{1,})-(\d{1,2})$/);
        if (yearMonthMatch) {
            const [_, year, month] = yearMonthMatch;
            return `${months[parseInt(month) - 1]} ${year}`;
        }

        return date; // Return original if no format matches
    } catch (error) {
        console.error('Date parsing error:', error);
        return date; // Return original on error
    }
}