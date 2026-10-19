import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** X02: reads a local folder (or a JSON item list) into index items, for `context-index`. */
const SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.creator',
  '.turbo',
]);
const TEXT =
  /\.(ts|tsx|js|mjs|cjs|jsx|py|md|txt|json|yaml|yml|toml|sql|css|html|sh|ps1|rs|go|java|cs|rb)$/i;
const MAX_FILE = 512 * 1024;
const CHUNK = 12000;

export interface LocalItem {
  key: string;
  locator: string | null;
  text: string;
}

export function readCorpus(path: string): LocalItem[] {
  if (path.endsWith('.json')) {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!Array.isArray(raw))
      throw new Error('An index JSON file holds an array of items.');
    return raw as LocalItem[];
  }
  const out: LocalItem[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (SKIP.has(name) || name.startsWith('.env')) continue;
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile() && TEXT.test(name) && st.size <= MAX_FILE) {
        const text = readFileSync(full, 'utf8');
        if (!text.trim() || text.includes('\u0000')) continue;
        const rel = relative(path, full).split(sep).join('/');
        // Large files become ordered chunks so each stays inside one item.
        for (let i = 0, n = 0; i < text.length; i += CHUNK, n += 1)
          out.push({
            key: text.length > CHUNK ? `${rel}#${n + 1}` : rel,
            locator: `${rel}${text.length > CHUNK ? `#chunk-${n + 1}` : ''}`,
            text: text.slice(i, i + CHUNK),
          });
      }
    }
  };
  walk(path);
  if (out.length > 5000) throw new Error('At most 5000 items per corpus.');
  return out;
}

/** Splits items into requests that stay under the API's 64 KiB body limit. */
export function batchesOf(
  items: LocalItem[],
  limitBytes = 48 * 1024,
): LocalItem[][] {
  const out: LocalItem[][] = [];
  let cur: LocalItem[] = [];
  let size = 0;
  for (const i of items) {
    const s = Buffer.byteLength(JSON.stringify(i), 'utf8');
    if (cur.length && (size + s > limitBytes || cur.length >= 500)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(i);
    size += s;
  }
  if (cur.length) out.push(cur);
  return out;
}
