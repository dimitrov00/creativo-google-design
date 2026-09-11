import { describe, expect, it } from 'vitest';
import { Money, ZonedDateTime } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import { BarberId, ServiceId, ServiceTerms } from '@creativo/domain/catalog';
import { CouponCombinability, CouponValue } from '@creativo/domain/engagement';
import { AppliedDiscount } from './applied-discount';
import { Appointment } from './appointment';
import { CONFIRMED } from './appointment-status';
import { SeatId } from './ids';
import { Seat, SeatSubject } from './seat';
import { VoucherRedemption } from './voucher-redemption';

const ZONE = 'Europe/Sofia';

function at(iso: string): ZonedDateTime {
  const r = ZonedDateTime.fromISO(iso, ZONE);
  if (r.isFailure()) throw new Error('bad fixture');
  return r.value;
}

function eur(minor: number): Money {
  const r = Money.fromMinorUnitsAndCode(minor, 'EUR');
  if (r.isFailure()) throw new Error('bad fixture');
  return r.value;
}

function seat(priceMinorUnits: number, startIso: string): Seat {
  const terms = ServiceTerms.create(eur(priceMinorUnits), 30);
  if (terms.isFailure()) throw new Error('bad fixture');
  return Seat.of({
    id: SeatId.generate(),
    subject: SeatSubject.account(UserId.generate(), 'self'),
    serviceId: ServiceId.generate(),
    variantId: null,
    barberId: BarberId.generate(),
    terms: terms.value,
    startsAt: at(startIso),
  });
}

function percent(value: number): CouponValue {
  const r = CouponValue.percentOff(value);
  if (r.isFailure()) throw new Error('bad fixture');
  return r.value;
}

function fixed(minor: number): CouponValue {
  const r = CouponValue.fixedAmount(eur(minor));
  if (r.isFailure()) throw new Error('bad fixture');
  return r.value;
}

/** A 20,00 € cut and an 8,00 € beard, confirmed. */
function visit(discounts: readonly AppliedDiscount[] = []): Appointment {
  const r = Appointment.reconstitute({
    id: 'appointment-1',
    locationId: 'loc-1',
    seats: [
      seat(2000, '2026-09-10T10:00:00'),
      seat(800, '2026-09-10T10:30:00'),
    ],
    status: CONFIRMED,
    discounts,
  });
  if (r.isFailure()) throw new Error('bad fixture');
  return r.value;
}

const birthday = AppliedDiscount.of({
  id: 'grant:grant-1',
  source: 'grant',
  label: 'Рожден ден',
  value: percent(20),
  grantId: 'grant-1',
  appliedAt: at('2026-09-10T09:00:00'),
});

describe('AppliedDiscount on an Appointment', () => {
  it('is empty by default, and then the total is the subtotal', () => {
    const appointment = visit();
    expect(appointment.discounts).toEqual([]);
    expect(appointment.subtotal().toMinorUnits()).toBe(2800);
    expect(appointment.total().toMinorUnits()).toBe(2800);
    expect(appointment.breakdown().lines).toEqual([]);
  });

  it('takes the discount off the bill through the one evaluator', () => {
    const appointment = visit([birthday]);
    const breakdown = appointment.breakdown();
    // 20% of 28,00 € is 5,60 €.
    expect(breakdown.subtotal.toMinorUnits()).toBe(2800);
    expect(breakdown.discountTotal.toMinorUnits()).toBe(560);
    expect(breakdown.total.toMinorUnits()).toBe(2240);
    expect(breakdown.lines.map((line) => line.label)).toEqual(['Рожден ден']);
    expect(appointment.total().toMinorUnits()).toBe(2240);
  });

  it('clamps a fixed amount at the bill and a free service zeroes it', () => {
    const generous = AppliedDiscount.of({
      id: 'manual',
      source: 'manual',
      label: 'manual',
      value: fixed(5000),
      appliedAt: at('2026-09-10T09:00:00'),
    });
    expect(visit([generous]).total().toMinorUnits()).toBe(0);
    const free = AppliedDiscount.of({
      id: 'grant:grant-2',
      source: 'grant',
      label: 'Пето подстригване',
      value: CouponValue.freeService(),
      grantId: 'grant-2',
      appliedAt: at('2026-09-10T09:00:00'),
    });
    expect(visit([free]).total().toMinorUnits()).toBe(0);
  });

  it('survives every lifecycle move and can be replaced whole', () => {
    const discounted = visit([birthday]);
    const completed = discounted.complete(at('2026-09-10T11:00:00').toMillis());
    if (completed.isFailure()) throw new Error('expected a completion');
    expect(completed.value.discounts).toHaveLength(1);
    expect(completed.value.total().toMinorUnits()).toBe(2240);

    const cleared = discounted.withDiscounts([]);
    expect(cleared.discounts).toEqual([]);
    expect(cleared.total().toMinorUnits()).toBe(2800);
    // The original is untouched: every mutator returns a new instance.
    expect(discounted.discounts).toHaveLength(1);
  });

  it('hands the evaluator its own shape, and compares as a promise', () => {
    expect(birthday.toDiscountInput()).toEqual({
      id: 'grant:grant-1',
      label: 'Рожден ден',
      value: percent(20),
      grantedAt: birthday.appliedAt,
    });
    const later = AppliedDiscount.of({
      ...birthday,
      appliedAt: at('2026-09-11T09:00:00'),
    });
    expect(birthday.equals(later)).toBe(true);
    const other = AppliedDiscount.of({ ...birthday, value: percent(10) });
    expect(birthday.equals(other)).toBe(false);
    expect(birthday.grantId).toBe('grant-1');
    expect(birthday.code).toBeNull();
  });
});

