import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __e2eLastOtpCode?: string;
  }
}

/**
 * Goal 06.2 exit gate (docs/migration/goals/06-feature-slices.md), on the
 * adopted email-OTP deployment — email sign-in and onboarding (which now
 * COLLECTS the phone via `ui-phone-field`) end-to-end against Firebase
 * emulators and the ported `requestOtpChallenge`/`verifyOtpChallenge`/
 * `completeRegistration` callables (`pnpm run e2e:web` builds+serves
 * `apps/functions` into the functions emulator first). Emails are unique
 * per test to dodge the 1-minute resend rate limit between tests; each
 * `emulators:exec` run starts from an empty store, so a deterministic
 * per-test address never collides with a previous run's registration.
 */
function fakeEmail(testId: string): string {
  const suffix = Math.abs(hashCode(testId)) % 10_000;
  return `e2e-client-${suffix}@example.com`;
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

async function identifyWithEmail(page: Page, email: string): Promise<void> {
  await expect(page.getByTestId('auth-identify')).toBeVisible();
  await page.getByTestId('auth-identifier-input').fill(email);
  await page.getByTestId('auth-submit-identifier').click();
  await expect(page.getByTestId('auth-otp')).toBeVisible();
}

/**
 * Drives the composite phone field the way a Bulgarian user would: opens
 * the country picker, confirms Bulgaria (the deployment default, so this
 * also proves the listbox actually opens/selects/closes), then types the
 * national number — `formatPhoneDraft` turns it into E.164 under BG.
 */
async function fillOnboardingPhone(page: Page): Promise<void> {
  await page.getByTestId('phone-field-trigger').click();
  await page.getByTestId('phone-field-option-BG').click();
  const input = page.getByTestId('phone-field-input');
  await input.click();
  await input.fill('0888123456');
  await input.blur();
}

test.describe('auth + onboarding (email OTP)', () => {
  test('a new email walks identify → otp → onboarding (names + phone) → /account', async ({
    page,
  }) => {
    const email = fakeEmail(test.info().testId);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/auth');

    // The flow opens directly on identify — the welcome step is retired
    // (auth-flow design §1.5). Email deployment → plain email input.
    await identifyWithEmail(page, email);
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

    // The email identifier can't satisfy the strategy's phone requirement —
    // Continue stays disabled until the collected phone draft is valid.
    await expect(page.getByTestId('onboarding-submit-about')).toBeDisabled();
    await fillOnboardingPhone(page);
    await expect(page.getByTestId('onboarding-submit-about')).toBeEnabled();
    await page.getByTestId('onboarding-submit-about').click();

    await expect(page.getByTestId('onboarding-reward')).toBeVisible();
    await page.getByTestId('onboarding-enter-app').click();

    await expect(page).toHaveURL(/\/account$/, { timeout: 15_000 });
  });

  test('a returning (already-registered) email skips onboarding entirely', async ({
    page,
    browser,
  }) => {
    const email = fakeEmail(`${test.info().testId}-returning`);

    // First pass: register.
    await page.goto('/auth');
    await identifyWithEmail(page, email);
    const firstCode = await readDevOtpCode(page);
    await enterOtpCode(page, firstCode);
    await expect(page.getByTestId('onboarding-about')).toBeVisible({
      timeout: 10_000,
    });
    await page.getByTestId('onboarding-first-name').fill('Grace');
    await page.getByTestId('onboarding-last-name').fill('Hopper');
    await fillOnboardingPhone(page);
    await page.getByTestId('onboarding-submit-about').click();
    await page.getByTestId('onboarding-enter-app').click();
    await expect(page).toHaveURL(/\/account$/, { timeout: 15_000 });

    // Second pass, fresh session: the same email should now be a
    // "returning" session and skip onboarding entirely. A genuinely fresh
    // browser context (not just cleared cookies/localStorage) — Firebase
    // Auth persists its session in IndexedDB, which clearing cookies never
    // touches, so the first pass's sign-in would otherwise still be live.
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    try {
      await freshPage.goto('/auth');
      await identifyWithEmail(freshPage, email);
      const secondCode = await readDevOtpCode(freshPage);
      await enterOtpCode(freshPage, secondCode);

      await expect(freshPage).toHaveURL(/\/account$/, { timeout: 15_000 });
    } finally {
      await freshContext.close();
    }
  });

  test('an invalid email shows an inline domain error on blur', async ({
    page,
  }) => {
    await page.goto('/auth');
    await expect(page.getByTestId('auth-identify')).toBeVisible();
    // Errors surface on blur, never per keystroke (design §2.1) — a field
    // punished while typing reads as hostile.
    await page.getByTestId('auth-identifier-input').fill('not-an-email');
    await page.getByTestId('auth-identifier-input').blur();
    await expect(page.getByTestId('auth-identifier-error')).toBeVisible();
    await expect(page.getByTestId('auth-submit-identifier')).toBeDisabled();
  });

  test('an incorrect OTP code shows an inline domain error', async ({
    page,
  }) => {
    const email = fakeEmail(`${test.info().testId}-wrong-code`);

    await page.goto('/auth');
    await identifyWithEmail(page, email);
    // Ensure the real code is issued (and thus never accidentally matches)
    // before trying a wrong one.
    await readDevOtpCode(page);

    await enterOtpCode(page, '000000');
    await expect(page.getByTestId('auth-verify-error')).toBeVisible();
  });
});
