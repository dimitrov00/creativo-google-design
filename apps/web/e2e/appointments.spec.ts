import { expect, test } from '@playwright/test';
import { mintCustomToken } from './support/mint-custom-token';
import {
  readAppointmentStatusKind,
  seedUpcomingAppointment,
  seedUserProfile,
} from './support/seed-firestore';

declare global {
  interface Window {
    __e2eSignIn?: (customToken: string) => Promise<void>;
  }
}

async function signIn(
  page: import('@playwright/test').Page,
  uid: string,
): Promise<void> {
  const token = await mintCustomToken(uid, {
    stage: 'active',
    roles: ['client'],
  });
  await page.goto('/');
  await page.waitForFunction(() => typeof window.__e2eSignIn === 'function');
  await page.evaluate(
    (customToken) => window.__e2eSignIn?.(customToken),
    token,
  );
}

/**
 * Goal 6.4 exit gate (docs/migration/goals/06-feature-slices.md) —
 * `/account/appointments` renders a calendar and list bound to
 * `observeUpcomingFor`, and cancelling an own appointment runs the domain
 * `cancel()` transition through the repository. Mirrors
 * `account-dashboard.spec.ts`'s `mintCustomToken`/`seed-firestore` pattern.
 */
test.describe('account appointments', () => {
  test('shows the honest empty state for a client with no upcoming appointments', async ({
    page,
  }) => {
    const uid = `e2e-appts-empty-${test.info().testId}`;
    await seedUserProfile(uid);
    await signIn(page, uid);

    await page.goto('/account/appointments');
    await expect(page.getByTestId('appointments-page')).toHaveAttribute(
      'data-state',
      'ready',
    );
    await expect(page.getByTestId('appointments-list')).toHaveAttribute(
      'data-state',
      'empty',
    );
    await expect(page.getByTestId('appointments-empty-cta')).toBeVisible();
  });

  test('lists a live upcoming appointment and shows it on the calendar', async ({
    page,
  }) => {
    const uid = `e2e-appts-populated-${test.info().testId}`;
    const appointmentId = `appt-${uid}`;
    await seedUserProfile(uid);
    await seedUpcomingAppointment(appointmentId, uid, '2030-06-01T10:00:00');
    await signIn(page, uid);

    await page.goto('/account/appointments');
    await expect(page.getByTestId('appointments-list')).toHaveAttribute(
      'data-state',
      'populated',
    );
    const row = page.getByTestId('appointment-row');
    await expect(row).toHaveAttribute('data-status', 'confirmed');

    await page.getByTestId('appointments-view-calendar').click();
    await expect(page.getByTestId('appointments-calendar')).toBeVisible();
  });

  test('month navigation moves the calendar label forward and back', async ({
    page,
  }) => {
    const uid = `e2e-appts-calendar-nav-${test.info().testId}`;
    await seedUserProfile(uid);
    await signIn(page, uid);

    await page.goto('/account/appointments');
    await page.getByTestId('appointments-view-calendar').click();

    const label = page.getByTestId('appointments-calendar-month-label');
    const initial = await label.textContent();

    await page.getByTestId('appointments-calendar-next').click();
    await expect(label).not.toHaveText(initial ?? '');

    await page.getByTestId('appointments-calendar-prev').click();
    await expect(label).toHaveText(initial ?? '');
  });

  test('cancelling an own appointment runs the domain cancel() transition and persists it', async ({
    page,
  }) => {
    const uid = `e2e-appts-cancel-${test.info().testId}`;
    const appointmentId = `appt-${uid}`;
    await seedUserProfile(uid);
    await seedUpcomingAppointment(appointmentId, uid, '2030-06-01T10:00:00');
    await signIn(page, uid);

    await page.goto('/account/appointments');
    await expect(page.getByTestId('appointment-row')).toHaveAttribute(
      'data-status',
      'confirmed',
    );

    await page.getByTestId('appointment-cancel-trigger').click();
    await expect(page.getByTestId('appointment-cancel-sheet')).toHaveAttribute(
      'data-open',
      '',
    );

    await page.getByTestId('appointment-cancel-confirm').click();

    // The live observeUpcomingFor listener drops the now-terminal
    // appointment on its own — no manual UI removal.
    await expect(page.getByTestId('appointments-list')).toHaveAttribute(
      'data-state',
      'empty',
    );
    await expect(page.getByTestId('appointment-row')).toHaveCount(0);

    await expect
      .poll(() => readAppointmentStatusKind(appointmentId))
      .toBe('cancelled');
  });
});
