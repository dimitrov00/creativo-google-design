import { describe, expect, it } from 'vitest';
import { Result } from '@creativo/domain/kernel';
import { ServiceId } from '@creativo/domain/catalog';
import {
  ONBOARDING_FLOW_INITIAL_STATE,
  OnboardingFlowState,
  advanceOnboardingFlow,
} from './onboarding-flow';
import { InvalidOnboardingFlowTransitionError } from './onboarding-flow.errors';

function requiredValue<T, E>(result: Result<T, E>): T {
  if (result.isFailure()) throw new Error('unexpected failure in test fixture');
  return result.value;
}

function advance(
  state: OnboardingFlowState,
  event: Parameters<typeof advanceOnboardingFlow>[1],
): OnboardingFlowState {
  return requiredValue(advanceOnboardingFlow(state, event));
}

describe('advanceOnboardingFlow', () => {
  it('walks about -> reward -> services -> avatar -> entering, personalizing along the way', () => {
    let state = advance(ONBOARDING_FLOW_INITIAL_STATE, { type: 'registered' });
    expect(state.kind).toBe('reward');

    state = advance(state, { type: 'personalize' });
    expect(state.kind).toBe('services');

    const serviceId = requiredValue(ServiceId.create('service_1'));
    state = advance(state, { type: 'submit_services', services: [serviceId] });
    expect(state.kind).toBe('avatar');
    if (state.kind === 'avatar') {
      expect(state.selected).toEqual([serviceId]);
    }

    state = advance(state, { type: 'skip_avatar' });
    expect(state.kind).toBe('entering');
  });

  it('lets a returning-enough user skip straight from reward to entering', () => {
    let state = advance(ONBOARDING_FLOW_INITIAL_STATE, { type: 'registered' });
    state = advance(state, { type: 'enter_app' });
    expect(state.kind).toBe('entering');
  });

  it('skipping services still reaches avatar with nothing selected', () => {
    let state = advance(ONBOARDING_FLOW_INITIAL_STATE, { type: 'registered' });
    state = advance(state, { type: 'personalize' });
    state = advance(state, { type: 'skip_services' });
    expect(state.kind).toBe('avatar');
    if (state.kind === 'avatar') {
      expect(state.selected).toEqual([]);
    }
  });

  it('keeps a failed registration on the about step, carrying the error', () => {
    const state = advance(ONBOARDING_FLOW_INITIAL_STATE, {
      type: 'registration_failed',
      message: 'destination already registered',
    });
    expect(state.kind).toBe('about');
    if (state.kind === 'about') {
      expect(state.error).toBe('destination already registered');
    }
  });

  it('back from avatar returns to services, preserving the selection', () => {
    let state = advance(ONBOARDING_FLOW_INITIAL_STATE, { type: 'registered' });
    state = advance(state, { type: 'personalize' });
    const serviceId = requiredValue(ServiceId.create('service_1'));
    state = advance(state, { type: 'submit_services', services: [serviceId] });

    state = advance(state, { type: 'back' });
    expect(state.kind).toBe('services');
  });

  it('rejects an illegal transition from a terminal state', () => {
    const result = advanceOnboardingFlow(
      { kind: 'entering' },
      { type: 'personalize' },
    );
    expect(result.isFailure()).toBe(true);
    if (result.isFailure()) {
      expect(result.error).toBeInstanceOf(InvalidOnboardingFlowTransitionError);
    }
  });

  it('rejects personalizing from the about step', () => {
    const result = advanceOnboardingFlow(ONBOARDING_FLOW_INITIAL_STATE, {
      type: 'personalize',
    });
    expect(result.isFailure()).toBe(true);
  });
});
