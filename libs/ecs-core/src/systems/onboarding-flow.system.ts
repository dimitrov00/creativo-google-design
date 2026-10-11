import { IdentityError, Result } from '@core/primitives';
import {
  OnboardingFlowEvent,
  OnboardingFlowEventKind,
  OnboardingFlowState,
  OnboardingFlowStep,
} from '@core/components';

/**
 * OnboardingFlowSystem — the onboarding flow's transition function
 * (blueprint §2.8), the pure port of `libs/application/identity/src/lib/
 * flow/onboarding-flow.ts` (`advanceOnboardingFlow`), plus the resume plan
 * the `OnboardingFlowStore` walked by hand (`onboarding-flow.store.ts`:
 * `skipStepsOutsidePlan`, `back`, `planPosition`).
 *
 * The required registration first (`about`), then the optional
 * personalization — services → birthday → avatar, every step skippable. A
 * resume shows only the personalization steps its plan names; the machine
 * keeps its fixed order and the plan decides which steps are stepped over.
 * Total over the tagged unions: an event a step does not accept answers
 * `IDENTITY_ONBOARDING_FLOW_INVALID_TRANSITION` with the two tags.
 */

/** The optional phase's steps, in the order the machine walks them. */
export const PERSONALIZE_STEPS = [
  OnboardingFlowStep.Services,
  OnboardingFlowStep.Birthday,
  OnboardingFlowStep.Avatar,
] as const;
export type PersonalizeStep = (typeof PERSONALIZE_STEPS)[number];

/** The event that leaves each personalization step untouched — how a step outside the plan is stepped over. */
function skipEventOf(step: PersonalizeStep): OnboardingFlowEvent {
  switch (step) {
    case OnboardingFlowStep.Services:
      return OnboardingFlowEvent.skipServices();
    case OnboardingFlowStep.Birthday:
      return OnboardingFlowEvent.skipBirthday();
    default:
      return OnboardingFlowEvent.skipAvatar();
  }
}

/** Linear scan of the (at most three-entry) plan. */
function planHas(plan: readonly PersonalizeStep[], step: string): boolean {
  for (let i = 0; i < plan.length; i++) {
    if (plan[i] === step) return true;
  }
  return false;
}

function invalid(
  state: OnboardingFlowState,
  event: OnboardingFlowEvent,
): Result<OnboardingFlowState, IdentityError> {
  return Result.err(
    IdentityError.onboardingFlowInvalidTransition(
      state.onboardingFlowStep,
      event.onboardingFlowEventKind,
    ),
  );
}

