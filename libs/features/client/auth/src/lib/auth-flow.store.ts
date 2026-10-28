import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  AuthFlowEvent,
  AuthFlowState,
  AuthFlowStep,
  OtpCode,
  ParsedIdentifier,
  type SessionKind,
} from '@core/components';
import { type OtpId } from '@core/primitives';
import { IdentityError, IdentityErrorCode, PipelineError } from '@core/errors';
import { AuthFlowSystem, OtpLimits, OtpSystem } from '@core/systems';
import { OTP_CHALLENGE_PORTS } from '@creativo/infrastructure/firebase-app';

/**
 * The seconds a throttled send says are left on the destination's resend
 * window — the refusal's `retryAfterSeconds`, as the wire's allowlisted
 * context carried it (OR-9). A refusal that names no whole positive figure
 * waits out the whole window: the server's window is never longer.
 */
function retryAfterSecondsOf(error: PipelineError): number {
  const seconds = error.serverParams['retryAfterSeconds'];
  return typeof seconds === 'number' && Number.isInteger(seconds) && seconds > 0
    ? seconds
    : OtpLimits.ResendWindowSeconds;
}

/**
 * Wraps `AuthFlowSystem.next` (pure, blueprint §5.3) with the async OTP
 * round-trip and the challenge-id side channel the pure state doesn't
 * model. One instance per `/auth` visit — provided component-scoped on
 * `ClientAuth`, not root, so re-navigating to `/auth` always starts fresh.
 *
 * Also owns the PRESENTATIONAL trust mechanics the machine deliberately
 * doesn't (design §3.3): the resend countdown ticker and the per-flow send
 * counter. The countdown runs the server's own resend window
 * (`OtpLimits.ResendWindowSeconds`, 60 s — owner ruling OR-9), so the
 * button never re-enables while the server would still refuse; a resend
 * the server throttles anyway restarts the countdown at the seconds it
 * says are left, with no error. `OtpSystem.escalates` reads the send count
 * for the escalation footnote (OR-10). Both reset only when a DIFFERENT
 * identifier is submitted — a new destination is a new attempt. Merely
 * stepping back to identify keeps the outstanding challenge (and its
 * ticking countdown) alive, so resubmitting the same destination rejoins
 * the otp step without burning a second code.
 *
 * Translation-free by design: `state().error` carries the refusal as its
 * struct (`AuthFailure`, pass D §2.11) — the failed callable's
 * `PipelineError` as the gateway answered it (never a firebase import
 * here), or the identity refusal the store raised itself — not a display
 * string; the component words it at render time (`wordFlowFailure`: the
 * server's code, else `IDENTITY_CALL_FAILED`). A failure on the
 * `permission-denied` wire status is the lockout (`PipelineError.isBlocked`).
 */
@Injectable()
export class AuthFlowStore {
  private readonly otp = inject(OTP_CHALLENGE_PORTS);

  private readonly _state = signal<AuthFlowState>(AuthFlowState.initial());
  readonly state = this._state.asReadonly();

  private readonly _pending = signal(false);
  /** True while a request/verify round-trip is in flight — presentational only, not modeled in `AuthFlowState`. */
  readonly pending = this._pending.asReadonly();

  private readonly _resendSecondsLeft = signal(0);
  /** Countdown until "Resend code" re-enables — 0 means resend is available. */
  readonly resendSecondsLeft = this._resendSecondsLeft.asReadonly();
  readonly canResend = computed(() => this._resendSecondsLeft() === 0);

  private readonly _sendCount = signal(0);
  /** Codes sent for the CURRENT identifier (initial send included). */
  readonly sendCount = this._sendCount.asReadonly();
  /** Whether the code step adds the escalation footnote — `OtpSystem.escalates` of the send count (OR-10). */
  readonly escalated = computed(() => OtpSystem.escalates(this._sendCount()));

