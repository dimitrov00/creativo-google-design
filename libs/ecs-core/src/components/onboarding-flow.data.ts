import type { ServiceId } from '../primitives/ids.primitive';
import type { RegistrationFields } from './registration.data';

/** Onboarding flow step tags — the ONLY source of these strings, the discriminator `onboardingFlowStep`. */
export const OnboardingFlowStep = {
  About: 'ABOUT',
  Reward: 'REWARD',
  Services: 'SERVICES',
  Birthday: 'BIRTHDAY',
  Avatar: 'AVATAR',
  Entering: 'ENTERING',
} as const;
export type OnboardingFlowStep =
  (typeof OnboardingFlowStep)[keyof typeof OnboardingFlowStep];

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
 * The onboarding flow's state (the pure port of v2's `onboarding.machine.ts`):
 * the required registration first (`about` collects names and phone only),
 * then the optional personalization — services → birthday → avatar, every
 * step skippable. The async saves collapse into events the store dispatches;
 * `OnboardingFlowSystem.next(state, event)` is a synchronous total function.
 * `selected` carries the picked services through the personalization steps;
 * `error` is the last refusal to show (`null` for none).
 */
export type OnboardingFlowState =
  | OnboardingFlowState.About
  | OnboardingFlowState.Reward
  | OnboardingFlowState.Services
  | OnboardingFlowState.Birthday
  | OnboardingFlowState.Avatar
  | OnboardingFlowState.Entering;

const ABOUT: OnboardingFlowState.About = {
  onboardingFlowStep: OnboardingFlowStep.About,
  error: null,
};
const REWARD: OnboardingFlowState.Reward = {
  onboardingFlowStep: OnboardingFlowStep.Reward,
};
const ENTERING: OnboardingFlowState.Entering = {
  onboardingFlowStep: OnboardingFlowStep.Entering,
};

export const OnboardingFlowState = {
  initial(): OnboardingFlowState.About {
    return ABOUT;
  },
  about(error: string | null): OnboardingFlowState.About {
    return error === null
      ? ABOUT
      : { onboardingFlowStep: OnboardingFlowStep.About, error };
  },
  reward(): OnboardingFlowState.Reward {
    return REWARD;
  },
  services(selected: readonly ServiceId[]): OnboardingFlowState.Services {
    return { onboardingFlowStep: OnboardingFlowStep.Services, selected };
  },
  birthday(
    selected: readonly ServiceId[],
    error: string | null,
  ): OnboardingFlowState.Birthday {
    return { onboardingFlowStep: OnboardingFlowStep.Birthday, selected, error };
  },
  avatar(selected: readonly ServiceId[]): OnboardingFlowState.Avatar {
    return { onboardingFlowStep: OnboardingFlowStep.Avatar, selected };
  },
  entering(): OnboardingFlowState.Entering {
    return ENTERING;
  },
  /** No outgoing transitions from here. */
  isTerminal(state: OnboardingFlowState): boolean {
    return state.onboardingFlowStep === OnboardingFlowStep.Entering;
  },
} as const;

export namespace OnboardingFlowState {
  export type About = {
    readonly onboardingFlowStep: typeof OnboardingFlowStep.About;
    readonly error: string | null;
  };
  export type Reward = {
    readonly onboardingFlowStep: typeof OnboardingFlowStep.Reward;
  };
  export type Services = {
    readonly onboardingFlowStep: typeof OnboardingFlowStep.Services;
    readonly selected: readonly ServiceId[];
  };
  export type Birthday = {
    readonly onboardingFlowStep: typeof OnboardingFlowStep.Birthday;
    readonly selected: readonly ServiceId[];
    readonly error: string | null;
  };
  export type Avatar = {
    readonly onboardingFlowStep: typeof OnboardingFlowStep.Avatar;
    readonly selected: readonly ServiceId[];
  };
  export type Entering = {
    readonly onboardingFlowStep: typeof OnboardingFlowStep.Entering;
  };
}

/**
 * What the store tells the onboarding flow. `SUBMIT_BIRTHDAY` is dispatched
 * only AFTER the profile save settled — like `REGISTERED`, the async save
 * collapses into events, never a `saving` step.
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
  registrationFailed(message: string): OnboardingFlowEvent.RegistrationFailed {
    return {
      onboardingFlowEventKind: OnboardingFlowEventKind.RegistrationFailed,
      message,
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
  birthdayFailed(message: string): OnboardingFlowEvent.BirthdayFailed {
    return {
      onboardingFlowEventKind: OnboardingFlowEventKind.BirthdayFailed,
      message,
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
    readonly message: string;
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
    readonly message: string;
  };
  export type SkipAvatar = {
    readonly onboardingFlowEventKind: typeof OnboardingFlowEventKind.SkipAvatar;
  };
  export type Back = {
    readonly onboardingFlowEventKind: typeof OnboardingFlowEventKind.Back;
  };
}
