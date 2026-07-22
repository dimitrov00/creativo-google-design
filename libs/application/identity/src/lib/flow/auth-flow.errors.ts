export class InvalidAuthFlowTransitionError extends Error {
  constructor(
    public readonly from: string,
    public readonly event: string,
  ) {
    super(`AuthFlow: event "${event}" is not legal from state "${from}"`);
  }
}

export type AuthFlowError = InvalidAuthFlowTransitionError;
