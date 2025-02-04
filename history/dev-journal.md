## [History Timeline](https://haibalabs.github.io/history) - Dev Diary

### Day 27. Tue 02/04/25

Big focus last few days on editing and the back-end database, as well as sync controls between various editors:
- Ability to have profile login to the timeline
- Ability to use empty timelines and add to them through the UI
- Various UI updates to allow push and pull of changes from the events server

### Day 21. Wed 01/29/25

The focus the last few days has been on using a system of location corrections on top of the data.
This way we can enable realtime corrections, especially for old locations.

Also:
- New styles for the site. See progress shot [here](https://haibalabs.github.io/history/TimelineProgress-v0.6.png)
- Out of about 55 thousand events, we have 700 unknown locations to be fixed. Of course some others might be misleading.
- Prepped some work related to interactive quizzes coming up next!

### Day 16. Fri 01/24/25

The focus the last couple days was on enabling posting new events, and by extension editing existing ones.

Details:
- We've successfully integrated with Google Firebase with an event database and tested push and pull operations.
- Created a functional 'Add Event' dialog.
- Fixed various data munching issues to support the 1st Millenium BC data.
- Fixed a variety of 'negative' date issues.
- Fixed many location resolving issues.
- Updated the main data store with events from -1000 BC to 2024.
- Various UI fixes as usual.

### Day 14. Wed 01/22/25

The focus today was on a new layout of the UI, mainly to have a functional for mobile in portrait mode.

Also:
- New version of data with thousands of locations fixed.
- Various UI fixes.

### Day 13. Tue 01/21/25

The big effort today was creating an automatic process using open data and LLMs to get better event locations.
The script is running right now, and hopefully will be done by morning.

Also:
- Many fixes to various UI issues and bit more scrolling optimizations.
- Better handling of locations for display or mapping in the app.
- Gathered data for the first millenium BC, but we have to fix some issues before being able to process it.

### Day 12. Mon 01/20/25
49392 events! 

The number of events is not an issue anymore with all the performance fixes we've finally put in.
- Much better handling of the timeline scrolling and jumping with no layout issues.
- Lots of fixes to dates again and uniform display for the whole range, as well as various other UI fixes.
- Now the data covers events from year 0 to 2024.
- Next big challenge -> cleanup location data and add pre-1st century events.

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