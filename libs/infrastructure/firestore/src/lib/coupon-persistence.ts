import { DocumentData } from 'firebase/firestore';
import {
  Money,
  Result,
  ZonedDateTime,
  fail,
  ok,
} from '@creativo/domain/kernel';
import {
  Coupon,
  CouponCombinability,
  CouponExpiry,
  CouponValue,
} from '@creativo/domain/engagement';
import { RepositoryError } from '@creativo/application/shared';

/*
 * THE COUPON DOCUMENT, read and written in one place.
 *
 * Two adapters read `coupons/*` now — the grant repository joins against it,
 * and the coupon reader resolves a code to it — so the mapping lives beside
 * neither. The value mapper is shared with the grants' own `value` snapshot,
 * and its vocabulary (`percent_off` / `fixed_amount` / `free_service`, an
 * amount in minor units beside its currency) is the same one an
 * appointment's `discounts[].value` is written in.
 *
 * The write half (`couponToPersistence`) sits beside the reader so a field
 * added to one cannot be forgotten by the other: what it writes reads back
 * into an equal coupon, the OCCASION included (client-card-revision-3.md
 * §4.6). An admin may write `coupons/*`; a save that dropped the occasion
 * would quietly undress the birthday gift.
 */

// ── CouponValue ─────────────────────────────────────────────────────────

export function couponValueToPersistence(value: CouponValue): DocumentData {
  switch (value.kind) {
    case 'percent_off':
      return { kind: 'percent_off', percent: value.percent };
    case 'fixed_amount':
      return {
        kind: 'fixed_amount',
        amountMinorUnits: value.amount.toMinorUnits(),
        currencyCode: value.amount.currencyCode(),
      };
    case 'free_service':
      return { kind: 'free_service' };
  }
}

export function couponValueFromPersistence(
  data: DocumentData,
): Result<CouponValue, RepositoryError> {
  switch (data['kind']) {
    case 'percent_off': {
      const result = CouponValue.percentOff(data['percent']);
      return result.isFailure()
        ? fail(
            new RepositoryError(
              'Malformed CouponValue.percent_off',
              result.error,
            ),
          )
        : ok(result.value);
    }
    case 'fixed_amount': {
      const moneyResult = Money.fromMinorUnitsAndCode(
        data['amountMinorUnits'],
        data['currencyCode'],
      );
      if (moneyResult.isFailure()) {
        return fail(
          new RepositoryError(
            'Malformed CouponValue.fixed_amount amount',
            moneyResult.error,
          ),
        );
      }
      const result = CouponValue.fixedAmount(moneyResult.value);
      return result.isFailure()
        ? fail(
            new RepositoryError(
              'Malformed CouponValue.fixed_amount',
              result.error,
            ),
          )
        : ok(result.value);
    }
    case 'free_service':
      return ok(CouponValue.freeService());
    default:
      return fail(
        new RepositoryError(
          `Unknown CouponValue kind: ${String(data['kind'])}`,
        ),
      );
  }
}

// ── Coupon mapper ───────────────────────────────────────────────────────

function couponExpiryToPersistence(expiry: CouponExpiry): DocumentData {
  switch (expiry.kind) {
    case 'never':
      return { kind: 'never' };
    case 'days':
      return { kind: 'days', days: expiry.days };
    case 'fixed_date':
      return { kind: 'fixed_date', atIso: expiry.at.toISO() };
  }
}

/**
 * A coupon → `coupons/{id}`, EVERY field written, the ones that say
 * "none" included (`code`, `usageLimit` and `occasion` are `null`, never
 * absent): a save replaces the document, and a field left out of it is a
 * field deleted. The id is the document's, not a field.
 */
export function couponToPersistence(coupon: Coupon): DocumentData {
  return {
    name: coupon.name,
    code: coupon.code,
    value: couponValueToPersistence(coupon.value),
    combinability: { kind: coupon.combinability.kind },
    expiry: couponExpiryToPersistence(coupon.expiry),
    usageLimit: coupon.usageLimit,
    enabled: coupon.enabled,
    occasion: coupon.occasion,
  };
}

function couponExpiryFromPersistence(
  data: DocumentData,
): Result<CouponExpiry, RepositoryError> {
  switch (data['kind']) {
    case 'days':
      return ok({ kind: 'days', days: data['days'] });
    case 'fixed_date': {
      const atResult = ZonedDateTime.fromISO(data['atIso'], 'UTC');
      if (atResult.isFailure()) {
        return fail(
          new RepositoryError('Malformed expiry.atIso', atResult.error),
        );
      }
      return ok({ kind: 'fixed_date', at: atResult.value });
    }
    default:
      return ok({ kind: 'never' });
  }
}

export function couponFromPersistence(
  id: string,
  data: DocumentData,
): Result<Coupon, RepositoryError> {
  const valueResult = couponValueFromPersistence(data['value']);
  if (valueResult.isFailure()) return fail(valueResult.error);
  const expiryResult = couponExpiryFromPersistence(data['expiry']);
  if (expiryResult.isFailure()) return fail(expiryResult.error);
  const combinability: CouponCombinability =
    data['combinability']?.['kind'] === 'exclusive'
      ? CouponCombinability.exclusive()
      : CouponCombinability.stackable();

  const reconstituted = Coupon.reconstitute({
    id,
    name: data['name'],
    value: valueResult.value,
    combinability,
    expiry: expiryResult.value,
    usageLimit: data['usageLimit'] ?? undefined,
    enabled: data['enabled'],
    // A shareable code, when the coupon has one; absent on grant-only ones
    // and on every document written before codes existed.
    code: typeof data['code'] === 'string' ? data['code'] : null,
    // What the coupon is given for, handed over AS IT IS WRITTEN: a missing
    // field and `null` both read as "no occasion" (every coupon written
    // before occasions existed), and a word the domain does not know is
    // REFUSED there. Filtering it to `null` here would let a typo pass as
    // "none" and undress the gift without anyone being told.
    occasion: data['occasion'],
  });
  if (reconstituted.isFailure()) {
    return fail(
      new RepositoryError('Malformed Coupon document', reconstituted.error),
    );
  }
  return ok(reconstituted.value);
}
