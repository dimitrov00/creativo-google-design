import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { VoucherCode } from '@core/components';
import { CouponGrantId, CouponId, CustomerId, Result } from '@core/primitives';
import { RepositoryErrorCode } from '@core/errors';
import { unwrapOk } from '@core/testing';
import { FakeFirestore } from '../testing/fake-firestore';

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);

const { couponVoucherPorts } = await import('./coupons-vouchers.adapter');

const asDb = (fake: FakeFirestore) => fake as unknown as Firestore;
const code = (raw: string) => unwrapOk(VoucherCode.parse(raw));

const GEORGI = CustomerId.of('cus_georgi');

const coupon = (fields: { code: string | null; status?: string }) => ({
  name: 'Coupon',
  code: fields.code,
  couponStatus: fields.status ?? 'ENABLED',
  combinability: 'COMBINABLE',
});
const grant = (
  customerId: string,
  grantStatus: string,
  couponId = 'c-birthday',
) => ({
  customerId,
  holderUserId: `u-${customerId}`,
  couponId,
  grantStatus,
});
const voucher = (
  voucherCode: string,
  issuedToCustomerId: string | null,
  voucherStatus = 'ACTIVE',
) => ({
  code: voucherCode,
  issuedToCustomerId,
  holderUserId: issuedToCustomerId === null ? null : `u-${issuedToCustomerId}`,
  voucherStatus,
  balanceCents: 5000,
});

const promotions = () =>
  new FakeFirestore({
    'coupons/c-first10': coupon({ code: 'FIRST10' }),
    'coupons/c-retired': coupon({ code: 'OLD5', status: 'DISABLED' }),
    'coupons/c-birthday': coupon({ code: null }),
    'couponGrants/g-active': grant('cus_georgi', 'ACTIVE'),
    'couponGrants/g-used': grant('cus_georgi', 'USED'),
    'couponGrants/g-theirs': grant('cus_martin', 'ACTIVE'),
    'giftVouchers/v-held': voucher('GIFT-50', 'cus_georgi'),
    'giftVouchers/v-spent': voucher('GIFT-10', 'cus_georgi', 'VOID'),
    'giftVouchers/v-paper': voucher('PAPER-20', null),
    'giftVouchers/v-theirs': voucher('GIFT-30', 'cus_martin'),
  });

describe('couponVoucherPorts — coupons', () => {
  it('finds the ENABLED coupon a code names, one document', async () => {
    const fake = promotions();

    const found = await couponVoucherPorts(asDb(fake)).findCouponByCode(
      code('FIRST10'),
    );

    expect(found).toEqual(
      Result.ok({ id: 'c-first10', ...coupon({ code: 'FIRST10' }) }),
    );
    expect(fake.reads[0]?.constraints).toEqual([
      'code == "FIRST10"',
      'couponStatus == "ENABLED"',
      'limit 1',
    ]);
  });

  it('reads a retired code as no code at all', async () => {
    const found = await couponVoucherPorts(asDb(promotions())).findCouponByCode(
      code('OLD5'),
    );

    expect(found).toEqual(Result.ok(null));
  });

  it('lists the ENABLED coupons that carry a code — a grant-only coupon is not on offer', async () => {
    const fake = promotions();

    const open = await couponVoucherPorts(asDb(fake)).listOpenCoupons();

    expect(open.ok && open.value.map((c) => c.id)).toEqual(['c-first10']);
    expect(fake.reads[0]?.constraints).toEqual(['couponStatus == "ENABLED"']);
  });

  it('loads coupons by id whatever their status — a held grant whose coupon was disabled keeps its terms', async () => {
    const fake = promotions();

    const loaded = await couponVoucherPorts(asDb(fake)).loadCoupons([
      CouponId.of('c-retired'),
      CouponId.of('c-birthday'),
    ]);

    expect(loaded).toEqual(
      Result.ok([
        { id: 'c-birthday', ...coupon({ code: null }) },
        { id: 'c-retired', ...coupon({ code: 'OLD5', status: 'DISABLED' }) },
      ]),
    );
    expect(fake.reads[0]?.constraints).toEqual([
      '__name__ in ["c-retired","c-birthday"]',
    ]);
  });

  it('asks thirty ids at a time — Firestore’s cap on one `in` — and each id once', async () => {
    const fake = promotions();
    const ids = Array.from({ length: 31 }, (_, i) => CouponId.of(`c-${i}`));

    await couponVoucherPorts(asDb(fake)).loadCoupons([
      ...ids,
      ids[0] as CouponId,
    ]);

    expect(fake.reads).toHaveLength(2);
  });

  it('reads nothing for no ids', async () => {
    const fake = promotions();

    const loaded = await couponVoucherPorts(asDb(fake)).loadCoupons([]);

    expect(loaded).toEqual(Result.ok([]));
    expect(fake.reads).toEqual([]);
  });
});

describe('couponVoucherPorts — grants', () => {
  it('loads one grant by id, and null when there is none', async () => {
    const ports = couponVoucherPorts(asDb(promotions()));

    expect(await ports.loadCouponGrant(CouponGrantId.of('g-active'))).toEqual(
      Result.ok({ id: 'g-active', ...grant('cus_georgi', 'ACTIVE') }),
    );
    expect(await ports.loadCouponGrant(CouponGrantId.of('g-none'))).toEqual(
      Result.ok(null),
    );
  });

  it('lists a client record’s ACTIVE grants by two equalities — another client’s and a used one left out', async () => {
    const fake = promotions();

    const grants = await couponVoucherPorts(asDb(fake)).listUsableCouponGrants(
      GEORGI,
    );

    expect(grants.ok && grants.value.map((g) => g.id)).toEqual(['g-active']);
    expect(fake.reads[0]?.constraints).toEqual([
      'customerId == "cus_georgi"',
      'grantStatus == "ACTIVE"',
    ]);
  });
});

describe('couponVoucherPorts — gift vouchers', () => {
  it('finds the voucher a code names whatever its state — the sheet says why a void one will not take', async () => {
    const found = await couponVoucherPorts(
      asDb(promotions()),
    ).findGiftVoucherByCode(code('GIFT-10'));

    expect(found).toEqual(
      Result.ok({ id: 'v-spent', ...voucher('GIFT-10', 'cus_georgi', 'VOID') }),
    );
  });

  it('lists what a client holds, whatever its state — never another’s, never a paper one', async () => {
    const fake = promotions();

    const held = await couponVoucherPorts(asDb(fake)).listGiftVouchersForHolder(
      GEORGI,
    );

    expect(held.ok && held.value.map((v) => v.id)).toEqual([
      'v-held',
      'v-spent',
    ]);
    expect(fake.reads[0]?.constraints).toEqual([
      'issuedToCustomerId == "cus_georgi"',
    ]);
  });

  it('is an empty list, never an error, for a client who holds none', async () => {
    const held = await couponVoucherPorts(
      asDb(promotions()),
    ).listGiftVouchersForHolder(CustomerId.of('cus_nobody'));

    expect(held).toEqual(Result.ok([]));
  });

  it('turns a refused read into a failed Result', async () => {
    const fake = promotions().failWith({ code: 'permission-denied' });

    const held = await couponVoucherPorts(asDb(fake)).listGiftVouchersForHolder(
      GEORGI,
    );
    const loaded = await couponVoucherPorts(asDb(fake)).loadCoupons([
      CouponId.of('c-first10'),
    ]);

    expect(held).toEqual(
      Result.err({
        errorCode: RepositoryErrorCode.ReadFailed,
        path: 'giftVouchers',
        reason: 'permission-denied',
      }),
    );
    expect(loaded.ok).toBe(false);
  });
});
