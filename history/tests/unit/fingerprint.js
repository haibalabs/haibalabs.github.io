import { createHash } from 'node:crypto';

// Record fingerprints for release checks, computed as the Python exporters compute them.

// A number as the file writes it. JSON.parse turns 45.0 into 45, which Python prints as 45.0, so
// fingerprints are computed from the number's source text (the files are written by Python).
export class SourceNumber {
  constructor(source) { this.source = source; }
}
// A JSON reader that keeps each number's source text, on any Node version (JSON.parse's source
// text access needs Node 22, and CI runs Node 20). Strings go through JSON.parse for their escapes.
export function parseKeepingNumbers(bytes) {
  const text = bytes.toString('utf8');
  const token = /\s*(?:("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)|([{}[\],:]))/y;
  let match;
  const next = () => {
    match = token.exec(text);
    if (!match) throw new SyntaxError(`Unexpected JSON at ${token.lastIndex}`);
    return match;
  };
  const value = () => {
    const [, string, number, literal, punct] = next();
    if (string) return JSON.parse(string);
    if (number) return new SourceNumber(number);
    if (literal) return JSON.parse(literal);
    if (punct === '[') {
      const list = [];
      if (text[token.lastIndex] !== ']' && !/^\s*\]/.test(text.slice(token.lastIndex, token.lastIndex + 64))) {
        do list.push(value()); while (next()[4] === ',');
      } else next();
      return list;
    }
    if (punct === '{') {
      const object = {};
      if (!/^\s*\}/.test(text.slice(token.lastIndex, token.lastIndex + 64))) {
        do {
          const key = JSON.parse(next()[1]);
          next();
          object[key] = value();
        } while (next()[4] === ',');
      } else next();
      return object;
    }
    throw new SyntaxError(`Unexpected ${punct} at ${token.lastIndex}`);
  };
  return value();
}

// SHA256 of a record as the sidecar export fingerprints it: Python's json.dumps(record,
// sort_keys=True, ensure_ascii=False), so sorted keys with ", " and ": " separators.
export function recordSha256(value) {
  const canonical = (v) => (v instanceof SourceNumber ? v.source
    : Array.isArray(v) ? `[${v.map(canonical).join(', ')}]`
      : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}: ${canonical(v[k])}`).join(', ')}}`
        : JSON.stringify(v));
  return createHash('sha256').update(canonical(value)).digest('hex');
}
