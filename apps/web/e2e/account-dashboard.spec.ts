import { expect, test } from '@playwright/test';
import {
  seedProfilePhoto,
  seedUpcomingAppointment,
  seedUserProfile,
} from './support/seed-firestore';
import { signInAs } from './support/sign-in';

/**
 * Goal 06.3 exit gate (docs/migration/goals/06-feature-slices.md) — the
 * account dashboard renders live from `AccountStateService`/
 * `observeUpcomingFor` against emulators. `signInAs` skips the real OTP
 * round-trip; `seed-firestore.ts` writes the `users/{uid}`/`appointments/{id}`
 * docs (and the profile photo) directly via the Admin SDK the way a completed
 * onboarding / booking would have.
 */
test.describe('account dashboard', () => {
  // The device on UTC+14, eleven hours ahead of the shop in summer: a visit
  // at 10:00 Sofia is 21:00 on this phone, so an hour read in the device's
  // zone instead of the shop's cannot pass for the right one.
  test.use({ timezoneId: 'Pacific/Kiritimati' });

  test('shows the honest empty state and an open profile-completion item for a fresh profile', async ({
    page,
  }) => {
    const uid = `e2e-account-empty-${test.info().testId}`;
    await seedUserProfile(uid, { birthDate: null });
    await signInAs(page, uid, ['client']);

    await page.goto('/account');
    await expect(page.getByTestId('account-page')).toHaveAttribute(
      'data-state',
      'ready',
    );
    await expect(page.getByTestId('account-tile-book')).toBeVisible();

    await expect(page.getByTestId('account-upcoming')).toHaveAttribute(
      'data-state',
      'empty',
    );
    await expect(page.getByTestId('account-upcoming-book-cta')).toBeVisible();

    await expect(page.getByTestId('account-page')).toHaveAttribute(
      'data-completion',
      'open',
    );
    await expect(
      page.getByTestId('account-completion-birthday'),
    ).toHaveAttribute('data-done', 'false');
  });

  test('shows the upcoming appointment once one is live and a complete profile', async ({
    page,
  }) => {
    const uid = `e2e-account-populated-${test.info().testId}`;
    await seedUserProfile(uid, { birthDate: '1990-05-05' });
    await seedProfilePhoto(uid);
    await seedUpcomingAppointment(`appt-${uid}`, uid, '2030-06-01T10:00:00');
    await signInAs(page, uid, ['client']);

    await page.goto('/account');
    // The next visit's state is the PAGE's (`data-upcoming` on the host,
    // C1-1): the card itself is the shared `lib-visit-card`'s button and
    // carries no state of its own once drawn; the waiting card keeps
    // `data-state` for its empty, loading and error states.
    await expect(page.getByTestId('account-page')).toHaveAttribute(
      'data-upcoming',
      'populated',
    );
    const upcoming = page.getByTestId('account-upcoming');
    await expect(upcoming).toBeVisible();
    // The visit as the shop booked it: its hour in shop time (the device
    // reads 21:00), and its status in words rather than the stored enum.
    await expect(upcoming).toContainText('10:00');
    await expect(upcoming).not.toContainText('21:00');
    await expect(page.getByTestId('account-upcoming-status')).toHaveText(
      /Потвърден|Confirmed/,
    );

    // Complete — birthday and photo both in — so the nudge card has left
    // (owner ruling 2026-07-27: a finished profile shows no card at all).
    await expect(page.getByTestId('account-page')).toHaveAttribute(
      'data-completion',
      'complete',
    );
    await expect(page.getByTestId('account-completion')).toHaveCount(0);
  });

  test('signing out returns to the marketing landing page', async ({
    page,
  }) => {
    const uid = `e2e-account-signout-${test.info().testId}`;
    await seedUserProfile(uid);
    await signInAs(page, uid, ['client']);

    await page.goto('/account');
    await expect(page.getByTestId('account-page')).toHaveAttribute(
      'data-state',
      'ready',
    );
    // Sign-out lives in the shared shell menu (one nav component app-wide),
    // behind the monogram trigger.
    await page.getByTestId('nav-menu-trigger').click();
    await page.getByTestId('menu-sign-out').click();
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });

    // Signed out, not merely sent home: the header offers the login again,
    // and the account is behind the auth gate.
    await expect(page.getByTestId('site-login-pill')).toBeVisible();
    await page.goto('/account');
    await expect(page).toHaveURL(/\/auth(\?|$)/);
  });
});
