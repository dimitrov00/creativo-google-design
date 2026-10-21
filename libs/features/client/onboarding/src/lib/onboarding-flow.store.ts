import { Injectable, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  ANONYMOUS_PRINCIPAL,
  AUTH_DEPLOYMENT,
  AUTH_GATEWAY,
  EnsureSessionReadyUseCase,
  Identifier,
  MissingRegistrationFieldError,
  ONBOARDING_FLOW_INITIAL_STATE,
  OTP_CLIENT,
  OnboardingFlowEvent,
  OnboardingFlowState,
  PERSONALIZE_STEPS,
  type PersonalizeStep,
  Principal,
  RegisterUserUseCase,
  RegistrationField,
  Settled,
  SignOutUseCase,
  advanceOnboardingFlowWithinPlan,
  backOnboardingFlowWithinPlan,
  classify,
  onboardingPlanPosition,
} from '@creativo/application/identity';
import {
  AVATAR_UPLOADER,
  UploadAvatarUseCase,
} from '@creativo/application/accounts';
import { CLOCK } from '@creativo/application/shared';
import {
  ageDayOf,
  saveOwnProfile,
} from '@creativo/features/client/account-state';
import { PROFILE_PORTS } from '@creativo/infrastructure/firebase-app';
import { Observable, map } from 'rxjs';
import { ServiceId as FlowServiceId } from '@creativo/application/catalog';
import type { BirthDate } from '@core/components';
import { IdentityErrorCode, type ServiceId, UserId } from '@core/primitives';
import { AgeSystem } from '@core/systems';

/**
 * The optional phase's steps, in the order the flow machine walks them — the
 * one list, `OnboardingFlowSystem`'s (`@core/systems`), in the flow
 * shim's lowercase spelling (`@creativo/application/identity` converts the
 * SCREAMING tags, flatten pass). Stepping over the steps a resume's plan
 * leaves out is that system's math too (Phase 2): this store dispatches
 * through `advanceOnboardingFlowWithinPlan` / `backOnboardingFlowWithinPlan`
 * and keeps only the signals and the I/O.
 */
export { PERSONALIZE_STEPS, type PersonalizeStep };

/**
 * Wraps the onboarding flow machine (pure, blueprint §5.3). One instance per
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
  private readonly profilePorts = inject(PROFILE_PORTS);
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
  readonly planPosition = computed(() =>
    onboardingPlanPosition(this._state(), this._plan()),
  );

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

  /**
   * The picked catalogue services, as the stored entities name them. The
   * flow machine (identity, flip 2) still holds the kernel's ids, so they
   * are built at this one seam until it flips; a catalogue id is never
   * blank, so none is dropped.
   */
  submitServices(services: readonly ServiceId[]): void {
    const ids: FlowServiceId[] = [];
    for (const raw of services) {
      const id = FlowServiceId.create(raw);
      if (id.isSuccess()) ids.push(id.value);
    }
    this.dispatch({ type: 'submit_services', services: ids });
  }

  skipServices(): void {
    this.dispatch({ type: 'skip_services' });
  }

  /**
   * The optional birthday step's save — judges the segments through
   * `AgeSystem.fromParts` on the UTC age day (the same rule the step's own
   * blur validation uses), then writes them through
   * `PROFILE_PORTS.writeOwnProfile`, whose `ProfileEditSystem.decide`
   * re-judges the edit against the stored profile inside the transaction
   * (identity flip (2), F2-6). Dispatches `submit_birthday` only once the
   * save settles successfully; every failure stays on the step as a quiet,
   * reason-coded inline error (`errors.<errorCode>`, today's words).
   */
  async submitBirthday(parts: BirthDate.Parts): Promise<void> {
    // The day the age window is judged on, from this save's one CLOCK reading.
    const ageDay = ageDayOf(this.clock);
    if (ageDay === null) {
      // Unreachable ('UTC' is always valid) — kept as an honest backstop.
      this.dispatch({
        type: 'birthday_failed',
        message: IdentityErrorCode.BirthDateInvalid,
      });
      return;
    }
    const birthDate = AgeSystem.fromParts(parts, ageDay);
    if (!birthDate.ok) {
      this.dispatch({
        type: 'birthday_failed',
        message: birthDate.error.errorCode,
      });
      return;
    }

    const userId = this.currentUserId();
    if (userId === null) {
      this.dispatch({ type: 'birthday_failed', message: 'identifier_missing' });
      return;
    }

    this._pending.set(true);
    const code = await saveOwnProfile(
      this.profilePorts,
      userId,
      { firstName: null, lastName: null, birthDate: birthDate.value },
      ageDay,
    );
    this._pending.set(false);

    if (code !== null) {
      this.dispatch({ type: 'birthday_failed', message: code });
      return;
    }
    this.dispatch({ type: 'submit_birthday' });
  }

  /** The signed-in account's id — `null` before a session or for a uid no id parses from. */
  private currentUserId(): UserId | null {
    const principal = this.principal();
    if (principal.kind === 'anonymous') return null;
    const userId = UserId.parse(principal.uid.value);
    return userId.ok ? userId.value : null;
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
    const owner = this.currentUserId();
    if (owner === null) return 'identifier_missing';

    this._pending.set(true);
    const result = await this.uploadAvatarUseCase.execute(owner, data);
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
    const result = backOnboardingFlowWithinPlan(this._state(), this._plan());
    if (result.isSuccess()) this._state.set(result.value);
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

  /**
   * One transition, then every personalization step the plan leaves out
   * stepped over — the machine keeps its fixed services → birthday → avatar
   * order, the plan decides which of those this visit shows, so finishing
   * the birthday when the photo is already there lands on `entering`, not on
   * a redundant avatar step. Invalid edges are ignored, as they always have
   * been.
   */
  private dispatch(event: OnboardingFlowEvent): void {
    const result = advanceOnboardingFlowWithinPlan(
      this._state(),
      event,
      this._plan(),
    );
    if (result.isSuccess()) this._state.set(result.value);
  }
}
