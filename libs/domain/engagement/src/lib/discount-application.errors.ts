import { DomainError } from '@creativo/domain/kernel';

export class DiscountCapOutOfRangeError extends DomainError {
  override readonly code =
    'engagement.discount_application.invalid_cap' as const;
  constructor(public readonly attempted: number) {
    super(
      `Discount cap must be a percentage between 0 and 100, got ${attempted}`,
      {
        attempted,
      },
    );
  }
}
