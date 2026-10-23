import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ServiceId } from '@core/primitives';
import { IdentityErrorCode } from '@core/errors';
import {
  OnboardingFlowEvent,
  OnboardingFlowEventKind,
  OnboardingFlowState,
  OnboardingFlowStep,
  Registration,
} from '@core/components';
import { deepFreeze, unwrapErr, unwrapOk } from '@core/testing';
import {
  OnboardingFlowSystem,
  PERSONALIZE_STEPS,
  type PersonalizeStep,
} from './onboarding-flow.system';

/*
 * The cases of the legacy identity application lib's `onboarding-flow.spec.ts`
 * (deleted in Phase 4b; ledger `docs/architecture/flips/phase-4b-delete.md`
 * §11.1), COPIED and re-targeted: `advanceOnboardingFlow` →
 * `OnboardingFlowSystem.next`, the `{ type }` events → the
 * `OnboardingFlowEvent` companion, `isSuccess(r)` → `r.ok`, the transition
 * error class → the `IDENTITY_ONBOARDING_FLOW_INVALID_TRANSITION` struct. Then
 * the resume plan the OnboardingFlowStore walked by hand
 * (libs/features/client/onboarding/ src/lib/onboarding-flow.store.spec.ts:
 * steps outside the plan are stepped over forward and backward, the 1-based
 * plan position).
 */

const SERVICE = ServiceId.of('service_1');

function advance(
  state: OnboardingFlowState,
  event: OnboardingFlowEvent,
): OnboardingFlowState {
  return unwrapOk(OnboardingFlowSystem.next(state, event));
}

const registered = (): OnboardingFlowState =>
  advance(OnboardingFlowSystem.initial(), OnboardingFlowEvent.registered());

describe('OnboardingFlowSystem.next', () => {
  it('walks about -> reward -> services -> birthday -> avatar -> entering, personalizing along the way', () => {
    let state = registered();
    expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.Reward);

    state = advance(state, OnboardingFlowEvent.personalize());
    expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.Services);

    state = advance(state, OnboardingFlowEvent.submitServices([SERVICE]));
    expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.Birthday);
    if (state.onboardingFlowStep === OnboardingFlowStep.Birthday) {
      expect(state.selected).toEqual([SERVICE]);
    }

    state = advance(state, OnboardingFlowEvent.submitBirthday());
    expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.Avatar);
    if (state.onboardingFlowStep === OnboardingFlowStep.Avatar) {
      expect(state.selected).toEqual([SERVICE]);
    }

    state = advance(state, OnboardingFlowEvent.skipAvatar());
    expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.Entering);
  });

  it('lets a returning-enough user skip straight from reward to entering', () => {
    const state = advance(registered(), OnboardingFlowEvent.enterApp());
    expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.Entering);
  });

  it('skipping services still reaches the birthday step with nothing selected', () => {
    let state = advance(registered(), OnboardingFlowEvent.personalize());
    state = advance(state, OnboardingFlowEvent.skipServices());
    expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.Birthday);
    if (state.onboardingFlowStep === OnboardingFlowStep.Birthday) {
      expect(state.selected).toEqual([]);
    }
  });

  it('skipping the birthday reaches avatar, preserving the service selection', () => {
    let state = advance(registered(), OnboardingFlowEvent.personalize());
    state = advance(state, OnboardingFlowEvent.submitServices([SERVICE]));
    state = advance(state, OnboardingFlowEvent.skipBirthday());
    expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.Avatar);
    if (state.onboardingFlowStep === OnboardingFlowStep.Avatar) {
      expect(state.selected).toEqual([SERVICE]);
    }
  });

  it('keeps a failed birthday save on the birthday step, carrying the error', () => {
    let state = advance(registered(), OnboardingFlowEvent.personalize());
    state = advance(state, OnboardingFlowEvent.skipServices());
    state = advance(
      state,
      OnboardingFlowEvent.birthdayFailed(
        'ACCOUNTS_UPDATE_PROFILE_REPOSITORY_FAILURE',
      ),
    );
    expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.Birthday);
    if (state.onboardingFlowStep === OnboardingFlowStep.Birthday) {
      expect(state.error).toBe('ACCOUNTS_UPDATE_PROFILE_REPOSITORY_FAILURE');
    }
  });

  it('keeps a failed registration on the about step, carrying the error', () => {
    const state = advance(
      OnboardingFlowSystem.initial(),
      OnboardingFlowEvent.registrationFailed('destination already registered'),
    );
    expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.About);
    if (state.onboardingFlowStep === OnboardingFlowStep.About) {
      expect(state.error).toBe('destination already registered');
    }
  });

  it('back walks avatar -> birthday -> services, preserving the selection', () => {
    let state = advance(registered(), OnboardingFlowEvent.personalize());
    state = advance(state, OnboardingFlowEvent.submitServices([SERVICE]));
    state = advance(state, OnboardingFlowEvent.skipBirthday());
    expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.Avatar);

    state = advance(state, OnboardingFlowEvent.back());
    expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.Birthday);
    if (state.onboardingFlowStep === OnboardingFlowStep.Birthday) {
      expect(state.selected).toEqual([SERVICE]);
    }

    state = advance(state, OnboardingFlowEvent.back());
    expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.Services);
    if (state.onboardingFlowStep === OnboardingFlowStep.Services) {
      expect(state.selected).toEqual([SERVICE]);
    }

    state = advance(state, OnboardingFlowEvent.back());
    expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.Reward);
  });

  it('rejects an illegal transition from a terminal state', () => {
    const error = unwrapErr(
      OnboardingFlowSystem.next(
        OnboardingFlowState.entering(),
        OnboardingFlowEvent.personalize(),
      ),
    );
    expect(error).toEqual({
      errorCode: IdentityErrorCode.OnboardingFlowInvalidTransition,
      from: OnboardingFlowStep.Entering,
      event: OnboardingFlowEventKind.Personalize,
    });
  });

  it('rejects personalizing from the about step', () => {
    const result = OnboardingFlowSystem.next(
      OnboardingFlowSystem.initial(),
      OnboardingFlowEvent.personalize(),
    );
    expect(result.ok).toBe(false);
  });

  it('stays on about while the registration call is in flight', () => {
    const about = OnboardingFlowSystem.initial();
    expect(
      advance(
        about,
        OnboardingFlowEvent.submitAbout(Registration.emptyFields()),
      ),
    ).toBe(about);
  });
});

