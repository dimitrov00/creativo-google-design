import { expect, test, type Locator, type Page } from '@playwright/test';
import { Role } from '@core/components';
import { LocalDate } from '@core/primitives';
import { attemptKey } from './support/attempt-key';
import { DEV_CLASSIC_CUT } from './support/appointment-seed-document';
import {
  lockBarberLink,
  seedUserProfile,
  seedWorkedAppointment,
} from './support/seed-firestore';
import { signInAs } from './support/sign-in';
import { pinBrowserClock, suiteDay } from './support/suite-clock';

/**
 * «АНАЛИЗИ» END TO END (docs/designs/staff-analytics.md, plan item 51): the
 * screen asks the `staffAnalytics` callable for the month of the suite's day
 * and words its answer.
 *
 * - A LINKED barber — stored roles `[barber]`, `linkedBarberId` on the user
 *   record and the record's lock naming the account, as `setRoles` leaves
 *   them — opens «Анализи» from the menu, sees the month's takings, and the
 *   takings drill-down lists their seats with a footer equal to the figure.
 * - An account holding the barber role with NO link sees the not-linked
 *   refusal (CUJ 6).
 * - The admin opens on the shop and switches the scope picker to a barber:
 *   that barber's report, their seat in the drill-down.
 * - The open-hours card opens the schedule's agenda on the emptiest day,
 *   for that barber, with free time drawn (`?free=1`, CUJ 2).
 *
 * The callable reads the STORED user record (not the token), so each test
 * seeds its account with `seedUserProfile` before signing in. Only Ivan's
 * record is linked here: the roles e2e links `niko` and `stefan` through the
 * card, and a lock is one account's. Other specs seed worked visits in the
 * same emulator, so a figure is checked against its own rows (the footer)
 * and against this test's seats being among them — never against a fixed
 * sum. Every seeded visit is WORKED on the 1st of the suite's month: takings
 * count worked seats whatever the hour, so the figure holds whether the
 * server's clock is before or after the browser's pinned 10:00.
 */

/** The 1st of the suite's month at `hour` — inside the month the screen opens on. */
/** How many days the suite's month has — a bar each. */
function daysInSuiteMonth(): number {
  const { year, month } = LocalDate.parts(suiteDay());
  return LocalDate.daysInMonth(year, month);
}

function monthStartAt(hour: number): string {
  const first = LocalDate.startOfMonth(suiteDay());
  return `${first}T${String(hour).padStart(2, '0')}:00:00`;
}

/** The page's report has arrived (not the cache, not the placeholder). */
async function reportReady(page: Page): Promise<void> {
  await expect(page.getByTestId('staff-analytics')).toHaveAttribute(
    'data-load',
    'READY',
    { timeout: 45_000 },
  );
}

/** A figure as the screen prints it, its spaces normalised. */
async function textOf(locator: Locator): Promise<string> {
  return ((await locator.textContent()) ?? '').replace(/\s+/g, ' ').trim();
}

/** The hero's takings, as `ui-metric` paints them. */
function takingsOf(page: Page): Locator {
  return page
    .getByTestId('analytics-takings')
    .locator('.ui-metric__value .ui-metric__digits')
    .first();
}

/**
 * Opens the takings drill-down and checks it: `seatIds` among its rows, and
 * its footer total the hero's figure.
 */
async function expectTakingsRowsAddUp(
  page: Page,
  seatIds: readonly string[],
): Promise<void> {
  const hero = await textOf(takingsOf(page));
  expect(hero).toMatch(/\d/);
  await page.getByTestId('analytics-hero').click();
  const sheet = page.getByTestId('analytics-rows');
  await expect(sheet).toBeVisible();
  for (const seatId of seatIds) {
    await expect(
      sheet.locator(`[data-testid="analytics-seat-${seatId}"]`),
    ).toBeVisible({ timeout: 20_000 });
  }
  const footer = sheet
    .getByTestId('analytics-rows-total')
    .locator('[uiTrailing]')
    .first();
  await expect.poll(async () => textOf(footer)).toBe(hero);
}

