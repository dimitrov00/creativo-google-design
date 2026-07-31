import { DomainError } from '@creativo/domain/kernel';

export class EmptyExceptionRangesError extends DomainError {
  override readonly code =
    'scheduling.schedule_exception.empty_ranges' as const;
  constructor(public readonly exceptionKind: string) {
    super(
      `A "${exceptionKind}" schedule exception must name at least one time range — an empty one would silently mean something else`,
      { exceptionKind },
    );
  }
}
