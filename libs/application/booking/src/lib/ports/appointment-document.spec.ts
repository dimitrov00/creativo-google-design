import { describe, expect, it } from 'vitest';
import { Money, ZonedDateTime } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import { CouponCombinability, CouponValue } from '@creativo/domain/engagement';
import {
  BarberId,
  LocationId,
  ServiceId,
  ServiceTerms,
} from '@creativo/domain/catalog';
import {
  AppliedDiscount,
  Appointment,
  COMPLETED,
  CONFIRMED,
  PENDING,
  Seat,
  SeatId,
  SeatSubject,
  cancelled,
  seatCancelled,
  seatNoShow,
  seatWorked,
  VoucherRedemption,
} from '@creativo/domain/scheduling';
import {
  appointmentToDocument,
  bookedAtFromDocument,
  seatOutcomeFromDocument,
  seatOutcomeToDocument,
  discountsFromDocument,
  couponValueFromDocument,
  voucherRedemptionsFromDocument,
} from './appointment-document';

const ZONE = 'Europe/Sofia';
const RESOLVED_AT_MS = Date.UTC(2026, 7, 5, 9, 0, 0);

function at(iso: string): ZonedDateTime {
  const result = ZonedDateTime.fromISO(iso, ZONE);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function terms(): ServiceTerms {
  const price = Money.fromMinorUnitsAndCode(1500, 'EUR');
  if (price.isFailure()) throw new Error('bad fixture');
  const result = ServiceTerms.create(price.value, 30);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function seat(): Seat {
  return Seat.of({
    id: SeatId.generate(),
    subject: SeatSubject.account(UserId.generate(), 'self'),
    serviceId: ServiceId.generate(),
    variantId: null,
    barberId: BarberId.generate(),
    terms: terms(),
    startsAt: at('2026-06-01T10:00:00'),
  });
}

function appointment(now = at('2026-05-01T09:00:00')): Appointment {
  const result = Appointment.create({
    id: 'appointment-2',
    locationId: LocationId.generate().toString(),
    seats: [seat()],
    now,
    bookedFromAppointmentId: 'appointment-1',
  });
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

describe('appointmentToDocument — write-time captures', () => {
  it('writes the booking instant with the zone that makes it renderable', () => {
    const now = at('2026-05-01T09:00:00');
    const document = appointmentToDocument(appointment(now));
    expect(document['bookedAt']).toEqual({
      iso: now.toISO(),
      zone: ZONE,
    });
  });

  it('writes the rebooking edge', () => {
    expect(
      appointmentToDocument(appointment())['bookedFromAppointmentId'],
    ).toBe('appointment-1');
  });

  it('round-trips the booking instant', () => {
    const now = at('2026-05-01T09:00:00');
    const document = appointmentToDocument(appointment(now));
    expect(bookedAtFromDocument(document)?.toMillis()).toBe(now.toMillis());
  });

  it('reads a missing booking instant as null rather than inventing one', () => {
    expect(bookedAtFromDocument({})).toBeNull();
    expect(bookedAtFromDocument({ bookedAt: 'nonsense' })).toBeNull();
    expect(
      bookedAtFromDocument({ bookedAt: { iso: 'nope', zone: ZONE } }),
    ).toBeNull();
  });

  it('writes a per-seat outcome for every seat', () => {
    const document = appointmentToDocument(appointment());
    const seats = document['seats'] as readonly Record<string, unknown>[];
    expect(seats[0]?.['outcome']).toEqual({ kind: 'scheduled' });
  });
});

describe('seatOutcome persistence', () => {
  const END_MS = at('2026-06-01T10:30:00').toMillis();

  it('round-trips every arm', () => {
    const cases = [
      seatWorked(RESOLVED_AT_MS),
      seatNoShow(RESOLVED_AT_MS),
      seatCancelled(RESOLVED_AT_MS, 'client', { kind: 'client_unwell' }),
      seatCancelled(RESOLVED_AT_MS, 'staff', {
        kind: 'other',
        note: 'barber called in sick',
      }),
    ];
    for (const outcome of cases) {
      expect(
        seatOutcomeFromDocument(
          seatOutcomeToDocument(outcome),
          CONFIRMED,
          END_MS,
        ),
      ).toEqual(outcome);
    }
  });

  it('reads a stored scheduled outcome as scheduled even on a finished visit', () => {
    expect(
      seatOutcomeFromDocument({ kind: 'scheduled' }, COMPLETED, END_MS).kind,
    ).toBe('scheduled');
  });

  /**
   * The legacy path: rows written before outcomes existed have no `outcome`
   * field at all, and leaving them `scheduled` would make every historical
   * visit read as unfinished business.
   */
  it('derives a missing outcome from a terminal root status', () => {
    expect(seatOutcomeFromDocument(undefined, COMPLETED, END_MS)).toEqual({
      kind: 'worked',
      atMs: END_MS,
    });
    expect(
      seatOutcomeFromDocument(undefined, cancelled('shop closed'), END_MS),
    ).toEqual({
      kind: 'cancelled',
      atMs: END_MS,
      by: 'staff',
      reason: { kind: 'other', note: 'shop closed' },
    });
  });

  it('leaves a missing outcome scheduled while the visit is still open', () => {
    expect(seatOutcomeFromDocument(undefined, PENDING, END_MS)).toEqual({
      kind: 'scheduled',
    });
    expect(seatOutcomeFromDocument(undefined, undefined, END_MS)).toEqual({
      kind: 'scheduled',
    });
  });

  it('falls back to the derivation when the stored outcome is malformed', () => {
    expect(
      seatOutcomeFromDocument({ kind: 'worked' }, COMPLETED, END_MS),
    ).toEqual({ kind: 'worked', atMs: END_MS });
    expect(
      seatOutcomeFromDocument({ kind: 'nonsense', atMs: 1 }, PENDING, END_MS)
        .kind,
    ).toBe('scheduled');
  });

  /**
   * Forward compatibility: a code this build does not know about must survive
   * a read rather than be silently flattened to a generic cancellation.
   */
  it('preserves an unrecognised cancellation code in the note', () => {
    const outcome = seatOutcomeFromDocument(
      {
        kind: 'cancelled',
        atMs: RESOLVED_AT_MS,
        by: 'client',
        reason: { kind: 'weather' },
      },
      CONFIRMED,
      END_MS,
    );
    expect(outcome.kind).toBe('cancelled');
    if (outcome.kind === 'cancelled') {
      expect(outcome.reason).toEqual({ kind: 'other', note: 'weather' });
    }
  });
});

describe('discount persistence', () => {
  const percent = (value: number): CouponValue => {
    const result = CouponValue.percentOff(value);
    if (result.isFailure()) throw new Error('bad fixture');
    return result.value;
  };

  const birthday = AppliedDiscount.of({
    id: 'grant:grant-1',
    source: 'grant',
    label: 'Рожден ден',
    value: percent(20),
    grantId: 'grant-1',
    appliedAt: at('2026-05-01T09:30:00'),
  });

  it('writes an empty list at full price, so absence stays distinguishable from age', () => {
    expect(appointmentToDocument(appointment())['discounts']).toEqual([]);
    // A row written before discounts existed has no field at all.
    expect(discountsFromDocument({})).toEqual([]);
  });

  it('round-trips a discount as a snapshot with its provenance', () => {
    const document = appointmentToDocument(
      appointment().withDiscounts([birthday]),
    );
    expect(document['discounts']).toEqual([
      {
        id: 'grant:grant-1',
        source: 'grant',
        label: 'Рожден ден',
        value: { kind: 'percent_off', percent: 20 },
        grantId: 'grant-1',
        code: null,
        appliedAt: { iso: birthday.appliedAt.toISO(), zone: ZONE },
        combinability: 'stackable',
      },
    ]);
    const [read] = discountsFromDocument(document);
    expect(read?.equals(birthday)).toBe(true);
    expect(read?.label).toBe('Рожден ден');
    expect(read?.appliedAt.toMillis()).toBe(birthday.appliedAt.toMillis());
  });

  it('writes a fixed amount in minor units beside its currency, and reads it back as money', () => {
    const five = Money.fromMinorUnitsAndCode(500, 'EUR');
    if (five.isFailure()) throw new Error('bad fixture');
    const fixed = CouponValue.fixedAmount(five.value);
    if (fixed.isFailure()) throw new Error('bad fixture');
    const manual = AppliedDiscount.of({
      id: 'manual',
      source: 'manual',
      label: 'manual',
      value: fixed.value,
      appliedAt: at('2026-05-01T09:30:00'),
    });
    const document = appointmentToDocument(
      appointment().withDiscounts([manual]),
    );
    const [written] = document['discounts'] as Record<string, unknown>[];
    expect(written?.['value']).toEqual({
      kind: 'fixed_amount',
      amountMinorUnits: 500,
      currencyCode: 'EUR',
    });
    const value = couponValueFromDocument(written?.['value']);
    expect(value?.kind).toBe('fixed_amount');
    if (value?.kind === 'fixed_amount') {
      expect(value.amount.toMinorUnits()).toBe(500);
    }
  });

  it('drops an entry it cannot read rather than failing the appointment', () => {
    const good = {
      id: 'code:coupon-1',
      source: 'code',
      label: 'Първо посещение',
      value: { kind: 'percent_off', percent: 10 },
      grantId: null,
      code: 'FIRST10',
      appliedAt: { iso: at('2026-05-01T09:30:00').toISO(), zone: ZONE },
    };
    const read = discountsFromDocument({
      discounts: [
        good,
        { ...good, id: '' },
        { ...good, source: 'wishful' },
        { ...good, value: { kind: 'percent_off', percent: 140 } },
        { ...good, appliedAt: 'yesterday' },
        'nonsense',
      ],
    });
    expect(read).toHaveLength(1);
    expect(read[0]?.code).toBe('FIRST10');
    expect(read[0]?.source).toBe('code');
  });
});

describe('voucher redemption persistence', () => {
  const eur = (minor: number) => {
    const money = Money.fromMinorUnitsAndCode(minor, 'EUR');
    if (money.isFailure()) throw new Error('bad fixture');
    return money.value;
  };
  const redemption = VoucherRedemption.of({
    voucherId: 'v1',
    code: 'GIFT2025',
    amount: eur(1000),
    balanceAfter: eur(1500),
    appliedAt: at('2026-05-01T09:30:00'),
  });

  it('writes an empty list when nothing was paid ahead, and reads absence as none', () => {
    expect(appointmentToDocument(appointment())['voucherRedemptions']).toEqual(
      [],
    );
    expect(voucherRedemptionsFromDocument({})).toEqual([]);
  });

  it('round-trips a draw-down with the balance it left, live or reversed', () => {
    const reversed = redemption.reversed(at('2026-05-02T09:30:00'));
    const document = appointmentToDocument(
      appointment().withVoucherRedemptions([redemption, reversed]),
    );
    expect(document['voucherRedemptions']).toEqual([
      {
        voucherId: 'v1',
        code: 'GIFT2025',
        amountMinorUnits: 1000,
        balanceAfterMinorUnits: 1500,
        currencyCode: 'EUR',
        appliedAt: { iso: redemption.appliedAt.toISO(), zone: ZONE },
        reversedAt: null,
      },
      {
        voucherId: 'v1',
        code: 'GIFT2025',
        amountMinorUnits: 1000,
        balanceAfterMinorUnits: 1500,
        currencyCode: 'EUR',
        appliedAt: { iso: redemption.appliedAt.toISO(), zone: ZONE },
        reversedAt: { iso: reversed.reversedAt?.toISO(), zone: ZONE },
      },
    ]);
    const read = voucherRedemptionsFromDocument(document);
    expect(read).toHaveLength(2);
    expect(read[0]?.live).toBe(true);
    expect(read[0]?.amount.toMinorUnits()).toBe(1000);
    expect(read[0]?.balanceAfter.toMinorUnits()).toBe(1500);
    expect(read[1]?.live).toBe(false);
  });

  it('reads an exclusive discount back as exclusive', () => {
    const exclusive = AppliedDiscount.of({
      id: 'grant:g',
      source: 'grant',
      label: 'Рожден ден',
      value: (() => {
        const r = CouponValue.percentOff(20);
        if (r.isFailure()) throw new Error('bad fixture');
        return r.value;
      })(),
      grantId: 'g',
      appliedAt: at('2026-05-01T09:30:00'),
      combinability: CouponCombinability.exclusive(),
    });
    const document = appointmentToDocument(
      appointment().withDiscounts([exclusive]),
    );
    expect(
      (document['discounts'] as Record<string, unknown>[])[0]?.[
        'combinability'
      ],
    ).toBe('exclusive');
    expect(discountsFromDocument(document)[0]?.exclusive).toBe(true);
  });

  it('drops a draw-down it cannot read rather than failing the appointment', () => {
    const read = voucherRedemptionsFromDocument({
      voucherRedemptions: [
        {
          voucherId: '',
          code: 'X',
          amountMinorUnits: 1,
          currencyCode: 'EUR',
          appliedAt: { iso: at('2026-05-01T09:30:00').toISO(), zone: ZONE },
        },
        {
          voucherId: 'v',
          code: 'GIFT5',
          amountMinorUnits: 'five',
          currencyCode: 'EUR',
        },
        'nonsense',
      ],
    });
    expect(read).toEqual([]);
  });
});
