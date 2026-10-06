import { DomainError } from '@creativo/domain/kernel';

/**
 * A free-cancellation window that is not a whole, non-negative number of
 * hours — or one too long for its deadline to stay a real instant
 * (`CANCELLATION_WINDOW_MAX_HOURS`).
 */
export class InvalidCancellationWindowError extends DomainError {
  override readonly code = 'scheduling.cancellation_window.invalid' as const;
  constructor(public readonly rawValue: number) {
    super(
      `Cancellation window must be a whole, non-negative number of hours: ${rawValue}`,
      { rawValue },
    );
  }
}
