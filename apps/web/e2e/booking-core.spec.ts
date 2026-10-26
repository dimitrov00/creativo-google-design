import { expect, test, type Page } from '@playwright/test';
import { BarberId, LocalDate, UtcEpochMs, Weekday } from '@core/primitives';
import { DEV_CHAIR } from './support/appointment-seed-document';
import { attemptKey } from './support/attempt-key';
import { bookableDays, bookingLane } from './support/booking-days';
import {
  readAppointmentsOwnedBy,
  readBarberBusyDay,
  readScheduleException,
  seedCustomerRecord,
  seedInbox,
  seedUserProfile,
  seedWaitlistMatch,
} from './support/seed-firestore';
import { shopDayOf, shopToday, sure } from './support/shop-clock';
import { signInAs } from './support/sign-in';

/**
 * FLIP 1 (the booking core), LIVE: the paths the read-only smoke of
 * HANDOFF §3.1 could not reach, driven through the real UI against the
 * Functions emulator — a `/book` day with times (the capacity month's
 * sorted `entries[]` and the busy days, both trigger-built), a booking
 * that lands as a FLAT appointment body with its busy block projected, a
 * staff block stored as the flat public effect, the shell's inbox count
 * over `users/{uid}/notifications`, and the inbox page itself (OR-19):
 * opening it reads everything, and a waitlist match deep-links to `/book`.
 *
 * The catalogue (shops, services, rosters, the policy) is the dev seed
 * `support/global-setup.ts` writes once per run; every person and document
 * a case asserts on is its own attempt's (`attemptKey`).
 */

