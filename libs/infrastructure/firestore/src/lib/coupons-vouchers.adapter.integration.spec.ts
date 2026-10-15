import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  RulesTestContext,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { VoucherCode } from '@core/components';
import { CouponGrantId, CouponId, CustomerId } from '@core/primitives';
import {
  createEmulatorTestEnv,
  modularFirestore,
} from '../testing/emulator-test-env';
import { couponVoucherPorts } from './coupons-vouchers.adapter';

const GEORGI = CustomerId.of('cus_georgi');

const coupon = (code: string | null, couponStatus: string) => ({
  name: 'Coupon',
  code,
  couponStatus,
  combinability: 'COMBINABLE',
});
const grant = (
  customerId: string,
  holderUserId: string,
  grantStatus: string,
) => ({
  customerId,
  holderUserId,
  couponId: 'c-retired',
  grantStatus,
  grantedAtUtcMs: 1,
});
const voucher = (
  code: string,
  issuedToCustomerId: string | null,
  holderUserId: string | null,
  voucherStatus = 'ACTIVE',
) => ({
  code,
  issuedToCustomerId,
  holderUserId,
  voucherStatus,
  balanceCents: 5000,
});

describe('couponVoucherPorts (emulator)', () => {
  let testEnv: RulesTestEnvironment;

  const portsFor = (context: RulesTestContext) =>
    couponVoucherPorts(modularFirestore(context));
  const barber = () =>
    portsFor(testEnv.authenticatedContext('staff-ivan', { roles: ['barber'] }));
  const georgi = () =>
    testEnv.authenticatedContext('u-georgi', { roles: ['client'] });

  beforeAll(async () => {
    testEnv = await createEmulatorTestEnv('demo-firestore-coupons-vouchers');
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = modularFirestore(ctx);
      await setDoc(
        doc(db, 'coupons', 'c-first10'),
        coupon('FIRST10', 'ENABLED'),
      );
      await setDoc(doc(db, 'coupons', 'c-retired'), coupon('OLD5', 'DISABLED'));
      await setDoc(
        doc(db, 'couponGrants', 'g-active'),
        grant('cus_georgi', 'u-georgi', 'ACTIVE'),
      );
      await setDoc(
        doc(db, 'couponGrants', 'g-used'),
        grant('cus_georgi', 'u-georgi', 'USED'),
      );
      await setDoc(
        doc(db, 'couponGrants', 'g-theirs'),
        grant('cus_martin', 'u-martin', 'ACTIVE'),
      );
      await setDoc(
        doc(db, 'giftVouchers', 'v-held'),
        voucher('GIFT-50', 'cus_georgi', 'u-georgi'),
      );
      await setDoc(
        doc(db, 'giftVouchers', 'v-spent'),
        voucher('GIFT-10', 'cus_georgi', 'u-georgi', 'VOID'),
      );
      await setDoc(
        doc(db, 'giftVouchers', 'v-paper'),
        voucher('PAPER-20', null, null),
      );
      await setDoc(
        doc(db, 'giftVouchers', 'v-theirs'),
        voucher('GIFT-30', 'cus_martin', 'u-martin'),
      );
    });
  });

  describe('coupons', () => {
    it('finds the ENABLED coupon a code names, and reads a retired code as none', async () => {
      const ports = barber();

      const first10 = await ports.findCouponByCode(VoucherCode.of('FIRST10'));
      const old5 = await ports.findCouponByCode(VoucherCode.of('OLD5'));

      expect(first10.ok && first10.value?.id).toBe('c-first10');
      expect(old5.ok && old5.value).toBeNull();
    });

    it('loads a DISABLED coupon by id — a held grant keeps its coupon’s terms', async () => {
      const loaded = await barber().loadCoupons([CouponId.of('c-retired')]);

      expect(loaded.ok && loaded.value).toEqual([
        { id: 'c-retired', ...coupon('OLD5', 'DISABLED') },
      ]);
    });

    it('lists the ENABLED coupons on offer', async () => {
      const open = await barber().listOpenCoupons();

      expect(open.ok && open.value.map((c) => c.id)).toEqual(['c-first10']);
    });
  });

  describe('grants', () => {
    it('lists a client record’s ACTIVE grants for the book, by two equalities', async () => {
      const grants = await barber().listUsableCouponGrants(GEORGI);

      expect(grants.ok && grants.value.map((g) => g.id)).toEqual(['g-active']);
    });

    it('loads one grant by id', async () => {
      const found = await barber().loadCouponGrant(
        CouponGrantId.of('g-active'),
      );

      expect(found.ok && found.value?.grantStatus).toBe('ACTIVE');
    });

    it('RULES: a client may read their own grant, never another’s', async () => {
      const db = modularFirestore(georgi());

      await expect(
        getDoc(doc(db, 'couponGrants', 'g-active')),
      ).resolves.toBeTruthy();
      await expect(
        getDoc(doc(db, 'couponGrants', 'g-theirs')),
      ).rejects.toBeTruthy();
    });

    it('RULES: no client updates a grant — the owner’s used → active flip included', async () => {
      const db = modularFirestore(georgi());

      await expect(
        updateDoc(doc(db, 'couponGrants', 'g-used'), { grantStatus: 'ACTIVE' }),
      ).rejects.toBeTruthy();
    });
  });

  describe('gift vouchers', () => {
    it('hands a barber what the client record holds, whatever its state — never another’s, never a paper one', async () => {
      const held = await barber().listGiftVouchersForHolder(GEORGI);

      expect(held.ok && held.value.map((v) => v.id).sort()).toEqual([
        'v-held',
        'v-spent',
      ]);
    });

    it('is an empty list for a client record that holds none', async () => {
      const held = await barber().listGiftVouchersForHolder(
        CustomerId.of('cus_nobody'),
      );

      expect(held.ok && held.value).toEqual([]);
    });

    it('finds the voucher a code names, whatever its state', async () => {
      const found = await barber().findGiftVoucherByCode(
        VoucherCode.of('GIFT-10'),
      );

      expect(found.ok && found.value?.voucherStatus).toBe('VOID');
    });

    it('RULES: a client reads their own voucher, never another’s', async () => {
      const db = modularFirestore(georgi());

      await expect(
        getDoc(doc(db, 'giftVouchers', 'v-held')),
      ).resolves.toBeTruthy();
      await expect(
        getDoc(doc(db, 'giftVouchers', 'v-theirs')),
      ).rejects.toBeTruthy();
    });

    it('is refused to an anonymous visitor', async () => {
      const held = await portsFor(
        testEnv.unauthenticatedContext(),
      ).listGiftVouchersForHolder(GEORGI);

      expect(held.ok).toBe(false);
    });
  });
});
