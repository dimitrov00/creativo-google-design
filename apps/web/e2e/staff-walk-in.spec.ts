import { createHash } from 'node:crypto';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { LocalDate, Weekday } from '@core/primitives';
import { attemptKey } from './support/attempt-key';
import {
  seedUpcomingAppointment,
  seedUserProfile,
} from './support/seed-firestore';
import { shopToday } from './support/shop-clock';
import { signInAs } from './support/sign-in';

/**
 * A WALK-IN IS KEPT (OR-26), END TO END: a barber adds «Нов клиент» to a
 * visit with a number and a mail, saves, and on the NEXT visit types that
 * number into the client search — the walk-in's record answers, «Без
 * профил», badged as already a client, and once on the visit their card
 * opens. Before OR-26 the number and the mail vanished on the way to the
 * server and the walk-in was never found again.
 *
 * Both visits are the dev chair's (Иван at the Center) on ONE shop day this
 * attempt owns (`laneDay`): past the booking horizon, so no client booking
 * of another spec can take the half hour the walk-in's service adds; a
 * Monday to Thursday, which Иван works at the Center; and a day of its own
 * for every run at the same moment, so two copies never meet on the chair.
 * The service catalogue is the dev seed's (`support/global-setup.ts`).
 */

/** Days ahead the lane days start: the dev policy's horizon is two months. */
const PAST_THE_HORIZON_DAYS = 90;

/**
 * The shop day this attempt seeds and edits on. Runs at the same moment hold
 * different `parallelIndex`es (below `workers`), so that is the lane's
 * remainder; the turns one worker takes (every `--repeat-each` copy, every
 * retry) spread over further days — the `bookingLane` reasoning, over the
 * Mondays to Thursdays past the horizon.
 */
function laneDay(info: TestInfo): LocalDate {
  const workers = Math.max(1, info.config.workers);
  const turn = info.repeatEachIndex * (info.project.retries + 1) + info.retry;
  let lane = info.parallelIndex + workers * turn;
  let day = LocalDate.addDays(shopToday(), PAST_THE_HORIZON_DAYS);
  for (;;) {
    const weekday = LocalDate.weekday(day);
    const atTheCenter = weekday >= Weekday.Mon && weekday <= Weekday.Thu;
    if (atTheCenter && lane === 0) return day;
    if (atTheCenter) lane -= 1;
    day = LocalDate.addDays(day, 1);
  }
}

/**
 * A Bulgarian mobile number of this attempt's own — national `088…` as the
 * desk dials it — so the walk-in's record (keyed by the number) is new on
 * every run of one long-lived emulator.
 */
function walkInNumber(run: string): string {
  const digits = createHash('sha256').update(run).digest().readUInt32BE(0);
  return `088${String(digits % 10_000_000).padStart(7, '0')}`;
}

/** The visit sheet's editor — its `data-depth` is the page stack's. */
function editorOf(page: Page) {
  return page.getByTestId('staff-visit-editor');
}

/** Opens `rowId`'s visit from the day's agenda, at the sheet's root. */
async function openVisit(page: Page, day: string, rowId: string) {
  await page.goto(`/staff/schedule?day=${day}&view=agenda`);
  const visit = page.locator(`[data-row-id="${rowId}"]`);
  await expect(visit).toBeVisible({ timeout: 30_000 });
  await visit.click();
  await expect(editorOf(page)).toHaveAttribute('data-depth', '0');
}

test.describe('the staff visit sheet — a walk-in is kept (OR-26)', () => {
  test('a walk-in saved with a number is found by it on the next visit, «Без профил», and their card opens', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const run = attemptKey(test.info());
    const day = laneDay(test.info());
    const first = `e2e-walkin-a-${run}`;
    const next = `e2e-walkin-b-${run}`;
    const number = walkInNumber(run);
    const mail = `walkin-${run}@example.test`;

    await seedUserProfile(first, { firstName: 'Георги', lastName: 'Петров' });
    await seedUserProfile(next, { firstName: 'Мартин', lastName: 'Илиев' });
    await seedUpcomingAppointment(`${first}-visit`, first, `${day}T09:00:00`);
    await seedUpcomingAppointment(`${next}-visit`, next, `${day}T14:00:00`);
    await signInAs(page, `e2e-walkin-staff-${run}`, ['barber']);

    // ── THE FIRST VISIT: «Нов клиент» with everything the desk typed ──
    await openVisit(page, day, `${first}-visit#ivan`);
    await page.getByTestId('staff-visit-add-client').click();
    const query = page.getByTestId('staff-visit-client-query');
    // One pasted line: the name, the number and the mail each find their
    // field (the omnibox's reading).
    await query.fill(`Иван Тодоров ${number} ${mail}`);
    await page.getByTestId('staff-visit-new-client').click();
    await expect(page.getByTestId('staff-visit-new-name')).toHaveValue(
      'Иван Тодоров',
    );
    await expect(page.getByTestId('staff-visit-new-email')).toHaveValue(mail);
    // The number stands in the phone field, printed the field's way.
    await expect(
      page.getByTestId('staff-visit-new-phone').locator('input[type="tel"]'),
    ).toHaveValue(/\d{3}/);
    await page.getByTestId('staff-visit-new-client-save').click();
    // A person just added has no service: the catalogue opens for them.
    await page.getByTestId('staff-visit-service-svc-beard').click();
    await page.getByTestId('staff-visit-service-apply').click();
    await page.getByTestId('staff-visit-save').click();
    await expect(page.getByTestId('staff-toast')).toContainText(
      /Промените са запазени|Changes saved/,
      { timeout: 30_000 },
    );

    // ── THE NEXT VISIT: the number finds the walk-in's record ──
    await openVisit(page, day, `${next}-visit#ivan`);
    await page.getByTestId('staff-visit-add-client').click();
    await page.getByTestId('staff-visit-client-query').fill(number);
    const walkIn = page.locator(
      '[data-testid="staff-visit-client-results"] [data-testid^="staff-visit-client-guest-cus_"]',
    );
    await expect(walkIn).toHaveCount(1, { timeout: 20_000 });
    await expect(walkIn).toContainText('Иван Тодоров');
    await expect(walkIn).toContainText(mail);
    // No profile behind them — said in ink on the row — and the typed
    // number is theirs: badged, ahead of «Нов клиент».
    await expect(
      walkIn.locator('[data-testid^="staff-visit-client-no-account-"]'),
    ).toHaveText(/Без профил|No account/);
    await expect(
      walkIn.locator('[data-testid^="staff-visit-client-exact-"]'),
    ).toBeVisible();

    // On the visit, their card opens from their row.
    await walkIn.click();
    await expect(
      page.locator('[data-testid^="staff-visit-picked-guest-cus_"]'),
    ).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('staff-visit-back').click();
    await expect(editorOf(page)).toHaveAttribute('data-depth', '0');
    await page
      .locator('[data-testid^="staff-visit-client-row-guest-cus_"]')
      .click();
    await expect(editorOf(page)).toHaveAttribute('data-depth', '1');
    const card = page.getByTestId('client-card');
    await expect(card).toBeVisible();
    await expect(card.getByTestId('client-head-title')).toHaveText(
      'Иван Тодоров',
    );
  });
});
