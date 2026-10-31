import { expect, test, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import {
  seedUpcomingAppointment,
  seedUserProfile,
} from './support/seed-firestore';
import { signInAs } from './support/sign-in';
import { THEMES, pinTheme, type Theme } from './support/theme';

/**
 * The page's "now", pinned. The calendar opens on today's month and marks
 * today, so an unpinned clock would move the baseline every day. Only
 * `Date` is fixed (timers still run), and it sits before any real run, so
 * the tokens the emulator mints stay valid to the page.
 */
const PINNED_NOW = new Date('2026-09-25T10:00:00+03:00');

async function gotoAppointmentsWithTheme(
  page: Page,
  uid: string,
  theme: Theme,
): Promise<void> {
  await page.clock.setFixedTime(PINNED_NOW);
  await pinTheme(page, theme);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signInAs(page, uid, ['client']);
  await page.goto('/account/appointments');
  await expect(page.getByTestId('appointments-page')).toHaveAttribute(
    'data-state',
    'ready',
  );
}

/**
 * Goal 6.4 screenshot baseline (docs/migration/goals/06-feature-slices.md
 * — "Add a Playwright screenshot spec... per screen"), once per theme
 * (`support/theme.ts`).
 *
 * The row's service name and the barber's face come from the dev catalogue,
 * which `support/global-setup.ts` seeds once per run.
 */
test.describe(
  'account appointments — screenshot baseline',
  { tag: '@screenshot' },
  () => {
    for (const theme of THEMES) {
      test(`populated list view — ${theme}`, async ({ page }) => {
        const uid = `e2e-appts-screenshot-${theme}-${test.info().testId}`;
        await seedUserProfile(uid);
        await seedUpcomingAppointment(
          `appt-${uid}`,
          uid,
          '2030-06-01T10:00:00',
        );

        await gotoAppointmentsWithTheme(page, uid, theme);
        await expect(page.getByTestId('appointment-row')).toHaveAttribute(
          'data-status',
          'CONFIRMED',
        );
        await expect(page.getByTestId('appointment-row')).toContainText(
          /Оформяне на брада|Beard trim/,
        );
        // The barber's face, not the monogram it stands on while the bytes
        // load — otherwise the picture depends on which one won the race.
        await expect(
          page.getByTestId('appointment-row').locator('ui-async-image'),
        ).toHaveAttribute('data-state', 'loaded');
        await expect(page).toHaveScreenshot(
          `appointments-list-populated-${theme}.png`,
        );
        await expectNoAxeViolations(page);
      });

      test(`calendar view — ${theme}`, async ({ page }) => {
        const uid = `e2e-appts-calendar-screenshot-${theme}-${test.info().testId}`;
        await seedUserProfile(uid);
        // Inside the pinned month, four days after the pinned today: the
        // picture holds today's mark AND a visit day with its barber's face,
        // the one thing a person scans this month for.
        await seedUpcomingAppointment(
          `appt-${uid}`,
          uid,
          '2026-09-29T10:00:00',
        );

        await gotoAppointmentsWithTheme(page, uid, theme);
        await page.getByTestId('appointments-view-calendar').click();
        await expect(page.getByTestId('appointments-calendar')).toBeVisible();
        // Opened on the pinned today's month.
        await expect(
          page.locator('[data-month-key="2026-09"]'),
        ).toBeInViewport();
        const visitDay = page.locator(
          '[data-testid="appointments-calendar-day"][data-day-key="2026-09-29"]',
        );
        await expect(visitDay).toBeInViewport();
        // The face, not the monogram it stands on while the bytes load.
        await expect(visitDay.locator('ui-async-image')).toHaveAttribute(
          'data-state',
          'loaded',
        );
        // The heading, with the weekday key that closes it, has scrolled away
        // under the bar — which carries the key from here on.
        await expect(
          page.getByTestId('appointments-chrome-weekdays'),
        ).toBeVisible();
        await expect(page).toHaveScreenshot(
          `appointments-calendar-${theme}.png`,
        );
        await expectNoAxeViolations(page);
      });
    }
  },
);
