import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { EnvironmentProviders, Injectable } from '@angular/core';
import {
  Translation,
  TranslocoLoader,
  provideTransloco,
} from '@jsverse/transloco';
import { Observable, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANONYMOUS_PRINCIPAL,
  AUTH_DEPLOYMENT,
  AUTH_GATEWAY,
  AuthDeployment,
  DEFAULT_AUTH_DEPLOYMENT,
  OTP_CLIENT,
  OtpClientError,
  createAuthStrategy,
  fail,
  ok,
} from '@creativo/application/identity';
import { UiOtpField } from '@creativo/ui/controls';
import { ClientAuth } from './client-auth';

@Injectable()
class TestTranslationLoader implements TranslocoLoader {
  getTranslation(): Observable<Translation> {
    return of({});
  }
}

function provideTestI18n(): EnvironmentProviders[] {
  return provideTransloco({
    config: {
      availableLangs: ['bg', 'en'],
      defaultLang: 'bg',
      fallbackLang: 'bg',
      missingHandler: { logMissingKey: false },
    },
    loader: TestTranslationLoader,
  });
}

/** The phone_otp flavor of the deployment — exercises the phone branch of the strategy-driven identify screen (email_otp is the workspace default). */
function phoneDeployment(): AuthDeployment {
  const strategy = createAuthStrategy({
    kind: 'phone_otp',
    required: ['phone', 'firstName', 'lastName'],
    policy: { ttlMinutes: 5, maxAttempts: 5, sessionDays: 30 },
  });
  if (strategy.isFailure()) throw new Error('fixture strategy invalid');
  return { ...DEFAULT_AUTH_DEPLOYMENT, strategy: strategy.value };
}

