import { Injectable, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ANONYMOUS_PRINCIPAL,
  AUTH_DEPLOYMENT,
  AUTH_GATEWAY,
  BirthDate,
  BirthDateParts,
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
  Settled,
  SignOutUseCase,
  advanceOnboardingFlow,
  classify,
} from '@creativo/application/identity';
import {
  PROFILE_PORT,
  UpdateProfileUseCase,
  UserId,
} from '@creativo/application/accounts';
import { CLOCK } from '@creativo/application/shared';
import { Observable, map } from 'rxjs';
import { ServiceId } from '@creativo/application/catalog';

/**
 * Wraps `advanceOnboardingFlow` (pure, blueprint §5.3). One instance per
 * `/onboarding` visit — component-scoped, not root.
 *
 * The identifier being registered is re-derived from the already-signed-in
 * session via `AuthGateway.currentIdentifier()` (`verifyOtpChallenge`
 * already set `phoneNumber`/`email` on the Auth record at provisioning)
 * rather than threaded across the `/auth` → `/onboarding` navigation — the
 * user IS authenticated by the time they reach this route (`anonGuard`),
 * so this is trusted, not user input. Which registration fields the about
 * step must collect is the injected deployment's call (`strategy.required`),
 * never a hardcoded list.
 */
@Injectable()
export class OnboardingFlowStore {
  private readonly authGateway = inject(AUTH_GATEWAY);
  private readonly registerUserUseCase = new RegisterUserUseCase(
    inject(OTP_CLIENT),
  );
  private readonly ensureSessionReady = new EnsureSessionReadyUseCase(
    this.authGateway,
  );
  private readonly signOutUseCase = new SignOutUseCase(this.authGateway);
  private readonly updateProfileUseCase = new UpdateProfileUseCase(
    inject(PROFILE_PORT),
  );
  private readonly clock = inject(CLOCK);

  /**
   * Live principal for the birthday step's profile write — by the time the
   * personalization phase renders, the session is signed in (anonGuard) and
   * this signal has long settled past its anonymous initial value.
   */
  private readonly principal = toSignal(this.authGateway.observePrincipal(), {
    initialValue: ANONYMOUS_PRINCIPAL,
  });

  /** The deployment's auth config — the about step renders its fields from `deployment.strategy.required`. */
  readonly deployment = inject(AUTH_DEPLOYMENT);

  private readonly _state = signal<OnboardingFlowState>(
    ONBOARDING_FLOW_INITIAL_STATE,
  );
  readonly state = this._state.asReadonly();

  private readonly _pending = signal(false);
  readonly pending = this._pending.asReadonly();

  /** The channel this session signed in with — `null` only if the Auth record carries neither phone nor email (a provisioning bug). */
  currentIdentifier(): Identifier | null {
    return this.authGateway.currentIdentifier();
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
      this.deployment.strategy,
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
    // Refresh the session claims in the background NOW, not only at the
    // terminal `entering` poll: the server just activated this account,
    // but the client's ID token still says `onboarding` (Firebase refreshes
    // tokens lazily, up to an hour later). Without this, a page refresh
    // during reward/personalization classified the user as still-onboarding
    // and dropped them back onto an empty About form (owner report
    // 2026-07-26). Fire-and-forget — `entering`'s own poll stays the
    // authoritative gate, this only warms the claims early.
    void this.ensureSessionReady.execute();
  }

  /**
   * The about-step footer's explicit exit — the user must never feel
   * trapped in a signed-in state they didn't choose (design §2.5). The
   * caller navigates home afterwards regardless of the result: even a
   * failed sign-out should land on neutral ground, not strand the user
   * on a half-abandoned onboarding form.
   */
  async signOut(): Promise<void> {
    await this.signOutUseCase.execute();
  }

  /** Settled classification stream — feeds the component's active-account bounce. */
  observeSettled(): Observable<Settled> {
    return this.authGateway.observePrincipal().pipe(map(classify));
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

  /**
   * The optional birthday step's save — validates the segments through the
   * identity `BirthDate` VO (the same door the step's own blur validation
   * uses), then persists via `UpdateProfileUseCase` (which re-validates
   * through the accounts domain before the port sees anything). Dispatches
   * `submit_birthday` only once the save settles successfully; every
   * failure stays on the step as a quiet, reason-coded inline error.
   */
  async submitBirthday(parts: BirthDateParts): Promise<void> {
    const todayResult = this.clock.now('UTC');
    if (todayResult.isFailure()) {
      // Unreachable ('UTC' is always valid) — kept as an honest backstop.
      this.dispatch({
        type: 'birthday_failed',
        message: 'identity.birth_date.invalid',
      });
      return;
    }
    const birthResult = BirthDate.create(parts, todayResult.value);
    if (birthResult.isFailure()) {
      this.dispatch({
        type: 'birthday_failed',
        message: birthResult.error.code,
      });
      return;
    }

    const principal = this.principal();
    if (principal.kind === 'anonymous') {
      this.dispatch({ type: 'birthday_failed', message: 'identifier_missing' });
      return;
    }
    const userIdResult = UserId.create(principal.uid.value);
    if (userIdResult.isFailure()) {
      this.dispatch({ type: 'birthday_failed', message: 'identifier_missing' });
      return;
    }

    this._pending.set(true);
    const result = await this.updateProfileUseCase.execute({
      userId: userIdResult.value,
      birthDate: birthResult.value.toISODate(),
      today: todayResult.value,
    });
    this._pending.set(false);

    if (result.isFailure()) {
      this.dispatch({ type: 'birthday_failed', message: result.error.code });
      return;
    }
    this.dispatch({ type: 'submit_birthday' });
  }

  skipBirthday(): void {
    this.dispatch({ type: 'skip_birthday' });
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
