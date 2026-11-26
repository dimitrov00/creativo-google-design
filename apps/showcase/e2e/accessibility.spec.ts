import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { workspaceRoot } from '@nx/devkit';
import { expect, test } from '@playwright/test';
import {
  expectNoAxeViolations,
  type AxeContext,
} from '@creativo/shared/axe-scan';

/**
 * EVERY SHOWCASE PAGE IS SCANNED (2026-11-26). The showcase is the one
 * place each design-system element is drawn on its own, so one axe scan per
 * page, per theme, checks every element at the source: names, roles, valid
 * ARIA and contrast (WCAG 2.2 A and AA).
 *
 * The pages are read off `app.routes.ts`, so a page added to the showcase
 * is scanned without a line here. axe sees what is on screen: a closed menu
 * or sheet is not scanned, and keyboard behaviour is not judged at all —
 * those stay with the elements' own specs.
 */
const THEMES = ['light', 'dark'] as const;

type Waiver = NonNullable<AxeContext['disableRules']>[number];

const waive = (rule: string, reason: string): Waiver => ({ rule, reason });

const NAME_MISMATCH = (where: string): Waiver =>
  waive(
    'label-content-name-mismatch',
    `${where}: the aria-label does not contain the text drawn on the control (WCAG 2.5.3). Found by the first full scan, 2026-11-26; tracked in docs/designs/accessibility-findings.md.`,
  );
const CONTRAST = (where: string): Waiver =>
  waive(
    'color-contrast',
    `${where}. A colour decision for the owner; found by the first full scan, 2026-11-26; tracked in docs/designs/accessibility-findings.md.`,
  );

/**
 * What the first full scan found and this change did not fix, by page. Each
 * entry switches ONE rule off on ONE page, with its reason. An entry may
 * only be removed: fix the element, delete its row. A row naming a page the
 * showcase no longer has fails the first test.
 */
const KNOWN: Readonly<Record<string, readonly Waiver[]>> = {
  'controls/button': [
    CONTRAST(
      'dark: the destructive prominent button draws near-black words on red (3.9:1, needs 4.5:1)',
    ),
  ],
  'controls/chip': [NAME_MISMATCH('the chip’s remove button')],
  'controls/scroll-row': [NAME_MISMATCH('the photo tiles of the demo')],
  'controls/scroll-column': [
    waive(
      'scrollable-region-focusable',
      'ui-scroll-column over content with nothing focusable cannot be scrolled from the keyboard in every browser. Found by the first full scan, 2026-11-26; tracked in docs/designs/accessibility-findings.md.',
    ),
  ],
  'controls/quick-actions': [NAME_MISMATCH('a quick action with a count')],
  'controls/search-field': [
    NAME_MISMATCH('the search tokens'),
    waive(
      'label',
      'ui-search-field with a token placeholder leaves its input without an accessible name. Found by the first full scan, 2026-11-26; tracked in docs/designs/accessibility-findings.md.',
    ),
  ],
  'controls/charts': [
    waive(
      'aria-command-name',
      'a chart mark group carries an empty aria-label. Found by the first full scan, 2026-11-26; tracked in docs/designs/accessibility-findings.md.',
    ),
    waive(
      'nested-interactive',
      'the bar and line charts put focusable marks inside an interactive drawing. Found by the first full scan, 2026-11-26; tracked in docs/designs/accessibility-findings.md.',
    ),
  ],
  'controls/streak-track': [NAME_MISMATCH('the streak card as a button')],
  'controls/medal': [NAME_MISMATCH('a medal with a value text')],
  'controls/coupon-card': [
    CONTRAST(
      'light: the orange value on the grey hooked ticket is 2.62:1 (needs 3:1); dark: the 11px detail line is 4.35:1 (needs 4.5:1)',
    ),
  ],
  'controls/month-picker': [
    CONTRAST('dark: the date row’s placeholder value is 3.28:1 (needs 4.5:1)'),
  ],
  'compositions/client-card': [
    NAME_MISMATCH('the client card’s points and record tiles'),
  ],
  'compositions/team': [
    CONTRAST('dark: a choice tile’s detail line is 4.38:1 (needs 4.5:1)'),
  ],
};

/** The pages `app.routes.ts` declares (the redirect at `''` is not one). */
function declaredPages(): readonly string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed path to the showcase's own route table.
  const source = readFileSync(
    join(workspaceRoot, 'apps/showcase/src/app/app.routes.ts'),
    'utf8',
  );
  return [...source.matchAll(/^\s*path: '([^']+)',/gm)].map(
    (match) => match[1] ?? '',
  );
}

const PAGES = declaredPages();

test.describe('showcase accessibility', () => {
  test('every waiver names a page the showcase has', () => {
    expect(PAGES.length).toBeGreaterThan(40);
    expect(Object.keys(KNOWN).filter((page) => !PAGES.includes(page))).toEqual(
      [],
    );
  });

  for (const route of PAGES) {
    for (const theme of THEMES) {
      test(`${route} has no axe violations — ${theme}`, async ({ page }) => {
        await page.addInitScript((value) => {
          window.localStorage.setItem('showcase-theme', value);
        }, theme);
        // A scan mid-fade reads a blended colour as a contrast failure.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(`/${route}`);
        // Every showcase page renders its title as the one <h1>; a route
        // that draws only the shell must not pass as a clean scan.
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await expectNoAxeViolations(page, {
          disableRules: KNOWN[route] ?? [],
        });
      });
    }
  }
});
