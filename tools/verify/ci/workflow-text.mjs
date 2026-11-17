// The workflow files read as text (audit hardening Phase 3, WS-E): lines,
// never a YAML package (no new dependency). Shared by the workflow specs in
// this folder — the CI workflow's and the release and deploy workflows'.
import assert from 'node:assert/strict';

/** The text without its comments: a whole-line `#`, or ` #` to the end of a line. */
export function withoutComments(text) {
  return text
    .split('\n')
    .map((line) => (/^\s*#/.test(line) ? '' : line.replace(/\s+#.*$/, '')))
    .join('\n');
}

/** How many times `needle` occurs in `text`. */
export const occurrences = (text, needle) => text.split(needle).length - 1;

/** `jobs:` → { name: body } in file order, comments removed. */
export function jobsOf(text) {
  const lines = withoutComments(text).split('\n');
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  assert.ok(start >= 0, 'the workflow declares `jobs:`');
  const jobs = new Map();
  let current = null;
  for (const line of lines.slice(start + 1)) {
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) {
      current = header[1];
      jobs.set(current, []);
    } else if (current !== null) {
      jobs.get(current).push(line);
    }
  }
  return new Map([...jobs].map(([name, body]) => [name, body.join('\n')]));
}

/** The value of every `key:` line of `text` (a step's `- key:` included), trimmed. */
export function valuesOf(text, key) {
  const values = [];
  for (const line of withoutComments(text).split('\n')) {
    const entry = line.trim();
    const body = entry.startsWith('- ') ? entry.slice(2).trim() : entry;
    if (body.startsWith(`${key}:`))
      values.push(body.slice(key.length + 1).trim());
  }
  return values;
}

/** Every `uses:` value of `text`. */
export const usesOf = (text) => valuesOf(text, 'uses');

/** Every `run:` command of `text` (one line each, or `|` for a block). */
export const runsOf = (text) => valuesOf(text, 'run');

/** `owner/repo[/path]@v<N>` or `…@<40-hex sha>`. */
export function isPinned(ref) {
  const at = ref.lastIndexOf('@');
  if (at < 0) return false;
  const segments = ref.slice(0, at).split('/');
  const version = ref.slice(at + 1);
  return (
    segments.length >= 2 &&
    segments.every((segment) => /^[A-Za-z0-9_.-]+$/.test(segment)) &&
    (/^v\d+$/.test(version) || /^[0-9a-f]{40}$/.test(version))
  );
}

/** `owner/repo[/path]@<40-hex sha>` — the pin a job that holds a credential needs. */
export const isShaPinned = (ref) => isPinned(ref) && /@[0-9a-f]{40}$/.test(ref);

/** Every `secrets.NAME` the text names, once each. */
export const secretsOf = (text) => [
  ...new Set(
    [...withoutComments(text).matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map(
      (match) => match[1],
    ),
  ),
];

/** The workflow-level text, before `jobs:`, comments removed. */
export const headOf = (text) => {
  const code = withoutComments(text);
  return code.slice(0, code.indexOf('\njobs:'));
};
