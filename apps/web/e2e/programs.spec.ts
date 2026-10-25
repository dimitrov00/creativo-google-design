import { expect, test, type Locator, type Page } from '@playwright/test';
import { Role } from '@core/components';
import { LocalDate } from '@core/primitives';
import { attemptKey } from './support/attempt-key';
import { shopToday } from './support/shop-clock';
import { signInAs } from './support/sign-in';

/**
 * THE PROGRAMS, END TO END (flip 4 F4-2, pass E E-15 / E-17): a content
 * manager signed in through the e2e support creates an open position, an
 * open course and an upcoming event on `/admin/programs` — each save is the
 * BROWSER's write (`writePosition` / `writeCourse` / `writeShopEvent` over
 * `programs.adapter.ts`, a full-document `setDoc` of the entity minus its
 * id), so the journey proves the tightened `firestore.rules` shape checks
 * (`validPosition` / `validCourse` / `validEvent`, DEP-7) admit the live
 * writer. Then the public pages show them to anyone: `/careers` the
 * position with its status word, `/courses` the course with its status
 * word (the catalogues' `programs.status.*`, E-17 — the same lowercase
 * words in bg and en), and `/events` the event's title and its date on the
 * shop's wall clock — an event has no status (`event.entity.ts`).
 *
 * Every title carries this attempt's key: the three collections are shared
 * by every run on one emulator, and a row is found by its own words.
 */

/** A row of a public list: the link whose words hold `title`. */
function rowOf(list: Locator, title: string): Locator {
  return list.locator('a[uilistrow]', { hasText: title });
}

/** The status capsule of a public row (`span[uiBadge]`). */
function statusOf(row: Locator): Locator {
  return row.locator('.ui-badge');
}

/**
 * Opens a new form on `tab`'s list, fills it, saves, and waits for the
 * form to close on a stored write — `admin-save-error` would say the write
 * was refused (`saveFailed`).
 */
async function create(
  page: Page,
  tab: 'positions' | 'courses' | 'events',
  fill: (form: Locator) => Promise<void>,
): Promise<void> {
  await page.getByTestId(`admin-tab-${tab}`).click();
  await page.getByTestId('admin-new').click();
  const form = page.getByTestId('admin-form');
  await expect(form).toBeVisible();
  await fill(form);
  await page.getByTestId('admin-save').click();
  await expect(page.getByTestId('admin-save-error')).toHaveCount(0);
  await expect(form).toHaveCount(0, { timeout: 20_000 });
}

/**
 * The event's start as `/events` prints it: `marketing-events.ts`'
 * `EVENT_DATE_FORMAT` read on the UTC axis (`formatWallClock`), in the
 * page's own `Intl` — the wall clock as typed, whatever zone the browser
 * is in.
 */
async function eventDateLabel(
  page: Page,
  lang: string,
  day: LocalDate,
  hour: number,
  minute: number,
): Promise<string> {
  const { year, month, day: dayOfMonth } = LocalDate.parts(day);
  // The civil reading as a number on the UTC axis — `civilMs`' own sum.
  const civilMs = Date.UTC(year, month - 1, dayOfMonth, hour, minute);
  return page.evaluate(
    ({ locale, at }) =>
      new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'UTC',
      }).format(at),
    { locale: lang, at: civilMs },
  );
}

