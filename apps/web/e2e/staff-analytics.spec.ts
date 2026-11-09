import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { Role } from '@core/components';
import { LocalDate } from '@core/primitives';
import { attemptKey } from './support/attempt-key';
import { DEV_CLASSIC_CUT } from './support/appointment-seed-document';
import {
  lockBarberLink,
  seedUserProfile,
  seedWorkedAppointment,
  startAnalyticsRecompute,
  waitForAnalyticsDay,
  waitForAnalyticsRecompute,
} from './support/seed-firestore';
import { signInAs } from './support/sign-in';
import { pinBrowserClock, suiteDay } from './support/suite-clock';

/**
 * «АНАЛИЗИ» END TO END — the Revolut layout (docs/designs/
 * staff-analytics-v3-revolut.md) over v2's callable: the home asks the
 * `staffAnalytics` callable for the period of the suite's day and draws it
 * as a carousel page of bento cards; each card opens its own screen.
 *
 * - A LINKED barber — stored roles `[barber]`, `linkedBarberId` on the user
 *   record and the record's lock naming the account, as `setRoles` leaves
 *   them — opens «Анализи» from the menu, opens the takings card, switches
 *   its chart, and the figure's rows add up to it; exports the month and
 *   sets the month's goal from the tools.
 * - An account holding the barber role with NO link sees the not-linked
 *   refusal (CUJ 6).
 * - The admin opens on the shop, sets the shop's goal, exports, and picks a
 *   barber in the scope menu: that barber's figures, their seat in the rows.
 * - «Предстои» opens the schedule's agenda on the emptiest day, for that
 *   barber, with free time drawn (`?free=1`, CUJ 2).
 * - The schedule's chart button opens the day and chair on screen; Back
 *   restores the schedule.
 * - The year from the day documents, the team card's screen with the
 *   radars, and a custom range through the sheet's inline calendars.
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
function monthStartAt(hour: number): string {
  const first = LocalDate.startOfMonth(suiteDay());
  return `${first}T${String(hour).padStart(2, '0')}:00:00`;
}

/** The screen's report has arrived (not the cache, not the placeholder) — the home's or a card's. */
async function reportReady(page: Page): Promise<void> {
  await expect(page.locator('main[data-load]')).toHaveAttribute(
    'data-load',
    'READY',
    { timeout: 45_000 },
  );
}

/** A figure as the screen prints it, its spaces normalised. */
async function textOf(locator: Locator): Promise<string> {
  return ((await locator.textContent()) ?? '').replace(/\s+/g, ' ').trim();
}

/** The page on screen of the home's carousel. */
function currentPage(page: Page): Locator {
  return page.locator('.analytics-carousel__page[data-current]');
}

/** Opens a card of the page on screen and waits for its own screen's report. */
async function openCard(page: Page, card: string): Promise<void> {
  await currentPage(page).getByTestId(`analytics-card-${card}`).click();
  await expect(page).toHaveURL(new RegExp(`/staff/analytics/${card}\\?`));
  await reportReady(page);
}

/** Back from a card's screen to the home. */
async function backHome(page: Page): Promise<void> {
  await page.getByTestId('analytics-card-back').click();
  await expect(page).toHaveURL(/\/staff\/analytics(\?|$)/);
  await reportReady(page);
}

/**
 * On the takings card's screen: the figure opens its rows — `seatIds` among
 * them, the footer equal to the figure.
 */
async function expectTakingsRowsAddUp(
  page: Page,
  seatIds: readonly string[],
): Promise<void> {
  const figure = await textOf(page.getByTestId('analytics-card-value'));
  expect(figure).toMatch(/\d/);
  await page.getByTestId('analytics-card-figure').click();
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
  await expect.poll(async () => textOf(footer)).toBe(figure);
  // The sheet is a native dialog: Escape closes it.
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
}

/** Picks an option of a home menu by its test id. */
async function pickFromMenu(
  page: Page,
  menu: string,
  option: string,
): Promise<void> {
  await page.getByTestId(menu).click();
  await page.getByTestId(option).click();
  await reportReady(page);
}

