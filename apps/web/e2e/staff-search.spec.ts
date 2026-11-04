import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { LocalDate } from '@core/primitives';
import { attemptKey } from './support/attempt-key';
import {
  seedUpcomingAppointment,
  seedUserProfile,
  setVisitContact,
} from './support/seed-firestore';
import { shopToday } from './support/shop-clock';
import { signInAs } from './support/sign-in';

/**
 * THE SCHEDULE SEARCH (docs/designs/staff-search.md, part 1), END TO END.
 *
 * CUJ 1 — a number is found however the desk types it (`088 …`, `00359 88 …`,
 * `359 88 …`), and the run it matched is washed. CUJ 2 — a booking three and
 * a half weeks out is found: the window reaches the booking horizon, not a
 * count either side of now. (CUJ 3, a visit written on this device found at
 * once, is the store's rule: `staff-day.store.spec.ts` pins that a landed
 * write marks the window stale and the next opening reads it again. CUJ 4,
 * one look for every search, is `ui-marked-text` itself: one element, one
 * `--sys-color-mark`; this spec checks the wash is really painted.)
 *
 * Every visit is this attempt's own (`attemptKey`), with a name and a number
 * only this attempt knows, so a long-lived emulator never answers a
 * neighbour's. The dev catalogue is `support/global-setup.ts`'s.
 */

/** A Bulgarian mobile number of this attempt's own: `88` and seven digits. */
function numberOf(run: string): {
  readonly national: string;
  readonly e164: string;
} {
  const digits = createHash('sha256').update(run).digest().readUInt32BE(0);
  const tail = String(digits % 10_000_000).padStart(7, '0');
  return { national: `088${tail}`, e164: `+35988${tail}` };
}

/** Opens the schedule's search sheet. */
async function openSearch(page: Page): Promise<void> {
  await page.goto('/staff/schedule');
  await page.getByTestId('staff-search-open').click();
  await expect(page.getByTestId('staff-search-sheet')).toBeVisible({
    timeout: 30_000,
  });
}

/** The result cards whose text holds this attempt's name. */
function hitsOf(page: Page, run: string) {
  return page
    .getByTestId('staff-search-list')
    .locator('[data-appointment-id]')
    .filter({ hasText: run });
}

/** Seeds a visit of this attempt's, with the contact a desk would have typed. */
async function seedVisit(
  id: string,
  uid: string,
  day: LocalDate,
  contact: { readonly name: string; readonly phone: string },
): Promise<void> {
  await seedUserProfile(uid, { firstName: 'Тест', lastName: 'Търсене' });
  await seedUpcomingAppointment(id, uid, `${day}T09:00:00`);
  await setVisitContact(id, contact);
}

test.describe('the schedule search — part 1', () => {
  test('CUJ 1: one number, four ways of typing it, one visit — the matched run washed', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const run = attemptKey(test.info());
    const number = numberOf(run);
    const name = `Търсач ${run}`;
    await seedVisit(
      `e2e-search-phone-${run}`,
      `e2e-search-phone-owner-${run}`,
      LocalDate.addDays(shopToday(), 3),
      { name, phone: number.e164 },
    );
    await signInAs(page, `e2e-search-staff-${run}`, ['barber']);
    await openSearch(page);
    const input = page.getByTestId('staff-search-input');

    const national = number.national.slice(0, 7);
    const typings = [
      national,
      `00359${number.national.slice(1, 7)}`,
      `359${number.national.slice(1, 7)}`,
      number.national,
    ];
    for (const typed of typings) {
      await input.fill(typed);
      await expect(hitsOf(page, run), `typed ${typed}`).toHaveCount(1, {
        timeout: 30_000,
      });
    }

    // The phone line carries the washed run — painted, not just present.
    const wash = hitsOf(page, run)
      .getByTestId('staff-search-line-phone')
      .locator('mark')
      .first();
    await expect(wash).toBeVisible();
    const paint = await wash.evaluate((mark) => {
      const style = getComputedStyle(mark);
      return {
        background: style.backgroundColor,
        radius: style.borderTopLeftRadius,
      };
    });
    expect(paint.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(paint.radius).toBe('3px');

    // Under three digits is no number yet: read as text, and nothing has it.
    await input.fill('08');
    await expect(hitsOf(page, run)).toHaveCount(0);
  });

  test('CUJ 2: a booking 24 days out is found by name', async ({ page }) => {
    test.setTimeout(120_000);
    const run = attemptKey(test.info());
    const name = `Далечен ${run}`;
    await seedVisit(
      `e2e-search-far-${run}`,
      `e2e-search-far-owner-${run}`,
      LocalDate.addDays(shopToday(), 24),
      { name, phone: numberOf(`far-${run}`).e164 },
    );
    await signInAs(page, `e2e-search-far-staff-${run}`, ['barber']);
    await openSearch(page);

    await page.getByTestId('staff-search-input').fill(run);

    await expect(hitsOf(page, run)).toHaveCount(1, { timeout: 30_000 });
    await expect(page.getByTestId('staff-search-footnote')).toHaveCount(0);
  });
});
