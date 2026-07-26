import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoService, TranslocoDirective } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { filter } from 'rxjs/operators';
import {
  AUTH_DEPLOYMENT,
  AUTH_GATEWAY,
  RedirectPath,
  Settled,
  classify,
  identifierKindForStrategy,
  latchSettledPrincipal,
} from '@creativo/application/identity';
import { OtpCode, createIdentifier } from '@creativo/application/identity';
import {
  UiButton,
  UiIcon,
  UiOtpField,
  UiPhoneField,
  UiProgressView,
  UiTextField,
} from '@creativo/ui/controls';
import { UiSpacer, UiStack, UiToolbar } from '@creativo/ui/layout';
import {
  UiPageActionBar,
  UiSectionHeader,
  UiStepper,
} from '@creativo/ui/patterns';
import {
  UiFrameDirective,
  UiLinkDirective,
  UiPaddingDirective,
  UiRevealDirective,
  UiTextDirective,
  UiVisuallyHiddenDirective,
} from '@creativo/ui/modifiers';
import { translateDomainError } from '@creativo/infrastructure/i18n';
import { AuthFlowStore } from '../auth-flow.store';

/**
 * Auto-verify micro-delay (uxResearch: 100–300 ms) — long enough for the
 * user to see the visible "checking" state and catch a mistyped final
 * digit, short enough to feel instant. Verification is EXCLUSIVELY
 * automatic (owner ruling 2026-07-25: no Verify button); the accessible
 * explicit path is Enter inside the OTP field, bound in the template.
 */
const AUTO_VERIFY_DELAY_MS = 250;

/** One piece of the legal sentence — plain text or an inline link slot. */
interface LegalPart {
  readonly kind: 'text' | 'terms' | 'privacy';
  readonly text: string;
}

/**
 * `/auth` — identify → otp, `AuthFlowStore`-driven (blueprint §5.3, design
 * doc §2.1–2.4). One route, one in-page state machine; the welcome
 * interstitial is retired (design §1.5). No route guard (v2 deliberately
 * lets a user become authed mid-flow); this component's own
 * `classify`/`latchSettledPrincipal` latch decides whether to render the
 * flow or bounce an already-settled visitor — freezing the FIRST verdict
 * so a token refresh mid-flow never yanks them out from under themselves
 * (see `guest-guard.ts`'s own docs).
 *
 * No popstate listener anywhere here — back-navigation between steps is
 * the flow's own explicit `change_identifier` event, dispatched from an
 * in-page control, never the browser's history API.
 *
 * Strategy-driven: the identify input is a `ui-phone-field` or an email
 * `uiTextField` depending on `identifierKindForStrategy(deployment
 * .strategy)` — flipping phone↔email OTP is composition-root config, not
 * an edit here. Anti-enumeration: nothing in this flow ever reveals
 * whether an identifier has an account — a valid identifier always
 * advances to the code step.
 */