describe('AppliedDiscount — the legal set', () => {
  const stackable = AppliedDiscount.of({
    id: 'code:first10',
    source: 'code',
    label: 'Първо посещение',
    value: percent(10),
    code: 'FIRST10',
    appliedAt: at('2026-09-10T09:00:00'),
  });
  const exclusive = AppliedDiscount.of({
    ...birthday,
    combinability: CouponCombinability.exclusive(),
  });

  it('lets stackable promises share the bill and keeps an exclusive one alone', () => {
    expect(AppliedDiscount.isLegalSet([])).toBe(true);
    expect(AppliedDiscount.isLegalSet([stackable, birthday])).toBe(true);
    expect(AppliedDiscount.isLegalSet([exclusive])).toBe(true);
    expect(AppliedDiscount.isLegalSet([exclusive, stackable])).toBe(false);
    // The same promise twice is a caller bug, never a double discount.
    expect(AppliedDiscount.isLegalSet([stackable, stackable])).toBe(false);
    expect(exclusive.exclusive).toBe(true);
    expect(stackable.exclusive).toBe(false);
  });

  it("stacks on the running remainder, in the evaluator's order", () => {
    const five = AppliedDiscount.of({
      id: 'code:beard5',
      source: 'code',
      label: 'Брада −5 €',
      value: fixed(500),
      code: 'BEARD5',
      appliedAt: at('2026-09-10T09:01:00'),
    });
    // 28,00 − 5,00 = 23,00, then 10% of that: 2,30 off, 20,70 to pay.
    const appointment = visit([stackable, five]);
    expect(
      appointment.breakdown().lines.map((line) => line.amount.toMinorUnits()),
    ).toEqual([500, 230]);
    expect(appointment.total().toMinorUnits()).toBe(2070);
  });
});

describe('VoucherRedemption on an Appointment', () => {
  const redemption = VoucherRedemption.of({
    voucherId: 'v1',
    code: 'GIFT2025',
    amount: eur(1000),
    balanceAfter: eur(1500),
    appliedAt: at('2026-09-10T09:00:00'),
  });

  it('pays the bill without changing the price', () => {
    const paid = visit([birthday]).withVoucherRedemptions([redemption]);
    // 28,00 − 20% = 22,40 owed; the voucher paid 10,00 of it.
    expect(paid.total().toMinorUnits()).toBe(2240);
    expect(paid.redeemedTotal().toMinorUnits()).toBe(1000);
    expect(paid.balanceDue().toMinorUnits()).toBe(1240);
    expect(paid.voucherRedemptions[0]?.live).toBe(true);
  });

  it('keeps a reversed line as history that counts for nothing', () => {
    const reversed = redemption.reversed(at('2026-09-10T10:00:00'));
    const paid = visit().withVoucherRedemptions([reversed]);
    expect(reversed.live).toBe(false);
    expect(paid.redeemedTotal().toMinorUnits()).toBe(0);
    expect(paid.balanceDue().toMinorUnits()).toBe(2800);
    expect(paid.voucherRedemptions).toHaveLength(1);
  });

  it('never owes less than nothing, and survives the lifecycle', () => {
    const generous = VoucherRedemption.of({ ...redemption, amount: eur(5000) });
    const paid = visit().withVoucherRedemptions([generous]);
    expect(paid.balanceDue().toMinorUnits()).toBe(0);
    const completed = paid.complete(at('2026-09-10T11:00:00').toMillis());
    if (completed.isFailure()) throw new Error('expected a completion');
    expect(completed.value.voucherRedemptions).toHaveLength(1);
  });
});
