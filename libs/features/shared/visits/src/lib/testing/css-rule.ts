/**
 * TEST SUPPORT — a stylesheet read as a contract. jsdom lays nothing out,
 * so where a spec pins how a part is laid out (a column, a held run, a
 * shared baseline) the stylesheet is what it checks. The spec reads the
 * file itself (a literal path); this finds the ONE rule whose selector
 * list is exactly `selector`, comments stripped and whitespace folded, and
 * returns its declarations as property → value. A selector with no rule,
 * or with more than one, fails. Never part of the lib's build.
 */
export function cssRule(
  css: string,
  selector: string,
): ReadonlyMap<string, string> {
  const rules = [
    ...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g),
  ].filter(([, head]) => head?.replace(/\s+/g, ' ').trim() === selector);
  if (rules.length !== 1) {
    throw new Error(
      `expected one rule for «${selector}», found ${rules.length}`,
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

/**
 * TEST SUPPORT — the stylesheet's TOP-LEVEL rules alone: every
 * conditional group (`@media`, `@supports`, `@container`, `@layer { … }`)
 * is taken out whole, comments first. For a selector that is ruled once
 * at rest and once more inside a condition (a pill, and the same pill
 * under `prefers-reduced-motion`): `cssRule` wants one rule, and the one
 * at rest is the one a spec pins.
 */
export function cssAtRest(css: string): string {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let rest = '';
  let index = 0;
  while (index < bare.length) {
    const at = bare.indexOf('@', index);
    if (at === -1) return rest + bare.slice(index);
    const open = bare.indexOf('{', at);
    const end = bare.indexOf(';', at);
    // A statement at-rule (`@import …;`) holds no block to take out.
    if (open === -1 || (end !== -1 && end < open)) {
      const stop = end === -1 ? bare.length : end + 1;
      rest += bare.slice(index, stop);
      index = stop;
      continue;
    }
    rest += bare.slice(index, at);
    let depth = 1;
    let cursor = open + 1;
    while (cursor < bare.length && depth > 0) {
      const char = bare.charAt(cursor);
      if (char === '{') depth += 1;
      else if (char === '}') depth -= 1;
      cursor += 1;
    }
    index = cursor;
  }
  return rest;
}