/** The CSV's block 1 header (staff-analytics-v2 «Export (PR 7)»). */
const DAY_HEADER =
  'вид;бръснар;дата;работено мин;неявяване мин;немаркирано мин;блокирано мин;почивка мин;непродадено мин;друго мин;оборот;бакшиш';

/**
 * Takes the share sheet away before the app loads, so «Експорт» takes the
 * download fallback a desktop browser takes — the file Playwright can read.
 */
async function withoutShareSheet(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const name of ['share', 'canShare']) {
      Object.defineProperty(Navigator.prototype, name, {
        value: undefined,
        configurable: true,
      });
    }
  });
}

/** Taps the tools' «Експорт» and reads the downloaded file: its name and its lines (no BOM, no trailing CRLF). */
async function exportCsv(
  page: Page,
): Promise<{ name: string; lines: readonly string[] }> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('analytics-tool-export').click(),
  ]);
  const path = await download.path();
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Playwright's own download path.
  const text = readFileSync(path, 'utf8');
  expect(text.startsWith('﻿')).toBe(true);
  expect(text.endsWith('\r\n')).toBe(true);
  return {
    name: download.suggestedFilename(),
    lines: text.slice(1, -2).split('\r\n'),
  };
}

/**
 * Opens the goal sheet from the tools' «Задай цел» / «Промени целта», types
 * the two ends of the range in euro (whole figures), saves, and waits for
 * the sheet to leave — the store closes it once the callable has stored it.
 */
async function setGoalThroughSheet(
  page: Page,
  low: string,
  high: string,
): Promise<void> {
  await page.getByTestId('analytics-tool-goal').click();
  const sheet = page.getByTestId('analytics-goal-sheet');
  await expect(sheet).toBeVisible();
  const lowField = page.getByTestId('analytics-goal-low');
  const highField = page.getByTestId('analytics-goal-high');
  await lowField.fill(low);
  await lowField.press('Tab');
  await highField.fill(high);
  await highField.press('Tab');
  const save = page.getByTestId('analytics-goal-save');
  await expect(save).toBeEnabled();
  await save.click();
  await expect(sheet).toBeHidden({ timeout: 30_000 });
}

