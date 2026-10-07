/**
 * TEST SUPPORT — a component stylesheet read as a contract. jsdom lays
 * nothing out, so where a spec must pin how a thing is laid out (a line
 * that wraps rather than truncates, two tiles sharing one anatomy) the
 * stylesheet itself is what it checks (the shared visits' precedent,
 * `visit-row.spec.ts`). Never part of the lib's build.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The lib's `src/lib` folder, where every stylesheet lives. */
const LIB = resolve(__dirname, '../lib');

/**
 * The declarations of the ONE rule whose selector list is exactly
 * `selector`, in `file` (a path under `src/lib`), as property → value with
 * whitespace folded. A selector with no rule, or with more than one, fails.
 */
export function cssRule(
  file: string,
  selector: string,
): ReadonlyMap<string, string> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a stylesheet of this lib, named by its spec.
  const css = readFileSync(resolve(LIB, file), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
    ([, head]) => head?.replace(/\s+/g, ' ').trim() === selector,
  );
  if (rules.length !== 1) {
    throw new Error(
      `${file}: expected one rule for «${selector}», found ${rules.length}`,
    );
  }
  return new Map(
    (rules[0]?.[2] ?? '')
      .split(';')
      .map((part) => part.replace(/\s+/g, ' ').trim())
      .filter((part) => part.includes(':'))
      .map((part) => {
        const colon = part.indexOf(':');
        return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
      }),
  );
}
