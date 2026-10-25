import { Tag } from '@core/primitives';
import { OnboardingFlowStep } from './onboarding-flow.data';

/**
 * The onboarding flow's optional phase — the personalization steps a
 * resume plan may leave out, a subset of {@link OnboardingFlowStep} read
 * from it member by member, in the order the machine walks them.
 */
const PERSONALIZE = {
  Services: OnboardingFlowStep.Services,
  Birthday: OnboardingFlowStep.Birthday,
  Avatar: OnboardingFlowStep.Avatar,
} as const;

/** One personalization step (services, birthday, avatar). */
export type PersonalizeStep = Tag<typeof PERSONALIZE>;

export const PersonalizeStep = {
  /** The optional phase's steps, in the order the machine walks them. */
  ALL: Tag.values(PERSONALIZE),

  /** A personalization step (services, birthday, avatar) — the ones a plan may leave out. */
  is(step: string): step is PersonalizeStep {
    return Tag.has(PERSONALIZE, step);
  },
} as const;