test.describe('«Анализи» — staff analytics', () => {
  test('a linked barber opens «Анализи» from the menu, the takings card’s screen switches its chart, and its rows add up to the figure', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await pinBrowserClock(page);
    await withoutShareSheet(page);
    const run = attemptKey(test.info());
    const uid = `e2e-an-barber-${run}`;
    const client = `e2e-an-client-${run}`;
    await seedUserProfile(client, { firstName: 'Петър', lastName: 'Колев' });
    const seededAt = Date.now();
    await seedWorkedAppointment(
      `${run}-cut`,
      client,
      monthStartAt(11),
      DEV_CLASSIC_CUT,
    );
    await seedWorkedAppointment(`${run}-beard`, client, monthStartAt(12));
    // A past day's figures come from its document: let the trigger catch up.
    await waitForAnalyticsDay('ivan', monthStartAt(11).slice(0, 10), seededAt);
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

    // THE HOME: the period button on this month, no scope menu for a
    // barber, and the current page's five cards — no team (the shop's).
    await expect(page.getByTestId('analytics-period')).toHaveText('Този месец');
    await expect(page.getByTestId('analytics-scope-menu')).toHaveCount(0);
    const cards = currentPage(page).locator('[data-testid^="analytics-card-"]');
    await expect(cards).toHaveCount(5);
    await expect(
      currentPage(page).getByTestId('analytics-card-takings'),
    ).toContainText(/\d/);

    // THE TAKINGS CARD'S SCREEN: the smooth line first, then the bars and
    // the ring with the figure in its centre; the two seeded services.
    await openCard(page, 'takings');
    const chart = page.getByTestId('analytics-card-chart');
    await expect(chart.locator('[data-view="LINE"]')).toBeVisible();
    await page.getByTestId('analytics-view-BARS').click();
    await expect(chart.locator('[data-view="BARS"]')).toBeVisible();
    await page.getByTestId('analytics-view-RING').click();
    await expect(chart.locator('[data-view="RING"]')).toBeVisible();
    await expect(chart.locator('.analytics-card__ring-centre')).toContainText(
      /\d/,
    );
    const serviceBars = page
      .getByTestId('analytics-services-bars')
      .locator('.ui-bar-chart__bar');
    await expect(serviceBars).toHaveCount(2);
    await expectTakingsRowsAddUp(page, [
      `${run}-cut-seat`,
      `${run}-beard-seat`,
    ]);
    // A service bar opens that service's seats alone.
    await serviceBars.first().click();
    const sheet = page.getByTestId('analytics-rows');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-testid^="analytics-seat-"]')).toHaveCount(
      1,
      { timeout: 20_000 },
    );
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await backHome(page);

    // THE EXPORT (CUJ 7): the tools' «Експорт» downloads the month — a row
    // per day row (as many as the working-time screen's days list), a blank
    // line, a row per service — and no client.
    await openCard(page, 'time');
    await page.getByTestId('analytics-time-days').click();
    const days = page
      .getByTestId('analytics-rows')
      .locator('[data-testid^="analytics-day-"]');
    await expect(days.first()).toBeVisible();
    const dayCount = await days.count();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('analytics-rows')).toBeHidden();
    await backHome(page);
    const csv = await exportCsv(page);
    expect(csv.name).toMatch(
      /^creativo-analytics-\d{4}-\d{2}-01-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    expect(csv.lines[0]).toBe(DAY_HEADER);
    expect(csv.lines).toHaveLength(dayCount + 2 + 3);
    expect(csv.lines[dayCount + 1]).toBe('');
    expect(csv.lines[dayCount + 2]).toBe(
      'вид;бръснар;услуга;посещения;оборот;минути услуга',
    );
    expect(csv.lines.join('\n')).not.toContain('Петър');

    // THE GOAL (CUJ 6): the tools' «Задай цел»; the range comes back with
    // the report as the goal card's ring and its pace.
    await setGoalThroughSheet(page, '1800', '2200');
    const ring = page.getByTestId('analytics-goal-ring');
    await expect(ring).toBeVisible({ timeout: 30_000 });
    await expect(ring).toContainText('2200,00');
    await expect(page.getByTestId('analytics-goal-pace')).toHaveText(
      /работни дни|работен ден/,
    );
    await expect(page.getByTestId('analytics-tool-goal')).toContainText(
      'Промени целта',
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
    await expect(page.getByTestId('analytics-carousel')).toHaveCount(0);
  });

  test('the admin sets the shop’s goal, exports the shop, and picks a barber in the scope menu', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await pinBrowserClock(page);
    await withoutShareSheet(page);
    const run = attemptKey(test.info());
    const adminUid = `e2e-an-admin-${run}`;
    const client = `e2e-an-niko-client-${run}`;
    await seedUserProfile(client, { firstName: 'Стефан', lastName: 'Донев' });
    const seededAt = Date.now();
    await seedWorkedAppointment(
      `${run}-niko`,
      client,
      monthStartAt(15),
      DEV_CLASSIC_CUT,
      'niko',
    );
    await waitForAnalyticsDay('niko', monthStartAt(15).slice(0, 10), seededAt);
    await seedUserProfile(adminUid, {
      firstName: 'Админ',
      lastName: 'Салонов',
      roles: [Role.Admin],
    });
    await signInAs(page, adminUid, [Role.Admin]);

    await page.goto('/staff/analytics');
    await reportReady(page);
    // The admin opens on the shop — every location of the dev catalogue's
    // two, so the pill reads «Всички салони»: its page carries the team.
    await expect(page.getByTestId('analytics-scope-menu')).toContainText(
      'Всички салони',
    );
    await expect(
      currentPage(page).getByTestId('analytics-card-team'),
    ).toBeVisible();

    // The shop's goal (CUJ 6), shown as the goal card's ring.
    await setGoalThroughSheet(page, '9000', '12000');
    const shopRing = page.getByTestId('analytics-goal-ring');
    await expect(shopRing).toBeVisible({ timeout: 30_000 });
    // Five figures take a thousands separator in Bulgarian («12 000,00 €»).
    await expect(shopRing).toContainText(/12.000,00/);

    // The shop's export: the services the shop's own («Всички»), no client.
    const shopCsv = await exportCsv(page);
    expect(shopCsv.lines[0]).toBe(DAY_HEADER);
    expect(
      shopCsv.lines.some((line) => line.startsWith('УСЛУГА;Всички;')),
    ).toBe(true);
    expect(shopCsv.lines.join('\n')).not.toContain('Донев');

    // One location (ADR 2026-11-09): its figures, its name on the pill, the
    // URL saying so, and no goal — a goal is the shop's or a barber's.
    await pickFromMenu(
      page,
      'analytics-scope-menu',
      'analytics-scope-location-loc-mladost',
    );
    await expect
      .poll(() => new URL(page.url()).searchParams.get('location'))
      .toBe('loc-mladost');
    await reportReady(page);
    await expect(page.getByTestId('analytics-scope-menu')).toContainText(
      'Младост',
    );
    await expect(page.getByTestId('analytics-tool-goal')).toHaveCount(0);
    await expect(
      currentPage(page).getByTestId('analytics-card-team'),
    ).toBeVisible();

    await pickFromMenu(page, 'analytics-scope-menu', 'analytics-scope-niko');
    await expect
      .poll(() => new URL(page.url()).searchParams.get('barber'))
      .toBe('niko');
    // A barber never stands beside a location.
    expect(new URL(page.url()).searchParams.get('location')).toBeNull();
    // A colleague's scope shows no goal of the shop's, and the admin is
    // offered none to set there: a barber's goal is the barber's alone.
    await expect(page.getByTestId('analytics-goal-ring')).toHaveCount(0);
    await expect(page.getByTestId('analytics-tool-goal')).toHaveCount(0);
    await expect(
      currentPage(page).getByTestId('analytics-card-team'),
    ).toHaveCount(0);
    await openCard(page, 'takings');
    await expect
      .poll(() => new URL(page.url()).searchParams.get('barber'))
      .toBe('niko');
    await expectTakingsRowsAddUp(page, [`${run}-niko-seat`]);
  });

  test('«Предстои» opens the agenda on the emptiest day, for the barber, with free rows', async ({
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
    await pickFromMenu(page, 'analytics-scope-menu', 'analytics-scope-stefan');

    // The card is a link: the schedule, its agenda, the barber, free time on.
    const ahead = page.getByTestId('analytics-ahead');
    await expect
      .poll(async () => (await ahead.getAttribute('href')) ?? '')
      .toContain('barber=stefan');
    const href = await ahead.getAttribute('href');
    const target = new URL(href ?? '', 'http://localhost');
    expect(target.pathname).toBe('/staff/schedule');
    expect(target.searchParams.get('view')).toBe('agenda');
    expect(target.searchParams.get('barber')).toBe('stefan');
    expect(target.searchParams.get('free')).toBe('1');
    expect(target.searchParams.get('day')).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await ahead.click();
    // `?free=` is read once and leaves the address bar; the rest stays.
    await expect(page).toHaveURL(/\/staff\/schedule\?.*view=agenda/);
    await expect(page).toHaveURL(/barber=stefan/);
    await expect(page.getByTestId('staff-gap-row').first()).toBeVisible({
      timeout: 30_000,
    });
  });

  /**
   * THE SCHEDULE'S CHART BUTTON (staff-analytics-v2, «Entry from the
   * schedule», PR 1): the day on screen and the chair an admin is viewing;
   * Back lands on the same day, view and chair.
   */
  test('the schedule’s chart button opens «Анализи» on this day and chair, and Back restores the schedule', async ({
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

    // The admin was viewing Ivan's chair: Ivan's figures, the day on screen.
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

    // THE DAY: the period button reads «Днес» (the suite's day is today),
    // and a day's takings card has no bars — one bucket is no graph.
    await expect(page.getByTestId('analytics-period')).toHaveText('Днес');
    await expect(
      currentPage(page)
        .getByTestId('analytics-card-takings')
        .locator('ui-spark-bars'),
    ).toHaveCount(0);

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
    await expect(page.getByTestId('analytics-scope-menu')).toHaveCount(0);
  });

  /**
   * THE READ PATH (staff-analytics-v2 PR 4b): a year read from the day
   * documents the recompute wrote (the flag is on under the emulators); the
   * team card's screen with a radar per barber; and a custom range through
   * the sheet's inline calendars (staff-analytics-v3).
   */
  test('the admin opens the year from its day documents, the team’s radars, and a custom range through the sheet', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await pinBrowserClock(page);
    const adminUid = `e2e-an-year-${attemptKey(test.info())}`;
    await seedUserProfile(adminUid, {
      firstName: 'Админ',
      lastName: 'Година',
      roles: [Role.Admin],
    });
    // The pass over the full reach: every past barber-day of the catalogue
    // becomes a document before the year is read.
    await startAnalyticsRecompute(`${suiteDay()}T10:00:00.000+02:00`);
    await waitForAnalyticsRecompute();
    await signInAs(page, adminUid, [Role.Admin]);

    const day = suiteDay();
    await page.goto('/staff/analytics');
    await reportReady(page);
    // The period menu's «Годишно»: this year's page.
    await pickFromMenu(page, 'analytics-period-menu', 'analytics-grain-YEAR');
    await expect(page.getByTestId('analytics-period')).toHaveText(
      'Тази година',
    );
    await expect
      .poll(() => new URL(page.url()).searchParams.get('from'))
      .toBe(`${day.slice(0, 4)}-01-01`);

    // The working time's screen: the year's twelve months as bars.
    await openCard(page, 'time');
    await expect(
      page.getByTestId('analytics-card-chart').locator('.ui-bar-chart__bar'),
    ).toHaveCount(12);
    await backHome(page);

    // THE TEAM'S SCREEN (PR 5's radars): one per barber of the shop, the
    // base named; a barber's row opens their figures on the home.
    await openCard(page, 'team');
    const radars = page.getByTestId('analytics-radars');
    await expect(radars).toBeVisible();
    await expect(radars.getByTestId('analytics-radars-base')).toHaveText(
      'спрямо най-добрия в салона',
    );
    await expect(radars.locator('ui-radar')).toHaveCount(3);

    // A custom range on the takings screen: «1М» first (the sheet opens on
    // the period on screen), then «…» — «От» the month's first day, «До» the
    // suite's day, picked in the inline calendars, applied, named in the URL.
    await backHome(page);
    await openCard(page, 'takings');
    await page.getByTestId('analytics-range-MONTH').click();
    await reportReady(page);
    const from = LocalDate.startOfMonth(day);
    await page.getByTestId('analytics-custom-range').click();
    const sheet = page.getByTestId('analytics-range-sheet');
    await expect(sheet).toBeVisible();
    await page
      .getByTestId('analytics-range-from-calendar')
      .getByTestId(`ui-month-day-${from}`)
      .click();
    await page
      .getByTestId('analytics-range-to-calendar')
      .getByTestId(`ui-month-day-${day}`)
      .click();
    const apply = page.getByTestId('analytics-range-apply');
    await expect(apply).toBeEnabled();
    await apply.click();
    await expect
      .poll(() => {
        const url = new URL(page.url());
        return {
          span: url.searchParams.get('span'),
          from: url.searchParams.get('from'),
          to: url.searchParams.get('to'),
        };
      })
      .toEqual({ span: 'CUSTOM', from, to: day });
    await reportReady(page);
    await expect(page.getByTestId('analytics-custom-range')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
