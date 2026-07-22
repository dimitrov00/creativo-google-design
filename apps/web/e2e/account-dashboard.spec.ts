import { expect, test } from '@playwright/test';
import { mintCustomToken } from './support/mint-custom-token';
import {
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
 * Goal 06.3 exit gate (docs/migration/goals/06-feature-slices.md) — the
 * account dashboard renders live from `AccountStateService`/
 * `observeUpcomingFor` against emulators. `mintCustomToken` skips the real
 * OTP round-trip (`app-shell.spec.ts`'s pattern); `seed-firestore.ts`
 * writes the `users/{uid}`/`appointments/{id}` docs directly via the Admin
 * SDK the way a completed 6.2 onboarding / 6.5 booking would have.
 */
test.describe('account dashboard', () => {
  test('shows the honest empty state and an open profile-completion item for a fresh profile', async ({
    page,
  }) => {
    const uid = `e2e-account-empty-${test.info().testId}`;
    await seedUserProfile(uid, { birthDate: null });
    await signIn(page, uid);

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

    await expect(
      page.getByTestId('account-completion-birthday'),
    ).toHaveAttribute('data-done', 'false');
  });

  test('shows the upcoming appointment once one is live and a complete profile', async ({
    page,
  }) => {
    const uid = `e2e-account-populated-${test.info().testId}`;
    await seedUserProfile(uid, { birthDate: '1990-05-05' });
    await seedUpcomingAppointment(`appt-${uid}`, uid, '2030-06-01T10:00:00');
    await signIn(page, uid);

    await page.goto('/account');
    await expect(page.getByTestId('account-upcoming')).toHaveAttribute(
      'data-state',
      'populated',
    );
    await expect(page.getByTestId('account-completion')).toHaveAttribute(
      'data-state',
      'complete',
    );
  });

  test('signing out returns to the marketing landing page', async ({
    page,
  }) => {
    const uid = `e2e-account-signout-${test.info().testId}`;
    await seedUserProfile(uid);
    await signIn(page, uid);

    await page.goto('/account');
    await page.getByTestId('account-sign-out').click();
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
  });
});
