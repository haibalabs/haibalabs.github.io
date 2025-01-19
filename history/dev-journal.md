## [History Timeline](https://haibalabs.github.io/history) - Dev Diary

### Day 9. Fri 01/17/25
We're getting close to 50K events!

The last couple days we've been mainly working on data cleanup scripts, and finding more automatic ways to detect and resolve data issues:
- Using a strict json schema for OpenAI event queries.
- Scripts to verify suitable locations using openstreetmap API and OpenAI APIT (still WIP).
- Scripts to comb through the events and find faulty entries.
- Performance issues more visible now with this many events. 

### Day 7. Wed 01/15/25
In the last 3 days we've been focused on implementation and code organisation.

- Implemented virtual infinit scrolling so we can handle thousands of events with minimal HTML overhead.
- Refactored various modules out of the big spaghetti we had before.

### Day 4. Sun 01/12/25
Today the focus was on adding an info panel, and massaging the wikipedia api to get enough but minimal info displayed.

- Added a "more info" panel where we display the page of the url attached to an element.
- Processed 17th and 18th century starter events

### Day 3. Sat 01/11/25
We did a quick estimate for how many events we should be able to handle to cover a decent amount of history. Answer: 80M events. At 1k Maximum per event, we're below 100GB.

- Fixed mapping issues so it's functionally working.
- Added a test harness for openstreetmap.
- Added a version number and fixed jump-to-date functionality.
- Update data processing scripts to generate better location info, date info, and wikipedia links.

### Day 2. Fri 01/10/25
Today we focused on supporting a variety of "DATE" formats for the events we collected so far, so the timeline is as correct as possible.

In details:
- A much more complex date parsing routines handling a variety of expressions of days, months, years, seasons, and approximate dates of all sorts.
- A test harness for date parsing both for display and sorting and .
- Out of 8226, we fixed by hand 6 event dates. For some the format is not supported yet, for most the data was not complete.

### Day 1. Thu 01/09/25
Today we started an experimental experience based on one premise:
"One timeline for everything that ever happened"
After a couple days of writing this first prototype, and collecting data for 8226 events from the wikipedia foundation, we're ready to put it out there on our github page. 

The v0 implementation, which took about 5 dev days, has:
- A timeline rendered from a json data source.
- support for filtering by categories, searching through the timeline, and jumping to a specific year.
- Map view using openstreetmap data.
Most of the work has been on finding data source and curating/fixing/augmenting the list of events enough for a first test.