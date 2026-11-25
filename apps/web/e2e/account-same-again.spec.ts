import { expect, test } from '@playwright/test';
import { attemptKey } from './support/attempt-key';
import {
  seedUpcomingAppointment,
  seedUserProfile,
  seedWorkedAppointment,
} from './support/seed-firestore';
import { signInAs } from './support/sign-in';
import { farVisitDay } from './support/suite-clock';

/*
 * «ПАК СЪЩОТО» (owner ruling Q6 of the role-aware homes brief, 2026-11-25).
 * A client with nothing booked ahead lands on a home that leads with the
 * visit they had last — the cut and the barber by name — and ONE tap puts
 * that visit's bag in the booking flow (`/book?repeat=<id>`), on the step
 * that asks when. The rebooking edge it stores is
 * `client-card-rebook.spec.ts`'s; the card's states are the page spec's.
 */
test.describe('the client home — «Пак същото»', () => {
  test('one tap from the home to the booking flow with the last visit’s bag', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const run = attemptKey(test.info());
    const uid = `e2e-same-again-${run}`;
    const sourceId = `e2e-same-again-src-${run}`;
    await seedUserProfile(uid, { birthDate: '1990-05-05' });
    // A finished beard trim with Ivan at the Center — the dev catalogue's
    // chair, a service it still sells.
    await seedWorkedAppointment(sourceId, uid, '2026-03-10T10:00:00');
    await signInAs(page, uid, ['client']);

    await page.goto('/account');
    const home = page.getByTestId('account-page');
    await expect(home).toHaveAttribute('data-lead', 'same-again', {
      timeout: 20_000,
    });
    await expect(home).toHaveAttribute('data-upcoming', 'empty');

    const card = page.getByTestId('account-same-again');
    await expect(card).toContainText(/Пак същото|Same again/);
    // The barber by name (Q6): the visit's own chair.
    await expect(card).toContainText(/Иван|Ivan/);

    await page.getByTestId('account-same-again-book').click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === '/book' && url.searchParams.get('repeat') === sourceId,
    );
    // The bag landed: the flow opens on WHEN, not on the services.
    await expect(page.getByTestId('booking-machine')).toHaveAttribute(
      'data-state',
      'schedule',
      { timeout: 20_000 },
    );
  });

  test('a visit booked ahead leads the home instead — one booking prompt, never two', async ({
    page,
  }) => {
    const run = attemptKey(test.info());
    const uid = `e2e-same-again-next-${run}`;
    await seedUserProfile(uid, { birthDate: '1990-05-05' });
    await seedWorkedAppointment(
      `e2e-same-again-past-${run}`,
      uid,
      '2026-03-10T10:00:00',
    );
    await seedUpcomingAppointment(
      `e2e-same-again-ahead-${run}`,
      uid,
      `${farVisitDay()}T10:00:00`,
    );
    await signInAs(page, uid, ['client']);

    await page.goto('/account');
    await expect(page.getByTestId('account-page')).toHaveAttribute(
      'data-lead',
      'next',
      { timeout: 20_000 },
    );
    await expect(page.getByTestId('account-upcoming')).toBeVisible();
    await expect(page.getByTestId('account-same-again')).toHaveCount(0);
  });
});