describe('OnboardingFlowSystem resume plan (onboarding-flow.store.spec.ts)', () => {
  /** The store's `beginPersonalization(plan)`: `registered`, then `personalize`, each walked within the plan. */
  function begin(plan: readonly PersonalizeStep[]): OnboardingFlowState {
    const reward = unwrapOk(
      OnboardingFlowSystem.nextWithinPlan(
        OnboardingFlowSystem.initial(),
        OnboardingFlowEvent.registered(),
        plan,
      ),
    );
    return unwrapOk(
      OnboardingFlowSystem.nextWithinPlan(
        reward,
        OnboardingFlowEvent.personalize(),
        plan,
      ),
    );
  }

  const within = (
    state: OnboardingFlowState,
    event: OnboardingFlowEvent,
    plan: readonly PersonalizeStep[],
  ): OnboardingFlowState =>
    unwrapOk(OnboardingFlowSystem.nextWithinPlan(state, event, plan));

  it('beginPersonalization enters the services step directly — the returning-active-account path (no About form, no network)', () => {
    expect(begin(PERSONALIZE_STEPS).onboardingFlowStep).toBe(
      OnboardingFlowStep.Services,
    );
  });

  it('a plan opens on its first step, with the earlier plan step still reachable via back', () => {
    const plan: readonly PersonalizeStep[] = [
      OnboardingFlowStep.Services,
      OnboardingFlowStep.Birthday,
    ];
    let state = begin(plan);
    expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.Services);
    state = within(state, OnboardingFlowEvent.skipServices(), plan);
    expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.Birthday);

    state = unwrapOk(OnboardingFlowSystem.backWithinPlan(state, plan));
    expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.Services);
  });

  it('steps OVER anything the profile already satisfies, forwards and backwards', () => {
    // Birthday already set elsewhere — this resume is services → avatar.
    const plan: readonly PersonalizeStep[] = [
      OnboardingFlowStep.Services,
      OnboardingFlowStep.Avatar,
    ];
    let state = begin(plan);
    expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.Services);

    state = within(state, OnboardingFlowEvent.skipServices(), plan);
    // The machine's next state is `birthday`; the plan skips it.
    expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.Avatar);

    state = unwrapOk(OnboardingFlowSystem.backWithinPlan(state, plan));
    // …and back doesn't land on it either, which would freeze the screen.
    expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.Services);
  });

  it('a single remaining step opens directly on it and reports itself as one screen', () => {
    const plan: readonly PersonalizeStep[] = [OnboardingFlowStep.Avatar];
    const state = begin(plan);

    expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.Avatar);
    expect(OnboardingFlowSystem.planPosition(state, plan)).toBe(1);
  });

  it('finishing the last planned step goes straight to entering, not to a redundant one', () => {
    const plan: readonly PersonalizeStep[] = [OnboardingFlowStep.Birthday];
    let state = begin(plan);
    expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.Birthday);

    state = within(state, OnboardingFlowEvent.skipBirthday(), plan);

    // Avatar is NOT in the plan (the photo is already there), so the flow
    // is done rather than asking for it again.
    expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.Entering);
  });

  it('back from the only planned step steps over the unplanned ones, all the way to reward', () => {
    const plan: readonly PersonalizeStep[] = [OnboardingFlowStep.Avatar];
    const state = unwrapOk(
      OnboardingFlowSystem.backWithinPlan(begin(plan), plan),
    );
    expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.Reward);
  });

  it('an event the step refuses is the answer — nothing is skipped', () => {
    expect(
      OnboardingFlowSystem.nextWithinPlan(
        OnboardingFlowSystem.initial(),
        OnboardingFlowEvent.personalize(),
        PERSONALIZE_STEPS,
      ).ok,
    ).toBe(false);
    expect(
      OnboardingFlowSystem.backWithinPlan(
        OnboardingFlowState.entering(),
        PERSONALIZE_STEPS,
      ).ok,
    ).toBe(false);
  });

  it('plan position is 0 outside the personalization phase and outside the plan', () => {
    expect(
      OnboardingFlowSystem.planPosition(registered(), PERSONALIZE_STEPS),
    ).toBe(0);
    expect(
      OnboardingFlowSystem.planPosition(OnboardingFlowState.services([]), [
        OnboardingFlowStep.Birthday,
      ]),
    ).toBe(0);
  });
});

