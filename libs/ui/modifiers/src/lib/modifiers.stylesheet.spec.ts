import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * modifiers.css, READ AS IT IS WRITTEN. jsdom applies no cascade layers and
 * no media queries, so what must win is held where it is decided: in the
 * selectors.
 */
const css = readFileSync(resolve(__dirname, '../../modifiers.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')
  .replace(/\(\s/g, '(')
  .replace(/\s\)/g, ')');

/** The body of a block, from the brace that follows `opener` to its match. */
function block(opener: string, from = 0): string {
  const start = css.indexOf(opener, from);
  if (start < 0) throw new Error(`modifiers.css has no «${opener}»`);
  const open = css.indexOf('{', start);
  let close = open + 1;
  for (let depth = 1; depth > 0; close++) {
    const char = css.charAt(close);
    if (char === '{') depth++;
    else if (char === '}') depth--;
  }
  return css.slice(open + 1, close - 1).trim();
}

describe('modifiers.css · the interactive surface’s press', () => {
  const LIVE =
    "[data-interactive]:not(:disabled, [aria-disabled='true'], [data-disabled])";

  it('scales a live surface under the thumb, ungated by hover', () => {
    expect(block(`${LIVE}:active {`)).toBe(
      'transform: scale(var(--sys-press-scale-surface));',
    );
    // Outside the pointer-only gate: a tap on a phone shows it too.
    const gate = block('@media (hover: hover) { [data-interactive]');
    expect(gate).not.toContain('transform');
  });

  it('stands still under reduced motion: the branch repeats the press rule’s own selector, so it wins', () => {
    const reduced = block(
      `@media (prefers-reduced-motion: reduce) { ${LIVE}:active`,
    );
    expect(reduced).toBe(`${LIVE}:active { transform: none; }`);
    // A shorter selector here loses to the press rule on specificity
    // ((0,2,0) against (0,3,0), same layer) and the surface still scales.
    expect(css).not.toMatch(
      /prefers-reduced-motion: reduce\) \{ \[data-interactive\]:active/,
    );
    // …and it comes after the press rule, so equal specificity falls to it.
    expect(
      css.indexOf(`@media (prefers-reduced-motion: reduce) { ${LIVE}:active`),
    ).toBeGreaterThan(css.indexOf(`${LIVE}:active { transform: scale`));
  });
});

describe('modifiers.css · floating chrome (a bar lends its controls a backdrop)', () => {
  it('sets the backdrop on the bars content scrolls under, at the thin tier, at zero specificity', () => {
    expect(block(':where(.ui-page-action-bar, .ui-sheet-action-bar) {')).toBe(
      '--ui-control-backdrop: blur(var(--sys-material-thin-blur)) saturate(var(--sys-material-saturation));',
    );
  });

  it('resets it on a popover, which is a material of its own', () => {
    expect(block(':where([data-popover-surface]) {')).toBe(
      '--ui-control-backdrop: none;',
    );
  });

  it('is read by the translucent fill controls only, and is none outside a bar', () => {
    const readers = css.slice(
      css.indexOf(":where(.ui-button[data-button-style='bordered'],"),
    );
    const selector = readers.slice(0, readers.indexOf('{'));
    for (const control of [
      ".ui-button[data-button-style='bordered']",
      '.ui-chip',
      '.ui-text-field',
      '.ui-segmented-control__track',
      '.ui-search-field .ui-search-field__frame',
    ]) {
      expect(selector).toContain(control);
    }
    // Opaque and fill-less controls have nothing to see through.
    expect(selector).not.toContain('borderedProminent');
    expect(selector).not.toContain("'plain'");
    expect(block(":where(.ui-button[data-button-style='bordered'],")).toBe(
      '-webkit-backdrop-filter: var(--ui-control-backdrop, none); backdrop-filter: var(--ui-control-backdrop, none);',
    );
  });
});
