import { Injectable, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Observable, map } from 'rxjs';
import {
  type BirthDate,
  OnboardingFlowEvent,
  type OnboardingFlowState,
  type ParsedIdentifier,
  Principal,
  PrincipalKind,
  type RegistrationFields,
} from '@core/components';
import {
  ensureSessionReady,
  registerUser,
  uploadAvatar,
} from '@core/pipelines';
import {
  IdentityErrorCode,
  type ServiceId,
  type UserId,
} from '@core/primitives';
import {
  AgeSystem,
  GuestGuardSystem,
  OnboardingFlowSystem,
  PERSONALIZE_STEPS,
  type PersonalizeStep,
  type SettledVerdict,
} from '@core/systems';
import {
  ageDayOf,
  saveOwnProfile,
} from '@creativo/features/client/account-state';
import { avatarUploadRefusal } from '@creativo/features/shared/shell';
import {
  AUTH_DEPLOYMENT_PORTS,
  AUTH_SESSION_PORTS,
  AVATAR_PORTS,
  CLOCK_PORTS,
  GATEWAY_PORTS,
  OTP_CHALLENGE_PORTS,
  TIMER_PORTS,
} from '@creativo/infrastructure/firebase-app';

/**
 * The refusal shown when the session carries no identifier (or no account)
 * to register or save against — today's `errors.identifier_missing`.
 */
const IDENTIFIER_MISSING = 'identifier_missing';

/** The refusal shown for a failed callable the server named no code for — today's generic `errors.unknown`. */
const UNKNOWN_ERROR_CODE = 'unknown';

/**
 * Wraps the onboarding flow machine (`OnboardingFlowSystem`, pure,
 * blueprint §5.3). One instance per `/onboarding` visit — component-scoped,
 * not root. Stepping over the steps a resume's plan leaves out is that
 * system's math too (`nextWithinPlan` / `backWithinPlan`): this store keeps
 * only the signals and the I/O.
 *
 * The identifier being registered is re-derived from the already-signed-in
 * session via `AUTH_SESSION_PORTS.currentIdentifier()` (`verifyOtpChallenge`
 * already set `phoneNumber`/`email` on the Auth record at provisioning)
 * rather than threaded across the `/auth` → `/onboarding` navigation — the
 * user IS authenticated by the time they reach this route (`anonGuard`),
 * so this is trusted, not user input. Which registration fields the about
 * step must collect is the injected deployment's call (`strategy.required`),
 * never a hardcoded list.
 */
@Injectable()
export class OnboardingFlowStore {
  private readonly session = inject(AUTH_SESSION_PORTS);
  private readonly gateway = inject(GATEWAY_PORTS);
  private readonly clock = inject(CLOCK_PORTS);
  private readonly avatars = inject(AVATAR_PORTS);
  private readonly deploymentPorts = inject(AUTH_DEPLOYMENT_PORTS);
  private readonly register = registerUser({
    ...inject(OTP_CHALLENGE_PORTS),
    ...this.deploymentPorts,
  });
  private readonly ensureSessionReady = ensureSessionReady({
    ...this.session,
    ...inject(TIMER_PORTS),
  });
  private readonly upload = uploadAvatar(this.avatars);

  /**
   * Live principal for the birthday step's profile write — by the time the
   * personalization phase renders, the session is signed in (anonGuard) and
   * this signal has long settled past its anonymous initial value.
   */
  private readonly principal = toSignal(this.session.observePrincipal(), {
    initialValue: Principal.anonymous(),
  });

  /** The deployment's auth config — the about step renders its fields from `deployment.strategy.required`. */
  readonly deployment = this.deploymentPorts.authDeployment;

  private readonly _state = signal<OnboardingFlowState>(
    OnboardingFlowSystem.initial(),
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
    OnboardingFlowSystem.planPosition(this._state(), this._plan()),
  );

  /** A single remaining step is one task, not a journey — the screen drops its stepper and its back control. */
  readonly isSingleStep = computed(() => this._plan().length === 1);

