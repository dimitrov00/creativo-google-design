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

/**
 * Not a fault: axe compares the accessible name with every
 * glyph drawn inside the control, and here the only drawn text the name
 * leaves out is a picture — initials, a monogram, a count badge — while
 * every word a person would say is in the name. axe has no narrower switch
 * than the rule on the page.
 */
const GLYPH = (where: string): Waiver =>
  waive(
    'label-content-name-mismatch',
    `${where}, which is a picture and not the control’s label (WCAG 2.5.3 is about label text); its words are in the accessible name. Decided 2026-11-26, docs/designs/accessibility-findings.md.`,
  );

/**
 * What is switched off, by page: ONE rule on ONE page, with its reason.
 * Every row is a decision (`GLYPH`), never a debt: the faults the first
 * full scan found were all fixed by 2026-11-26, and a new one is fixed,
 * not listed here. A row naming a page the showcase no longer has fails
 * the first test.
 */
const KNOWN: Readonly<Record<string, readonly Waiver[]>> = {
  'controls/chip': [GLYPH('a person chip draws the avatar’s initials')],
  'controls/quick-actions': [
    GLYPH('a quick action draws its count as a badge before its word'),
  ],
  'controls/search-field': [
    GLYPH('a token draws its faces’ initials between its key and value'),
  ],
  'controls/medal': [
    GLYPH('a medal draws its monogram, its level and its «ново» marker'),
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
        // The theme is on the page, and its inks have arrived: a scan taken
        // while the title is still crossing from the other theme's ink read
        // #121212 on #000000 and failed four pages at random (2026-11-26).
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect
          .poll(async () => {
            const ink = () =>
              page.evaluate(() => {
                const title = document.querySelector('h1');
                return title === null ? '' : getComputedStyle(title).color;
              });
            const before = await ink();
            await page.waitForTimeout(120);
            return before !== '' && before === (await ink());
          })
          .toBe(true);
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        await expectNoAxeViolations(page, {
          disableRules: KNOWN[route] ?? [],
        });
      });
    }
  }
});
