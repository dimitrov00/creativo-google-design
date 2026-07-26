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
  it('walks about -> reward -> services -> birthday -> avatar -> entering, personalizing along the way', () => {
    let state = advance(ONBOARDING_FLOW_INITIAL_STATE, { type: 'registered' });
    expect(state.kind).toBe('reward');

    state = advance(state, { type: 'personalize' });
    expect(state.kind).toBe('services');

    const serviceId = requiredValue(ServiceId.create('service_1'));
    state = advance(state, { type: 'submit_services', services: [serviceId] });
    expect(state.kind).toBe('birthday');
    if (state.kind === 'birthday') {
      expect(state.selected).toEqual([serviceId]);
    }

    state = advance(state, { type: 'submit_birthday' });
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

  it('skipping services still reaches the birthday step with nothing selected', () => {
    let state = advance(ONBOARDING_FLOW_INITIAL_STATE, { type: 'registered' });
    state = advance(state, { type: 'personalize' });
    state = advance(state, { type: 'skip_services' });
    expect(state.kind).toBe('birthday');
    if (state.kind === 'birthday') {
      expect(state.selected).toEqual([]);
    }
  });

  it('skipping the birthday reaches avatar, preserving the service selection', () => {
    let state = advance(ONBOARDING_FLOW_INITIAL_STATE, { type: 'registered' });
    state = advance(state, { type: 'personalize' });
    const serviceId = requiredValue(ServiceId.create('service_1'));
    state = advance(state, { type: 'submit_services', services: [serviceId] });
    state = advance(state, { type: 'skip_birthday' });
    expect(state.kind).toBe('avatar');
    if (state.kind === 'avatar') {
      expect(state.selected).toEqual([serviceId]);
    }
  });

  it('keeps a failed birthday save on the birthday step, carrying the error', () => {
    let state = advance(ONBOARDING_FLOW_INITIAL_STATE, { type: 'registered' });
    state = advance(state, { type: 'personalize' });
    state = advance(state, { type: 'skip_services' });
    state = advance(state, {
      type: 'birthday_failed',
      message: 'accounts.update_profile.repository_failure',
    });
    expect(state.kind).toBe('birthday');
    if (state.kind === 'birthday') {
      expect(state.error).toBe('accounts.update_profile.repository_failure');
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

  it('back walks avatar -> birthday -> services, preserving the selection', () => {
    let state = advance(ONBOARDING_FLOW_INITIAL_STATE, { type: 'registered' });
    state = advance(state, { type: 'personalize' });
    const serviceId = requiredValue(ServiceId.create('service_1'));
    state = advance(state, { type: 'submit_services', services: [serviceId] });
    state = advance(state, { type: 'skip_birthday' });
    expect(state.kind).toBe('avatar');

    state = advance(state, { type: 'back' });
    expect(state.kind).toBe('birthday');
    if (state.kind === 'birthday') {
      expect(state.selected).toEqual([serviceId]);
    }

    state = advance(state, { type: 'back' });
    expect(state.kind).toBe('services');
    if (state.kind === 'services') {
      expect(state.selected).toEqual([serviceId]);
    }
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