/** `HH:mm` → minutes after the shop's midnight. */
function minutesOf(label: string): number {
  const match = /(\d{1,2}):(\d{2})/.exec(label);
  if (!match) throw new Error(`no time in «${label}»`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * From an empty `/book` to WHEN: the Center, Ivan's beard trim (the dev
 * catalogue's chair, `DEV_CHAIR`), and on to the calendar — waiting until
 * the calendar has at least `days` bookable days after today.
 */
async function bookUpToSchedule(page: Page, days: number): Promise<void> {
  await page.goto('/book', { waitUntil: 'commit' });
  const machine = page.getByTestId('booking-machine');
  await expect(machine).toHaveAttribute('data-state', 'location', {
    timeout: 20_000,
  });
  await page
    .locator(
      `[data-testid="booking-location-row"][data-location="${DEV_CHAIR.locationId}"]`,
    )
    .click();
  await page.getByTestId('booking-location-continue').click();

  await expect(machine).toHaveAttribute('data-state', 'services');
  await page.getByTestId(`service-card-${DEV_CHAIR.serviceId}`).click();
  await page.getByTestId('booking-barber-menu').click();
  await page.getByTestId(`booking-barber-${DEV_CHAIR.barberId}`).click();
  await page.getByTestId('booking-add-to-bag').click();
  await expect(page.getByTestId('booking-bag-count')).toHaveText('1');
  await page.getByTestId('booking-services-continue').click();

  await expect(machine).toHaveAttribute('data-state', 'schedule');
  // Rosters become bookable days once the capacity trigger has built the
  // month's `entries[]`: no day turns on before it has.
  await expect(bookableDays(page).nth(days - 1)).toBeVisible({
    timeout: 60_000,
  });
}

test.describe('booking core (flip 1) — live', () => {
  test('/book offers a seeded chair a day with bookable times', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await bookUpToSchedule(page, 1);

    const day = bookableDays(page).first();
    await day.click();
    await expect(day).toHaveAttribute('data-selected', '');
    await page.getByTestId('booking-time-pick').click();
    const times = page.getByTestId('booking-time');
    await expect(times.first()).toBeVisible({ timeout: 20_000 });
    // Every time is a wall-clock minute inside Ivan's Center roster.
    const labels = await times.allInnerTexts();
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      const minute = minutesOf(label);
      expect(minute).toBeGreaterThanOrEqual(9 * 60);
      expect(minute).toBeLessThan(18 * 60);
    }
  });

  test('a signed-in client books a time: a flat appointment, its busy block, and /account/appointments', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const run = attemptKey(test.info());
    const uid = `e2e-book-${run}`;
    await seedUserProfile(uid, {
      firstName: 'Петър',
      lastName: 'Иванов',
      phone: '+359881112233',
    });
    // The record a first booking would open, at the id the transaction
    // derives — so the confirm screen has a contact without the sheet.
    await seedCustomerRecord(uid);
    await signInAs(page, uid, ['client']);

    const workers = Math.max(1, test.info().config.workers);
    await bookUpToSchedule(page, workers);
    // Every run that books at the same moment takes its OWN day of Ivan's.
    const days = bookableDays(page);
    const day = days.nth(bookingLane(test.info(), await days.count()));
    const dayKey = await day.getAttribute('data-day-key');
    expect(dayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await day.click();
    await page.getByTestId('booking-time-pick').click();
    const time = page.getByTestId('booking-time').first();
    await expect(time).toBeVisible({ timeout: 20_000 });
    const label = (await time.innerText()).trim();
    const startMs = Number(await time.getAttribute('data-start'));
    const startMinutes = minutesOf(label);
    await time.click();
    await page.getByTestId('booking-time-continue').click();
    await page.getByTestId('booking-schedule-continue').click();

    const machine = page.getByTestId('booking-machine');
    await expect(machine).toHaveAttribute('data-state', 'review');
    await page.getByTestId('booking-review-confirm').click();
    await expect(machine).toHaveAttribute('data-state', 'confirmed', {
      timeout: 30_000,
    });

    // What the server FILED: one appointment, the flat archetype — every
    // 1-to-1 field at the root, none of the pre-flip nests.
    const booked = await readAppointmentsOwnedBy(uid);
    expect(booked).toHaveLength(1);
    const appointment = booked[0] ?? { id: '' };
    expect(appointment).toMatchObject({
      bookingStatus: 'CONFIRMED',
      localDate: dayKey,
      startMinutes,
      endMinutes: startMinutes + DEV_CHAIR.durationMinutes,
      utcEpochMs: startMs,
      locationId: DEV_CHAIR.locationId,
      barberIds: [DEV_CHAIR.barberId],
      ownerUserId: uid,
      ownerCustomerId: expect.any(String),
    });
    // The sold terms ride on the ONE seat (1-to-N), flat inside it.
    expect(appointment['seats']).toEqual([
      expect.objectContaining({
        serviceId: DEV_CHAIR.serviceId,
        barberId: DEV_CHAIR.barberId,
        startMinutes,
        durationMinutes: DEV_CHAIR.durationMinutes,
        priceCents: DEV_CHAIR.priceCents,
        currency: DEV_CHAIR.currency,
        seatSubject: 'ACCOUNT',
        subjectUserId: uid,
      }),
    ]);
    expect(typeof appointment['confirmedAtUtcMs']).toBe('number');
    for (const retired of ['timeSlot', 'startIso', 'status', 'kind', 'zone']) {
      expect(appointment, `no root «${retired}»`).not.toHaveProperty(retired);
    }
    // The shop's wall clock and the absolute instant agree (Law 7.3).
    expect(shopDayOf(sure(UtcEpochMs.of(startMs), 'the start'))).toBe(dayKey);

    // The busy trigger projected the chair's day, and it holds the visit.
    const chair = BarberId.of(DEV_CHAIR.barberId);
    const bookedDay = sure(LocalDate.parse(String(dayKey)), 'the booked day');
    await expect
      .poll(
        async () => {
          const busy = await readBarberBusyDay(chair, bookedDay);
          const blocks = (busy?.['blocks'] ?? []) as readonly {
            startMinutes: number;
            endMinutes: number;
            blockKind: string;
          }[];
          return blocks.some(
            (block) =>
              block.blockKind === 'BUSY' &&
              block.startMinutes <= startMinutes &&
              block.endMinutes >= startMinutes + DEV_CHAIR.durationMinutes,
          );
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    const busy = await readBarberBusyDay(chair, bookedDay);
    expect(busy).toMatchObject({
      barberId: DEV_CHAIR.barberId,
      localDate: dayKey,
    });

    // The client's own list shows it on the right day, at the right time.
    await page.goto('/account/appointments', { waitUntil: 'commit' });
    await expect(page.getByTestId('appointments-page')).toHaveAttribute(
      'data-state',
      'ready',
      { timeout: 20_000 },
    );
    const row = page.locator(
      `[data-testid="appointment-row"][data-appointment-id="${appointment.id}"]`,
    );
    await expect(row).toHaveAttribute('data-status', 'CONFIRMED');
    await expect(row).toContainText(label);
    await page.getByTestId('appointments-view-calendar').click();
    const cell = page.locator(
      `[data-testid="appointments-calendar-day"][data-day-key="${dayKey}"]`,
    );
    await cell.scrollIntoViewIfNeeded();
    await expect(cell).toBeVisible();
  });

  test('staff block a time: it shows on the day and is stored as the flat public effect', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const info = test.info();
    // A Monday–Thursday (Ivan's Center days, 09–13 and 14–18) some six
    // weeks out — past the days the booking cases take — one week further
    // per copy and attempt, so each one blocks a day of its own.
    const turn = info.repeatEachIndex * (info.project.retries + 1) + info.retry;
    const blockDay = centerWeekdayFrom(42 + 7 * turn);

    await signInAs(page, 'dev-staff-ivan', ['barber', 'admin']);
    await page.goto(
      `/staff/schedule?day=${blockDay}&view=day&barber=${DEV_CHAIR.barberId}`,
      { waitUntil: 'commit' },
    );
    const column = page.locator(
      `[data-testid="staff-grid-column"][data-column="${DEV_CHAIR.barberId}"]`,
    );
    await expect(column).toBeVisible({ timeout: 30_000 });
    await expect(column.getByTestId('staff-grid-block')).toHaveCount(0);

    await page.getByTestId('staff-add-trigger').click();
    await page.getByTestId('staff-add-block').click();
    const sheet = page.getByTestId('staff-block-sheet');
    await expect(sheet).toBeVisible();
    await expect(
      sheet.getByTestId(`staff-block-barber-${DEV_CHAIR.barberId}`),
    ).toBeVisible();
    // The sheet opens on its default range, 12:00–13:00, on the shown day.
    await page.getByTestId('staff-block-save').click();
    await expect(sheet).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId('staff-block-error')).toHaveCount(0);

    await expect(column.getByTestId('staff-grid-block')).toHaveCount(1, {
      timeout: 20_000,
    });

    // Stored as the sanitized public EFFECT, every field at the root: no
    // reason, no nested effect, no zone.
    await expect
      .poll(() =>
        readScheduleException(BarberId.of(DEV_CHAIR.barberId), blockDay),
      )
      .toEqual({
        barberId: DEV_CHAIR.barberId,
        localDate: blockDay,
        locationId: DEV_CHAIR.locationId,
        utcEpochMs: expect.any(Number),
        exceptionEffect: 'BLOCKED',
        exceptionRanges: [{ startMinutes: 12 * 60, endMinutes: 13 * 60 }],
      });
  });

  test('the shell menu counts the unread notifications of the inbox', async ({
    page,
  }) => {
    const uid = `e2e-inbox-${attemptKey(test.info())}`;
    await seedUserProfile(uid);
    await seedInbox(uid, { unread: 2, read: 1 });
    await signInAs(page, uid, ['client']);

    await page.goto('/account', { waitUntil: 'commit' });
    await expect(page.getByTestId('account-page')).toHaveAttribute(
      'data-state',
      'ready',
      { timeout: 20_000 },
    );
    await page.getByTestId('nav-menu-trigger').click();
    await expect(page.getByTestId('menu-notifications')).toBeVisible();
    await expect(page.getByTestId('menu-notifications-count')).toHaveText('2');
  });

  test('the inbox page reads every notification: the menu badge clears, and a waitlist match deep-links to /book', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const key = attemptKey(test.info());
    const uid = `e2e-inbox-page-${key}`;
    const requestId = `wl-${key}`;
    const freedDay = LocalDate.addDays(shopToday(), 3);
    await seedUserProfile(uid);
    await seedInbox(uid, { unread: 1, read: 1 });
    await seedWaitlistMatch(uid, requestId, freedDay, 10 * 60);
    await signInAs(page, uid, ['client']);

    const accountReady = async () =>
      expect(page.getByTestId('account-page')).toHaveAttribute(
        'data-state',
        'ready',
        { timeout: 20_000 },
      );
    await page.goto('/account', { waitUntil: 'commit' });
    await accountReady();

    // The menu row counts the two unread and leads to the inbox itself.
    await page.getByTestId('nav-menu-trigger').click();
    await expect(page.getByTestId('menu-notifications-count')).toHaveText('2');
    await page.getByTestId('menu-notifications').click();
    await expect(page).toHaveURL(/\/account\/notifications$/);
    const inbox = page.getByTestId('notifications-page');
    await expect(inbox).toHaveAttribute('data-state', 'ready', {
      timeout: 20_000,
    });
    const rows = page.getByTestId('notifications-row');
    await expect(rows).toHaveCount(3);
    // What was unread on entry keeps its dot for the visit.
    await expect(
      page.locator('[data-testid="notifications-row"][data-unread]'),
    ).toHaveCount(2);

    // Entering was the receipt: back on the account, the badge is gone.
    await page.getByTestId('notifications-back').click();
    await accountReady();
    await page.getByTestId('nav-menu-trigger').click();
    await expect(page.getByTestId('menu-notifications')).toBeVisible();
    await expect(page.getByTestId('menu-notifications-count')).toHaveCount(0, {
      timeout: 10_000,
    });

    // A second visit finds nothing unread, and the match leads to /book on
    // the freed day.
    await page.getByTestId('menu-notifications').click();
    await expect(inbox).toHaveAttribute('data-state', 'ready', {
      timeout: 20_000,
    });
    await expect(
      page.locator('[data-testid="notifications-row"][data-unread]'),
    ).toHaveCount(0);
    await page
      .locator('[data-testid="notifications-row"][data-topic="WAITLIST_MATCH"]')
      .click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === '/book' &&
        url.searchParams.get('waitlist') === requestId &&
        url.searchParams.get('day') === freedDay,
    );
    await expect(page.getByTestId('booking-machine')).toBeVisible({
      timeout: 20_000,
    });
  });
});

/**
 * The first Monday–Thursday at least `offset` days after the shop's today
 * — calendar arithmetic on the shop day alone (`LocalDate`, so no zone can
 * move it).
 */
function centerWeekdayFrom(offset: number): LocalDate {
  let day = LocalDate.addDays(shopToday(), offset);
  // ISO Monday 1 … Sunday 7; Ivan works the Center Monday to Thursday.
  while (LocalDate.weekday(day) > Weekday.Thu) {
    day = LocalDate.addDays(day, 1);
  }
  return day;
}