  /** The channel this session signed in with — `null` only if the Auth record carries neither phone nor email (a provisioning bug). */
  currentIdentifier(): ParsedIdentifier | null {
    return this.session.currentIdentifier();
  }

  async submitAbout(fields: RegistrationFields): Promise<void> {
    const identifier = this.currentIdentifier();
    if (!identifier) {
      this.dispatch(OnboardingFlowEvent.registrationFailed(IDENTIFIER_MISSING));
      return;
    }

    this.dispatch(OnboardingFlowEvent.submitAbout(fields));
    this._pending.set(true);
    const result = await this.register(identifier, fields);
    this._pending.set(false);

    if (!result.ok) {
      // A field the strategy requires is missing (`IDENTITY_REGISTRATION_
      // FIELD_MISSING`, before any call), else the callable's own code.
      const error = result.error;
      const message =
        error.errorCode === IdentityErrorCode.RegistrationFieldMissing
          ? error.errorCode
          : (error.serverErrorCode ?? UNKNOWN_ERROR_CODE);
      this.dispatch(OnboardingFlowEvent.registrationFailed(message));
      return;
    }
    this.dispatch(OnboardingFlowEvent.registered());
    // Refresh the session claims in the background NOW, not only at the
    // terminal `entering` poll: the server just activated this account,
    // but the client's ID token still says onboarding (Firebase refreshes
    // tokens lazily, up to an hour later). Without this, a page refresh
    // during reward/personalization classified the user as still-onboarding
    // and dropped them back onto an empty About form (owner report
    // 2026-07-26). Fire-and-forget — `entering`'s own poll stays the
    // authoritative gate, this only warms the claims early.
    void this.ensureSessionReady();
  }

  /**
   * The about-step footer's explicit exit — the user must never feel
   * trapped in a signed-in state they didn't choose (design §2.5). The
   * caller navigates home afterwards regardless of the result: even a
   * failed sign-out should land on neutral ground, not strand the user
   * on a half-abandoned onboarding form.
   */
  async signOut(): Promise<void> {
    await this.session.signOut();
  }

  /** Settled classification stream — feeds the component's active-account bounce. */
  observeSettled(): Observable<SettledVerdict> {
    return this.session
      .observePrincipal()
      .pipe(map((principal) => GuestGuardSystem.classify(principal)));
  }

  personalize(): void {
    this.dispatch(OnboardingFlowEvent.personalize());
  }

  /**
   * Entry for an ALREADY-ACTIVE account returning to finish the optional
   * personalization (the account checklist's open rows) — the machine has
   * no direct about→services edge, and it doesn't need one: for a
   * registered user, walking the real transitions (`REGISTERED` →
   * `PERSONALIZE`, then the plan's skips) is the honest path, skipping the
   * About form their registration already satisfied. Back from a
   * deep-linked birthday still returns to services — the earlier steps stay
   * reachable, just not forced.
   */
  beginPersonalization(
    steps: readonly PersonalizeStep[] = PERSONALIZE_STEPS,
  ): void {
    // An empty plan would leave the flow parked on services forever;
    // there is nothing to personalize, so go straight to the app.
    const plan = steps.length > 0 ? steps : PERSONALIZE_STEPS;
    this._plan.set(plan);
    this.dispatch(OnboardingFlowEvent.registered());
    this.dispatch(OnboardingFlowEvent.personalize());
  }

  /** The picked catalogue services, as the stored entities name them. */
  submitServices(services: readonly ServiceId[]): void {
    this.dispatch(OnboardingFlowEvent.submitServices(services));
  }

  skipServices(): void {
    this.dispatch(OnboardingFlowEvent.skipServices());
  }

