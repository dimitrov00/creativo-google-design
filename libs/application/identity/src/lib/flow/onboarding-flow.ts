import { Result, fail, ok } from '@creativo/domain/kernel';
import { ServiceId } from '@creativo/domain/catalog';
import { RegistrationField } from '@creativo/domain/identity';
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

export function advanceOnboardingFlow(
  state: OnboardingFlowState,
  event: OnboardingFlowEvent,
): Result<OnboardingFlowState, InvalidOnboardingFlowTransitionError> {
  switch (state.kind) {
    case 'about':
      switch (event.type) {
        case 'submit_about':
          // No state change — the store awaits `RegisterUserUseCase` and
          // dispatches `registered`/`registration_failed` when it settles.
          return ok(state);
        case 'registered':
          return ok({ kind: 'reward' });
        case 'registration_failed':
          return ok({ kind: 'about', error: event.message });
        default:
          break;
      }
      break;

    case 'reward':
      if (event.type === 'personalize')
        return ok({ kind: 'services', selected: [] });
      if (event.type === 'enter_app') return ok({ kind: 'entering' });
      break;

    case 'services':
      switch (event.type) {
        case 'submit_services':
          return ok({ kind: 'birthday', selected: event.services });
        case 'skip_services':
          return ok({ kind: 'birthday', selected: [] });
        case 'back':
          return ok({ kind: 'reward' });
        default:
          break;
      }
      break;

    case 'birthday':
      switch (event.type) {
        case 'submit_birthday':
        case 'skip_birthday':
          return ok({ kind: 'avatar', selected: state.selected });
        case 'birthday_failed':
          return ok({
            kind: 'birthday',
            selected: state.selected,
            error: event.message,
          });
        case 'back':
          return ok({ kind: 'services', selected: state.selected });
        default:
          break;
      }
      break;

    case 'avatar':
      switch (event.type) {
        case 'back':
          return ok({ kind: 'birthday', selected: state.selected });
        case 'skip_avatar':
        case 'enter_app':
          return ok({ kind: 'entering' });
        default:
          break;
      }
      break;

    case 'entering':
      // Terminal — no outgoing transitions.
      break;
  }

  return fail(new InvalidOnboardingFlowTransitionError(state.kind, event.type));
}
