import { Injectable, inject, signal } from '@angular/core';
import {
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
} from '@creativo/application/identity';

/**
 * Wraps `advanceAuthFlow` (pure, blueprint §5.3) with the async OTP
 * round-trip and the challenge-id side channel the pure state doesn't
 * model. One instance per `/auth` visit — provided component-scoped on
 * `ClientAuth`, not root, so re-navigating to `/auth` always starts fresh.
 *
 * Translation-free by design: `state().error` carries an `errors.<code>`
 * key (`OtpClientError.code`, extracted from the callable's `HttpsError`
 * details by the infrastructure adapter — never a firebase import here),
 * not a display string — the component resolves it via
 * `translateDomainError` at render time.
 */
@Injectable()
export class AuthFlowStore {
  private readonly requestOtpUseCase = new RequestOtpUseCase(
    inject(OTP_CLIENT),
  );
  private readonly verifyOtpUseCase = new VerifyOtpUseCase(inject(OTP_CLIENT));

  private readonly _state = signal<AuthFlowState>(AUTH_FLOW_INITIAL_STATE);
  readonly state = this._state.asReadonly();

  private readonly _pending = signal(false);
  /** True while a request/verify round-trip is in flight — presentational only, not modeled in `AuthFlowState`. */
  readonly pending = this._pending.asReadonly();

  private challengeId: OtpChallengeId | null = null;

  getStarted(): void {
    this.dispatch({ type: 'get_started' });
  }

  back(): void {
    this.dispatch({ type: 'back' });
  }

  changeIdentifier(): void {
    this.challengeId = null;
    this.dispatch({ type: 'change_identifier' });
  }

  /** `identifier` must already be a validated domain VO — the identify step's own template binds raw input straight through `createIdentifier` (blueprint §5.1), never through this store. */
  async submitIdentifier(identifier: Identifier): Promise<void> {
    this.dispatch({ type: 'submit_identifier', identifier });
    await this.requestChallenge(identifier);
  }

  async resend(): Promise<void> {
    const state = this._state();
    if (state.kind !== 'otp') return;
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
    const result = await this.requestOtpUseCase.execute({
      kind: identifier.kind,
      value: identifier.value.toString(),
    });
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
  }

  private dispatch(event: AuthFlowEvent): void {
    const result = advanceAuthFlow(this._state(), event);
    if (result.isSuccess()) {
      this._state.set(result.value);
    }
  }
}
