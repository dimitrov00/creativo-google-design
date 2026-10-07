import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { SHOP_ZONE } from './support/appointment-seed-document';
import { attemptKey } from './support/attempt-key';
import {
  readAppointmentsOwnedBy,
  seedUserProfile,
  seedWorkedAppointment,
} from './support/seed-firestore';
import { signInAs } from './support/sign-in';

/**
 * The days after today the calendar lets you tap, in calendar order.
 *
 * Today is skipped: its cell turns on before its live query answers, and by
 * evening it can have no time left worth booking.
 */
function bookableDays(page: Page): Locator {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHOP_ZONE,
  }).format(new Date());
  return page.locator(
    `[data-testid="booking-day"]:not([disabled]):not([data-day-key="${today}"])`,
  );
}

/**
 * Which of the bookable days this run books, as an index into them.
 *
 * Two runs booking at the same moment must never share a day. On a shared
 * day one run's booking re-renders the other's live time list under its
 * pick, which is then lost, or both take the same first time and one
 * correctly loses with «Този час току-що се зае»: the product's answer to a
 * real race, and a failure here. Runs at the same moment always hold
 * different `parallelIndex`es, whatever their project, repeat or retry
 * (Playwright: "workers running at the same time have a different
 * parallelIndex", all below `workers`). So the lane keeps `parallelIndex` as
 * its remainder by `workers`, and no two of them can meet.
 *
 * The quotient spreads the runs ONE worker makes in turn (every project,
 * every `--repeat-each` copy, every retry) over further days, as far as
 * `bookableDays` holds them, so a run seldom books a day an earlier one
 * booked while that booking's busy projection may still be landing.
 */
function bookingLane(info: TestInfo, bookableDays: number): number {
  const workers = Math.max(1, info.config.workers);
  const projects = info.config.projects.map((project) => project.name);
  const project = Math.max(0, projects.indexOf(info.project.name));
  const turn =
    (info.repeatEachIndex * projects.length + project) *
      (info.project.retries + 1) +
    info.retry;
  const turns = Math.max(1, Math.floor(bookableDays / workers));
  return info.parallelIndex + workers * (turn % turns);
}

/**
 * Defect §2.3 #6, the P0 exit criterion "an e2e test shows `/book?repeat`
 * persisting `bookedFromAppointmentId`" (design §12.4). The edge cannot be
 * backfilled, so the check reads the stored document rather than the
 * confirmation screen. The booking flow's catalogue (shops, services,
 * rosters, the policy) is the dev seed `support/global-setup.ts` runs once
 * per run, before any project starts.
 */
test.describe('client card — the rebooking edge', () => {
  test('/book?repeat= stores the repeated visit as bookedFromAppointmentId', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // Per project, per `--repeat-each` copy and per attempt: a retry must
    // not count the booking its failed predecessor may have committed, nor
    // a copy the one an earlier copy committed on the same emulator.
    const run = attemptKey(test.info());
    const uid = `e2e-rebook-${run}`;
    const sourceId = `e2e-rebook-src-${run}`;
    await seedUserProfile(uid, {
      firstName: 'Георги',
      lastName: 'Петров',
      phone: '+359881234567',
    });
    // A finished beard trim with Ivan at the Center: the dev catalogue's
    // chair, so the prefilled bag is one the catalogue still sells.
    await seedWorkedAppointment(sourceId, uid, '2026-03-10T10:00:00');
    await signInAs(page, uid, ['client']);

    await page.goto(`/book?repeat=${sourceId}`);
    const machine = page.getByTestId('booking-machine');
    // The prefill lands on WHEN: the bag, the barber and the shop are the
    // visit's own.
    await expect(machine).toHaveAttribute('data-state', 'schedule', {
      timeout: 20_000,
    });

    // Every run books the same chair (Ivan's), so every run that books at the
    // same moment takes its OWN day (`bookingLane`): the phone, tablet and
    // desktop projects, and every copy `--repeat-each` makes of them.
    const days = bookableDays(page);
    // Rosters become bookable days once the capacity trigger has run; wait
    // until there is a day for every run that can book at once, so none of
    // them counts a shorter list.
    await expect(
      days.nth(Math.max(1, test.info().config.workers) - 1),
    ).toBeVisible({
      timeout: 60_000,
    });
    const lane = bookingLane(test.info(), await days.count());
    await days.nth(lane).click();
    await page.getByTestId('booking-time-pick').click();
    const times = page.getByTestId('booking-time');
    await expect(times.first()).toBeVisible({ timeout: 20_000 });
    await times.first().click();
    await page.getByTestId('booking-time-continue').click();
    await page.getByTestId('booking-schedule-continue').click();

    await expect(machine).toHaveAttribute('data-state', 'review');
    await page.getByTestId('booking-review-confirm').click();
    await expect(machine).toHaveAttribute('data-state', 'confirmed', {
      timeout: 30_000,
    });

    // Every appointment the client holds apart from the visit it repeated.
    const booked = (await readAppointmentsOwnedBy(uid)).filter(
      ({ id }) => id !== sourceId,
    );
    expect(booked).toHaveLength(1);
    expect(booked[0]?.['bookedFromAppointmentId']).toBe(sourceId);
    expect(booked[0]?.['barberIds']).toEqual(['ivan']);
  });
});
