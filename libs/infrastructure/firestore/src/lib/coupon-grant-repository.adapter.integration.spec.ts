import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import type { Firestore } from 'firebase/firestore';
import { doc, setDoc } from 'firebase/firestore';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { createEmulatorTestEnv } from '../testing/emulator-test-env';
import { FirestoreCouponGrantRepository } from './coupon-grant-repository.adapter';
import { UserId } from '@creativo/domain/accounts';
import { CouponGrantId } from '@creativo/domain/engagement';
import { ZonedDateTime } from '@creativo/domain/kernel';

describe('FirestoreCouponGrantRepository (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-coupon-grant');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  const nowResult = ZonedDateTime.now('Europe/Sofia');
  if (nowResult.isFailure()) throw new Error('unreachable');
  const now = nowResult.value;

  function db(uid: string): Firestore {
    return testEnv
      .authenticatedContext(uid, { roles: ['client'] })
      .firestore() as unknown as Firestore;
  }

  function createRepo(uid: string): FirestoreCouponGrantRepository {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: FIREBASE_FIRESTORE, useValue: db(uid) },
        FirestoreCouponGrantRepository,
      ],
    });
    return TestBed.inject(FirestoreCouponGrantRepository);
  }

  async function seedCoupon(id: string, name: string) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore() as unknown as Firestore, 'coupons', id),
        {
          name,
          value: { kind: 'percent_off', percent: 15 },
          combinability: { kind: 'stackable' },
          expiry: { kind: 'never' },
          usageLimit: null,
          enabled: true,
        },
      );
    });
  }

  // Grants are server-minted only (`firestore.rules`: couponGrants
  // `create`/`delete` always deny a client) — every fixture here seeds the
  // INITIAL grant doc via the rules-disabled admin bypass, exactly like a
  // real materialization Cloud Function would, and only exercises
  // `repo.save()` for the one client-legal path: an owner transitioning
  // their own grant's `state`.
  async function seedGrant(
    userId: string,
    grantId: string,
    couponId: string,
    state: Record<string, unknown>,
  ) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(
          ctx.firestore() as unknown as Firestore,
          'users',
          userId,
          'couponGrants',
          grantId,
        ),
        {
          id: grantId,
          userId,
          couponId,
          value: { kind: 'percent_off', percent: 15 },
          grantedAt: now.toISO(),
          state,
        },
      );
    });
  }

  it('saves and finds a grant round-trip', async () => {
    await seedGrant('user-1', 'grant-1', 'coupon-1', {
      kind: 'active',
      capacity: { kind: 'single_use' },
      expiration: { kind: 'no_expiry' },
    });

    const repo = createRepo('user-1');
    const grantId = CouponGrantId.create('grant-1');
    if (grantId.isFailure()) throw new Error('unreachable');
    const findResult = await repo.findById(grantId.value);
    expect(findResult.isSuccess()).toBe(true);
    if (findResult.isSuccess()) {
      expect(findResult.value?.id.value).toBe('grant-1');
      expect(findResult.value?.userId.value).toBe('user-1');
    }

    // The one client-legal write: transition the owner's own grant to `used`.
    if (findResult.isSuccess() && findResult.value !== null) {
      const usedResult = findResult.value.markUsed(now, 'redeemed at checkout');
      if (usedResult.isFailure()) throw new Error('unreachable');
      const saveResult = await repo.save(usedResult.value);
      expect(saveResult.isSuccess()).toBe(true);
    }
  });

  it('findUsableForUser returns only active grants, joined with their coupon', async () => {
    await seedCoupon('coupon-1', 'Welcome bonus');
    await seedGrant('user-2', 'active-grant', 'coupon-1', {
      kind: 'active',
      capacity: { kind: 'single_use' },
      expiration: { kind: 'no_expiry' },
    });
    await seedGrant('user-2', 'used-grant', 'coupon-1', {
      kind: 'used',
      usedAtIso: now.toISO(),
      note: 'already redeemed',
    });

    const repo = createRepo('user-2');
    const userId = UserId.create('user-2');
    if (userId.isFailure()) throw new Error('unreachable');

    const result = await repo.findUsableForUser(userId.value, now);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.grant.id.value).toBe('active-grant');
      expect(result.value[0]?.coupon.name).toBe('Welcome bonus');
    }
  });

  it('denies a grant update that changes anything other than `state` (rules)', async () => {
    await seedGrant('user-3', 'grant-2', 'coupon-1', {
      kind: 'active',
      capacity: { kind: 'single_use' },
      expiration: { kind: 'no_expiry' },
    });

    // Direct write bypassing the adapter's own state-only mapper, to prove
    // the RULE (not just adapter discipline) rejects a value-changing update
    // on an EXISTING grant doc.
    await expect(
      setDoc(
        doc(db('user-3'), 'users', 'user-3', 'couponGrants', 'grant-2'),
        { value: { kind: 'percent_off', percent: 99 } },
        { merge: true },
      ),
    ).rejects.toBeDefined();
  });
});
