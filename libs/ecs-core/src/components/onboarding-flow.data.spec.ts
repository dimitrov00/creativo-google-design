import { describe, expect, it } from 'vitest';
import { ServiceId } from '../entities/service.entity';
import {
  OnboardingFlowEvent,
  OnboardingFlowEventKind,
  OnboardingFlowState,
  OnboardingFlowStep,
} from './onboarding-flow.data';
import type { RegistrationFields } from './registration.data';

const picked = [ServiceId.of('svc-cut'), ServiceId.of('svc-beard')];

describe('OnboardingFlowState', () => {
  it('opens on about with no error, a shared struct', () => {
    expect(OnboardingFlowState.initial()).toEqual({
      kind: 'about',
      error: null,
    });
    expect(OnboardingFlowState.initial()).toBe(OnboardingFlowState.about(null));
  });

  it('about(error) carries the refusal to show', () => {
    expect(OnboardingFlowState.about('accounts.first_name.too_short')).toEqual({
      kind: OnboardingFlowStep.About,
      error: 'accounts.first_name.too_short',
    });
  });

  it('the personalization steps carry the picked services', () => {
    expect(OnboardingFlowState.services(picked)).toEqual({
      kind: 'services',
      selected: picked,
    });
    expect(OnboardingFlowState.birthday(picked, null)).toEqual({
      kind: 'birthday',
      selected: picked,
      error: null,
    });
    expect(OnboardingFlowState.avatar([])).toEqual({
      kind: 'avatar',
      selected: [],
    });
  });

  it('only entering is terminal', () => {
    expect(OnboardingFlowState.isTerminal(OnboardingFlowState.entering())).toBe(
      true,
    );
    expect(OnboardingFlowState.isTerminal(OnboardingFlowState.reward())).toBe(
      false,
    );
    expect(OnboardingFlowState.reward()).toEqual({ kind: 'reward' });
    expect(OnboardingFlowState.entering()).toEqual({ kind: 'entering' });
  });
});

describe('OnboardingFlowEvent — each event built from its tag', () => {
  it('carries the payload each event names, and nothing else', () => {
    const fields: RegistrationFields = {
      phone: '+359885550100',
      email: null,
      firstName: 'Мария',
      lastName: 'Иванова',
      birthDate: null,
    };
    expect(OnboardingFlowEvent.submitAbout(fields)).toEqual({
      kind: OnboardingFlowEventKind.SubmitAbout,
      fields,
    });
    expect(OnboardingFlowEvent.registrationFailed('taken')).toEqual({
      kind: OnboardingFlowEventKind.RegistrationFailed,
      message: 'taken',
    });
    expect(
      OnboardingFlowEvent.submitServices([ServiceId.of('svc-cut')]),
    ).toEqual({
      kind: OnboardingFlowEventKind.SubmitServices,
      services: ['svc-cut'],
    });
    expect(OnboardingFlowEvent.birthdayFailed('invalid')).toEqual({
      kind: OnboardingFlowEventKind.BirthdayFailed,
      message: 'invalid',
    });
    expect([
      OnboardingFlowEvent.registered(),
      OnboardingFlowEvent.personalize(),
      OnboardingFlowEvent.enterApp(),
      OnboardingFlowEvent.skipServices(),
      OnboardingFlowEvent.submitBirthday(),
      OnboardingFlowEvent.skipBirthday(),
      OnboardingFlowEvent.skipAvatar(),
      OnboardingFlowEvent.back(),
    ]).toEqual([
      { kind: OnboardingFlowEventKind.Registered },
      { kind: OnboardingFlowEventKind.Personalize },
      { kind: OnboardingFlowEventKind.EnterApp },
      { kind: OnboardingFlowEventKind.SkipServices },
      { kind: OnboardingFlowEventKind.SubmitBirthday },
      { kind: OnboardingFlowEventKind.SkipBirthday },
      { kind: OnboardingFlowEventKind.SkipAvatar },
      { kind: OnboardingFlowEventKind.Back },
    ]);
  });
});