  private challengeId: OtpId | null = null;
  /** The destination the outstanding challenge was issued for — the key `holdsChallengeFor` matches against. */
  private challengeIdentifier: ParsedIdentifier | null = null;
  private cooldownTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopCooldown());
  }

  changeIdentifier(): void {
    // Deliberately does NOT discard the challenge or the cooldown/send
    // counters: an accidental back must not strand the code already in the
    // user's inbox (the server would throttle an immediate re-request
    // anyway). Reset happens in `submitIdentifier`, only for a genuinely
    // new destination.
    this.dispatch(AuthFlowEvent.changeIdentifier());
  }

  /** `identifier` is already parsed — the identify step's own template binds raw input through `ParsedIdentifier.parse` (blueprint §5.1), never through this store. */
  async submitIdentifier(identifier: ParsedIdentifier): Promise<void> {
    if (this.holdsChallengeFor(identifier)) {
      // Same destination, live challenge — rejoin the otp step exactly
      // where it left off (cooldown still ticking, send count intact);
      // the code already delivered still verifies.
      this.dispatch(AuthFlowEvent.submitIdentifier(identifier));
      return;
    }

    this.challengeId = null;
    this.challengeIdentifier = null;
    this.stopCooldown();
    this._resendSecondsLeft.set(0);
    this._sendCount.set(0);
    this.dispatch(AuthFlowEvent.submitIdentifier(identifier));
    await this.requestChallenge(identifier);
  }

  async resend(): Promise<void> {
    const state = this._state();
    if (
      state.authFlowStep !== AuthFlowStep.Otp ||
      !this.canResend() ||
      this._pending()
    ) {
      return;
    }
    this.dispatch(AuthFlowEvent.resendOtp());
    await this.requestChallenge(state.identifier);
  }

  async submitCode(rawCode: string): Promise<SessionKind | null> {
    const state = this._state();
    if (state.authFlowStep !== AuthFlowStep.Otp || !this.challengeId) {
      return null;
    }

    this.dispatch(AuthFlowEvent.submitOtp());
    const code = OtpCode.parse(rawCode);
    if (!code.ok) {
      // A code that is not six digits never reaches the server — refused
      // as a wrong code, exactly as the verify use case did.
      this.dispatch(
        AuthFlowEvent.verifyFailed(false, IdentityError.otpWrongCode()),
      );
      return null;
    }
    this._pending.set(true);
    const result = await this.otp.verifyOtpChallenge(
      this.challengeId,
      code.value,
    );
    this._pending.set(false);

    if (!result.ok) {
      this.dispatch(
        AuthFlowEvent.verifyFailed(
          PipelineError.isBlocked(result.error),
          result.error,
        ),
      );
      return null;
    }

    this.dispatch(AuthFlowEvent.verified(result.value));
    return result.value;
  }

  private async requestChallenge(identifier: ParsedIdentifier): Promise<void> {
    this._pending.set(true);
    const result = await this.otp.requestOtpChallenge(identifier);
    this._pending.set(false);

    if (!result.ok) {
      if (
        result.error.serverErrorCode === IdentityErrorCode.OtpRateLimited &&
        this.holdsChallengeFor(identifier)
      ) {
        // The destination's window is still open on the server (another
        // tab asked for a code meanwhile): the code already sent still
        // verifies, so stay on the code step and count down what the
        // server says is left — a countdown, not an error (OR-9, DEP-F8).
        this.startCooldown(retryAfterSecondsOf(result.error));
        return;
      }
      // Any other failure — a throttled send with no live challenge here
      // (a reload of /auth) included: back to identify with the refusal,
      // whose `retryAfterSeconds` the line words.
      this.dispatch(
        AuthFlowEvent.requestFailed(
          PipelineError.isBlocked(result.error),
          result.error,
        ),
      );
      return;
    }
    this.challengeId = result.value;
    this.challengeIdentifier = identifier;
    this._sendCount.update((count) => count + 1);
    this.startCooldown();
  }

  /** Whether the outstanding challenge was issued for `identifier` — the rejoin key, and the throttled-resend key. */
  private holdsChallengeFor(identifier: ParsedIdentifier): boolean {
    return (
      this.challengeId !== null &&
      this.challengeIdentifier !== null &&
      ParsedIdentifier.equals(identifier, this.challengeIdentifier)
    );
  }

  private startCooldown(seconds: number = OtpLimits.ResendWindowSeconds): void {
    this.stopCooldown();
    this._resendSecondsLeft.set(seconds);
    this.cooldownTimer = setInterval(() => {
      const next = this._resendSecondsLeft() - 1;
      this._resendSecondsLeft.set(Math.max(0, next));
      if (next <= 0) this.stopCooldown();
    }, 1000);
  }

  private stopCooldown(): void {
    if (this.cooldownTimer !== null) {
      clearInterval(this.cooldownTimer);
      this.cooldownTimer = null;
    }
  }

  private dispatch(event: AuthFlowEvent): void {
    const result = AuthFlowSystem.next(this._state(), event);
    if (result.ok) {
      this._state.set(result.value);
    }
  }
}
