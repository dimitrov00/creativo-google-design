import type { ServiceId } from '@core/primitives';
import type { OnboardingFailure } from '@core/errors';

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
 * The onboarding flow's state (the pure port of v2's `onboarding.machine.ts`):
 * the required registration first (`about` collects names and phone only),
 * then the optional personalization — services → birthday → avatar, every
 * step skippable. The async saves collapse into events the store dispatches;
 * `OnboardingFlowSystem.next(state, event)` is a synchronous total function.
 * `selected` carries the picked services through the personalization steps;
 * `error` is the last refusal to show (`null` for none) as its struct, so its
 * params survive to the words (Law 7.5, pass D §2.11): an
 * `OnboardingFailure` (the session's missing identifier among them).
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
  about(error: OnboardingFailure | null): OnboardingFlowState.About {
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
    error: OnboardingFailure | null,
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
    readonly error: OnboardingFailure | null;
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
    readonly error: OnboardingFailure | null;
  };
  export type Avatar = {
    readonly onboardingFlowStep: typeof OnboardingFlowStep.Avatar;
    readonly selected: readonly ServiceId[];
  };
  export type Entering = {
    readonly onboardingFlowStep: typeof OnboardingFlowStep.Entering;
  };
}
