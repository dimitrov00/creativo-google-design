import {
  type IdentityError,
  OnboardingFlowEvent as FlowEvent,
  OnboardingFlowState as FlowState,
  OnboardingFlowStep,
  OnboardingFlowSystem,
  type PersonalizeStep,
  type Result as FlowResult,
  ServiceId as ServiceKey,
} from '@creativo/ecs-core';
import { Result, fail, ok } from '@creativo/domain/kernel';
import { ServiceId } from '@creativo/domain/catalog';
import { RegistrationField } from '@creativo/domain/identity';
import { toRegistrationFields } from '../registration-fields.shim';
import { InvalidOnboardingFlowTransitionError } from './onboarding-flow.errors';

/**
 * Pure port of v2's `onboarding.machine.ts` (`docs/migration-blueprint.md`
 * §5.3) — Phase 1 (required registration: about collects names + phone
 * ONLY) then Phase 2 (optional personalization: services → birthday →
 * avatar, every step skippable). The optional birthday lives in Phase 2 as
 * its own step — progressive disclosure keeps the required form minimal.
 * Like `AuthFlow`, the async `saving` steps collapse into events the
 * wrapping feature store dispatches once `RegisterUserUseCase` (about) or
 * `UpdateProfileUseCase` (birthday) settles.
 */
export type OnboardingFlowState =
  | { readonly kind: 'about'; readonly error?: string }
  | { readonly kind: 'reward' }
  | { readonly kind: 'services'; readonly selected: readonly ServiceId[] }
  | {
      readonly kind: 'birthday';
      readonly selected: readonly ServiceId[];
      readonly error?: string;
    }
  | { readonly kind: 'avatar'; readonly selected: readonly ServiceId[] }
  | { readonly kind: 'entering' };

export type OnboardingFlowEvent =
  | {
      readonly type: 'submit_about';
      readonly fields: Partial<Record<RegistrationField, string>>;
    }
  | { readonly type: 'registered' }
  | { readonly type: 'registration_failed'; readonly message: string }
  | { readonly type: 'personalize' }
  | { readonly type: 'enter_app' }
  | {
      readonly type: 'submit_services';
      readonly services: readonly ServiceId[];
    }
  | { readonly type: 'skip_services' }
  // Dispatched by the store only AFTER `UpdateProfileUseCase` settles
  // successfully — mirrors `registered` (the async save collapses into
  // events, never a `saving` state of its own).
  | { readonly type: 'submit_birthday' }
  | { readonly type: 'skip_birthday' }
  | { readonly type: 'birthday_failed'; readonly message: string }
  | { readonly type: 'skip_avatar' }
  | { readonly type: 'back' };

export const ONBOARDING_FLOW_INITIAL_STATE: OnboardingFlowState = {
  kind: 'about',
};

/*
 * Phase 2 shim (ECS migration): the transition function and the resume
 * plan walk are `OnboardingFlowSystem` (`@creativo/ecs-core`). This file
 * keeps its legacy state, event and error shapes for the store and converts
 * at the edge — the helpers below are the only code besides the delegating
 * bodies.
 */

/** The legacy selection and its system twin, so a carried selection maps back to the caller's own array. */
type Selection = {
  readonly legacy: readonly ServiceId[];
  readonly keys: readonly ServiceKey[];
};

function toSelection(selected: readonly ServiceId[]): Selection {
  return {
    legacy: selected,
    keys: selected.map((id) => ServiceKey.of(id.value)),
  };
}

/** The state as the system's struct, beside the selections it carries. */
function toFlowState(
  state: OnboardingFlowState,
  selections: Selection[],
): FlowState {
  switch (state.kind) {
    case 'about':
      return FlowState.about(state.error ?? null);
    case 'reward':
      return FlowState.reward();
    case 'services': {
      const selection = toSelection(state.selected);
      selections.push(selection);
      return FlowState.services(selection.keys);
    }
    case 'birthday': {
      const selection = toSelection(state.selected);
      selections.push(selection);
      return FlowState.birthday(selection.keys, state.error ?? null);
    }
    case 'avatar': {
      const selection = toSelection(state.selected);
      selections.push(selection);
      return FlowState.avatar(selection.keys);
    }
    default:
      return FlowState.entering();
  }
}

