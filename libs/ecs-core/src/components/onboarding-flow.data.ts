import type { ServiceId } from '../entities/service.entity';
import type { RegistrationFields } from './registration.data';

/** Onboarding flow step tags — the ONLY source of these strings. */
export const OnboardingFlowStep = {
  About: 'about',
  Reward: 'reward',
  Services: 'services',
  Birthday: 'birthday',
  Avatar: 'avatar',
  Entering: 'entering',
} as const;
export type OnboardingFlowStep =
  (typeof OnboardingFlowStep)[keyof typeof OnboardingFlowStep];

/** Onboarding flow event tags — what the wrapping store dispatches. */
export const OnboardingFlowEventKind = {
  SubmitAbout: 'submit_about',
  Registered: 'registered',
  RegistrationFailed: 'registration_failed',
  Personalize: 'personalize',
  EnterApp: 'enter_app',
  SubmitServices: 'submit_services',
  SkipServices: 'skip_services',
  SubmitBirthday: 'submit_birthday',
  SkipBirthday: 'skip_birthday',
  BirthdayFailed: 'birthday_failed',
  SkipAvatar: 'skip_avatar',
  Back: 'back',
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
  kind: OnboardingFlowStep.About,
  error: null,
};
const REWARD: OnboardingFlowState.Reward = { kind: OnboardingFlowStep.Reward };
const ENTERING: OnboardingFlowState.Entering = {
  kind: OnboardingFlowStep.Entering,
};

export const OnboardingFlowState = {
  initial(): OnboardingFlowState.About {
    return ABOUT;
  },
  about(error: string | null): OnboardingFlowState.About {
    return error === null ? ABOUT : { kind: OnboardingFlowStep.About, error };
  },
  reward(): OnboardingFlowState.Reward {
    return REWARD;
  },
  services(selected: readonly ServiceId[]): OnboardingFlowState.Services {
    return { kind: OnboardingFlowStep.Services, selected };
  },
  birthday(
    selected: readonly ServiceId[],
    error: string | null,
  ): OnboardingFlowState.Birthday {
    return { kind: OnboardingFlowStep.Birthday, selected, error };
  },
  avatar(selected: readonly ServiceId[]): OnboardingFlowState.Avatar {
    return { kind: OnboardingFlowStep.Avatar, selected };
  },
  entering(): OnboardingFlowState.Entering {
    return ENTERING;
  },
  /** No outgoing transitions from here. */
  isTerminal(state: OnboardingFlowState): boolean {
    return state.kind === OnboardingFlowStep.Entering;
  },
} as const;

export namespace OnboardingFlowState {
  export type About = {
    readonly kind: typeof OnboardingFlowStep.About;
    readonly error: string | null;
  };
  export type Reward = {
    readonly kind: typeof OnboardingFlowStep.Reward;
  };
  export type Services = {
    readonly kind: typeof OnboardingFlowStep.Services;
    readonly selected: readonly ServiceId[];
  };
  export type Birthday = {
    readonly kind: typeof OnboardingFlowStep.Birthday;
    readonly selected: readonly ServiceId[];
    readonly error: string | null;
  };
  export type Avatar = {
    readonly kind: typeof OnboardingFlowStep.Avatar;
    readonly selected: readonly ServiceId[];
  };
  export type Entering = {
    readonly kind: typeof OnboardingFlowStep.Entering;
  };
}

/**
 * What the store tells the onboarding flow. `submit_birthday` is dispatched
 * only AFTER the profile save settled — like `registered`, the async save
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
    return { kind: OnboardingFlowEventKind.SubmitAbout, fields };
  },
  registered(): OnboardingFlowEvent.Registered {
    return { kind: OnboardingFlowEventKind.Registered };
  },
  registrationFailed(message: string): OnboardingFlowEvent.RegistrationFailed {
    return { kind: OnboardingFlowEventKind.RegistrationFailed, message };
  },
  personalize(): OnboardingFlowEvent.Personalize {
    return { kind: OnboardingFlowEventKind.Personalize };
  },
  enterApp(): OnboardingFlowEvent.EnterApp {
    return { kind: OnboardingFlowEventKind.EnterApp };
  },
  submitServices(
    services: readonly ServiceId[],
  ): OnboardingFlowEvent.SubmitServices {
    return { kind: OnboardingFlowEventKind.SubmitServices, services };
  },
  skipServices(): OnboardingFlowEvent.SkipServices {
    return { kind: OnboardingFlowEventKind.SkipServices };
  },
  submitBirthday(): OnboardingFlowEvent.SubmitBirthday {
    return { kind: OnboardingFlowEventKind.SubmitBirthday };
  },
  skipBirthday(): OnboardingFlowEvent.SkipBirthday {
    return { kind: OnboardingFlowEventKind.SkipBirthday };
  },
  birthdayFailed(message: string): OnboardingFlowEvent.BirthdayFailed {
    return { kind: OnboardingFlowEventKind.BirthdayFailed, message };
  },
  skipAvatar(): OnboardingFlowEvent.SkipAvatar {
    return { kind: OnboardingFlowEventKind.SkipAvatar };
  },
  back(): OnboardingFlowEvent.Back {
    return { kind: OnboardingFlowEventKind.Back };
  },
} as const;

export namespace OnboardingFlowEvent {
  export type SubmitAbout = {
    readonly kind: typeof OnboardingFlowEventKind.SubmitAbout;
    readonly fields: RegistrationFields;
  };
  export type Registered = {
    readonly kind: typeof OnboardingFlowEventKind.Registered;
  };
  export type RegistrationFailed = {
    readonly kind: typeof OnboardingFlowEventKind.RegistrationFailed;
    readonly message: string;
  };
  export type Personalize = {
    readonly kind: typeof OnboardingFlowEventKind.Personalize;
  };
  export type EnterApp = {
    readonly kind: typeof OnboardingFlowEventKind.EnterApp;
  };
  export type SubmitServices = {
    readonly kind: typeof OnboardingFlowEventKind.SubmitServices;
    readonly services: readonly ServiceId[];
  };
  export type SkipServices = {
    readonly kind: typeof OnboardingFlowEventKind.SkipServices;
  };
  export type SubmitBirthday = {
    readonly kind: typeof OnboardingFlowEventKind.SubmitBirthday;
  };
  export type SkipBirthday = {
    readonly kind: typeof OnboardingFlowEventKind.SkipBirthday;
  };
  export type BirthdayFailed = {
    readonly kind: typeof OnboardingFlowEventKind.BirthdayFailed;
    readonly message: string;
  };
  export type SkipAvatar = {
    readonly kind: typeof OnboardingFlowEventKind.SkipAvatar;
  };
  export type Back = {
    readonly kind: typeof OnboardingFlowEventKind.Back;
  };
}
