import { Result, fail, ok } from '@creativo/domain/kernel';
import { ServiceId } from '@creativo/domain/catalog';
import { RegistrationField } from '@creativo/domain/identity';
import { InvalidOnboardingFlowTransitionError } from './onboarding-flow.errors';

/**
 * Pure port of v2's `onboarding.machine.ts` (`docs/migration-blueprint.md`
 * §5.3) — Phase 1 (required registration) then Phase 2 (optional
 * personalization). Like `AuthFlow`, the async `saving` step collapses
 * into events the wrapping feature store dispatches once
 * `RegisterUserUseCase` settles.
 */
export type OnboardingFlowState =
  | { readonly kind: 'about'; readonly error?: string }
  | { readonly kind: 'reward' }
  | { readonly kind: 'services'; readonly selected: readonly ServiceId[] }
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
          return ok({ kind: 'avatar', selected: event.services });
        case 'skip_services':
          return ok({ kind: 'avatar', selected: [] });
        case 'back':
          return ok({ kind: 'reward' });
        default:
          break;
      }
      break;

    case 'avatar':
      switch (event.type) {
        case 'back':
          return ok({ kind: 'services', selected: state.selected });
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