describe('OnboardingFlowSystem properties', () => {
  const anyPlan = fc.subarray([...PERSONALIZE_STEPS]);

  const states: readonly OnboardingFlowState[] = [
    OnboardingFlowState.initial(),
    OnboardingFlowState.about('x'),
    OnboardingFlowState.reward(),
    OnboardingFlowState.services([SERVICE]),
    OnboardingFlowState.birthday([SERVICE], null),
    OnboardingFlowState.avatar([]),
    OnboardingFlowState.entering(),
  ];
  const events: readonly OnboardingFlowEvent[] = [
    OnboardingFlowEvent.submitAbout(Registration.emptyFields()),
    OnboardingFlowEvent.registered(),
    OnboardingFlowEvent.registrationFailed('x'),
    OnboardingFlowEvent.personalize(),
    OnboardingFlowEvent.enterApp(),
    OnboardingFlowEvent.submitServices([SERVICE]),
    OnboardingFlowEvent.skipServices(),
    OnboardingFlowEvent.submitBirthday(),
    OnboardingFlowEvent.skipBirthday(),
    OnboardingFlowEvent.birthdayFailed('x'),
    OnboardingFlowEvent.skipAvatar(),
    OnboardingFlowEvent.back(),
  ];

  it('is total: every (state, event) pair answers, a refusal names both tags, and entering refuses everything', () => {
    for (const state of states) {
      for (const event of events) {
        const result = OnboardingFlowSystem.next(state, event);
        if (OnboardingFlowState.isTerminal(state))
          expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toEqual({
            errorCode: IdentityErrorCode.OnboardingFlowInvalidTransition,
            from: state.onboardingFlowStep,
            event: event.onboardingFlowEventKind,
          });
        }
      }
    }
    // Every step but entering accepts at least one event and refuses another.
    for (const state of states.slice(0, -1)) {
      const answers = events.map((e) => OnboardingFlowSystem.next(state, e).ok);
      expect(answers).toContain(true);
      expect(answers).toContain(false);
    }
  });

  it('a forward walk inside a plan only ever rests on a planned step or outside the personalization phase', () => {
    fc.assert(
      fc.property(anyPlan, (plan) => {
        const state = unwrapOk(
          OnboardingFlowSystem.nextWithinPlan(
            registered(),
            OnboardingFlowEvent.personalize(),
            plan,
          ),
        );
        if (OnboardingFlowSystem.isPersonalizeStep(state.onboardingFlowStep)) {
          expect(plan).toContain(state.onboardingFlowStep);
        } else {
          expect(plan).toEqual([]);
          expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.Entering);
        }
      }),
    );
  });
});

describe('OnboardingFlowSystem purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const state = deepFreeze(OnboardingFlowState.birthday([SERVICE], null));
    const event = deepFreeze(OnboardingFlowEvent.submitBirthday());
    const plan = deepFreeze([OnboardingFlowStep.Birthday] as const);
    const run = () => ({
      next: OnboardingFlowSystem.next(state, event),
      within: OnboardingFlowSystem.nextWithinPlan(state, event, plan),
      back: OnboardingFlowSystem.backWithinPlan(state, plan),
    });
    const once = run();
    const twice = run();
    expect(twice).toEqual(once);
    expect(state).toEqual(OnboardingFlowState.birthday([SERVICE], null));
  });
});