export const OnboardingFlowSystem = {
  initial(): OnboardingFlowState {
    return OnboardingFlowState.initial();
  },

  next(
    state: OnboardingFlowState,
    event: OnboardingFlowEvent,
  ): Result<OnboardingFlowState, IdentityError> {
    switch (state.onboardingFlowStep) {
      case OnboardingFlowStep.About:
        switch (event.onboardingFlowEventKind) {
          case OnboardingFlowEventKind.SubmitAbout:
            // No state change — the store awaits the registration callable
            // and dispatches `REGISTERED`/`REGISTRATION_FAILED`.
            return Result.ok(state);
          case OnboardingFlowEventKind.Registered:
            return Result.ok(OnboardingFlowState.reward());
          case OnboardingFlowEventKind.RegistrationFailed:
            return Result.ok(OnboardingFlowState.about(event.message));
          default:
            return invalid(state, event);
        }

      case OnboardingFlowStep.Reward:
        if (
          event.onboardingFlowEventKind === OnboardingFlowEventKind.Personalize
        ) {
          return Result.ok(OnboardingFlowState.services([]));
        }
        if (
          event.onboardingFlowEventKind === OnboardingFlowEventKind.EnterApp
        ) {
          return Result.ok(OnboardingFlowState.entering());
        }
        return invalid(state, event);

      case OnboardingFlowStep.Services:
        switch (event.onboardingFlowEventKind) {
          case OnboardingFlowEventKind.SubmitServices:
            return Result.ok(
              OnboardingFlowState.birthday(event.services, null),
            );
          case OnboardingFlowEventKind.SkipServices:
            return Result.ok(OnboardingFlowState.birthday([], null));
          case OnboardingFlowEventKind.Back:
            return Result.ok(OnboardingFlowState.reward());
          default:
            return invalid(state, event);
        }

      case OnboardingFlowStep.Birthday:
        switch (event.onboardingFlowEventKind) {
          case OnboardingFlowEventKind.SubmitBirthday:
          case OnboardingFlowEventKind.SkipBirthday:
            return Result.ok(OnboardingFlowState.avatar(state.selected));
          case OnboardingFlowEventKind.BirthdayFailed:
            return Result.ok(
              OnboardingFlowState.birthday(state.selected, event.message),
            );
          case OnboardingFlowEventKind.Back:
            return Result.ok(OnboardingFlowState.services(state.selected));
          default:
            return invalid(state, event);
        }

      case OnboardingFlowStep.Avatar:
        switch (event.onboardingFlowEventKind) {
          case OnboardingFlowEventKind.Back:
            return Result.ok(
              OnboardingFlowState.birthday(state.selected, null),
            );
          case OnboardingFlowEventKind.SkipAvatar:
          case OnboardingFlowEventKind.EnterApp:
            return Result.ok(OnboardingFlowState.entering());
          default:
            return invalid(state, event);
        }

      default:
        // ENTERING: terminal, no outgoing transition.
        return invalid(state, event);
    }
  },

  /** A personalization step (services, birthday, avatar) — the ones a plan may leave out. */
  isPersonalizeStep(step: string): step is PersonalizeStep {
    return planHas(PERSONALIZE_STEPS, step);
  },

  /**
   * One event, then every personalization step the plan leaves out stepped
   * over with its skip event (at most one pass over the three steps). The
   * first event's refusal is the answer; a refused skip stops where the walk
   * stands. A step inside the plan, or outside the personalization phase,
   * ends the walk.
   */
  nextWithinPlan(
    state: OnboardingFlowState,
    event: OnboardingFlowEvent,
    plan: readonly PersonalizeStep[],
  ): Result<OnboardingFlowState, IdentityError> {
    const first = OnboardingFlowSystem.next(state, event);
    if (!first.ok) return first;
    let current = first.value;
    for (let guard = 0; guard < PERSONALIZE_STEPS.length; guard++) {
      const step = current.onboardingFlowStep;
      if (!OnboardingFlowSystem.isPersonalizeStep(step) || planHas(plan, step))
        break;
      const skipped = OnboardingFlowSystem.next(current, skipEventOf(step));
      if (!skipped.ok) break;
      current = skipped.value;
    }
    return Result.ok(current);
  },

  /**
   * Back, walked BACKWARDS through the plan — stepping over every step the
   * resume already satisfied, so back never lands on a step the forward
   * walk would skip straight away again.
   */
  backWithinPlan(
    state: OnboardingFlowState,
    plan: readonly PersonalizeStep[],
  ): Result<OnboardingFlowState, IdentityError> {
    const back = OnboardingFlowEvent.back();
    const first = OnboardingFlowSystem.next(state, back);
    if (!first.ok) return first;
    let current = first.value;
    for (let guard = 0; guard < PERSONALIZE_STEPS.length; guard++) {
      const step = current.onboardingFlowStep;
      if (!OnboardingFlowSystem.isPersonalizeStep(step) || planHas(plan, step))
        break;
      const stepped = OnboardingFlowSystem.next(current, back);
      if (!stepped.ok) break;
      current = stepped.value;
    }
    return Result.ok(current);
  },

  /** 1-based position of the state's step within the plan; 0 outside the personalization phase or the plan. */
  planPosition(
    state: OnboardingFlowState,
    plan: readonly PersonalizeStep[],
  ): number {
    if (!OnboardingFlowSystem.isPersonalizeStep(state.onboardingFlowStep)) {
      return 0;
    }
    for (let i = 0; i < plan.length; i++) {
      if (plan[i] === state.onboardingFlowStep) return i + 1;
    }
    return 0;
  },
} as const;
