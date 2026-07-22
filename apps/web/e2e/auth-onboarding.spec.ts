import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __e2eLastOtpCode?: string;
  }
}

/**
 * Goal 06.2 exit gate (docs/migration/goals/06-feature-slices.md) — phone-OTP
 * sign-in and onboarding end-to-end against Firebase emulators and the
 * ported `requestOtpChallenge`/`verifyOtpChallenge`/`completeRegistration`
 * callables (`pnpm run e2e:web` builds+serves `apps/functions` into the
 * functions emulator first). `+141555501XX` is NANP's reserved fictional
 * "directory assistance" block — a real, format-valid number
 * `libphonenumber-js` accepts, unique per test to dodge the 1-minute
 * resend rate limit between runs.
 */
function fakePhone(testId: string): string {
  const suffix = Math.abs(hashCode(testId)) % 100;
  return `+141555501${String(suffix).padStart(2, '0')}`;
}

function hashCode(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

async function readDevOtpCode(page: Page): Promise<string> {
  await page.waitForFunction(() => typeof window.__e2eLastOtpCode === 'string');
  const code = await page.evaluate(() => window.__e2eLastOtpCode);
  if (!code) throw new Error('E2E OTP dev code was never set');
  return code;
}

async function enterOtpCode(page: Page, code: string): Promise<void> {
  const slots = page.locator('[data-testid="auth-otp"] .ui-otp-field__slot');
  await slots.first().click();
  await page.keyboard.type(code);
}

test.describe('auth + onboarding', () => {
  test('a new phone number walks welcome → identify → otp → onboarding → /account', async ({
    page,
  }) => {
    const phone = fakePhone(test.info().testId);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/auth');
    await expect(page.getByTestId('auth-welcome')).toBeVisible();
    await page.getByTestId('auth-get-started').click();

    await expect(page.getByTestId('auth-identify')).toBeVisible();
    await page.getByTestId('auth-identifier-input').fill(phone);
    await page.getByTestId('auth-submit-identifier').click();

    await expect(page.getByTestId('auth-otp')).toBeVisible();
    const code = await readDevOtpCode(page);
    await enterOtpCode(page, code);

    // New identifier → RegisterUserUseCase/onboarding, not straight to
    // /account. Generous timeout: the redirect waits on Firebase Auth's
    // own `onIdTokenChanged` listener to actually reflect the just-completed
    // `signInWithCustomToken()` (a real, non-instant round trip even
    // against the emulator) before it's safe to navigate past `anonGuard`.
    await expect(page).toHaveURL(/\/onboarding/, { timeout: 10_000 });
    await expect(page.getByTestId('onboarding-about')).toBeVisible();

    await page.getByTestId('onboarding-first-name').fill('Ada');
    await page.getByTestId('onboarding-last-name').fill('Lovelace');
    await page.getByTestId('onboarding-submit-about').click();

    await expect(page.getByTestId('onboarding-reward')).toBeVisible();
    await page.getByTestId('onboarding-enter-app').click();

    await expect(page).toHaveURL(/\/account$/, { timeout: 15_000 });
  });

  test('a returning (already-registered) phone number skips onboarding entirely', async ({
    page,
    browser,
  }) => {
    const phone = fakePhone(`${test.info().testId}-returning`);

    // First pass: register.
    await page.goto('/auth');
    await page.getByTestId('auth-get-started').click();
    await page.getByTestId('auth-identifier-input').fill(phone);
    await page.getByTestId('auth-submit-identifier').click();
    const firstCode = await readDevOtpCode(page);
    await enterOtpCode(page, firstCode);
    await expect(page.getByTestId('onboarding-about')).toBeVisible({
      timeout: 10_000,
    });
    await page.getByTestId('onboarding-first-name').fill('Grace');
    await page.getByTestId('onboarding-last-name').fill('Hopper');
    await page.getByTestId('onboarding-submit-about').click();
    await page.getByTestId('onboarding-enter-app').click();
    await expect(page).toHaveURL(/\/account$/, { timeout: 15_000 });

    // Second pass, fresh session: same phone number should now be a
    // "returning" session and skip onboarding entirely. A genuinely fresh
    // browser context (not just cleared cookies/localStorage) — Firebase
    // Auth persists its session in IndexedDB, which clearing cookies never
    // touches, so the first pass's sign-in would otherwise still be live.
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    try {
      await freshPage.goto('/auth');
      await freshPage.getByTestId('auth-get-started').click();
      await freshPage.getByTestId('auth-identifier-input').fill(phone);
      await freshPage.getByTestId('auth-submit-identifier').click();
      const secondCode = await readDevOtpCode(freshPage);
      await enterOtpCode(freshPage, secondCode);

      await expect(freshPage).toHaveURL(/\/account$/, { timeout: 15_000 });
    } finally {
      await freshContext.close();
    }
  });

  test('an invalid phone number shows an inline domain error', async ({
    page,
  }) => {
    await page.goto('/auth');
    await page.getByTestId('auth-get-started').click();
    await page.getByTestId('auth-identifier-input').fill('not-a-phone');
    await expect(page.getByTestId('auth-identifier-error')).toBeVisible();
    await expect(page.getByTestId('auth-submit-identifier')).toBeDisabled();
  });

  test('an incorrect OTP code shows an inline domain error', async ({
    page,
  }) => {
    const phone = fakePhone(`${test.info().testId}-wrong-code`);

    await page.goto('/auth');
    await page.getByTestId('auth-get-started').click();
    await page.getByTestId('auth-identifier-input').fill(phone);
    await page.getByTestId('auth-submit-identifier').click();
    await expect(page.getByTestId('auth-otp')).toBeVisible();
    // Ensure the real code is issued (and thus never accidentally matches)
    // before trying a wrong one.
    await readDevOtpCode(page);

    await enterOtpCode(page, '000000');
    await expect(page.getByTestId('auth-verify-error')).toBeVisible();
  });
});
