import { expect, test } from '@playwright/test';
import {
  readBookingStatus,
  readSeatCancellation,
  seedUpcomingAppointment,
  seedUserProfile,
  seedWorkedAppointment,
} from './support/seed-firestore';
import { signInAs } from './support/sign-in';
import { pinBrowserClock, suiteDay } from './support/suite-clock';

/** The suite day's `YYYY-MM` in the shop's zone — the month the calendar of a
 *  pinned page (`pinBrowserClock`) opens on, whatever day it already is on
 *  the device. */
function shopMonthKey(): string {
  return suiteDay().slice(0, 7);
}

/**
 * Goal 6.4 exit gate (docs/migration/goals/06-feature-slices.md) —
 * `/account/appointments` renders a list and a calendar bound to the live
 * upcoming and history reads, and cancelling an own appointment runs the
 * domain transition server-side (the `cancelAppointment` callable) and
 * persists it.
 *
 * A row names its service and barber from the dev catalogue, which
 * `support/global-setup.ts` seeds once per run.
 */
test.describe('account appointments', () => {
  // The device on UTC+14, eleven hours ahead of the shop in summer: 10:00 in
  // Sofia is 21:00 on this phone, and from 13:00 Sofia time on its "today"
  // is already tomorrow — so a time or a day read in the device's zone
  // cannot pass for the shop's.
  test.use({ timezoneId: 'Pacific/Kiritimati' });

  test('shows the honest empty state for a client with no upcoming appointments', async ({
    page,
  }) => {
    const uid = `e2e-appts-empty-${test.info().testId}`;
    await seedUserProfile(uid);
    await signInAs(page, uid, ['client']);

    await page.goto('/account/appointments');
    await expect(page.getByTestId('appointments-page')).toHaveAttribute(
      'data-state',
      'ready',
    );
    await expect(page.getByTestId('appointments-empty')).toBeVisible();
    await expect(page.getByTestId('appointments-empty-cta')).toBeVisible();
    await expect(page.getByTestId('appointment-row')).toHaveCount(0);
  });

  test('lists a live upcoming appointment and shows it on the calendar', async ({
    page,
  }) => {
    const uid = `e2e-appts-populated-${test.info().testId}`;
    const appointmentId = `appt-${uid}`;
    await seedUserProfile(uid);
    await seedUpcomingAppointment(appointmentId, uid, '2030-06-01T10:00:00');
    // A past visit too: the jump pills show from two sections up (OR-56 c).
    await seedWorkedAppointment(
      `${appointmentId}-past`,
      uid,
      '2026-01-15T10:00:00',
    );
    await signInAs(page, uid, ['client']);

    await page.goto('/account/appointments');
    await expect(page.getByTestId('appointments-page')).toHaveAttribute(
      'data-state',
      'ready',
    );
    const row = page.locator(
      `[data-testid="appointment-row"][data-appointment-id="${appointmentId}"]`,
    );
    await expect(row).toHaveAttribute('data-status', 'CONFIRMED');
    // What and when: the catalogue's name for the service, in shop time
    // (the device reads 21:00).
    await expect(row).toContainText(/Оформяне на брада|Beard trim/);
    await expect(row).toContainText('10:00');
    await expect(row).not.toContainText('21:00');
    // The jump pills start on the content column, where the rows do — not
    // at the screen's edge, as they did on a wide screen.
    const pillBox = await page
      .getByTestId('appointments-pill')
      .first()
      .boundingBox();
    const rowBox = await row.boundingBox();
    expect(Math.abs((pillBox?.x ?? -1) - (rowBox?.x ?? 0))).toBeLessThan(1);

    await page.getByTestId('appointments-view-calendar').click();
    await expect(page.getByTestId('appointments-calendar')).toBeVisible();
    // Its day is a live cell — the run widens to reach a visit years out.
    const day = page.locator(
      '[data-testid="appointments-calendar-day"][data-day-key="2030-06-01"]',
    );
    await day.scrollIntoViewIfNeeded();
    await expect(day).toBeVisible();
  });

  test('month navigation moves the calendar forward and back', async ({
    page,
  }) => {
    // The page's "this month" and `shopMonthKey()` read one day (P3-DEP-4).
    await pinBrowserClock(page);
    const uid = `e2e-appts-calendar-nav-${test.info().testId}`;
    await seedUserProfile(uid);
    await signInAs(page, uid, ['client']);

    await page.goto('/account/appointments');
    await expect(page.getByTestId('appointments-page')).toHaveAttribute(
      'data-state',
      'ready',
    );
    await page.getByTestId('appointments-view-calendar').click();

    // The calendar is a scrolling run of months that opens on this one.
    const thisMonth = page.locator(`[data-month-key="${shopMonthKey()}"]`);
    await expect(thisMonth).toBeInViewport();

    // The heading has scrolled away, so the bar carries the weekday key —
    // each of its seven labels centred over the column it names.
    const key = page.getByTestId('appointments-chrome-weekdays');
    await expect(key).toBeVisible();
    const centres = (boxes: Element[]) =>
      boxes.map((box) => {
        const rect = box.getBoundingClientRect();
        return rect.left + rect.width / 2;
      });
    const keyCentres = await key.locator('[uiweekday]').evaluateAll(centres);
    // The month's first week, blanks included.
    const columnCentres = (
      await thisMonth.locator('ui-calendar-grid > [uiday]').evaluateAll(centres)
    ).slice(0, 7);
    expect(keyCentres).toHaveLength(7);
    const drift = keyCentres.map((x, column) =>
      Math.abs(x - (columnCentres.at(column) ?? Number.POSITIVE_INFINITY)),
    );
    expect(Math.max(...drift)).toBeLessThan(1);

    const months = page.getByTestId('appointments-month-label');
    const initialMonths = await months.count();

    // Forward: scrolling on carries this month away and, near the end,
    // grows the run by more months.
    const scroller = page.getByTestId('appointments-calendar');
    await scroller.hover();
    await expect(async () => {
      await page.mouse.wheel(0, 2000);
      expect(await months.count()).toBeGreaterThan(initialMonths);
    }).toPass({ timeout: 15_000 });
    await expect(thisMonth).not.toBeInViewport();
    // Months later, still labelled.
    await expect(key).toBeInViewport();

    // Back: the today control returns to this month.
    await page.getByTestId('appointments-scroll-today').click();
    await expect(thisMonth).toBeInViewport();
  });

  test('cancelling an own appointment runs the domain cancel() transition and persists it', async ({
    page,
  }) => {
    const uid = `e2e-appts-cancel-${test.info().testId}`;
    const appointmentId = `appt-${uid}`;
    await seedUserProfile(uid);
    await seedUpcomingAppointment(appointmentId, uid, '2030-06-01T10:00:00');
    await signInAs(page, uid, ['client']);

    await page.goto('/account/appointments');
    const row = page.locator(
      `[data-testid="appointment-row"][data-appointment-id="${appointmentId}"]`,
    );
    await expect(row).toHaveAttribute('data-status', 'CONFIRMED');
    // It is filed under the upcoming run, which is what the cancel must
    // take it out of. One section draws no pill rail (OR-56 c): the
    // section itself is the proof.
    const upcomingSection = page.getByTestId('appointments-upcoming');
    await expect(upcomingSection).toHaveCount(1);

    // The row opens the visit; cancelling lives in its sheet.
    await row.click();
    await expect(page.getByTestId('appointment-visit-sheet')).toHaveAttribute(
      'data-open',
      '',
    );
    await page.getByTestId('appointment-cancel-trigger').click();
    await expect(page.getByTestId('appointment-cancel-sheet')).toHaveAttribute(
      'data-open',
      '',
    );
    // The reason is optional and starts empty.
    await expect(page.getByTestId('appointment-cancel-reason')).toHaveValue('');

    await page.getByTestId('appointment-cancel-confirm').click();
    await expect(page.getByTestId('appointment-cancel-sheet')).toHaveCount(0);

    // The live listeners move the visit on their own — out of the upcoming
    // run and into the history, as cancelled — no manual UI removal.
    await expect(row).toHaveAttribute('data-status', 'CANCELLED');
    await expect(upcomingSection).toHaveCount(0);

    await expect.poll(() => readBookingStatus(appointmentId)).toBe('CANCELLED');
    // Filed as the client's, with no reason claimed on their behalf.
    await expect
      .poll(() => readSeatCancellation(appointmentId))
      .toEqual({ cancelledBy: 'CLIENT', cancellationReason: 'UNSPECIFIED' });
  });
});
