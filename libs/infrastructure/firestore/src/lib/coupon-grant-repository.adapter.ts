import { Injectable, inject } from '@angular/core';
import {
  DocumentData,
  collectionGroup,
  documentId,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import {
  Money,
  Result,
  ZonedDateTime,
  fail,
  ok,
} from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import {
  Coupon,
  CouponCombinability,
  CouponExpiry,
  CouponGrant,
  CouponGrantCapacity,
  CouponGrantExpiration,
  CouponGrantId,
  CouponGrantState,
  CouponValue,
} from '@creativo/domain/engagement';
import {
  CouponGrantRepository,
  CouponGrantWithCoupon,
} from '@creativo/application/engagement';
import { RepositoryError } from '@creativo/application/shared';
import {
  couponGrantDocRef,
  couponGrantsCollection,
  couponsCollection,
} from './firestore-paths';

// ── CouponValue ─────────────────────────────────────────────────────────

function couponValueToPersistence(value: CouponValue): DocumentData {
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

function couponValueFromPersistence(
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

// ── CouponGrantState ────────────────────────────────────────────────────

function capacityToPersistence(capacity: CouponGrantCapacity): DocumentData {
  return capacity.kind === 'single_use'
    ? { kind: 'single_use' }
    : {
        kind: 'multi_use',
        remaining: capacity.remaining,
        totalGranted: capacity.totalGranted,
      };
}

function capacityFromPersistence(data: DocumentData): CouponGrantCapacity {
  return data['kind'] === 'multi_use'
    ? {
        kind: 'multi_use',
        remaining: data['remaining'],
        totalGranted: data['totalGranted'],
      }
    : { kind: 'single_use' };
}

function expirationToPersistence(
  expiration: CouponGrantExpiration,
): DocumentData {
  return expiration.kind === 'expires_at'
    ? { kind: 'expires_at', atIso: expiration.at.toISO() }
    : { kind: 'no_expiry' };
}

function expirationFromPersistence(
  data: DocumentData,
): Result<CouponGrantExpiration, RepositoryError> {
  if (data['kind'] !== 'expires_at') {
    return ok({ kind: 'no_expiry' });
  }
  const atResult = ZonedDateTime.fromISO(data['atIso'], 'UTC');
  if (atResult.isFailure()) {
    return fail(
      new RepositoryError('Malformed expiration.atIso', atResult.error),
    );
  }
  return ok({ kind: 'expires_at', at: atResult.value });
}

function stateToPersistence(state: CouponGrantState): DocumentData {
  switch (state.kind) {
    case 'active':
      return {
        kind: 'active',
        capacity: capacityToPersistence(state.capacity),
        expiration: expirationToPersistence(state.expiration),
      };
    case 'used':
      return {
        kind: 'used',
        usedAtIso: state.usedAt.toISO(),
        note: state.note,
      };
    case 'expired':
      return {
        kind: 'expired',
        expiredAtIso: state.expiredAt.toISO(),
        scheduledForIso: state.scheduledFor.toISO(),
      };
    case 'revoked':
      return {
        kind: 'revoked',
        revokedAtIso: state.revokedAt.toISO(),
        revokedBy: state.revokedBy.value,
        reason: state.reason,
      };
  }
}

function stateFromPersistence(
  data: DocumentData,
): Result<CouponGrantState, RepositoryError> {
  switch (data['kind']) {
    case 'active': {
      const expirationResult = expirationFromPersistence(data['expiration']);
      if (expirationResult.isFailure()) return fail(expirationResult.error);
      return ok({
        kind: 'active',
        capacity: capacityFromPersistence(data['capacity']),
        expiration: expirationResult.value,
      });
    }
    case 'used': {
      const usedAtResult = ZonedDateTime.fromISO(data['usedAtIso'], 'UTC');
      if (usedAtResult.isFailure()) {
        return fail(
          new RepositoryError('Malformed state.usedAtIso', usedAtResult.error),
        );
      }
      return ok({
        kind: 'used',
        usedAt: usedAtResult.value,
        note: data['note'] ?? '',
      });
    }
    case 'expired': {
      const expiredAtResult = ZonedDateTime.fromISO(
        data['expiredAtIso'],
        'UTC',
      );
      const scheduledForResult = ZonedDateTime.fromISO(
        data['scheduledForIso'],
        'UTC',
      );
      if (expiredAtResult.isFailure()) {
        return fail(
          new RepositoryError(
            'Malformed state.expiredAtIso',
            expiredAtResult.error,
          ),
        );
      }
      if (scheduledForResult.isFailure()) {
        return fail(
          new RepositoryError(
            'Malformed state.scheduledForIso',
            scheduledForResult.error,
          ),
        );
      }
      return ok({
        kind: 'expired',
        expiredAt: expiredAtResult.value,
        scheduledFor: scheduledForResult.value,
      });
    }
    case 'revoked': {
      const revokedAtResult = ZonedDateTime.fromISO(
        data['revokedAtIso'],
        'UTC',
      );
      const revokedByResult = UserId.create(data['revokedBy']);
      if (revokedAtResult.isFailure()) {
        return fail(
          new RepositoryError(
            'Malformed state.revokedAtIso',
            revokedAtResult.error,
          ),
        );
      }
      if (revokedByResult.isFailure()) {
        return fail(
          new RepositoryError(
            'Malformed state.revokedBy',
            revokedByResult.error,
          ),
        );
      }
      return ok({
        kind: 'revoked',
        revokedAt: revokedAtResult.value,
        revokedBy: revokedByResult.value,
        reason: data['reason'],
      });
    }
    default:
      return fail(
        new RepositoryError(
          `Unknown CouponGrantState kind: ${String(data['kind'])}`,
        ),
      );
  }
}

// ── CouponGrant mapper ──────────────────────────────────────────────────

function grantToPersistence(grant: CouponGrant): DocumentData {
  return {
    id: grant.id.value,
    userId: grant.userId.value,
    couponId: grant.couponId.value,
    value: couponValueToPersistence(grant.value),
    grantedAt: grant.grantedAt.toISO(),
    state: stateToPersistence(grant.state),
  };
}

function grantFromPersistence(
  id: string,
  data: DocumentData,
): Result<CouponGrant, RepositoryError> {
  const valueResult = couponValueFromPersistence(data['value']);
  if (valueResult.isFailure()) return fail(valueResult.error);
  const stateResult = stateFromPersistence(data['state']);
  if (stateResult.isFailure()) return fail(stateResult.error);
  const grantedAtResult = ZonedDateTime.fromISO(data['grantedAt'], 'UTC');
  if (grantedAtResult.isFailure()) {
    return fail(
      new RepositoryError(
        'Malformed CouponGrant.grantedAt',
        grantedAtResult.error,
      ),
    );
  }
  const reconstituted = CouponGrant.reconstitute({
    id,
    userId: data['userId'],
    couponId: data['couponId'],
    value: valueResult.value,
    grantedAt: grantedAtResult.value,
    state: stateResult.value,
  });
  if (reconstituted.isFailure()) {
    return fail(
      new RepositoryError(
        'Malformed CouponGrant document',
        reconstituted.error,
      ),
    );
  }
  return ok(reconstituted.value);
}

// ── Coupon mapper ───────────────────────────────────────────────────────

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

function couponFromPersistence(
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
  });
  if (reconstituted.isFailure()) {
    return fail(
      new RepositoryError('Malformed Coupon document', reconstituted.error),
    );
  }
  return ok(reconstituted.value);
}

/**
 * `findById` only receives a `CouponGrantId`, but a grant lives in a
 * per-user subcollection (`users/{uid}/couponGrants/{grantId}`) — there is
 * no way to build that path without the owning `userId`. A denormalized
 * `id` field (equal to the doc id) lets a `collectionGroup` equality query
 * find it; a single-field equality filter on a collection-group query is
 * covered by Firestore's automatic indexing (no composite index needed —
 * only equality + a *different-field* orderBy would require one, and this
 * query has no orderBy).
 */
@Injectable()
export class FirestoreCouponGrantRepository implements CouponGrantRepository {
  private readonly db = inject(FIREBASE_FIRESTORE);

  async save(grant: CouponGrant): Promise<Result<void, RepositoryError>> {
    try {
      await setDoc(
        couponGrantDocRef(this.db, grant.userId, grant.id),
        grantToPersistence(grant),
      );
      return ok(undefined);
    } catch (error) {
      return fail(new RepositoryError('Failed to save CouponGrant', error));
    }
  }

  async findById(
    id: CouponGrantId,
  ): Promise<Result<CouponGrant | null, RepositoryError>> {
    try {
      const snapshot = await getDocs(
        query(
          collectionGroup(this.db, 'couponGrants'),
          where('id', '==', id.value),
        ),
      );
      if (snapshot.empty) {
        return ok(null);
      }
      const docSnap = snapshot.docs[0];
      if (!docSnap) {
        return ok(null);
      }
      return grantFromPersistence(docSnap.id, docSnap.data());
    } catch (error) {
      return fail(new RepositoryError('Failed to find CouponGrant', error));
    }
  }

  async findUsableForUser(
    userId: UserId,
    now: ZonedDateTime,
  ): Promise<Result<readonly CouponGrantWithCoupon[], RepositoryError>> {
    try {
      const snapshot = await getDocs(
        query(
          couponGrantsCollection(this.db, userId),
          where('state.kind', '==', 'active'),
        ),
      );

      const grants: CouponGrant[] = [];
      for (const docSnap of snapshot.docs) {
        const grantResult = grantFromPersistence(docSnap.id, docSnap.data());
        if (grantResult.isFailure()) {
          return fail(grantResult.error);
        }
        if (grantResult.value.isUsable(now)) {
          grants.push(grantResult.value);
        }
      }
      if (grants.length === 0) {
        return ok([]);
      }

      const couponIds = [...new Set(grants.map((g) => g.couponId.value))];
      const couponsById = new Map<string, Coupon>();
      for (const batch of chunk(couponIds, 30)) {
        const couponsSnapshot = await getDocs(
          query(couponsCollection(this.db), where(documentId(), 'in', batch)),
        );
        for (const docSnap of couponsSnapshot.docs) {
          const couponResult = couponFromPersistence(
            docSnap.id,
            docSnap.data(),
          );
          if (couponResult.isFailure()) {
            return fail(couponResult.error);
          }
          couponsById.set(docSnap.id, couponResult.value);
        }
      }

      const results: CouponGrantWithCoupon[] = [];
      for (const grant of grants) {
        const coupon = couponsById.get(grant.couponId.value);
        if (coupon) {
          results.push({ grant, coupon });
        }
      }
      return ok(results);
    } catch (error) {
      return fail(
        new RepositoryError('Failed to find usable CouponGrants', error),
      );
    }
  }
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
