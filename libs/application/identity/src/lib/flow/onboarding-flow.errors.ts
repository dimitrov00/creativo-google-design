export class InvalidOnboardingFlowTransitionError extends Error {
  constructor(
    public readonly from: string,
    public readonly event: string,
  ) {
    super(`OnboardingFlow: event "${event}" is not legal from state "${from}"`);
  }
}

export type OnboardingFlowError = InvalidOnboardingFlowTransitionError;