@Component({
  selector: 'lib-client-auth',
  imports: [
    TranslocoDirective,
    UiButton,
    UiFrameDirective,
    UiIcon,
    UiLinkDirective,
    UiOtpField,
    UiPageActionBar,
    UiPhoneField,
    UiProgressView,
    UiRevealDirective,
    UiSectionHeader,
    UiStepper,
    UiTextField,
    UiToolbar,
    UiPaddingDirective,
    UiSpacer,
    UiStack,
    UiTextDirective,
    UiVisuallyHiddenDirective,
  ],
  providers: [AuthFlowStore],
  templateUrl: './client-auth.html',
  styleUrl: './client-auth.css',
  host: {
    'data-testid': 'auth-page',
    '[attr.data-state]': 'store.state().kind',
  },
})
export class ClientAuth {
  private readonly authGateway = inject(AUTH_GATEWAY);
  private readonly deployment = inject(AUTH_DEPLOYMENT);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);

  protected readonly store = inject(AuthFlowStore);

  /** Country names in the picker follow the active UI language, not LOCALE_ID. */
  protected readonly activeLang = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang(),
  });

  private readonly principal = toSignal(this.authGateway.observePrincipal(), {
    initialValue: null,
  });
  private readonly liveSettled = computed<Settled>(() =>
    classify(this.principal()),
  );
  private readonly latched = signal<Exclude<Settled, 'loading'> | null>(null);

  private readonly redirect = computed(() =>
    RedirectPath.parseOrRoot(this.route.snapshot.queryParamMap.get('redirect')),
  );
  /** A booking (or any deep-link) hand-off — swaps the identify lede for the contextual "hold your slot" benefit line. */
  protected readonly hasRedirect = computed(
    () => this.route.snapshot.queryParamMap.get('redirect') !== null,
  );

  /** Phone-vs-email is the deployment's call — `identifierKindForStrategy` is total over every `AuthStrategy` variant. */
  protected readonly identifierKind = identifierKindForStrategy(
    this.deployment.strategy,
  );
  protected readonly defaultCountry = this.deployment.defaultCountry;

  /* ── Identify step ────────────────────────────────────────────────
     Both input signals survive the otp step (the component lives across
     the whole flow), so returning via change_identifier finds the field
     PRE-FILLED — no re-typing to fix a typo (design §2.2). */

  /** Raw email text (email deployments). */
  protected readonly rawIdentifier = signal('');
  /** Canonical E.164 from `ui-phone-field` — null while the draft is invalid (phone deployments). */
  protected readonly phoneValue = signal<string | null>(null);
  /** Domain-error code shown under the field — set on blur/submit, cleared live once the input turns valid (reward early, punish late). */
  protected readonly identifierErrorCode = signal<string | null>(null);

  protected readonly identifierResult = computed(() => {
    if (this.identifierKind === 'phone') {
      const value = this.phoneValue();
      if (!value) return null;
      return createIdentifier({ kind: 'phone', value }, this.defaultCountry);
    }
    const raw = this.rawIdentifier().trim();
    if (!raw) return null;
    return createIdentifier({ kind: 'email', value: raw });
  });

  /* ── OTP step ───────────────────────────────────────────────────── */

  protected readonly rawCode = signal('');
  /** True during the auto-verify micro-delay — the visible "checking" state (field locked + inline progress row; there is no Verify button). */
  protected readonly checking = signal(false);
  /** Whether the last verify failure is still displayed — auto-verify stays suppressed until the user edits. */
  protected readonly otpErrorVisible = signal(false);
  private autoVerifyTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly verifying = computed(
    () => this.checking() || this.store.pending(),
  );
  /** The address the code went to, rendered semibold in the lede. */
  protected readonly otpDestination = computed(() => {
    const state = this.store.state();
    return state.kind === 'otp' ? state.identifier.value.toString() : '';
  });
  /**
   * Sparse `aria-live` countdown announcements (design §2.2: at 30/10/0,
   * never every tick) — the ticking button label itself is not live.
   */
  protected readonly resendAnnouncement = computed(() => {
    const seconds = this.store.resendSecondsLeft();
    if (seconds === 30 || seconds === 10) {
      return this.transloco.translate('auth.code.resendIn', { seconds });
    }
    if (seconds === 0 && this.store.sendCount() > 0) {
      return this.transloco.translate('auth.code.resendReady');
    }
    return '';
  });

  constructor() {
    effect(() => {
      this.latched.set(
        latchSettledPrincipal(this.latched(), this.liveSettled()),
      );
    });

    effect(() => {
      const settled = this.latched();
      if (settled === 'active') {
        void this.router.navigateByUrl(this.redirect().authDestination().value);
      } else if (settled === 'onboarding') {
        void this.router.navigate(['/onboarding'], {
          queryParams: { redirect: this.redirect().value },
        });
      }
    });

    // Reward early: the moment the identifier turns valid, the punishing
    // copy goes away (errors themselves only ever appear on blur/submit).
    effect(() => {
      if (this.identifierResult()?.isSuccess()) {
        this.identifierErrorCode.set(null);
      }
    });
  }

  protected translateError(code: string | undefined | null): string | null {
    if (!code) return null;
    return translateDomainError(this.transloco, { code });
  }

  /**
   * Splits the translated legal sentence on its `{terms}`/`{privacy}` slots
   * so the template can render REAL inline links inside the sentence (the
   * word order stays the locale's own — no concatenation). Single-brace
   * slots pass through Transloco untouched (its interpolation is `{{ }}`).
   */
  protected legalParts(sentence: string): readonly LegalPart[] {
    return sentence
      .split(/(\{terms\}|\{privacy\})/)
      .filter((piece) => piece !== '')
      .map((piece): LegalPart => {
        if (piece === '{terms}') return { kind: 'terms', text: '' };
        if (piece === '{privacy}') return { kind: 'privacy', text: '' };
        return { kind: 'text', text: piece };
      });
  }

  protected currentError(): string | undefined {
    const state = this.store.state();
    return state.kind === 'identify' ? state.error : undefined;
  }

  /** The otp step's error line — verify failures render only until the user edits (`otpErrorVisible`). */
  protected otpError(): string | undefined {
    const state = this.store.state();
    return state.kind === 'otp' && this.otpErrorVisible()
      ? state.error
      : undefined;
  }

  /* ── Identify step ──────────────────────────────────────────────── */

  protected onEmailInput(value: string): void {
    this.rawIdentifier.set(value);
  }

  protected onEmailBlur(): void {
    const raw = this.rawIdentifier().trim();
    if (!raw) return;
    const result = createIdentifier({ kind: 'email', value: raw });
    if (result.isFailure()) {
      this.identifierErrorCode.set(result.error.code);
    }
  }

  /** `ui-phone-field` validate-on-blur — its `value` model is already null whenever the draft is invalid. */
  protected onPhoneBlur(fieldText: string): void {
    if (fieldText.trim() !== '' && this.phoneValue() === null) {
      this.identifierErrorCode.set('identity.identifier.invalid');
    }
  }

  protected submitIdentifier(): void {
    const result = this.identifierResult();
    if (!result || result.isFailure()) {
      // Validate on submit (not per keystroke — design §2.1 trust note).
      this.identifierErrorCode.set(
        result?.isFailure() ? result.error.code : 'identity.identifier.invalid',
      );
      return;
    }
    this.identifierErrorCode.set(null);
    void this.store.submitIdentifier(result.value);
  }

  /* ── OTP step ───────────────────────────────────────────────────── */

  protected onCodeChange(value: string): void {
    this.rawCode.set(value);
    // Any edit dismisses a displayed failure — the user is correcting.
    this.otpErrorVisible.set(false);
    this.cancelAutoVerify();
    // Delayed auto-verify on the 6th digit with a VISIBLE checking state
    // (uxResearch: instant submit prevents catching a mistyped digit).
    // A failed verify clears the field, so a stale code can never sit at
    // 6 digits and auto-resubmit itself.
    if (value.length === this.otpLength && !this.store.pending()) {
      this.checking.set(true);
      this.autoVerifyTimer = setTimeout(() => {
        this.autoVerifyTimer = null;
        this.submitCode();
      }, AUTO_VERIFY_DELAY_MS);
    }
  }

  protected readonly otpLength = 6;

  protected codeErrorMessage(): string | null {
    const raw = this.rawCode();
    if (raw.length < this.otpLength) return null;
    const result = OtpCode.create(raw);
    return result.isSuccess()
      ? null
      : translateDomainError(this.transloco, { code: result.error.code });
  }

  protected submitCode(): void {
    this.cancelAutoVerify();
    const result = OtpCode.create(this.rawCode());
    if (result.isFailure()) return;
    void this.afterSubmitCode(result.value.value);
  }

  protected changeIdentifier(): void {
    this.cancelAutoVerify();
    this.rawCode.set('');
    this.otpErrorVisible.set(false);
    this.store.changeIdentifier();
  }

  protected resend(): void {
    this.cancelAutoVerify();
    // A resend is a genuinely NEW code — the old digits are dead weight
    // (the only case besides expiry where the field is cleared).
    this.rawCode.set('');
    this.otpErrorVisible.set(false);
    void this.store.resend();
  }

  protected goHome(): void {
    void this.router.navigateByUrl('/');
  }

  private cancelAutoVerify(): void {
    if (this.autoVerifyTimer !== null) {
      clearTimeout(this.autoVerifyTimer);
      this.autoVerifyTimer = null;
    }
    this.checking.set(false);
  }

  /**
   * Awaits the verify round-trip directly (rather than reacting to
   * `AuthFlowStore.state()` via `effect()`) and only then navigates —
   * driving the terminal redirect from an explicit async continuation
   * sidesteps a real interaction between zoneless effect scheduling and
   * Angular Router's `withViewTransitions()`: an effect-triggered
   * `navigate()` here was observed to resolve `true` and update
   * `Router.url`, yet never actually commit the browser's address bar.
   *
   * Also waits for `AUTH_GATEWAY.observePrincipal()` to actually reflect
   * the sign-in before navigating to `/onboarding` — `signInWithCustomToken()`
   * resolving does not guarantee Firebase's `onIdTokenChanged` listener has
   * fired yet, and navigating too early races `anonGuard` (it would read a
   * still-`anonymous` principal and bounce straight back to `/auth`).
   */
  private async afterSubmitCode(rawCode: string): Promise<void> {
    const session = await this.store.submitCode(rawCode);
    if (!session) {
      this.checking.set(false);
      const state = this.store.state();
      if (state.kind === 'otp' && state.error) {
        this.otpErrorVisible.set(true);
        // Every failed verify CLEARS the field (owner ruling 2026-07-25):
        // with auto-verify and no button, retyping a fresh code beats
        // editing a wrong one in place — the native iOS loop. The error
        // line stays until the user starts typing again.
        this.rawCode.set('');
      }
      return;
    }

    await firstValueFrom(
      this.authGateway
        .observePrincipal()
        .pipe(filter((principal) => principal.kind !== 'anonymous')),
    );

    if (session.kind === 'returning') {
      await this.router.navigateByUrl(this.redirect().authDestination().value);
    } else {
      await this.router.navigate(['/onboarding'], {
        queryParams: { redirect: this.redirect().value },
      });
    }
  }
}
