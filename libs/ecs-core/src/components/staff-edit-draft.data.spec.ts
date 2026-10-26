import { describe, expect, it } from 'vitest';
import {
  CouponGrantId,
  Currency,
  GiftVoucherId,
  LocationId,
  SeatId,
  ServiceId,
  BarberId,
} from '@core/primitives';
import {
  cents,
  draftPersonKey,
  duration,
  localDate,
  trackMinute,
} from '@core/testing';
import { CouponValue } from './coupon-value.data';
import { DiscountProvenance } from './discount-provenance.data';
import type { StaffEditDraft } from './staff-edit-draft.data';
import { VoucherCode } from './voucher-code.data';

/*
 * The staff sheet's commit as ecs-core reads it (pass D, D-10.1): EVERY
 * property required — absent is `null` — so a draft that omits `revision`,
 * `drawn` or a leg's `typedPriceCents` does not compile (the @ts-expect-error
 * lines below are the type-level pins; `nx typecheck` runs this file).
 */

const ANNA = draftPersonKey('u-anna');

const LEG: StaffEditDraft.Leg = {
  seatId: SeatId.of('seat-1'),
  serviceId: ServiceId.of('svc-cut'),
  variantId: null,
  minutes: duration(30),
  priceCents: cents(2800),
  currency: Currency.EUR,
  typedPriceCents: null,
  barberId: BarberId.of('ivan'),
  clientId: ANNA,
};

const DRAFT: StaffEditDraft = {
  revision: null,
  dayKey: localDate('2026-08-05'),
  startMinute: trackMinute(600),
  endMinute: trackMinute(630),
  locationId: LocationId.of('loc-center'),
  legs: [LEG],
  note: null,
  discounts: [],
  vouchers: [],
  tipCents: null,
  drawn: null,
  clients: [{ id: ANNA, label: 'Анна', phone: null, email: null }],
};

// @ts-expect-error — `revision` is required: absent is `null`.
const noRevision: StaffEditDraft = { ...DRAFT, revision: undefined };
// @ts-expect-error — `drawn` is required: absent is `null`.
const noDrawn: StaffEditDraft = { ...DRAFT, drawn: undefined };
// @ts-expect-error — a leg's `typedPriceCents` is required: absent is `null`.
const noTyped: StaffEditDraft.Leg = { ...LEG, typedPriceCents: undefined };
// @ts-expect-error — a person's `email` is required: absent is `null` (OR-26).
const noEmail: StaffEditDraft.Client = { id: ANNA, label: 'Анна', phone: null };

/** A whole draft omitting a field, as an object literal — refused at compile time. */
function omitted(): StaffEditDraft {
  // @ts-expect-error — omitting `revision` outright does not compile either.
  return {
    dayKey: DRAFT.dayKey,
    startMinute: DRAFT.startMinute,
    endMinute: DRAFT.endMinute,
    locationId: DRAFT.locationId,
    legs: DRAFT.legs,
    note: null,
    discounts: [],
    vouchers: [],
    tipCents: null,
    drawn: null,
    clients: DRAFT.clients,
  };
}

/** A drafted discount: provenance and value at the root, as the domain stores them. */
const GRANTED: StaffEditDraft.Discount = {
  ...DiscountProvenance.grant(CouponGrantId.of('grant-1')),
  ...CouponValue.freeService(),
  label: 'Рожден ден',
  grantId: CouponGrantId.of('grant-1'),
  code: null,
  exclusive: true,
};

const VOUCHER: StaffEditDraft.Voucher = {
  voucherId: GiftVoucherId.of('voucher-1'),
  code: VoucherCode.of('GIFT-2026'),
  availableCents: cents(5000),
};

describe('StaffEditDraft — the staff sheet’s commit, every field present', () => {
  it('holds a draft whose absent values are null, never missing', () => {
    expect(Object.keys(DRAFT)).toEqual([
      'revision',
      'dayKey',
      'startMinute',
      'endMinute',
      'locationId',
      'legs',
      'note',
      'discounts',
      'vouchers',
      'tipCents',
      'drawn',
      'clients',
    ]);
    expect(DRAFT.revision).toBeNull();
    expect(DRAFT.drawn).toBeNull();
    expect(LEG.typedPriceCents).toBeNull();
  });

  it('carries each person’s number and e-mail as typed — what the plan parses into a walk-in’s contact (OR-26)', () => {
    const typed: StaffEditDraft.Client = {
      id: draftPersonKey('guest-maria'),
      label: 'Мария',
      phone: '+359888123456',
      email: 'Maria@Example.com',
    };
    expect(Object.keys(typed)).toEqual(['id', 'label', 'phone', 'email']);
    expect(DRAFT.clients[0]?.email).toBeNull();
  });

  it('carries a discount flat — provenance and value fields at the root', () => {
    expect(GRANTED).toMatchObject({
      discountSource: 'GRANT',
      discountGrantId: 'grant-1',
      discountMethod: 'FREE_SERVICE',
    });
    expect(VOUCHER.availableCents).toBe(5000);
  });

  it('keeps the compile-time refusals compiled out of nothing at run time', () => {
    expect([noRevision, noDrawn, noTyped, noEmail, omitted()].length).toBe(5);
  });
});
