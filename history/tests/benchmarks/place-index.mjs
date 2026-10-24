// Usage: node tests/benchmarks/place-index.mjs /path/to/canonical/events.json
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { PlaceEventIndex } from '../../modules/place-event-index.js';
const bytes = fs.readFileSync(process.argv[2]);
const events = JSON.parse(bytes);
const start = performance.now();
const index = new PlaceEventIndex(events);
const buildMs = performance.now() - start;
const bounds = { south: 35, north: 60, west: -10, east: 30 };
const times = [];
let ids;
for (let i = 0; i < 100; i++) {
    const start = performance.now(); ids = index.query({ bounds }); times.push(performance.now() - start);
}
times.sort((a,b) => a-b);
console.log(JSON.stringify({ runtime: process.version, platform: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0].model, sourceSha256: crypto.createHash('sha256').update(bytes).digest('hex'), events: index.events.size, places: index.places.size, points: index.points.size, mappedEvents: index.events.size - index.unmapped.size, unmappedEvents: index.unmapped.size, buildMs, bounds, matches: ids.size, queryP50Ms: times[50], queryP95Ms: times[95], heapUsedMiB: process.memoryUsage().heapUsed / 1024**2 }, null, 2));
