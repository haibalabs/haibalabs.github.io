// The timeline's sort keys for the factory's release builder (T110, team-status/.../t106/shard-format.md),
// computed by the site's own date code so the build never needs a second date parser.
//
// Input, on stdin: one JSON object per line, { event_id, event_version, event }, where event holds at least
// the fields the date code reads (enhanced_time, sort_years_ago, sort_tiebreak).
// Output, on stdout: one line per input line, in the same order:
//   { event_id, event_version, year, sortable, tiebreak }
// each value { finite: true, value } or { finite: false }, since JSON cannot carry NaN or infinity.
// A malformed line stops the run with exit code 1 and its line number on stderr; the builder then fails
// before writing any manifest.
//
//   node tools/sort-keys.mjs --describe   prints the Node version and the SHA-256 of every file the keys
//                                          depend on, for the builder to pin.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { eventSortableValue, eventTiebreak, eventYear } from '../modules/date-handlers.js';

// date-handlers.js imports nothing, so these two files are all the keys depend on
const DEPENDENCIES = ['../modules/date-handlers.js', './sort-keys.mjs'];

const tagged = value => (Number.isFinite(value) ? { finite: true, value } : { finite: false });

export function sortKeys(event) {
    return { year: tagged(eventYear(event)), sortable: tagged(eventSortableValue(event)), tiebreak: tagged(eventTiebreak(event)) };
}

export function describe() {
    const files = {};
    for (const relative of DEPENDENCIES) {
        const path = fileURLToPath(new URL(relative, import.meta.url));
        files[relative.replace(/^\.\.\//, '').replace(/^\.\//, 'tools/')] = createHash('sha256').update(readFileSync(path)).digest('hex');
    }
    return { node: process.version, files };
}

async function main() {
    // stdout carries only result lines: the date code warns on console.warn (stderr), and anything it
    // might print with console.log goes there too
    console.log = (...args) => console.error(...args);
    if (process.argv.includes('--describe')) {
        process.stdout.write(JSON.stringify(describe()) + '\n');
        return;
    }
    let number = 0;
    for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
        number += 1;
        if (!line.trim()) continue;
        let input;
        try {
            input = JSON.parse(line);
        } catch {
            process.stderr.write(`line ${number}: not JSON\n`);
            process.exit(1);
        }
        if (!input || typeof input.event_id !== 'string' || !input.event || typeof input.event !== 'object') {
            process.stderr.write(`line ${number}: needs event_id and event\n`);
            process.exit(1);
        }
        process.stdout.write(JSON.stringify({ event_id: input.event_id, event_version: input.event_version ?? null, ...sortKeys(input.event) }) + '\n');
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
