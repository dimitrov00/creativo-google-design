import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  AuthFlowEvent,
  type AuthFlowState,
  AuthFlowStep,
  OtpCode,
  ParsedIdentifier,
  type SessionKind,
} from '@core/components';
import { IdentityErrorCode, type OtpId, PipelineError } from '@core/primitives';
import { AuthFlowSystem } from '@core/systems';
import { OTP_CHALLENGE_PORTS } from '@creativo/infrastructure/firebase-app';

/** Seconds a fresh code must age before "Resend code" re-enables (industry default; uxResearch §resend). */
export const RESEND_COOLDOWN_SECONDS = 30;

/**
 * Wraps `AuthFlowSystem.next` (pure, blueprint §5.3) with the async OTP
 * round-trip and the challenge-id side channel the pure state doesn't
 * model. One instance per `/auth` visit — provided component-scoped on
 * `ClientAuth`, not root, so re-navigating to `/auth` always starts fresh.
 *
 * Also owns the PRESENTATIONAL trust mechanics the machine deliberately
 * doesn't (design §3.3): the 30 s resend cooldown ticker and the per-flow
 * send counter (escalation copy appears after the 3rd send). Both reset
 * only when a DIFFERENT identifier is submitted — a new destination is a
 * new attempt. Merely stepping back to identify keeps the outstanding
 * challenge (and its ticking cooldown) alive, so resubmitting the same
 * destination rejoins the otp step without burning a second code.
 *
 * Translation-free by design: `state().error` carries an error code — the
 * server's `errorCode` off the failed callable (`PipelineError`'s
 * `serverErrorCode`), never a firebase import here — not a display string;
 * the component resolves it as `errors.<code>` at render time. A failure on
 * the `permission-denied` wire status is the lockout
 * (`PipelineError.isBlocked`).
 */
@Injectable()
export class AuthFlowStore {
  private readonly otp = inject(OTP_CHALLENGE_PORTS);

  private readonly _state = signal<AuthFlowState>(AuthFlowSystem.initial());
  readonly state = this._state.asReadonly();

  private readonly _pending = signal(false);
  /** True while a request/verify round-trip is in flight — presentational only, not modeled in `AuthFlowState`. */
  readonly pending = this._pending.asReadonly();

  private readonly _resendSecondsLeft = signal(0);
  /** Countdown until "Resend code" re-enables — 0 means resend is available. */
  readonly resendSecondsLeft = this._resendSecondsLeft.asReadonly();
  readonly canResend = computed(() => this._resendSecondsLeft() === 0);

  private readonly _sendCount = signal(0);
  /** Codes sent for the CURRENT identifier (initial send included) — drives the escalation footnote after the 3rd. */
  readonly sendCount = this._sendCount.asReadonly();

  private challengeId: OtpId | null = null;
  /** The destination the outstanding challenge was issued for — the rejoin key `submitIdentifier` matches against. */
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
    if (
      this.challengeId !== null &&
      this.challengeIdentifier !== null &&
      ParsedIdentifier.equals(identifier, this.challengeIdentifier)
    ) {
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
        AuthFlowEvent.verifyFailed(false, IdentityErrorCode.OtpWrongCode),
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
          messageOf(result.error),
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
      this.dispatch(
        AuthFlowEvent.requestFailed(
          PipelineError.isBlocked(result.error),
          messageOf(result.error),
        ),
      );
      return;
    }
    this.challengeId = result.value;
    this.challengeIdentifier = identifier;
    this._sendCount.update((count) => count + 1);
    this.startCooldown();
  }

  private startCooldown(): void {
    this.stopCooldown();
    this._resendSecondsLeft.set(RESEND_COOLDOWN_SECONDS);
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

/**
 * The refusal to show for a failed callable: the server's own code, else
 * the auth surface's own generic copy (`IDENTITY_CALL_FAILED`).
 */
function messageOf(error: PipelineError): string {
  return error.serverErrorCode ?? IdentityErrorCode.CallFailed;
}