/** The event as the system's struct, beside the selection it carries. */
function toFlowEvent(
  event: OnboardingFlowEvent,
  selections: Selection[],
): FlowEvent {
  switch (event.type) {
    case 'submit_about':
      return FlowEvent.submitAbout(toRegistrationFields(event.fields));
    case 'registered':
      return FlowEvent.registered();
    case 'registration_failed':
      return FlowEvent.registrationFailed(event.message);
    case 'personalize':
      return FlowEvent.personalize();
    case 'enter_app':
      return FlowEvent.enterApp();
    case 'submit_services': {
      const selection = toSelection(event.services);
      selections.push(selection);
      return FlowEvent.submitServices(selection.keys);
    }
    case 'skip_services':
      return FlowEvent.skipServices();
    case 'submit_birthday':
      return FlowEvent.submitBirthday();
    case 'skip_birthday':
      return FlowEvent.skipBirthday();
    case 'birthday_failed':
      return FlowEvent.birthdayFailed(event.message);
    case 'skip_avatar':
      return FlowEvent.skipAvatar();
    default:
      return FlowEvent.back();
  }
}

/**
 * A selection back as the caller's own array — the system only ever carries
 * one through, or starts an empty one — rebuilt from the keys otherwise.
 */
function toLegacySelected(
  keys: readonly ServiceKey[],
  selections: readonly Selection[],
): readonly ServiceId[] {
  for (const selection of selections) {
    if (selection.keys === keys) return selection.legacy;
  }
  const rebuilt: ServiceId[] = [];
  for (const key of keys) {
    const id = ServiceId.create(key);
    if (id.isSuccess()) rebuilt.push(id.value);
  }
  return rebuilt;
}

function toLegacyState(
  next: FlowState,
  selections: readonly Selection[],
): OnboardingFlowState {
  switch (next.kind) {
    case OnboardingFlowStep.About:
      return next.error === null
        ? { kind: 'about' }
        : { kind: 'about', error: next.error };
    case OnboardingFlowStep.Reward:
      return { kind: 'reward' };
    case OnboardingFlowStep.Services:
      return {
        kind: 'services',
        selected: toLegacySelected(next.selected, selections),
      };
    case OnboardingFlowStep.Birthday: {
      const selected = toLegacySelected(next.selected, selections);
      return next.error === null
        ? { kind: 'birthday', selected }
        : { kind: 'birthday', selected, error: next.error };
    }
    case OnboardingFlowStep.Avatar:
      return {
        kind: 'avatar',
        selected: toLegacySelected(next.selected, selections),
      };
    default:
      return { kind: 'entering' };
  }
}

/** The system's answer back in the legacy shapes — an unchanged state is the caller's own object. */
function toLegacyResult(
  next: FlowResult<FlowState, IdentityError>,
  ecsState: FlowState,
  state: OnboardingFlowState,
  event: OnboardingFlowEvent,
  selections: readonly Selection[],
): Result<OnboardingFlowState, InvalidOnboardingFlowTransitionError> {
  if (!next.ok) {
    return fail(
      new InvalidOnboardingFlowTransitionError(state.kind, event.type),
    );
  }
  return ok(
    next.value === ecsState ? state : toLegacyState(next.value, selections),
  );
}

export function advanceOnboardingFlow(
  state: OnboardingFlowState,
  event: OnboardingFlowEvent,
): Result<OnboardingFlowState, InvalidOnboardingFlowTransitionError> {
  const selections: Selection[] = [];
  const ecsState = toFlowState(state, selections);
  const next = OnboardingFlowSystem.next(
    ecsState,
    toFlowEvent(event, selections),
  );
  return toLegacyResult(next, ecsState, state, event, selections);
}

/**
 * {@link advanceOnboardingFlow}, then every personalization step the resume
 * `plan` leaves out stepped over (`OnboardingFlowSystem.nextWithinPlan`).
 */
export function advanceOnboardingFlowWithinPlan(
  state: OnboardingFlowState,
  event: OnboardingFlowEvent,
  plan: readonly PersonalizeStep[],
): Result<OnboardingFlowState, InvalidOnboardingFlowTransitionError> {
  const selections: Selection[] = [];
  const ecsState = toFlowState(state, selections);
  const next = OnboardingFlowSystem.nextWithinPlan(
    ecsState,
    toFlowEvent(event, selections),
    plan,
  );
  return toLegacyResult(next, ecsState, state, event, selections);
}

/** Back, walked backwards through the resume `plan` (`OnboardingFlowSystem.backWithinPlan`). */
export function backOnboardingFlowWithinPlan(
  state: OnboardingFlowState,
  plan: readonly PersonalizeStep[],
): Result<OnboardingFlowState, InvalidOnboardingFlowTransitionError> {
  const selections: Selection[] = [];
  const ecsState = toFlowState(state, selections);
  const next = OnboardingFlowSystem.backWithinPlan(ecsState, plan);
  return toLegacyResult(next, ecsState, state, { type: 'back' }, selections);
}

/** 1-based position of the state's step within the resume `plan`; 0 outside it. */
export function onboardingPlanPosition(
  state: OnboardingFlowState,
  plan: readonly PersonalizeStep[],
): number {
  return OnboardingFlowSystem.planPosition(toFlowState(state, []), plan);
}
