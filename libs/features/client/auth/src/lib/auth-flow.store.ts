import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  AUTH_DEPLOYMENT,
  AUTH_FLOW_INITIAL_STATE,
  AuthFlowEvent,
  AuthFlowState,
  Identifier,
  OTP_CLIENT,
  OtpChallengeId,
  RequestOtpUseCase,
  SessionKind,
  VerifyOtpUseCase,
  advanceAuthFlow,
  identifierEquals,
} from '@creativo/application/identity';

/** Seconds a fresh code must age before "Resend code" re-enables (industry default; uxResearch §resend). */
export const RESEND_COOLDOWN_SECONDS = 30;

/**
 * Wraps `advanceAuthFlow` (pure, blueprint §5.3) with the async OTP
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
 * Translation-free by design: `state().error` carries an `errors.<code>`
 * key (`OtpClientError.code`, extracted from the callable's `HttpsError`
 * details by the infrastructure adapter — never a firebase import here),
 * not a display string — the component resolves it via
 * `translateDomainError` at render time.
 */
@Injectable()
export class AuthFlowStore {
  private readonly deployment = inject(AUTH_DEPLOYMENT);
  private readonly requestOtpUseCase = new RequestOtpUseCase(
    inject(OTP_CLIENT),
  );
  private readonly verifyOtpUseCase = new VerifyOtpUseCase(inject(OTP_CLIENT));

  private readonly _state = signal<AuthFlowState>(AUTH_FLOW_INITIAL_STATE);
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

  private challengeId: OtpChallengeId | null = null;
  /** The destination the outstanding challenge was issued for — the rejoin key `submitIdentifier` matches against. */
  private challengeIdentifier: Identifier | null = null;
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
    this.dispatch({ type: 'change_identifier' });
  }

  /** `identifier` must already be a validated domain VO — the identify step's own template binds raw input straight through `createIdentifier` (blueprint §5.1), never through this store. */
  async submitIdentifier(identifier: Identifier): Promise<void> {
    if (
      this.challengeId !== null &&
      this.challengeIdentifier !== null &&
      identifierEquals(identifier, this.challengeIdentifier)
    ) {
      // Same destination, live challenge — rejoin the otp step exactly
      // where it left off (cooldown still ticking, send count intact);
      // the code already delivered still verifies.
      this.dispatch({ type: 'submit_identifier', identifier });
      return;
    }

    this.challengeId = null;
    this.challengeIdentifier = null;
    this.stopCooldown();
    this._resendSecondsLeft.set(0);
    this._sendCount.set(0);
    this.dispatch({ type: 'submit_identifier', identifier });
    await this.requestChallenge(identifier);
  }

  async resend(): Promise<void> {
    const state = this._state();
    if (state.kind !== 'otp' || !this.canResend() || this._pending()) return;
    this.dispatch({ type: 'resend_otp' });
    await this.requestChallenge(state.identifier);
  }

  async submitCode(rawCode: string): Promise<SessionKind | null> {
    const state = this._state();
    if (state.kind !== 'otp' || !this.challengeId) return null;

    this.dispatch({ type: 'submit_otp' });
    this._pending.set(true);
    const result = await this.verifyOtpUseCase.execute(
      this.challengeId,
      rawCode,
    );
    this._pending.set(false);

    if (result.isFailure()) {
      const blocked =
        result.error.kind === 'client_error' && result.error.error.userBlocked;
      const message =
        result.error.kind === 'invalid_code'
          ? 'otp_incorrect_code'
          : result.error.error.code;
      this.dispatch({
        type: 'verify_failed',
        blocked: blocked ?? false,
        message,
      });
      return null;
    }

    this.dispatch({ type: 'verified', session: result.value });
    return result.value;
  }

  private async requestChallenge(identifier: Identifier): Promise<void> {
    this._pending.set(true);
    const result = await this.requestOtpUseCase.execute(
      {
        kind: identifier.kind,
        value: identifier.value.toString(),
      },
      this.deployment.defaultCountry,
    );
    this._pending.set(false);

    if (result.isFailure()) {
      const blocked =
        result.error.kind === 'client_error' && result.error.error.userBlocked;
      const message =
        result.error.kind === 'invalid_identifier'
          ? 'identifier_invalid'
          : result.error.error.code;
      this.dispatch({
        type: 'request_failed',
        blocked: blocked ?? false,
        message,
      });
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
    const result = advanceAuthFlow(this._state(), event);
    if (result.isSuccess()) {
      this._state.set(result.value);
    }
  }
}
