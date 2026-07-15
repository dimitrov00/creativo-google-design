import { DomainError } from './domain-error';

export class InvalidMoneyAmountError extends DomainError {
  readonly code = 'invalid_money_amount' as const;
  constructor(public readonly rawAmount: number) {
    super(
      `Invalid money amount: ${rawAmount} (must be a non-negative integer minor-unit count)`,
      { rawAmount },
    );
  }
}

export class CurrencyMismatchError extends DomainError {
  readonly code = 'currency_mismatch' as const;
  constructor(
    public readonly leftCurrency: string,
    public readonly rightCurrency: string,
  ) {
    super(
      `Cannot combine mismatched currencies: ${leftCurrency} and ${rightCurrency}`,
      {
        leftCurrency,
        rightCurrency,
      },
    );
  }
}

export class UnknownCurrencyCodeError extends DomainError {
  readonly code = 'unknown_currency_code' as const;
  constructor(public readonly rawCode: string) {
    super(`Unknown or unsupported currency code: "${rawCode}"`, { rawCode });
  }
}
