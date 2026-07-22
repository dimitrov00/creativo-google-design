import { beforeEach, describe, expect, it, vi } from 'vitest';

// `vi.mock` factories are hoisted above every import — including this test
// file's own `import ... from '@creativo/infrastructure/firebase-app'`,
// which transitively loads the *real* `firebase/firestore` at module-eval
// time. Any mock var the factory reads directly (not through a lazy
// closure) must go through `vi.hoisted` or it's a TDZ error the moment that
// import chain runs, before the plain `const` below would have executed.
const { setDocMock, getDocsMock } = vi.hoisted(() => ({
  setDocMock: vi.fn().mockResolvedValue(undefined),
  getDocsMock: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, ...segments: string[]) => ({
    id: segments[segments.length - 1],
    path: segments.join('/'),
  })),
  collection: vi.fn((_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  })),
  collectionGroup: vi.fn((_db: unknown, id: string) => ({ __group: id })),
  query: vi.fn((ref: unknown, ...constraints: unknown[]) => ({
    ref,
    constraints,
  })),
  where: vi.fn((field: string, op: string, value: unknown) => ({
    field,
    op,
    value,
  })),
  documentId: vi.fn(() => '__name__'),
  setDoc: setDocMock,
  getDocs: getDocsMock,
}));

import { TestBed } from '@angular/core/testing';
import { UserId } from '@creativo/domain/accounts';
import {
  CouponGrant,
  CouponGrantExpiration,
  CouponValue,
} from '@creativo/domain/engagement';
import { ZonedDateTime } from '@creativo/domain/kernel';
import { FIREBASE_FIRESTORE } from '@creativo/infrastructure/firebase-app';
import { FirestoreCouponGrantRepository } from './coupon-grant-repository.adapter';

function fakeSnapshot(docs: { id: string; data: Record<string, unknown> }[]) {
  return {
    empty: docs.length === 0,
    docs: docs.map((d) => ({ id: d.id, data: () => d.data })),
  };
}

function createRepo(): FirestoreCouponGrantRepository {
  TestBed.configureTestingModule({
    providers: [
      { provide: FIREBASE_FIRESTORE, useValue: {} },
      FirestoreCouponGrantRepository,
    ],
  });
  return TestBed.inject(FirestoreCouponGrantRepository);
}

describe('FirestoreCouponGrantRepository', () => {
  beforeEach(() => {
    setDocMock.mockClear();
    getDocsMock.mockReset();
  });

  const now = ZonedDateTime.now('Europe/Sofia');
  if (now.isFailure()) throw new Error('unreachable');
  const nowValue = now.value;

  function buildGrant() {
    const capacity = { kind: 'single_use' as const };
    const value = CouponValue.percentOff(20);
    if (value.isFailure()) throw new Error('unreachable');
    const grant = CouponGrant.create({
      id: 'grant-1',
      userId: 'user-1',
      couponId: 'coupon-1',
      value: value.value,
      grantedAt: nowValue,
      capacity,
      expiration: CouponGrantExpiration.none(),
    });
    if (grant.isFailure()) throw new Error(JSON.stringify(grant.error));
    return grant.value;
  }

  it('save() writes the grant under users/{userId}/couponGrants/{grantId}', async () => {
    const repo = createRepo();
    const grant = buildGrant();

    const result = await repo.save(grant);

    expect(result.isSuccess()).toBe(true);
    expect(setDocMock).toHaveBeenCalledTimes(1);
    const [ref, data] = setDocMock.mock.calls[0] as [
      { path: string },
      Record<string, unknown>,
    ];
    expect(ref.path).toBe('users/user-1/couponGrants/grant-1');
    expect(data['id']).toBe('grant-1');
    expect(data['userId']).toBe('user-1');
    expect(data['couponId']).toBe('coupon-1');
    expect(data['value']).toEqual({ kind: 'percent_off', percent: 20 });
    expect(data['state']).toMatchObject({ kind: 'active' });
  });

  it('findById() returns null when no matching grant exists', async () => {
    getDocsMock.mockResolvedValueOnce(fakeSnapshot([]));
    const repo = createRepo();

    const result = await repo.findById(buildGrant().id);
    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toBeNull();
    }
  });

  it('findById() reconstitutes the grant from a matching document', async () => {
    const grant = buildGrant();
    getDocsMock.mockResolvedValueOnce(
      fakeSnapshot([
        {
          id: 'grant-1',
          data: {
            id: 'grant-1',
            userId: 'user-1',
            couponId: 'coupon-1',
            value: { kind: 'percent_off', percent: 20 },
            grantedAt: nowValue.toISO(),
            state: {
              kind: 'active',
              capacity: { kind: 'single_use' },
              expiration: { kind: 'no_expiry' },
            },
          },
        },
      ]),
    );
    const repo = createRepo();

    const result = await repo.findById(grant.id);

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess() && result.value) {
      expect(result.value.id.value).toBe('grant-1');
      expect(result.value.userId.value).toBe('user-1');
      expect(result.value.value).toEqual({ kind: 'percent_off', percent: 20 });
      expect(result.value.isActive()).toBe(true);
    }
  });

  it('findUsableForUser() filters expired grants and joins the coupon definition', async () => {
    const past = ZonedDateTime.fromISO('2020-01-01T00:00:00Z', 'UTC');
    if (past.isFailure()) throw new Error('unreachable');

    getDocsMock
      .mockResolvedValueOnce(
        fakeSnapshot([
          {
            id: 'active-grant',
            data: {
              id: 'active-grant',
              userId: 'user-1',
              couponId: 'coupon-1',
              value: { kind: 'percent_off', percent: 10 },
              grantedAt: nowValue.toISO(),
              state: {
                kind: 'active',
                capacity: { kind: 'single_use' },
                expiration: { kind: 'no_expiry' },
              },
            },
          },
          {
            id: 'expired-grant',
            data: {
              id: 'expired-grant',
              userId: 'user-1',
              couponId: 'coupon-1',
              value: { kind: 'percent_off', percent: 10 },
              grantedAt: past.value.toISO(),
              state: {
                kind: 'active',
                capacity: { kind: 'single_use' },
                expiration: { kind: 'expires_at', atIso: past.value.toISO() },
              },
            },
          },
        ]),
      )
      .mockResolvedValueOnce(
        fakeSnapshot([
          {
            id: 'coupon-1',
            data: {
              name: 'Birthday coupon',
              value: { kind: 'percent_off', percent: 10 },
              combinability: { kind: 'stackable' },
              expiry: { kind: 'never' },
              usageLimit: null,
              enabled: true,
            },
          },
        ]),
      );

    const repo = createRepo();
    const userId = UserId.create('user-1');
    if (userId.isFailure()) throw new Error('unreachable');

    const result = await repo.findUsableForUser(userId.value, nowValue);

    expect(result.isSuccess()).toBe(true);
    if (result.isSuccess()) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.grant.id.value).toBe('active-grant');
      expect(result.value[0]?.coupon.name).toBe('Birthday coupon');
    }
  });
});
