import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * `firestore.rules` read as TEXT — the one comment stripper and block reader
 * of this lib's rules-text specs (`stamp-window.rules-text.spec.ts`,
 * `rules-key-parity.rules-text.spec.ts`; security hardening review round 1,
 * finding 5), so the two can never parse the same file differently. Spec
 * support only: excluded from `tsconfig.lib.json` (`src/testing/**`), read
 * with node's `fs` at the specs' run time.
 */

/** The rules text without its `//` and block comments — quoted strings kept whole. */
export function rulesCode(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src.charAt(i);
    if (ch === "'" || ch === '"') {
      let end = i + 1;
      while (end < src.length && src.charAt(end) !== ch) {
        end += src.charAt(end) === '\\' ? 2 : 1;
      }
      out += src.slice(i, end + 1);
      i = end + 1;
    } else if (src.startsWith('//', i)) {
      const end = src.indexOf('\n', i);
      i = end === -1 ? src.length : end;
    } else if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/**
 * The workspace's own `firestore.rules`, comments removed — a fixed path
 * from this folder (`src/testing` sits beside `src/lib`, so the depth is
 * the specs' own).
 */
export const RULES_CODE = rulesCode(
  readFileSync(resolve(__dirname, '../../../../../firestore.rules'), 'utf8'),
);

/** The text of `match <path> { … }` in {@link RULES_CODE}, braces balanced; throws when absent or unbalanced. */
export function blockOf(path: string): string {
  const head = `match ${path} {`;
  const start = RULES_CODE.indexOf(head);
  if (start === -1) throw new Error(`no ${head} in firestore.rules`);
  let depth = 0;
  for (let i = start + head.length - 1; i < RULES_CODE.length; i++) {
    if (RULES_CODE.charAt(i) === '{') depth += 1;
    else if (RULES_CODE.charAt(i) === '}') {
      depth -= 1;
      if (depth === 0) return RULES_CODE.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced ${head}`);
}

/** How often `needle` occurs in `text`. */
export function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}
