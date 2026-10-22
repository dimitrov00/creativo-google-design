import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  Email,
  OnboardingFlowStep,
  ParsedIdentifier,
  type Principal,
  RegistrationField,
  type RegistrationFields,
} from '@core/components';
import { Callables } from '@core/ports';
import {
  IdentityErrorCode,
  PipelineError,
  Result,
  UserId,
} from '@core/primitives';
import {
  type GatewayCall,
  type OtpChallengeCall,
  immediateTimerPorts,
  memoryAuthSessionPorts,
  memoryAvatarPorts,
  memoryClockPorts,
  memoryOtpChallengePorts,
  principalFixture,
  scriptedGatewayPorts,
  utcMs,
} from '@core/testing';
import {
  AUTH_SESSION_PORTS,
  AVATAR_PORTS,
  CLOCK_PORTS,
  GATEWAY_PORTS,
  OTP_CHALLENGE_PORTS,
  TIMER_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { OnboardingFlowStore } from './onboarding-flow.store';

function emailIdentifier(): ParsedIdentifier {
  const email = Email.parse('client@example.com');
  if (email === null) throw new Error('unexpected failure in fixture');
  return ParsedIdentifier.email(email);
}

const UID = UserId.of('uid_1');

/** The about step's fields — every key present, `null` where not collected. */
const ABOUT_FIELDS: RegistrationFields = {
  [RegistrationField.Phone]: '+359881234567',
  [RegistrationField.Email]: null,
  [RegistrationField.FirstName]: 'Ada',
  [RegistrationField.LastName]: 'Lovelace',
  [RegistrationField.BirthDate]: null,
};

describe('OnboardingFlowStore — birthday step', () => {
  /** Every OTP callable the store dialled, in order. */
  let otpCalls: OtpChallengeCall[];
  /** Every gateway callable the store dialled (the profile save), in order. */
  let gatewayCalls: GatewayCall[];
  /** A spec sets it to make the `updateProfile` call fail as a store failure. */
  let writeFails: boolean;
  let store: OnboardingFlowStore;

  beforeEach(() => {
    otpCalls = [];
    gatewayCalls = [];
    writeFails = false;

    TestBed.configureTestingModule({
      providers: [
        OnboardingFlowStore,
        // Frozen clock — the birthday age window must never read real time.
        {
          provide: CLOCK_PORTS,
          useValue: memoryClockPorts(utcMs('2026-07-25T12:00:00.000Z')),
        },
        {
          provide: AUTH_SESSION_PORTS,
          useValue: memoryAuthSessionPorts({
            principals$: new BehaviorSubject<Principal>(
              principalFixture.onboarding(UID),
            ),
            identifier: emailIdentifier(),
          }),
        },
        { provide: TIMER_PORTS, useValue: immediateTimerPorts() },
        {
          provide: OTP_CHALLENGE_PORTS,
          useValue: memoryOtpChallengePorts({ calls: otpCalls }),
        },
        {
          provide: GATEWAY_PORTS,
          useValue: scriptedGatewayPorts(
            {
              [Callables.UpdateProfile]: () =>
                writeFails
                  ? Result.err(PipelineError.fromWire('internal', null))
                  : Result.ok({ changed: true }),
            },
            gatewayCalls,
          ),
        },
        { provide: AVATAR_PORTS, useValue: memoryAvatarPorts() },
      ],
    });
    store = TestBed.inject(OnboardingFlowStore);
  });

  /** Registers and personalizes past services onto the birthday step. */
  async function walkToBirthday(): Promise<void> {
    await store.submitAbout(ABOUT_FIELDS);
    store.personalize();
    store.skipServices();
    expect(store.state().onboardingFlowStep).toBe(OnboardingFlowStep.Birthday);
  }

  it('beginPersonalization enters the services step directly — the returning-active-account path (no About form, no network)', () => {
    store.beginPersonalization();

    expect(store.state().onboardingFlowStep).toBe(OnboardingFlowStep.Services);
    expect(otpCalls).toEqual([]);
  });

  it('a plan opens on its first step, with the earlier plan step still reachable via back', () => {
    store.beginPersonalization([
      OnboardingFlowStep.Services,
      OnboardingFlowStep.Birthday,
    ]);

    expect(store.state().onboardingFlowStep).toBe(OnboardingFlowStep.Services);
    store.skipServices();
    expect(store.state().onboardingFlowStep).toBe(OnboardingFlowStep.Birthday);

    store.back();
    expect(store.state().onboardingFlowStep).toBe(OnboardingFlowStep.Services);
  });

  it('steps OVER anything the profile already satisfies, forwards and backwards', () => {
    // Birthday already set elsewhere — this resume is services → avatar.
    store.beginPersonalization([
      OnboardingFlowStep.Services,
      OnboardingFlowStep.Avatar,
    ]);
    expect(store.state().onboardingFlowStep).toBe(OnboardingFlowStep.Services);

    store.skipServices();
    // The machine's next state is `birthday`; the plan skips it.
    expect(store.state().onboardingFlowStep).toBe(OnboardingFlowStep.Avatar);

    store.back();
    // …and back doesn't land on it either, which would freeze the screen.
    expect(store.state().onboardingFlowStep).toBe(OnboardingFlowStep.Services);
  });

  it('a single remaining step opens directly on it and reports itself as one screen', () => {
    store.beginPersonalization([OnboardingFlowStep.Avatar]);

    expect(store.state().onboardingFlowStep).toBe(OnboardingFlowStep.Avatar);
    expect(store.isSingleStep()).toBe(true);
    expect(store.plan()).toEqual([OnboardingFlowStep.Avatar]);
    expect(store.planPosition()).toBe(1);
  });

  it('finishing the last planned step goes straight to entering, not to a redundant one', () => {
    store.beginPersonalization([OnboardingFlowStep.Birthday]);
    expect(store.state().onboardingFlowStep).toBe(OnboardingFlowStep.Birthday);

    store.skipBirthday();

    // Avatar is NOT in the plan (the photo is already there), so the flow
    // is done rather than asking for it again.
    expect(store.state().onboardingFlowStep).toBe(OnboardingFlowStep.Entering);
  });

  it('submitBirthday sends the ISO date through the updateProfile callable, then advances to avatar', async () => {
    await walkToBirthday();

    await store.submitBirthday({ day: 3, month: 7, year: 1990 });

    // A birthday-only save keeps the names the registration wrote: they
    // travel as `null` (keep), never as a value.
    expect(gatewayCalls).toEqual([
      {
        callable: Callables.UpdateProfile,
        input: { firstName: null, lastName: null, birthDate: '1990-07-03' },
      },
    ]);
    expect(store.state().onboardingFlowStep).toBe(OnboardingFlowStep.Avatar);
  });

  it('skipBirthday advances to avatar without calling updateProfile', async () => {
    await walkToBirthday();

    store.skipBirthday();

    expect(gatewayCalls).toEqual([]);
    expect(store.state().onboardingFlowStep).toBe(OnboardingFlowStep.Avatar);
  });

  it('rejects VO-invalid segments before the port is ever consulted', async () => {
    await walkToBirthday();

    await store.submitBirthday({ day: 30, month: 2, year: 1990 });

    expect(gatewayCalls).toEqual([]);
    const state = store.state();
    expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.Birthday);
    if (state.onboardingFlowStep === OnboardingFlowStep.Birthday) {
      expect(state.error).toBe(IdentityErrorCode.BirthDateInvalid);
    }
  });

  it('a failed save stays on the birthday step, carrying the stable error code', async () => {
    writeFails = true;
    await walkToBirthday();

    await store.submitBirthday({ day: 3, month: 7, year: 1990 });

    const state = store.state();
    expect(state.onboardingFlowStep).toBe(OnboardingFlowStep.Birthday);
    if (state.onboardingFlowStep === OnboardingFlowStep.Birthday) {
      expect(state.error).toBe('accounts.update_profile.repository_failure');
    }
  });

  it('registers through completeRegistration with the session identifier and every about field', async () => {
    await store.submitAbout(ABOUT_FIELDS);

    expect(otpCalls).toEqual([
      {
        otpCall: 'COMPLETE',
        identifier: emailIdentifier(),
        fields: {
          ...ABOUT_FIELDS,
          [RegistrationField.Email]: 'client@example.com',
        },
      },
    ]);
    expect(store.state().onboardingFlowStep).toBe(OnboardingFlowStep.Reward);
  });
});
