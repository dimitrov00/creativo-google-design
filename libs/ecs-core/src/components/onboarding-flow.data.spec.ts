import { describe, expect, it } from 'vitest';
import { ServiceId } from '@core/primitives';
import {
  AccountsError,
  IdentityError,
  PipelineError,
  PipelineErrorCode,
} from '@core/errors';
import {
  OnboardingFlowEvent,
  OnboardingFlowEventKind,
} from './onboarding-flow-event.data';
import {
  OnboardingFlowState,
  OnboardingFlowStep,
} from './onboarding-flow.data';
import type { RegistrationFields } from './registration-fields.data';

const picked = [ServiceId.of('svc-cut'), ServiceId.of('svc-beard')];

describe('OnboardingFlowState', () => {
  it('opens on about with no error, a shared struct', () => {
    expect(OnboardingFlowState.initial()).toEqual({
      onboardingFlowStep: 'ABOUT',
      error: null,
    });
    expect(OnboardingFlowState.initial()).toBe(OnboardingFlowState.about(null));
  });

  it('about(error) carries the refusal to show, as its struct', () => {
    const refusal = IdentityError.registrationFieldMissing('firstName');
    expect(OnboardingFlowState.about(refusal)).toEqual({
      onboardingFlowStep: OnboardingFlowStep.About,
      error: refusal,
    });
  });

  it('the personalization steps carry the picked services', () => {
    expect(OnboardingFlowState.services(picked)).toEqual({
      onboardingFlowStep: 'SERVICES',
      selected: picked,
    });
    expect(OnboardingFlowState.birthday(picked, null)).toEqual({
      onboardingFlowStep: 'BIRTHDAY',
      selected: picked,
      error: null,
    });
    expect(OnboardingFlowState.avatar([])).toEqual({
      onboardingFlowStep: 'AVATAR',
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
    expect(OnboardingFlowState.reward()).toEqual({
      onboardingFlowStep: 'REWARD',
    });
    expect(OnboardingFlowState.entering()).toEqual({
      onboardingFlowStep: 'ENTERING',
    });
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
      onboardingFlowEventKind: OnboardingFlowEventKind.SubmitAbout,
      fields,
    });
    const taken = PipelineError.bare(PipelineErrorCode.InvalidRequest);
    expect(OnboardingFlowEvent.registrationFailed(taken)).toEqual({
      onboardingFlowEventKind: OnboardingFlowEventKind.RegistrationFailed,
      error: taken,
    });
    expect(
      OnboardingFlowEvent.submitServices([ServiceId.of('svc-cut')]),
    ).toEqual({
      onboardingFlowEventKind: OnboardingFlowEventKind.SubmitServices,
      services: ['svc-cut'],
    });
    expect(
      OnboardingFlowEvent.birthdayFailed(
        AccountsError.updateProfileRepositoryFailure(),
      ),
    ).toEqual({
      onboardingFlowEventKind: OnboardingFlowEventKind.BirthdayFailed,
      error: AccountsError.updateProfileRepositoryFailure(),
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
      { onboardingFlowEventKind: OnboardingFlowEventKind.Registered },
      { onboardingFlowEventKind: OnboardingFlowEventKind.Personalize },
      { onboardingFlowEventKind: OnboardingFlowEventKind.EnterApp },
      { onboardingFlowEventKind: OnboardingFlowEventKind.SkipServices },
      { onboardingFlowEventKind: OnboardingFlowEventKind.SubmitBirthday },
      { onboardingFlowEventKind: OnboardingFlowEventKind.SkipBirthday },
      { onboardingFlowEventKind: OnboardingFlowEventKind.SkipAvatar },
      { onboardingFlowEventKind: OnboardingFlowEventKind.Back },
    ]);
  });
});