test.describe('programs — a content manager publishes, the public pages show it', () => {
  test('a position, a course and an event created on /admin/programs reach /careers, /courses and /events', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const run = attemptKey(test.info());
    const position = { bg: `Барбер ${run}`, en: `Barber ${run}` };
    const course = { bg: `Курс фейд ${run}`, en: `Fade course ${run}` };
    const event = { bg: `Вечер на бръснача ${run}`, en: `Razor night ${run}` };
    // Upcoming on the shop's clock whenever the suite runs: a month ahead,
    // 18:30 on the shop's wall.
    const eventDay = LocalDate.addDays(shopToday(), 30);
    const [eventHour, eventMinute] = [18, 30];
    const startsAt = `${eventDay}T${String(eventHour).padStart(2, '0')}:${String(eventMinute).padStart(2, '0')}`;

    await signInAs(page, `e2e-programs-${run}`, [Role.ContentManager]);
    await page.goto('/admin/programs');
    await expect(page.getByTestId('admin-programs-page')).toBeVisible({
      timeout: 20_000,
    });

    // THE POSITION — open (the form's default status).
    await create(page, 'positions', async (form) => {
      await form.getByTestId('admin-position-title-en').fill(position.en);
      await form.getByTestId('admin-position-title-bg').fill(position.bg);
      await form
        .getByTestId('admin-position-summary-en')
        .fill('Full-time, at the Center.');
      await form
        .getByTestId('admin-position-summary-bg')
        .fill('Пълен работен ден, в Центъра.');
      await form.getByRole('button', { name: 'Open', exact: true }).click();
    });
    const positionRow = page
      .getByTestId('admin-positions-list')
      .locator('[uilistrow]', { hasText: position.en });
    await expect(positionRow).toBeVisible({ timeout: 20_000 });
    await expect(positionRow).toContainText('open');

    // THE COURSE — open for enrolment, with when it starts.
    await create(page, 'courses', async (form) => {
      await form.getByTestId('admin-course-title-en').fill(course.en);
      await form.getByTestId('admin-course-title-bg').fill(course.bg);
      await form
        .getByTestId('admin-course-description-en')
        .fill('Six evenings on the skin fade.');
      await form
        .getByTestId('admin-course-description-bg')
        .fill('Шест вечери върху фейда.');
      await form.getByRole('button', { name: 'Open', exact: true }).click();
      await form.getByTestId('admin-course-starts-label-en').fill('Spring');
      await form.getByTestId('admin-course-starts-label-bg').fill('Пролет');
    });
    const courseRow = page
      .getByTestId('admin-courses-list')
      .locator('[uilistrow]', { hasText: course.en });
    await expect(courseRow).toBeVisible({ timeout: 20_000 });
    await expect(courseRow).toContainText('open');

    // THE EVENT — a month ahead, at the default shop (no location typed:
    // the default location's zone places it, flip 4 F4-11).
    await create(page, 'events', async (form) => {
      await form.getByTestId('admin-event-title-en').fill(event.en);
      await form.getByTestId('admin-event-title-bg').fill(event.bg);
      await form
        .getByTestId('admin-event-description-en')
        .fill('Hot towels and straight razors.');
      await form
        .getByTestId('admin-event-description-bg')
        .fill('Горещи кърпи и бръсначи.');
      await form.getByTestId('admin-event-starts-at').fill(startsAt);
    });
    await expect(
      page
        .getByTestId('admin-events-list')
        .locator('[uilistrow]', { hasText: event.en }),
    ).toBeVisible({ timeout: 20_000 });

    // /careers — the position, in the page's language (bg), with its
    // status word.
    await page.goto('/careers');
    const careers = page.getByTestId('careers-list');
    const careersRow = rowOf(careers, position.bg);
    await expect(careersRow).toBeVisible({ timeout: 20_000 });
    await expect(statusOf(careersRow)).toHaveText('open');

    // /courses — the course under «Open» (the default tab), with its
    // status word.
    await page.goto('/courses');
    await expect(page.getByTestId('courses-tab-open')).toBeVisible({
      timeout: 20_000,
    });
    const coursesRow = rowOf(page.getByTestId('courses-list'), course.bg);
    await expect(coursesRow).toBeVisible({ timeout: 20_000 });
    await expect(coursesRow).toContainText('Пролет');
    await expect(statusOf(coursesRow)).toHaveText('open');

    // /events — the event under «Upcoming» (the default tab): its title and
    // its date on the shop's wall clock, and no status word.
    await page.goto('/events');
    const eventsRow = rowOf(page.getByTestId('events-list'), event.bg);
    await expect(eventsRow).toBeVisible({ timeout: 20_000 });
    await expect(eventsRow).toContainText(
      await eventDateLabel(page, 'bg', eventDay, eventHour, eventMinute),
    );
    await expect(statusOf(eventsRow)).toHaveCount(0);
  });
});
