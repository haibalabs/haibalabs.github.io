## History Timeline - Dev Diary

### Day 3. Sat 01/11/25
We did a quick estimate for how many events we should be able to handle to cover a decent amount of history. Answer: 80M events. At 1k Maximum per event, we're below 100GB.

- Fixed mapping issues so it's functionally working.
- Added a test harness for openstreetmap 

### Day 2. Fri 01/10/25
Today we focused on supporting a variety of "DATE" formats for the events we collected so far, so the timeline is as correct as possible.

In details:
- A much more complex date parsing routines handling a variety of expressions of days, months, years, seasons, and approximate dates of all sorts.
- A test harness for date parsing both for display and sorting and .
- Out of 8226, we fixed by hand 6 event dates. For some the format is not supported yet, for most the data was not complete.

Here's the public timeline: [Link Text](https://haibalabs.github.io/history)

### Day 1. Thu 01/09/25
Today we started an experimental experience based on one premise:
"One timeline for everything that ever happened"
After a couple days of writing this first prototype, and collecting data for 8226 events from the wikipedia foundation, we're ready to put it out there on our github page. 

The v0 implementation has:
- A timeline rendered from a json data source.
- support for filtering by categories, searching through the timeline, and jumping to a specific year.
- Map view using openstreetmap data.
Most of the work has been on finding data source and curating/fixing/augmenting the list of events enough for a first test.
 
