import {
  Money,
  Result,
  ZonedDateTime,
  combineAll,
  fail,
  ok,
} from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import { Coupon } from './coupon';
import {
  GiftVoucherCurrencyMismatchError,
  GiftVoucherInsufficientBalanceError,
  GiftVoucherInvalidValueError,
  GiftVoucherNotRedeemableError,
  GiftVoucherOverRestoreError,
} from './gift-voucher.errors';
import { GiftVoucherId } from './ids';
import { EmptyIdError } from './ids.errors';
import { VoucherCode } from './voucher-code';
import { VoucherCodeInvalidError } from './voucher-code.errors';

/**
 * `active` until voided; an EMPTY voucher stays active — a restore after a
 * cancelled visit can fill it again, and a report wants "spent" and
 * "cancelled by the shop" to be different facts.
 */
export type GiftVoucherState =
  | { readonly kind: 'active' }
  | {
      readonly kind: 'void';
      readonly voidedAt: ZonedDateTime;
      readonly reason: string;
    };

export type GiftVoucherError =
  EmptyIdError | VoucherCodeInvalidError | GiftVoucherInvalidValueError;

export interface IssueGiftVoucherProps {
  id: string;
  /** Normalised the way `Coupon.code` is: trimmed, upper-case, a legal `VoucherCode`. */
  code: string;
  value: Money;
  issuedAt: ZonedDateTime;
  expiresAt?: ZonedDateTime | null;
  /** The account it was sold or gifted to, when known; a paper voucher has none. */
  issuedToUserId?: string | null;
}

export interface ReconstituteGiftVoucherProps extends IssueGiftVoucherProps {
  balance: Money;
  state: GiftVoucherState;
}

/**
 * **Aggregate root.** A GIFT VOUCHER — money the shop has already been paid,
 * carried as a balance that visits draw down.
 *
 * ### Not a coupon
 * A coupon lowers the PRICE of a visit; a voucher PAYS part of it, and the
 * visit stays full price in every report. The two never meet: a discount is
 * applied first (`Appointment.discounts`), a voucher then covers what is
 * left (`Appointment.voucherRedemptions`), and `balanceDue()` is what
 * changes hands at the counter. The balance is the only mutable fact here
 * and every change to it goes through `redeem` / `restore`, which refuse
 * rather than round.
 */
export class GiftVoucher {
  private constructor(
    readonly id: GiftVoucherId,
    readonly code: string,
    readonly initialValue: Money,
    readonly balance: Money,
    readonly issuedAt: ZonedDateTime,
    readonly expiresAt: ZonedDateTime | null,
    readonly issuedToUserId: UserId | null,
    readonly state: GiftVoucherState,
  ) {}

  static issue(
    props: IssueGiftVoucherProps,
  ): Result<GiftVoucher, GiftVoucherError[]> {
    return GiftVoucher.build({
      ...props,
      balance: props.value,
      state: { kind: 'active' },
    });
  }

  static reconstitute(
    props: ReconstituteGiftVoucherProps,
  ): Result<GiftVoucher, GiftVoucherError[]> {
    return GiftVoucher.build(props);
  }

  private static build(
    props: ReconstituteGiftVoucherProps,
  ): Result<GiftVoucher, GiftVoucherError[]> {
    const idResult = GiftVoucherId.create(props.id);
    const codeResult = VoucherCode.create(Coupon.normalizeCode(props.code));
    const combined = combineAll([idResult, codeResult] as const);
    const errors: GiftVoucherError[] = combined.isFailure()
      ? [...combined.error]
      : [];
    if (props.value.toMinorUnits() <= 0) {
      errors.push(new GiftVoucherInvalidValueError());
    }
    if (errors.length > 0 || combined.isFailure()) return fail(errors);
    const [id, code] = combined.value;

    // An owner id that does not parse reads as "nobody": the voucher is
    // real money whoever holds it, and losing the name is the cheaper loss.
    let issuedTo: UserId | null = null;
    if (props.issuedToUserId != null) {
      const parsed = UserId.create(props.issuedToUserId);
      if (parsed.isSuccess()) issuedTo = parsed.value;
    }

    return ok(
      new GiftVoucher(
        id,
        code.value,
        props.value,
        props.balance,
        props.issuedAt,
        props.expiresAt ?? null,
        issuedTo,
        props.state,
      ),
    );
  }

  /** Why it cannot be used now, or `null` when it can. */
  refusal(now: ZonedDateTime): 'void' | 'expired' | 'empty' | null {
    if (this.state.kind === 'void') return 'void';
    if (this.expiresAt !== null && now.isAfter(this.expiresAt))
      return 'expired';
    if (this.balance.toMinorUnits() <= 0) return 'empty';
    return null;
  }

  isRedeemable(now: ZonedDateTime): boolean {
    return this.refusal(now) === null;
  }

