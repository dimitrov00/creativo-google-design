import { DomainError } from '@creativo/domain/kernel';

export class GiftVoucherInvalidValueError extends DomainError {
  override readonly code = 'engagement.gift_voucher.invalid_value' as const;
  constructor() {
    super('A gift voucher must be issued with a positive value');
  }
}

export class GiftVoucherNotRedeemableError extends DomainError {
  override readonly code = 'engagement.gift_voucher.not_redeemable' as const;
  constructor(public readonly reason: 'void' | 'expired' | 'empty') {
    super(`The gift voucher cannot be redeemed: ${reason}`, { reason });
  }
}

export class GiftVoucherInsufficientBalanceError extends DomainError {
  override readonly code =
    'engagement.gift_voucher.insufficient_balance' as const;
  constructor(
    public readonly requestedMinorUnits: number,
    public readonly balanceMinorUnits: number,
  ) {
    super(
      `Cannot redeem ${requestedMinorUnits} from a balance of ${balanceMinorUnits}`,
      { requestedMinorUnits, balanceMinorUnits },
    );
  }
}

export class GiftVoucherOverRestoreError extends DomainError {
  override readonly code = 'engagement.gift_voucher.over_restore' as const;
  constructor() {
    super('A restore cannot take a voucher above the value it was issued with');
  }
}

export class GiftVoucherCurrencyMismatchError extends DomainError {
  override readonly code = 'engagement.gift_voucher.currency_mismatch' as const;
  constructor(
    public readonly expected: string,
    public readonly found: string,
  ) {
    super(`A gift voucher in ${expected} cannot settle ${found}`, {
      expected,
      found,
    });
  }
}
