import { DomainError } from '@creativo/domain/kernel';

export class VoucherCodeInvalidError extends DomainError {
  override readonly code = 'engagement.voucher_code.invalid' as const;
  constructor(public readonly attempted: string) {
    super(
      `"${attempted}" is not a valid voucher code (must be 4-32 alphanumeric/-/_ characters)`,
      { attempted },
    );
  }
}