describe('ClientAuth', () => {
  const requestChallenge = vi.fn();
  const verifyChallenge = vi.fn();
  let fixture: ComponentFixture<ClientAuth>;

  async function setup(deployment?: AuthDeployment): Promise<void> {
    requestChallenge.mockReset().mockResolvedValue(ok('challenge_1'));
    verifyChallenge
      .mockReset()
      .mockResolvedValue(ok({ kind: 'returning' as const }));

    await TestBed.configureTestingModule({
      imports: [ClientAuth],
      providers: [
        provideRouter([]),
        ...provideTestI18n(),
        ...(deployment
          ? [{ provide: AUTH_DEPLOYMENT, useValue: deployment }]
          : []),
        {
          provide: AUTH_GATEWAY,
          useValue: {
            observePrincipal: () => of(ANONYMOUS_PRINCIPAL),
            currentIdentifier: () => null,
            refreshToken: () => Promise.resolve(ok(undefined)),
            signOut: () => Promise.resolve(ok(undefined)),
          },
        },
        {
          provide: OTP_CLIENT,
          useValue: {
            requestChallenge,
            verifyChallenge,
            completeRegistration: () => Promise.resolve(ok(undefined)),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ClientAuth);
    await fixture.whenStable();
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  function host(): HTMLElement {
    return fixture.nativeElement;
  }

  function query<T extends HTMLElement>(testId: string): T | null {
    return host().querySelector<T>(`[data-testid="${testId}"]`);
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    // Store/component continuations (`afterSubmitCode`, `requestChallenge`)
    // are plain floating promises `whenStable` doesn't track — one macrotask
    // turn lets the immediately-resolving mocks settle through them.
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  }

  async function fillEmailAndSubmit(email = 'client@example.com') {
    const input = query<HTMLInputElement>('auth-identifier-input');
    if (!input) throw new Error('email input not rendered');
    input.value = email;
    input.dispatchEvent(new Event('input'));
    await settle();
    query<HTMLButtonElement>('auth-submit-identifier')?.click();
    await settle();
  }

  function emitCode(value: string): void {
    fixture.debugElement
      .query(By.directive(UiOtpField))
      .triggerEventHandler('valueChange', value);
    fixture.detectChanges();
  }

  /**
   * The accessible EXPLICIT verify path — there is no Verify button
   * (verification is automatic on the 6th digit); pressing Enter inside
   * the OTP field submits the current code immediately.
   */
  function pressEnterInOtpField(): void {
    fixture.debugElement
      .query(By.directive(UiOtpField))
      .nativeElement.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    fixture.detectChanges();
  }

  function slotValues(): string {
    return Array.from(
      host().querySelectorAll<HTMLInputElement>('.ui-otp-field__slot'),
    )
      .map((slot) => slot.value)
      .join('');
  }

  describe('email_otp deployment (the default)', () => {
    beforeEach(async () => {
      await setup();
    });

    it('opens directly on the identify step — the welcome interstitial is retired', () => {
      expect(query('auth-identify')).not.toBeNull();
      expect(query('auth-welcome')).toBeNull();
    });

    it('renders an email input with email autofill semantics', () => {
      const input = query<HTMLInputElement>('auth-identifier-input');
      expect(input).not.toBeNull();
      expect(input?.getAttribute('type')).toBe('email');
      expect(input?.getAttribute('autocomplete')).toBe('email');
      expect(input?.getAttribute('inputmode')).toBe('email');
    });

    it('shows the identifier error on blur, not per keystroke', async () => {
      const input = query<HTMLInputElement>('auth-identifier-input');
      if (!input) throw new Error('email input not rendered');
      input.value = 'not-an-email';
      input.dispatchEvent(new Event('input'));
      await settle();
      expect(query('auth-identifier-error')).toBeNull();

      input.dispatchEvent(new Event('blur'));
      await settle();
      expect(query('auth-identifier-error')).not.toBeNull();
      expect(query<HTMLButtonElement>('auth-submit-identifier')?.disabled).toBe(
        true,
      );
    });

    it('advances to the otp step, showing the destination — with no Verify button', async () => {
      await fillEmailAndSubmit();

      expect(query('auth-otp')).not.toBeNull();
      expect(query('auth-otp-destination')?.textContent).toContain(
        'client@example.com',
      );
      expect(requestChallenge).toHaveBeenCalledTimes(1);
      // Verification is automatic (owner ruling 2026-07-25) — the otp
      // screen ships no Verify button and no bottom action bar.
      expect(query('auth-submit-code')).toBeNull();
      expect(host().querySelector('.ui-page-action-bar')).toBeNull();
    });

    it('clears the digits when the code is wrong and hides the error once typing resumes', async () => {
      verifyChallenge.mockResolvedValue(
        fail(
          new OtpClientError('wrong', false, undefined, 'otp_incorrect_code'),
        ),
      );
      await fillEmailAndSubmit();

      emitCode('123456');
      // Explicit Enter path — independent of the auto-verify timer.
      pressEnterInOtpField();
      await settle();

      // Owner ruling 2026-07-25: with auto-verify and no button, every
      // failed verify clears the field — retyping beats in-place editing.
      expect(query('auth-verify-error')).not.toBeNull();
      expect(slotValues()).toBe('');

      // Typing again dismisses the error.
      emitCode('1');
      await settle();
      expect(query('auth-verify-error')).toBeNull();
    });

    it('clears the digits when the code is expired — a genuinely new code is coming', async () => {
      verifyChallenge.mockResolvedValue(
        fail(new OtpClientError('expired', false, undefined, 'otp_expired')),
      );
      await fillEmailAndSubmit();

      emitCode('123456');
      pressEnterInOtpField();
      await settle();

      expect(query('auth-verify-error')).not.toBeNull();
      expect(slotValues()).toBe('');
    });

    it('auto-verifies ~250ms after the 6th digit with a visible checking state', async () => {
      // A failing verify keeps the flow on-page (no navigation continuation
      // to race the test) — the assertion is WHEN the call happens.
      verifyChallenge.mockResolvedValue(
        fail(
          new OtpClientError('wrong', false, undefined, 'otp_incorrect_code'),
        ),
      );
      await fillEmailAndSubmit();

      vi.useFakeTimers();
      emitCode('123456');

      // Micro-delay pending: nothing sent yet, but the checking state is
      // already visible — the inline progress row shows and the field is
      // locked (the loading Verify button this replaced is gone).
      expect(verifyChallenge).not.toHaveBeenCalled();
      expect(query('auth-otp-checking')).not.toBeNull();
      expect(
        host().querySelector<HTMLInputElement>('.ui-otp-field__slot')?.disabled,
      ).toBe(true);

      await vi.advanceTimersByTimeAsync(250);
      expect(verifyChallenge).toHaveBeenCalledTimes(1);
    });

    it('suppresses auto-verify while a previous error is displayed, until the user edits', async () => {
      verifyChallenge.mockResolvedValue(
        fail(
          new OtpClientError('wrong', false, undefined, 'otp_incorrect_code'),
        ),
      );
      await fillEmailAndSubmit();

      emitCode('123456');
      pressEnterInOtpField();
      await settle();
      expect(verifyChallenge).toHaveBeenCalledTimes(1);
      expect(query('auth-verify-error')).not.toBeNull();

      // Digits are kept and no edit happens — time alone must never
      // re-submit the same wrong code.
      vi.useFakeTimers();
      await vi.advanceTimersByTimeAsync(2000);
      expect(verifyChallenge).toHaveBeenCalledTimes(1);

      // Correcting the code re-arms the delayed auto-verify.
      emitCode('123457');
      await vi.advanceTimersByTimeAsync(250);
      expect(verifyChallenge).toHaveBeenCalledTimes(2);
    });

    it('returns to identify with the field pre-filled on change identifier', async () => {
      await fillEmailAndSubmit();
      expect(query('auth-otp')).not.toBeNull();

      query<HTMLButtonElement>('auth-back')?.click();
      await settle();

      expect(query('auth-identify')).not.toBeNull();
      expect(query<HTMLInputElement>('auth-identifier-input')?.value).toBe(
        'client@example.com',
      );
    });

    it('shows the resend cooldown after the first send — as quiet text, not a dead control', async () => {
      await fillEmailAndSubmit();

      expect(query('auth-resend')).toBeNull();
      const cooldown = query('auth-resend-cooldown');
      expect(cooldown).not.toBeNull();
      // The ticking countdown is informational caption text (owner ruling
      // 2026-07-25), no longer a disabled button.
      expect(cooldown?.tagName).toBe('P');
    });
  });

  describe('phone_otp deployment', () => {
    beforeEach(async () => {
      await setup(phoneDeployment());
    });

    it('renders the composite phone field on identify', () => {
      expect(query('auth-identifier-field')).not.toBeNull();
      expect(query('auth-identifier-input')).toBeNull();
      const input = query<HTMLInputElement>('phone-field-input');
      expect(input).not.toBeNull();
      expect(input?.getAttribute('type')).toBe('tel');
    });
  });
});
