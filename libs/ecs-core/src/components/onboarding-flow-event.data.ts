import type { ServiceId } from '@core/primitives';
import type { OnboardingFailure } from '@core/errors';
import type { RegistrationFields } from './registration-fields.data';

/**
 * Onboarding flow event tags — what the wrapping store dispatches; the
 * discriminator `onboardingFlowEventKind` (N15: `OnboardingFlowEvent` is
 * the union).
 */
export const OnboardingFlowEventKind = {
  SubmitAbout: 'SUBMIT_ABOUT',
  Registered: 'REGISTERED',
  RegistrationFailed: 'REGISTRATION_FAILED',
  Personalize: 'PERSONALIZE',
  EnterApp: 'ENTER_APP',
  SubmitServices: 'SUBMIT_SERVICES',
  SkipServices: 'SKIP_SERVICES',
  SubmitBirthday: 'SUBMIT_BIRTHDAY',
  SkipBirthday: 'SKIP_BIRTHDAY',
  BirthdayFailed: 'BIRTHDAY_FAILED',
  SkipAvatar: 'SKIP_AVATAR',
  Back: 'BACK',
} as const;
export type OnboardingFlowEventKind =
  (typeof OnboardingFlowEventKind)[keyof typeof OnboardingFlowEventKind];

/**
 * What the store tells the onboarding flow. `SUBMIT_BIRTHDAY` is dispatched
 * only AFTER the profile save settled — like `REGISTERED`, the async save
 * collapses into events, never a `saving` step. A failure carries its
 * refusal as the struct (`error`, pass D §2.11), so its params — the age
 * window's `minAge`/`maxAge` among them — reach the words.
 */
export type OnboardingFlowEvent =
  | OnboardingFlowEvent.SubmitAbout
  | OnboardingFlowEvent.Registered
  | OnboardingFlowEvent.RegistrationFailed
  | OnboardingFlowEvent.Personalize
  | OnboardingFlowEvent.EnterApp
  | OnboardingFlowEvent.SubmitServices
  | OnboardingFlowEvent.SkipServices
  | OnboardingFlowEvent.SubmitBirthday
  | OnboardingFlowEvent.SkipBirthday
  | OnboardingFlowEvent.BirthdayFailed
  | OnboardingFlowEvent.SkipAvatar
  | OnboardingFlowEvent.Back;

export const OnboardingFlowEvent = {
  submitAbout(fields: RegistrationFields): OnboardingFlowEvent.SubmitAbout {
    return {
      onboardingFlowEventKind: OnboardingFlowEventKind.SubmitAbout,
      fields,
    };
  },
  registered(): OnboardingFlowEvent.Registered {
    return { onboardingFlowEventKind: OnboardingFlowEventKind.Registered };
  },
  registrationFailed(
    error: OnboardingFailure,
  ): OnboardingFlowEvent.RegistrationFailed {
    return {
      onboardingFlowEventKind: OnboardingFlowEventKind.RegistrationFailed,
      error,
    };
  },
  personalize(): OnboardingFlowEvent.Personalize {
    return { onboardingFlowEventKind: OnboardingFlowEventKind.Personalize };
  },
  enterApp(): OnboardingFlowEvent.EnterApp {
    return { onboardingFlowEventKind: OnboardingFlowEventKind.EnterApp };
  },
  submitServices(
    services: readonly ServiceId[],
  ): OnboardingFlowEvent.SubmitServices {
    return {
      onboardingFlowEventKind: OnboardingFlowEventKind.SubmitServices,
      services,
    };
  },
  skipServices(): OnboardingFlowEvent.SkipServices {
    return { onboardingFlowEventKind: OnboardingFlowEventKind.SkipServices };
  },
  submitBirthday(): OnboardingFlowEvent.SubmitBirthday {
    return { onboardingFlowEventKind: OnboardingFlowEventKind.SubmitBirthday };
  },
  skipBirthday(): OnboardingFlowEvent.SkipBirthday {
    return { onboardingFlowEventKind: OnboardingFlowEventKind.SkipBirthday };
  },
  birthdayFailed(error: OnboardingFailure): OnboardingFlowEvent.BirthdayFailed {
    return {
      onboardingFlowEventKind: OnboardingFlowEventKind.BirthdayFailed,
      error,
    };
  },
  skipAvatar(): OnboardingFlowEvent.SkipAvatar {
    return { onboardingFlowEventKind: OnboardingFlowEventKind.SkipAvatar };
  },
  back(): OnboardingFlowEvent.Back {
    return { onboardingFlowEventKind: OnboardingFlowEventKind.Back };
  },
} as const;

export namespace OnboardingFlowEvent {
  export type SubmitAbout = {
    readonly onboardingFlowEventKind: typeof OnboardingFlowEventKind.SubmitAbout;
    readonly fields: RegistrationFields;
  };
  export type Registered = {
    readonly onboardingFlowEventKind: typeof OnboardingFlowEventKind.Registered;
  };
  export type RegistrationFailed = {
    readonly onboardingFlowEventKind: typeof OnboardingFlowEventKind.RegistrationFailed;
    readonly error: OnboardingFailure;
  };
  export type Personalize = {
    readonly onboardingFlowEventKind: typeof OnboardingFlowEventKind.Personalize;
  };
  export type EnterApp = {
    readonly onboardingFlowEventKind: typeof OnboardingFlowEventKind.EnterApp;
  };
  export type SubmitServices = {
    readonly onboardingFlowEventKind: typeof OnboardingFlowEventKind.SubmitServices;
    readonly services: readonly ServiceId[];
  };
  export type SkipServices = {
    readonly onboardingFlowEventKind: typeof OnboardingFlowEventKind.SkipServices;
  };
  export type SubmitBirthday = {
    readonly onboardingFlowEventKind: typeof OnboardingFlowEventKind.SubmitBirthday;
  };
  export type SkipBirthday = {
    readonly onboardingFlowEventKind: typeof OnboardingFlowEventKind.SkipBirthday;
  };
  export type BirthdayFailed = {
    readonly onboardingFlowEventKind: typeof OnboardingFlowEventKind.BirthdayFailed;
    readonly error: OnboardingFailure;
  };
  export type SkipAvatar = {
    readonly onboardingFlowEventKind: typeof OnboardingFlowEventKind.SkipAvatar;
  };
  export type Back = {
    readonly onboardingFlowEventKind: typeof OnboardingFlowEventKind.Back;
  };
}
