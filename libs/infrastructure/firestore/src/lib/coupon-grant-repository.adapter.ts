import { Injectable, inject } from '@angular/core';
import {
  DocumentData,
  documentId,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { Result, ZonedDateTime, fail, ok } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import {
  Coupon,
  CouponGrant,
  CouponGrantCapacity,
  CouponGrantExpiration,
  CouponGrantId,
  CouponGrantState,
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
import {
  couponFromPersistence,
  couponValueFromPersistence,
  couponValueToPersistence,
} from './coupon-persistence';

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

/**
 * Grants live TOP-LEVEL (`couponGrants/{grantId}`) with the owner in a
 * `userId` field. The earlier per-user subcollection forced `findById` (a
 * grant id carries no owner) through a collection-group query whose rule
 * had to widen to every signed-in account — an unfiltered dump of every
 * user's grants — and whose index claim was simply wrong: a filtered CG
 * query needs a COLLECTION_GROUP-scope fieldOverride that was never
 * authored, so it passed the emulator and would have died in production
 * the day the port got a caller. Top-level, `findById` is a point get and
 * the rule is owner-only.
 */
@Injectable()
export class FirestoreCouponGrantRepository implements CouponGrantRepository {
  private readonly db = inject(FIREBASE_FIRESTORE);

  async save(grant: CouponGrant): Promise<Result<void, RepositoryError>> {
    try {
      await setDoc(
        couponGrantDocRef(this.db, grant.id),
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
      const snapshot = await getDoc(couponGrantDocRef(this.db, id));
      if (!snapshot.exists()) {
        return ok(null);
      }
      return grantFromPersistence(snapshot.id, snapshot.data() ?? {});
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
          couponGrantsCollection(this.db),
          // Two equality filters — served by Firestore's automatic
          // single-field indexes via index merging; no composite needed.
          where('userId', '==', userId.value),
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