  /**
   * The optional birthday step's save — judges the segments through
   * `AgeSystem.fromParts` on the UTC age day (the same rule the step's own
   * blur validation uses), then writes them through the `updateProfile`
   * callable (`saveOwnProfile`), whose `ProfileEditSystem.decide` re-judges
   * the edit against the stored profile inside its transaction and audits
   * it, credited to this user. Dispatches `SUBMIT_BIRTHDAY` only once the
   * save settles successfully; every failure stays on the step as a quiet,
   * reason-coded inline error (`errors.<errorCode>`, today's words).
   */
  async submitBirthday(parts: BirthDate.Parts): Promise<void> {
    // The day the age window is judged on, from this save's one clock reading.
    const ageDay = ageDayOf(this.clock);
    const birthDate = AgeSystem.fromParts(parts, ageDay);
    if (!birthDate.ok) {
      this.dispatch(
        OnboardingFlowEvent.birthdayFailed(birthDate.error.errorCode),
      );
      return;
    }

    if (this.currentUserId() === null) {
      this.dispatch(OnboardingFlowEvent.birthdayFailed(IDENTIFIER_MISSING));
      return;
    }

    this._pending.set(true);
    const code = await saveOwnProfile(this.gateway, {
      firstName: null,
      lastName: null,
      birthDate: birthDate.value,
    });
    this._pending.set(false);

    if (code !== null) {
      this.dispatch(OnboardingFlowEvent.birthdayFailed(code));
      return;
    }
    this.dispatch(OnboardingFlowEvent.submitBirthday());
  }

  /** The signed-in account's id — `null` before a session. */
  private currentUserId(): UserId | null {
    const principal = this.principal();
    return principal.principalKind === PrincipalKind.Anonymous
      ? null
      : principal.userId;
  }

  skipBirthday(): void {
    this.dispatch(OnboardingFlowEvent.skipBirthday());
  }

  skipAvatar(): void {
    this.dispatch(OnboardingFlowEvent.skipAvatar());
  }

  /**
   * The avatar step's optional upload — persistence IS the Storage object
   * at the well-known `avatars/{uid}/original` path (the `User` entity
   * deliberately carries no photo URL; readers resolve the path). Returns
   * the stable error code for the step's inline line, or null on success —
   * no flow event: the machine's `ENTER_APP` fires only after the caller
   * decides what a failure means.
   */
  async uploadAvatar(data: Blob): Promise<string | null> {
    const owner = this.currentUserId();
    if (owner === null) return IDENTIFIER_MISSING;

    this._pending.set(true);
    const result = await this.upload(owner, data);
    this._pending.set(false);
    return result.ok ? null : avatarUploadRefusal(result.error);
  }

  /**
   * Back walks BACKWARDS through the plan — stepping over anything this
   * resume already satisfied. Without that it would land on a step the
   * forward normalization immediately skips again, and the screen would
   * appear frozen.
   */
  back(): void {
    const result = OnboardingFlowSystem.backWithinPlan(
      this._state(),
      this._plan(),
    );
    if (result.ok) this._state.set(result.value);
  }

  /** Transitions to the terminal `ENTERING` state — dispatch-only, no async work (the component's own continuation then calls `pollActivation`, so this never double-polls). Valid from `REWARD` (skip-all) or `AVATAR` (finished personalizing). */
  enterApp(): void {
    this.dispatch(OnboardingFlowEvent.enterApp());
  }

  /**
   * Polls until the just-promoted claims land (or the backoff schedule
   * exhausts) — returns the settled `Principal`, or `null` on a hard
   * session failure (never on a mere "still onboarding after exhausting
   * the backoff", which `ensureSessionReady` itself answers as a success
   * value the caller interprets, not an error). Call only once already in
   * the `ENTERING` state.
   */
  async pollActivation(): Promise<Principal | null> {
    this._pending.set(true);
    const result = await this.ensureSessionReady();
    this._pending.set(false);
    return result.ok ? result.value : null;
  }

  /**
   * One transition, then every personalization step the plan leaves out
   * stepped over — the machine keeps its fixed services → birthday → avatar
   * order, the plan decides which of those this visit shows, so finishing
   * the birthday when the photo is already there lands on `ENTERING`, not
   * on a redundant avatar step. Invalid edges are ignored, as they always
   * have been.
   */
  private dispatch(event: OnboardingFlowEvent): void {
    const result = OnboardingFlowSystem.nextWithinPlan(
      this._state(),
      event,
      this._plan(),
    );
    if (result.ok) this._state.set(result.value);
  }
}
