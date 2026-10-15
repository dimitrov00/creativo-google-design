import {
  Money,
  Result,
  ZonedDateTime,
  combineAll,
  fail,
  ok,
} from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import {
  Currency,
  EngagementErrorCode,
  type EngagementError as EngagementErrorData,
  PriceCents,
  UtcEpochMs,
  VoucherRefusal,
  defect,
} from '@core/primitives';
import { type Money as MoneyData, VoucherLifecycle } from '@core/components';
import { type VoucherBalance, VoucherSystem } from '@core/systems';
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

/*
 * THIN SHIM (ECS migration Phase 2). The balance algebra — why a voucher
 * cannot be used, how much it covers, redeem / restore / settle refusing
 * rather than rounding, never below zero nor above what was issued — is
 * `VoucherSystem` over the ECS `GiftVoucherEntity`. This class keeps the
 * legacy API its callers hold and only converts.
 */

/* ── Legacy ↔ ECS converters ─────────────────────────────────────────── */

/** The legacy lower-case refusal → the ecs-core `VoucherRefusal` (flatten-spec §8.9). */
const LEGACY_VOUCHER_REFUSAL = {
  void: VoucherRefusal.Void,
  expired: VoucherRefusal.Expired,
  empty: VoucherRefusal.Empty,
} as const satisfies Record<'void' | 'expired' | 'empty', VoucherRefusal>;

/** The inverse: the ecs-core refusal → the legacy word callers compare. */
const VOUCHER_REFUSAL_LEGACY = {
  [LEGACY_VOUCHER_REFUSAL.void]: 'void',
  [LEGACY_VOUCHER_REFUSAL.expired]: 'expired',
  [LEGACY_VOUCHER_REFUSAL.empty]: 'empty',
} as const satisfies Record<VoucherRefusal, 'void' | 'expired' | 'empty'>;

function sure<T, E>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: E },
  what: string,
): T {
  // Unreachable: a legacy `Money` / `ZonedDateTime` already holds the rule.
  if (!result.ok) defect(`unreachable: ${what}`);
  return result.value;
}

function instantOf(at: ZonedDateTime): UtcEpochMs {
  return sure(UtcEpochMs.of(at.toMillis()), 'an instant');
}

function centsOf(money: Money): PriceCents {
  return sure(PriceCents.of(money.toMinorUnits()), 'an amount');
}

function toMoneyData(money: Money): MoneyData {
  return {
    amountCents: centsOf(money),
    currency: sure(Currency.parse(money.currencyCode()), 'a currency'),
  };
}

/**
 * The legacy voucher as the slice the balance algebra reads
 * (`VoucherBalance`) — its money, its expiry and its lifecycle. Whose it is
 * stays on the legacy class: the algebra never reads it, and the client
 * record a flat voucher names (D29) is nothing a legacy voucher can know.
 */
function toBalance(voucher: GiftVoucher): VoucherBalance {
  const state = voucher.state;
  return {
    initialValueCents: centsOf(voucher.initialValue),
    balanceCents: centsOf(voucher.balance),
    currency: sure(
      Currency.parse(voucher.balance.currencyCode()),
      'a currency',
    ),
    expiresAtUtcMs:
      voucher.expiresAt === null ? null : instantOf(voucher.expiresAt),
    ...(state.kind === 'void'
      ? VoucherLifecycle.voided(instantOf(state.voidedAt), state.reason)
      : VoucherLifecycle.active()),
  };
}

type VoucherBalanceError =
  | GiftVoucherNotRedeemableError
  | GiftVoucherInsufficientBalanceError
  | GiftVoucherCurrencyMismatchError
  | GiftVoucherOverRestoreError;

/** A struct refusal → the legacy class it always was. */
function toLegacyError(error: EngagementErrorData): VoucherBalanceError {
  switch (error.errorCode) {
    case EngagementErrorCode.GiftVoucherNotRedeemable:
      return new GiftVoucherNotRedeemableError(
        VOUCHER_REFUSAL_LEGACY[error.reason],
      );
    case EngagementErrorCode.GiftVoucherInsufficientBalance:
      return new GiftVoucherInsufficientBalanceError(
        error.requestedCents,
        error.balanceCents,
      );
    case EngagementErrorCode.GiftVoucherCurrencyMismatch:
      return new GiftVoucherCurrencyMismatchError(error.expected, error.found);
    default:
      return new GiftVoucherOverRestoreError();
  }
}

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
    const refused = VoucherSystem.refusal(toBalance(this), instantOf(now));
    return refused === null ? null : VOUCHER_REFUSAL_LEGACY[refused];
  }

  isRedeemable(now: ZonedDateTime): boolean {
    return this.refusal(now) === null;
  }

  /**
   * How much of `due` this voucher can settle — its whole balance, or all of
   * what is owed, whichever is smaller. Zero across a currency line.
   */
  coverage(due: Money): Money {
    return GiftVoucher.money(
      VoucherSystem.coverage(toBalance(this), toMoneyData(due)).amountCents,
      this.balance.currencyCode(),
    );
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
    const redeemed = VoucherSystem.redeem(
      toBalance(this),
      toMoneyData(amount),
      instantOf(now),
    );
    return redeemed.ok
      ? ok(this.withBalanceOf(redeemed.value))
      : fail(
          toLegacyError(redeemed.error) as
            | GiftVoucherNotRedeemableError
            | GiftVoucherInsufficientBalanceError
            | GiftVoucherCurrencyMismatchError,
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
    const restored = VoucherSystem.restore(
      toBalance(this),
      toMoneyData(amount),
    );
    return restored.ok
      ? ok(this.withBalanceOf(restored.value))
      : fail(
          toLegacyError(restored.error) as
            GiftVoucherOverRestoreError | GiftVoucherCurrencyMismatchError,
        );
  }

  /**
   * One visit's draw on this voucher, CHANGED from `previous` to `next` —
   * the save that re-settles a bill. What the visit already holds is its own
   * to keep or give back whatever the voucher's state, so a void voucher
   * refuses only when the visit would take MORE than it had; the balance can
   * never go below zero or above what was issued.
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
    const settled = VoucherSystem.settle(
      toBalance(this),
      toMoneyData(previous),
      toMoneyData(next),
    );
    return settled.ok
      ? ok(this.withBalanceOf(settled.value))
      : fail(toLegacyError(settled.error));
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

  /** The struct's balance, back on the legacy voucher. */
  private withBalanceOf(entity: VoucherBalance): GiftVoucher {
    return this.withBalance(
      GiftVoucher.money(entity.balanceCents, this.balance.currencyCode()),
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
