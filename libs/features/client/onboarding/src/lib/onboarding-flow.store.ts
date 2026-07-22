import { Injectable, inject, signal } from '@angular/core';
import {
  AUTH_GATEWAY,
  DEFAULT_AUTH_STRATEGY,
  EnsureSessionReadyUseCase,
  Identifier,
  MissingRegistrationFieldError,
  ONBOARDING_FLOW_INITIAL_STATE,
  OTP_CLIENT,
  OnboardingFlowEvent,
  OnboardingFlowState,
  Principal,
  RegisterUserUseCase,
  RegistrationField,
  advanceOnboardingFlow,
  reconstituteIdentifier,
} from '@creativo/application/identity';
import { ServiceId } from '@creativo/application/catalog';
import { FIREBASE_AUTH } from '@creativo/infrastructure/firebase-app';

/**
 * Wraps `advanceOnboardingFlow` (pure, blueprint §5.3). One instance per
 * `/onboarding` visit — component-scoped, not root.
 *
 * The identifier being registered is re-derived from the already-signed-in
 * Firebase user (`verifyOtpChallenge` already set `phoneNumber`/`email` on
 * it at provisioning) rather than threaded across the `/auth` → `/onboarding`
 * navigation — the user IS authenticated by the time they reach this route
 * (`anonGuard`), so this is trusted, not user input.
 */
@Injectable()
export class OnboardingFlowStore {
  private readonly registerUserUseCase = new RegisterUserUseCase(
    inject(OTP_CLIENT),
  );
  private readonly ensureSessionReady = new EnsureSessionReadyUseCase(
    inject(AUTH_GATEWAY),
  );
  private readonly firebaseAuth = inject(FIREBASE_AUTH);

  private readonly _state = signal<OnboardingFlowState>(
    ONBOARDING_FLOW_INITIAL_STATE,
  );
  readonly state = this._state.asReadonly();

  private readonly _pending = signal(false);
  readonly pending = this._pending.asReadonly();

  private currentIdentifier(): Identifier | null {
    const user = this.firebaseAuth.currentUser;
    if (!user) return null;
    if (user.phoneNumber) {
      return reconstituteIdentifier({ kind: 'phone', value: user.phoneNumber });
    }
    if (user.email) {
      return reconstituteIdentifier({ kind: 'email', value: user.email });
    }
    return null;
  }

  async submitAbout(
    fields: Partial<Record<RegistrationField, string>>,
  ): Promise<void> {
    const identifier = this.currentIdentifier();
    if (!identifier) {
      this.dispatch({
        type: 'registration_failed',
        message: 'identifier_missing',
      });
      return;
    }

    this.dispatch({ type: 'submit_about', fields });
    this._pending.set(true);
    const result = await this.registerUserUseCase.execute(
      identifier,
      DEFAULT_AUTH_STRATEGY,
      fields,
    );
    this._pending.set(false);

    if (result.isFailure()) {
      const message =
        result.error instanceof MissingRegistrationFieldError
          ? 'registration_field_missing'
          : result.error.error.code;
      this.dispatch({ type: 'registration_failed', message });
      return;
    }
    this.dispatch({ type: 'registered' });
  }

  personalize(): void {
    this.dispatch({ type: 'personalize' });
  }

  submitServices(services: readonly ServiceId[]): void {
    this.dispatch({ type: 'submit_services', services });
  }

  skipServices(): void {
    this.dispatch({ type: 'skip_services' });
  }

  skipAvatar(): void {
    this.dispatch({ type: 'skip_avatar' });
  }

  back(): void {
    this.dispatch({ type: 'back' });
  }

  /** Transitions to the terminal `entering` state — dispatch-only, no async work (the component's own effect watching `state().kind === 'entering'` is the one place that then calls `pollActivation`, so this never double-polls). Valid from `reward` (skip-all) or `avatar` (finished personalizing). */
  enterApp(): void {
    this.dispatch({ type: 'enter_app' });
  }

  /**
   * Polls until the just-promoted claims land (or the backoff schedule
   * exhausts) — returns the settled `Principal`, or `null` on a hard
   * gateway failure (never on a mere "still onboarding after exhausting
   * the backoff", which `EnsureSessionReadyUseCase` itself treats as a
   * success value the caller interprets, not an error). Call only once
   * already in the `entering` state.
   */
  async pollActivation(): Promise<Principal | null> {
    this._pending.set(true);
    const result = await this.ensureSessionReady.execute();
    this._pending.set(false);
    return result.isSuccess() ? result.value : null;
  }

  private dispatch(event: OnboardingFlowEvent): void {
    const result = advanceOnboardingFlow(this._state(), event);
    if (result.isSuccess()) {
      this._state.set(result.value);
    }
  }
}