test.describe('«Анализи» — staff analytics', () => {
  test('a linked barber opens «Анализи» from the menu, and the takings drill-down adds up to the figure', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await pinBrowserClock(page);
    const run = attemptKey(test.info());
    const uid = `e2e-an-barber-${run}`;
    const client = `e2e-an-client-${run}`;
    await seedUserProfile(client, { firstName: 'Петър', lastName: 'Колев' });
    await seedWorkedAppointment(
      `${run}-cut`,
      client,
      monthStartAt(11),
      DEV_CLASSIC_CUT,
    );
    await seedWorkedAppointment(`${run}-beard`, client, monthStartAt(12));
    await seedUserProfile(uid, {
      firstName: 'Иван',
      lastName: 'Бръснаров',
      roles: [Role.Barber],
      linkedBarberId: 'ivan',
    });
    await lockBarberLink('ivan', uid);
    await signInAs(page, uid, [Role.Barber]);

    // The menu sits behind the header's monogram (the schedule's own chrome
    // has none): open it from the account page, as the shell specs do.
    await page.goto('/account');
    await expect(page.getByTestId('account-page')).toHaveAttribute(
      'data-state',
      'ready',
      { timeout: 30_000 },
    );
    await page.getByTestId('nav-menu-trigger').click();
    const entry = page.getByTestId('menu-staff-analytics');
    await expect(entry).toBeVisible();
    await entry.click();
    // The store's first write-back states the month it opened on.
    await expect(page).toHaveURL(
      /\/staff\/analytics(\?span=MONTH&from=\d{4}-\d{2}-01)?$/,
    );
    await reportReady(page);

    // A barber has no scope picker: the report is their own record's.
    await expect(page.getByTestId('analytics-scopes')).toHaveCount(0);
    await expect(takingsOf(page)).toHaveText(/\d/);

    // THE SEVEN QUESTIONS DRAWN (staff-analytics-v2 PR 2): the takings line
    // with its comparison legend, a stacked bar per day of the month with
    // the six-part legend beneath, the seven open-hours bars, and a ranked
    // bar per worked service — the two seeded ones.
    await expect(
      page.getByTestId('analytics-series').locator('svg[role="img"]'),
    ).toBeVisible();
    await expect(
      page.getByTestId('analytics-time-bars').locator('.ui-bar-chart__bar'),
    ).toHaveCount(daysInSuiteMonth());
    await expect(
      page.getByTestId('analytics-time-bar').locator('li'),
    ).toHaveCount(6);
    await expect(
      page.getByTestId('analytics-ahead-bars').locator('.ui-bar-chart__bar'),
    ).toHaveCount(7);
    const serviceBars = page
      .getByTestId('analytics-services-bars')
      .locator('.ui-bar-chart__bar');
    await expect(serviceBars).toHaveCount(2);

    await expectTakingsRowsAddUp(page, [
      `${run}-cut-seat`,
      `${run}-beard-seat`,
    ]);
    // The sheet is a native dialog: Escape closes it.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('analytics-rows')).toBeHidden();

    // A service bar opens that service's seats alone, the footer its takings.
    await serviceBars.first().click();
    const sheet = page.getByTestId('analytics-rows');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-testid^="analytics-seat-"]')).toHaveCount(
      1,
      { timeout: 20_000 },
    );
  });

  test('an account holding the barber role with no link sees the not-linked state', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await pinBrowserClock(page);
    const uid = `e2e-an-unlinked-${attemptKey(test.info())}`;
    await seedUserProfile(uid, {
      firstName: 'Нов',
      lastName: 'Бръснар',
      roles: [Role.Barber],
    });
    await signInAs(page, uid, [Role.Barber]);

    await page.goto('/staff/analytics');
    const refused = page.getByTestId('analytics-refused');
    await expect(refused).toBeVisible({ timeout: 45_000 });
    // `errors.ANALYTICS_BARBER_NOT_LINKED`, in either language.
    await expect(refused).toHaveText(
      /още не е свързан с бръснар|not linked to a barber yet/,
    );
    await expect(page.getByTestId('analytics-hero')).toHaveCount(0);
  });

  test('the admin switches the scope picker to a barber and sees that barber’s figures', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await pinBrowserClock(page);
    const run = attemptKey(test.info());
    const adminUid = `e2e-an-admin-${run}`;
    const client = `e2e-an-niko-client-${run}`;
    await seedUserProfile(client, { firstName: 'Стефан', lastName: 'Донев' });
    await seedWorkedAppointment(
      `${run}-niko`,
      client,
      monthStartAt(15),
      DEV_CLASSIC_CUT,
      'niko',
    );
    await seedUserProfile(adminUid, {
      firstName: 'Админ',
      lastName: 'Салонов',
      roles: [Role.Admin],
    });
    await signInAs(page, adminUid, [Role.Admin]);

    await page.goto('/staff/analytics');
    await reportReady(page);
    // The admin opens on the shop.
    const shop = page.getByTestId('analytics-scope-shop');
    await expect(shop).toHaveAttribute('aria-pressed', 'true');

    const niko = page.getByTestId('analytics-scope-niko');
    await niko.click();
    await expect(niko).toHaveAttribute('aria-pressed', 'true');
    await expect(shop).toHaveAttribute('aria-pressed', 'false');
    await reportReady(page);
    await expectTakingsRowsAddUp(page, [`${run}-niko-seat`]);
  });

  test('the open-hours card opens the agenda on the emptiest day, for the barber, with free rows', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await pinBrowserClock(page);
    const adminUid = `e2e-an-open-${attemptKey(test.info())}`;
    await seedUserProfile(adminUid, {
      firstName: 'Админ',
      lastName: 'Свободен',
      roles: [Role.Admin],
    });
    await signInAs(page, adminUid, [Role.Admin]);

    await page.goto('/staff/analytics');
    await reportReady(page);
    await page.getByTestId('analytics-scope-stefan').click();
    await reportReady(page);

    // The card is a link: the schedule, its agenda, the barber, free time on.
    const open = page.getByTestId('analytics-open');
    const href = await open.getAttribute('href');
    const target = new URL(href ?? '', 'http://localhost');
    expect(target.pathname).toBe('/staff/schedule');
    expect(target.searchParams.get('view')).toBe('agenda');
    expect(target.searchParams.get('barber')).toBe('stefan');
    expect(target.searchParams.get('free')).toBe('1');
    expect(target.searchParams.get('day')).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await open.click();
    // `?free=` is read once and leaves the address bar; the rest stays.
    await expect(page).toHaveURL(/\/staff\/schedule\?.*view=agenda/);
    await expect(page).toHaveURL(/barber=stefan/);
    await expect(page.getByTestId('staff-gap-row').first()).toBeVisible({
      timeout: 30_000,
    });
  });

  /**
   * THE SCHEDULE'S CHART BUTTON (staff-analytics-v2, «Entry from the
   * schedule», PR 1): the week that holds the day on screen, the chair an
   * admin is viewing, and Back lands on the same day, view and chair.
   */
  test('the schedule’s chart button opens «Анализи» on this day’s week and chair, and Back restores the schedule', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await pinBrowserClock(page);
    const adminUid = `e2e-an-entry-${attemptKey(test.info())}`;
    await seedUserProfile(adminUid, {
      firstName: 'Админ',
      lastName: 'Вход',
      roles: [Role.Admin],
    });
    await signInAs(page, adminUid, [Role.Admin]);

    const day = suiteDay();
    await page.goto(`/staff/schedule?day=${day}&view=agenda&barber=ivan`);
    const button = page.getByTestId('staff-analytics-open');
    await expect(button).toBeVisible({ timeout: 30_000 });
    await button.click();

    // The admin was viewing Ivan's chair: Ivan's figures, the day on
    // screen (the DAY span since PR 3).
    await expect(page).toHaveURL(/\/staff\/analytics\?/);
    await expect
      .poll(() => {
        const url = new URL(page.url());
        return {
          span: url.searchParams.get('span'),
          from: url.searchParams.get('from'),
          barber: url.searchParams.get('barber'),
        };
      })
      .toEqual({ span: 'DAY', from: day, barber: 'ivan' });
    await reportReady(page);

    // THE DAY SCREEN (staff-analytics-v2 PR 3): the hero and its delta stand
    // alone (no line), the time is one stacked bar, there is no heatmap,
    // and the comparison chip names the previous period.
    await expect(page.getByTestId('analytics-span')).toContainText('Ден');
    await expect(page.getByTestId('analytics-series')).toHaveCount(0);
    await expect(page.getByTestId('analytics-busy')).toHaveCount(0);
    await expect(
      page.getByTestId('analytics-time-bars').locator('.ui-bar-chart__bar'),
    ).toHaveCount(1);
    await expect(page.getByTestId('analytics-comparison-chip')).toHaveText(
      'спрямо предходния период',
    );

    // Back: the schedule, on the same day, view and chair. The schedule
    // writes no `day` for today (its canonical URL), so the suite's day
    // reads back as the absent parameter.
    await page.goBack();
    await expect(page).toHaveURL(/\/staff\/schedule\?/);
    await expect
      .poll(() => {
        const url = new URL(page.url());
        return {
          day: url.searchParams.get('day') ?? day,
          view: url.searchParams.get('view'),
          barber: url.searchParams.get('barber'),
        };
      })
      .toEqual({ day, view: 'agenda', barber: 'ivan' });
    await expect(button).toBeVisible({ timeout: 30_000 });
  });

  test('a barber’s chart button opens their own figures, whatever chair the book shows', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await pinBrowserClock(page);
    const uid = `e2e-an-entry-barber-${attemptKey(test.info())}`;
    await seedUserProfile(uid, {
      firstName: 'Иван',
      lastName: 'Вход',
      roles: [Role.Barber],
      linkedBarberId: 'ivan',
    });
    await lockBarberLink('ivan', uid);
    await signInAs(page, uid, [Role.Barber]);

    const day = suiteDay();
    await page.goto(`/staff/schedule?day=${day}&view=agenda&barber=niko`);
    const button = page.getByTestId('staff-analytics-open');
    await expect(button).toBeVisible({ timeout: 30_000 });
    await button.click();

    // Niko's chair on the book, but a barber's figures are their own: no
    // `barber` in the query (a colleague's would be refused).
    await expect(page).toHaveURL(/\/staff\/analytics\?/);
    await expect
      .poll(() => new URL(page.url()).searchParams.get('barber'))
      .toBeNull();
    await expect
      .poll(() => new URL(page.url()).searchParams.get('span'))
      .toBe('DAY');
    await reportReady(page);
    await expect(page.getByTestId('analytics-scopes')).toHaveCount(0);
  });
});
