import { Injectable, computed, inject, signal } from '@angular/core';
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
  AVATAR_UPLOADER,
  PROFILE_PORT,
  UpdateProfileUseCase,
  UploadAvatarUseCase,
  UserId,
} from '@creativo/application/accounts';
import { CLOCK } from '@creativo/application/shared';
import { Observable, map } from 'rxjs';
import { ServiceId } from '@creativo/application/catalog';

/** The optional phase's steps, in the order the flow machine walks them. */
export type PersonalizeStep = 'services' | 'birthday' | 'avatar';

export const PERSONALIZE_STEPS: readonly PersonalizeStep[] = [
  'services',
  'birthday',
  'avatar',
];

/** The event that leaves each step untouched — how a step outside the plan is stepped over. */
const SKIP_EVENT = {
  services: 'skip_services',
  birthday: 'skip_birthday',
  avatar: 'skip_avatar',
} as const satisfies Record<PersonalizeStep, OnboardingFlowEvent['type']>;

function isPersonalizeStep(kind: string): kind is PersonalizeStep {
  return (PERSONALIZE_STEPS as readonly string[]).includes(kind);
}

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
  private readonly uploadAvatarUseCase = new UploadAvatarUseCase(
    inject(AVATAR_UPLOADER),
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

  /**
   * Which personalization steps THIS visit will show. A first run gets all
   * three; a resume from the menu's finish-your-profile row gets only what
   * the profile is still missing, so someone who already set a birthday is
   * never asked for it again.
   */
  private readonly _plan =
    signal<readonly PersonalizeStep[]>(PERSONALIZE_STEPS);
  readonly plan = this._plan.asReadonly();

  /** 1-based position of the current step within the plan; 0 outside the personalization phase. */
  readonly planPosition = computed(() => {
    const kind = this._state().kind;
    if (!isPersonalizeStep(kind)) return 0;
    return this._plan().indexOf(kind) + 1;
  });

  /** A single remaining step is one task, not a journey — the screen drops its stepper and its back control. */
  readonly isSingleStep = computed(() => this._plan().length === 1);

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

  /**
   * Entry for an ALREADY-ACTIVE account returning to finish the optional
   * personalization (the account checklist's open rows) — the machine has
   * no direct about→services edge, and it doesn't need one: for a
   * registered user, walking the real transitions (`registered` →
   * `personalize`, then `skip_services` when the caller deep-links past
   * them) is the honest path, skipping the About form their registration
   * already satisfied. Back from a deep-linked birthday still returns to
   * services — the earlier steps stay reachable, just not forced.
   */
  beginPersonalization(
    steps: readonly PersonalizeStep[] = PERSONALIZE_STEPS,
  ): void {
    // An empty plan would leave the flow parked on `services` forever;
    // there is nothing to personalize, so go straight to the app.
    const plan = steps.length > 0 ? steps : PERSONALIZE_STEPS;
    this._plan.set(plan);
    this.dispatch({ type: 'registered' });
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

  /**
   * The avatar step's optional upload — persistence IS the Storage object
   * at the well-known `avatars/{uid}/original` path (the `User` aggregate
   * deliberately carries no photo URL; readers resolve the path). Returns
   * the stable error code for the step's inline line, or null on success —
   * no flow event: the machine's `enter_app` fires only after the caller
   * decides what a failure means.
   */
  async uploadAvatar(data: Blob): Promise<string | null> {
    const principal = this.principal();
    if (principal.kind === 'anonymous') return 'identifier_missing';
    const userIdResult = UserId.create(principal.uid.value);
    if (userIdResult.isFailure()) return 'identifier_missing';

    this._pending.set(true);
    const result = await this.uploadAvatarUseCase.execute(
      userIdResult.value,
      data,
    );
    this._pending.set(false);
    return result.isFailure() ? result.error.code : null;
  }

  /**
   * Back walks BACKWARDS through the plan — stepping over anything this
   * resume already satisfied. Without that it would land on a step the
   * forward normalization immediately skips again, and the screen would
   * appear frozen.
   */
  back(): void {
    if (!this.applyEvent({ type: 'back' })) return;
    for (let guard = 0; guard < PERSONALIZE_STEPS.length; guard++) {
      const kind = this._state().kind;
      if (!isPersonalizeStep(kind) || this._plan().includes(kind)) return;
      if (!this.applyEvent({ type: 'back' })) return;
    }
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
    if (!this.applyEvent(event)) return;
    this.skipStepsOutsidePlan();
  }

  /** One transition. Returns whether the machine actually moved (invalid edges are ignored, as they always have been). */
  private applyEvent(event: OnboardingFlowEvent): boolean {
    const result = advanceOnboardingFlow(this._state(), event);
    if (result.isFailure()) return false;
    this._state.set(result.value);
    return true;
  }

  /**
   * The heart of the resume: after every transition, step over any
   * personalization the profile already satisfies. The machine keeps its
   * fixed services → birthday → avatar order (it is a pure function and
   * knows nothing about profiles); the plan decides which of those the
   * user is actually shown, so finishing the birthday when the photo is
   * already there lands on `entering`, not on a redundant avatar step.
   */
  private skipStepsOutsidePlan(): void {
    for (let guard = 0; guard < PERSONALIZE_STEPS.length; guard++) {
      const kind = this._state().kind;
      if (!isPersonalizeStep(kind) || this._plan().includes(kind)) return;
      if (!this.applyEvent({ type: SKIP_EVENT[kind] })) return;
    }
  }
}
