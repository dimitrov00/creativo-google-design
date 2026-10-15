import type { Firestore } from 'firebase-admin/firestore';
import { RepositoryErrorCode } from '@core/primitives';
import { VoucherCode } from '@core/components';
import { createProjectionFirestore } from '../test-support/fake-projection-firestore';
import { firestoreCouponPorts } from './firestore-coupons.adapter';

const SUMMER = VoucherCode.of('SUMMER10');

describe('firestoreCouponPorts — the typed-code lookup', () => {
  it('finds the ENABLED coupon a code names, as its entity ({ id, ...body })', async () => {
    const fake = createProjectionFirestore({
      'coupons/c-summer': {
        code: 'SUMMER10',
        couponStatus: 'ENABLED',
        name: 'Summer',
      },
    });
    const result = await firestoreCouponPorts(
      fake.db as unknown as Firestore,
    ).findCouponByCode(SUMMER);
    expect(result).toEqual({
      ok: true,
      value: {
        id: 'c-summer',
        code: 'SUMMER10',
        couponStatus: 'ENABLED',
        name: 'Summer',
      },
    });
  });

  it('never answers a DISABLED coupon, and answers null when none matches', async () => {
    const fake = createProjectionFirestore({
      'coupons/c-old': { code: 'SUMMER10', couponStatus: 'DISABLED' },
      'coupons/c-other': { code: 'WINTER', couponStatus: 'ENABLED' },
    });
    const result = await firestoreCouponPorts(
      fake.db as unknown as Firestore,
    ).findCouponByCode(SUMMER);
    expect(result).toEqual({ ok: true, value: null });
  });

  it('answers a failed query as a REPOSITORY_READ_FAILED value', async () => {
    const failing = {
      collection: () => {
        throw new Error('down');
      },
    } as unknown as Firestore;
    const result = await firestoreCouponPorts(failing).findCouponByCode(SUMMER);
    expect(!result.ok && result.error.errorCode).toBe(
      RepositoryErrorCode.ReadFailed,
    );
  });
});