  /**
   * How much of `due` this voucher can settle — its whole balance, or all of
   * what is owed, whichever is smaller. Zero across a currency line.
   */
  coverage(due: Money): Money {
    if (due.currencyCode() !== this.balance.currencyCode()) {
      return GiftVoucher.zero(this.balance.currencyCode());
    }
    const minor = Math.max(
      0,
      Math.min(this.balance.toMinorUnits(), due.toMinorUnits()),
    );
    return GiftVoucher.money(minor, this.balance.currencyCode());
  }

  /** The same voucher with `amount` taken off its balance. */
  redeem(
    amount: Money,
    now: ZonedDateTime,
  ): Result<
    GiftVoucher,
    | GiftVoucherNotRedeemableError
    | GiftVoucherInsufficientBalanceError
    | GiftVoucherCurrencyMismatchError
  > {
    const refusal = this.refusal(now);
    if (refusal !== null)
      return fail(new GiftVoucherNotRedeemableError(refusal));
    if (amount.currencyCode() !== this.balance.currencyCode()) {
      return fail(
        new GiftVoucherCurrencyMismatchError(
          this.balance.currencyCode(),
          amount.currencyCode(),
        ),
      );
    }
    if (amount.toMinorUnits() > this.balance.toMinorUnits()) {
      return fail(
        new GiftVoucherInsufficientBalanceError(
          amount.toMinorUnits(),
          this.balance.toMinorUnits(),
        ),
      );
    }
    return ok(
      this.withBalance(
        GiftVoucher.money(
          this.balance.toMinorUnits() - amount.toMinorUnits(),
          this.balance.currencyCode(),
        ),
      ),
    );
  }

  /**
   * Money given BACK — a cancelled visit, a save that took less than the one
   * before it. Allowed on a void or expired voucher too: the shop cancelling
   * a visit must not keep the client's money because the voucher meanwhile
   * ran out of time. Never above what was issued.
   */
  restore(
    amount: Money,
  ): Result<
    GiftVoucher,
    GiftVoucherOverRestoreError | GiftVoucherCurrencyMismatchError
  > {
    if (amount.currencyCode() !== this.balance.currencyCode()) {
      return fail(
        new GiftVoucherCurrencyMismatchError(
          this.balance.currencyCode(),
          amount.currencyCode(),
        ),
      );
    }
    const next = this.balance.toMinorUnits() + amount.toMinorUnits();
    if (next > this.initialValue.toMinorUnits()) {
      return fail(new GiftVoucherOverRestoreError());
    }
    return ok(
      this.withBalance(GiftVoucher.money(next, this.balance.currencyCode())),
    );
  }

  /**
   * One visit's draw on this voucher, CHANGED from `previous` to `next` —
   * the save that re-settles a bill after a reprice, a discount, or the
   * removal of another voucher. What the visit already holds is its own
   * to keep or give back whatever the voucher's state, so a void or an
   * expired voucher refuses only when the visit would take MORE than it
   * had; the balance can never go below zero or above what was issued.
   */
  settle(
    previous: Money,
    next: Money,
  ): Result<
    GiftVoucher,
    | GiftVoucherNotRedeemableError
    | GiftVoucherInsufficientBalanceError
    | GiftVoucherCurrencyMismatchError
    | GiftVoucherOverRestoreError
  > {
    const currency = this.balance.currencyCode();
    if (
      previous.currencyCode() !== currency ||
      next.currencyCode() !== currency
    ) {
      return fail(
        new GiftVoucherCurrencyMismatchError(currency, next.currencyCode()),
      );
    }
    const available = this.balance.toMinorUnits() + previous.toMinorUnits();
    if (next.toMinorUnits() > previous.toMinorUnits()) {
      if (this.state.kind === 'void') {
        return fail(new GiftVoucherNotRedeemableError('void'));
      }
    }
    if (next.toMinorUnits() > available) {
      return fail(
        new GiftVoucherInsufficientBalanceError(next.toMinorUnits(), available),
      );
    }
    const balance = available - next.toMinorUnits();
    if (balance > this.initialValue.toMinorUnits()) {
      return fail(new GiftVoucherOverRestoreError());
    }
    return ok(this.withBalance(GiftVoucher.money(balance, currency)));
  }

  void(now: ZonedDateTime, reason: string): GiftVoucher {
    return new GiftVoucher(
      this.id,
      this.code,
      this.initialValue,
      this.balance,
      this.issuedAt,
      this.expiresAt,
      this.issuedToUserId,
      { kind: 'void', voidedAt: now, reason },
    );
  }

  private withBalance(balance: Money): GiftVoucher {
    return new GiftVoucher(
      this.id,
      this.code,
      this.initialValue,
      balance,
      this.issuedAt,
      this.expiresAt,
      this.issuedToUserId,
      this.state,
    );
  }

  private static money(minor: number, currencyCode: string): Money {
    const result = Money.fromMinorUnitsAndCode(
      Math.max(0, minor),
      currencyCode,
    );
    if (result.isSuccess()) return result.value;
    // Unreachable: the currency is the voucher's own, already valid.
    return GiftVoucher.zero(currencyCode);
  }

  private static zero(currencyCode: string): Money {
    const zero = Money.fromMinorUnitsAndCode(0, currencyCode);
    return zero.isSuccess() ? zero.value : (undefined as never);
  }
}
