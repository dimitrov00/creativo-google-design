import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type AppliedDiscount,
  BookingLifecycle,
  CancellationReason,
  CancellationReasonSet,
  CancelledBy,
  Combinability,
  CouponValue,
  DiscountProvenance,
  type Seat,
  SeatOutcome,
  StaffEditDelta,
  VoucherCode,
  type VoucherRedemption,
} from '@core/components';
import {
  AppliedDiscountId,
  AttendanceState,
  BarberId,
  BookingStatus,
  Currency,
  GiftVoucherId,
  LocationId,
  type PriceCents,
  SeatId,
} from '@core/primitives';
import type { Appointment } from '@core/entities';
import {
  appointmentFixture,
  cents,
  deepFreeze,
  FIXTURE_IDS,
  hourCount,
  localDate,
  minute,
  seatFixture,
  termsFixture,
  unwrapOk,
  utcMs,
} from '@core/testing';
import { AuditDeltaSystem } from './audit-delta.system';

/*
 * The before / after values an audit row carries (audit-hardening WS-2,
 * DEP-10 / DEP-10a): pure, total, from the entities the act already read.
 */

const IVAN = FIXTURE_IDS.barber;
const MARIA = BarberId.of('b-maria');
const OTHER_SHOP = LocationId.of('loc-west');
const BOOKED = utcMs('2026-09-20T10:00:00.000+03:00');
const LATER = utcMs('2026-09-27T10:00:00.000+03:00');

/** A seat with its own id, barber, start and terms (price in cents, minutes, currency). */
function seat(
  id: string,
  barberId: BarberId = IVAN,
  options: {
    readonly start?: number;
    readonly price?: number;
    readonly minutes?: number;
    readonly currency?: Currency;
    readonly tip?: PriceCents | null;
    readonly outcome?: SeatOutcome;
  } = {},
): Seat {
  return seatFixture({
    seatId: SeatId.of(id),
    barberId,
    startMinutes: minute(options.start ?? 600),
    tipCents: options.tip ?? null,
    terms: {
      ...termsFixture(
        options.price ?? 2800,
        options.minutes ?? 30,
        0,
        0,
        options.currency ?? Currency.EUR,
      ),
      catalogPriceCents: null,
      catalogDurationMinutes: null,
    },
    ...(options.outcome === undefined ? {} : { outcome: options.outcome }),
  });
}

/** A visit holding `seats`, on Oct 1 at the first seat's start unless overridden. */
function visit(
  seats: readonly Seat[],
  overrides: Parameters<typeof appointmentFixture>[0] = {},
): Appointment {
  return appointmentFixture({
    seats,
    localDate: localDate('2026-10-01'),
    startMinutes: seats[0]?.startMinutes ?? minute(600),
    ...overrides,
  });
}

function discount(id: string): AppliedDiscount {
  return {
    discountId: AppliedDiscountId.of(id),
    label: 'Desk words that never reach a row',
    appliedAtUtcMs: BOOKED,
    combinability: Combinability.Stackable,
    ...DiscountProvenance.manual(),
    ...unwrapOk(CouponValue.percentOff(5)),
  };
}

function line(
  voucher: string,
  amount: number,
  options: {
    readonly reversed?: boolean;
    readonly currency?: Currency;
  } = {},
): VoucherRedemption {
  return {
    voucherId: GiftVoucherId.of(voucher),
    code: VoucherCode.of('GIFT50'),
    amountCents: cents(amount),
    balanceAfterCents: cents(0),
    currency: options.currency ?? Currency.EUR,
    appliedAtUtcMs: BOOKED,
    reversedAtUtcMs: options.reversed === true ? LATER : null,
  };
}

describe('AuditDeltaSystem.rescheduled — where a client move took the visit', () => {
  it('names the day, the start, the shop and the barbers on each side', () => {
    const before = visit([seat('s-1')]);
    const after = visit([seat('s-1', MARIA, { start: 660 })], {
      localDate: localDate('2026-10-02'),
      locationId: OTHER_SHOP,
    });
    expect(AuditDeltaSystem.rescheduled(before, after)).toEqual({
      rescheduleFromLocalDate: '2026-10-01',
      rescheduleToLocalDate: '2026-10-02',
      rescheduleFromStartMinutes: 600,
      rescheduleToStartMinutes: 660,
      rescheduleFromBarberIds: [IVAN],
      rescheduleToBarberIds: [MARIA],
      rescheduleFromLocationId: FIXTURE_IDS.location,
      rescheduleToLocationId: OTHER_SHOP,
    });
  });

  it('keeps a duplicate barber and the seat order — positional, never deduplicated', () => {
    const before = visit([seat('s-1', IVAN), seat('s-2', IVAN)]);
    const after = visit([seat('s-1', MARIA), seat('s-2', IVAN)]);
    const delta = AuditDeltaSystem.rescheduled(before, after);
    expect(delta.rescheduleFromBarberIds).toEqual([IVAN, IVAN]);
    expect(delta.rescheduleToBarberIds).toEqual([MARIA, IVAN]);
  });

  it('reads re-id’d cart seats by place — a move that re-ids its seats still names its barbers', () => {
    const before = visit([seat('s-1', IVAN), seat('s-2', MARIA)]);
    const after = visit([seat('cart-9', MARIA), seat('cart-8', IVAN)]);
    const delta = AuditDeltaSystem.rescheduled(before, after);
    expect(delta.rescheduleFromBarberIds).toEqual([IVAN, MARIA]);
    expect(delta.rescheduleToBarberIds).toEqual([MARIA, IVAN]);
  });

  it('carries the first and last minute of the shop day as they are', () => {
    const before = visit([seat('s-1', IVAN, { start: 0, minutes: 30 })]);
    const after = visit([seat('s-1', IVAN, { start: 1439, minutes: 1 })]);
    const delta = AuditDeltaSystem.rescheduled(before, after);
    expect([
      delta.rescheduleFromStartMinutes,
      delta.rescheduleToStartMinutes,
    ]).toEqual([0, 1439]);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const before = deepFreeze(visit([seat('s-1')]));
    const after = deepFreeze(visit([seat('s-1', MARIA, { start: 700 })]));
    expect(AuditDeltaSystem.rescheduled(before, after)).toEqual(
      AuditDeltaSystem.rescheduled(before, after),
    );
  });
});

describe('AuditDeltaSystem.staffEdit — what a staff save changed', () => {
  const base = () =>
    visit([seat('s-1', IVAN, { price: 2800, minutes: 30 })], {
      discounts: [discount('manual')],
      voucherRedemptions: [line('v-1', 1000)],
    });

  it('a save that touched nothing audited is NONE itself', () => {
    expect(AuditDeltaSystem.staffEdit(base(), base())).toBe(
      StaffEditDelta.NONE,
    );
    // A new revision or ledger entry is not an audited dimension.
    expect(AuditDeltaSystem.staffEdit(base(), { ...base(), revision: 9 })).toBe(
      StaffEditDelta.NONE,
    );
  });

  it('a reprice alone sets the subtotal pair and its currency — nothing else', () => {
    const after = { ...base(), seats: [seat('s-1', IVAN, { price: 3500 })] };
    expect(AuditDeltaSystem.staffEdit(base(), after)).toEqual({
      ...StaffEditDelta.NONE,
      editRepriceFromCents: 2800,
      editRepriceToCents: 3500,
      editCurrency: 'EUR',
    });
  });

  it('a mixed-currency bill on either side leaves the subtotal pair null, never a defect', () => {
    const mixed = {
      ...base(),
      seats: [
        seat('s-1', IVAN, { price: 2800 }),
        seat('s-2', MARIA, { price: 1000, currency: Currency.BGN }),
      ],
    };
    const delta = AuditDeltaSystem.staffEdit(base(), mixed);
    expect(delta.editRepriceFromCents).toBeNull();
    expect(delta.editRepriceToCents).toBeNull();
    expect(delta.editCurrency).toBeNull();
    // The second seat is still a restaff and a longer visit.
    expect(delta.editRestaffToBarberIds).toEqual([IVAN, MARIA]);
    expect(delta.editDurationToMinutes).toBe(60);
  });

  it('a bill that changed currency is no reprice either — one currency cannot word both sides', () => {
    const after = {
      ...base(),
      seats: [seat('s-1', IVAN, { price: 5600, currency: Currency.BGN })],
    };
    const delta = AuditDeltaSystem.staffEdit(base(), after);
    expect(delta.editRepriceFromCents).toBeNull();
    expect(delta.editRepriceToCents).toBeNull();
  });

  it('a discount added: the before and AFTER id sets', () => {
    const after = {
      ...base(),
      discounts: [discount('manual'), discount('code:c-1')],
    };
    expect(AuditDeltaSystem.staffEdit(base(), after)).toEqual({
      ...StaffEditDelta.NONE,
      editDiscountFromIds: ['manual'],
      editDiscountIds: ['manual', 'code:c-1'],
    });
  });

  it('every discount removed is `[]` after — a change; untouched is `null`', () => {
    const after = { ...base(), discounts: [] };
    const delta = AuditDeltaSystem.staffEdit(base(), after);
    expect(delta.editDiscountFromIds).toEqual(['manual']);
    expect(delta.editDiscountIds).toEqual([]);
    const reordered = AuditDeltaSystem.staffEdit(
      { ...base(), discounts: [discount('a'), discount('b')] },
      { ...base(), discounts: [discount('b'), discount('a')] },
    );
    expect(reordered.editDiscountIds).toBeNull();
    expect(reordered.editDiscountFromIds).toBeNull();
  });

  it('a voucher drawn down: the live lines’ net, signed and positive', () => {
    const after = {
      ...base(),
      voucherRedemptions: [line('v-1', 1000), line('v-2', 500)],
    };
    expect(AuditDeltaSystem.staffEdit(base(), after)).toEqual({
      ...StaffEditDelta.NONE,
      editVoucherDebitCents: 500,
      editCurrency: 'EUR',
    });
  });

  it('a voucher line reversed: the net is negative', () => {
    const after = {
      ...base(),
      voucherRedemptions: [line('v-1', 1000, { reversed: true })],
    };
    const delta = AuditDeltaSystem.staffEdit(base(), after);
    expect(delta.editVoucherDebitCents).toBe(-1000);
    expect(delta.editCurrency).toBe('EUR');
  });

  it('lines swapped for the same sum: the debit is 0 — a change, not `null`', () => {
    const after = { ...base(), voucherRedemptions: [line('v-2', 1000)] };
    const delta = AuditDeltaSystem.staffEdit(base(), after);
    expect(delta.editVoucherDebitCents).toBe(0);
    expect(delta.editCurrency).toBe('EUR');
  });

  it('a reversed line that stays reversed is no voucher change', () => {
    const was = {
      ...base(),
      voucherRedemptions: [
        line('v-1', 1000),
        line('v-2', 300, { reversed: true }),
      ],
    };
    const now = {
      ...base(),
      voucherRedemptions: [
        line('v-1', 1000),
        line('v-2', 300, { reversed: true }),
      ],
    };
    expect(AuditDeltaSystem.staffEdit(was, now)).toBe(StaffEditDelta.NONE);
  });

  it('a voucher change on a mixed bill reads in the stored bill’s currency', () => {
    const mixed = [
      seat('s-1', IVAN, { price: 2800 }),
      seat('s-2', IVAN, { price: 1000, currency: Currency.BGN }),
    ];
    const delta = AuditDeltaSystem.staffEdit(base(), {
      ...base(),
      seats: mixed,
      voucherRedemptions: [line('v-1', 1000), line('v-2', 400)],
    });
    expect(delta.editVoucherDebitCents).toBe(400);
    expect(delta.editCurrency).toBe('EUR');
    // Neither side has a currency at all: no debit can be worded.
    const both = AuditDeltaSystem.staffEdit(
      { ...base(), seats: mixed },
      { ...base(), seats: mixed, voucherRedemptions: [] },
    );
    expect(both.editVoucherDebitCents).toBeNull();
    expect(both.editCurrency).toBeNull();
  });

  it('a redurate, a relocate, a move and a restaff each set their own pair', () => {
    expect(
      AuditDeltaSystem.staffEdit(base(), {
        ...base(),
        seats: [seat('s-1', IVAN, { minutes: 45 })],
      }),
    ).toEqual({
      ...StaffEditDelta.NONE,
      editDurationFromMinutes: 30,
      editDurationToMinutes: 45,
    });
    expect(
      AuditDeltaSystem.staffEdit(base(), {
        ...base(),
        locationId: OTHER_SHOP,
      }),
    ).toEqual({
      ...StaffEditDelta.NONE,
      editRelocateFromLocationId: FIXTURE_IDS.location,
      editRelocateToLocationId: OTHER_SHOP,
    });
    // A same-day move still names its day: a start means nothing alone.
    expect(
      AuditDeltaSystem.staffEdit(base(), {
        ...base(),
        startMinutes: minute(1439),
      }),
    ).toEqual({
      ...StaffEditDelta.NONE,
      editMoveFromLocalDate: '2026-10-01',
      editMoveToLocalDate: '2026-10-01',
      editMoveFromStartMinutes: 600,
      editMoveToStartMinutes: 1439,
    });
    expect(
      AuditDeltaSystem.staffEdit(base(), {
        ...base(),
        localDate: localDate('2026-10-03'),
        startMinutes: minute(0),
      }),
    ).toMatchObject({
      editMoveFromLocalDate: '2026-10-01',
      editMoveToLocalDate: '2026-10-03',
      editMoveFromStartMinutes: 600,
      editMoveToStartMinutes: 0,
    });
    expect(
      AuditDeltaSystem.staffEdit(base(), {
        ...base(),
        seats: [seat('s-1', MARIA)],
      }),
    ).toEqual({
      ...StaffEditDelta.NONE,
      editRestaffFromBarberIds: [IVAN],
      editRestaffToBarberIds: [MARIA],
    });
  });

  it('a reorder of the barbers is a restaff; the same barbers in place are not', () => {
    const pair = (a: BarberId, b: BarberId) =>
      visit([seat('s-1', a), seat('s-2', b)]);
    expect(
      AuditDeltaSystem.staffEdit(pair(IVAN, MARIA), pair(MARIA, IVAN)),
    ).toMatchObject({
      editRestaffFromBarberIds: [IVAN, MARIA],
      editRestaffToBarberIds: [MARIA, IVAN],
    });
    expect(
      AuditDeltaSystem.staffEdit(pair(IVAN, IVAN), pair(IVAN, IVAN))
        .editRestaffToBarberIds,
    ).toBeNull();
  });

  it('carries no voucher code and no discount label — ids and money only (R36)', () => {
    const after = {
      ...base(),
      discounts: [discount('code:c-1')],
      voucherRedemptions: [line('v-2', 700)],
    };
    const text = JSON.stringify(AuditDeltaSystem.staffEdit(base(), after));
    expect(text).not.toContain('GIFT50');
    expect(text).not.toContain('Desk words');
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const before = deepFreeze(base());
    const after = deepFreeze({
      ...base(),
      seats: [seat('s-1', MARIA, { price: 3000 })],
      discounts: [],
    });
    expect(AuditDeltaSystem.staffEdit(before, after)).toEqual(
      AuditDeltaSystem.staffEdit(before, after),
    );
  });

  it('a visit against itself is NONE, whatever it holds (fast-check)', () => {
    const arbitrarySeat = fc.record({
      barber: fc.constantFrom(IVAN, MARIA),
      start: fc.integer({ min: 0, max: 1380 }),
      price: fc.integer({ min: 0, max: 50_000 }),
      minutes: fc.integer({ min: 1, max: 59 }),
      currency: fc.constantFrom(Currency.EUR, Currency.BGN),
    });
    fc.assert(
      fc.property(
        fc.array(arbitrarySeat, { minLength: 1, maxLength: 4 }),
        fc.array(fc.constantFrom('manual', 'code:a', 'grant:b'), {
          maxLength: 3,
        }),
        fc.array(
          fc.record({
            voucher: fc.constantFrom('v-1', 'v-2'),
            amount: fc.integer({ min: 0, max: 5000 }),
            reversed: fc.boolean(),
          }),
          { maxLength: 3 },
        ),
        (seats, discountIds, lines) => {
          const built = visit(
            seats.map((s, i) =>
              seat(`s-${i}`, s.barber, {
                start: s.start,
                price: s.price,
                minutes: s.minutes,
                currency: s.currency,
              }),
            ),
            {
              discounts: discountIds.map(discount),
              voucherRedemptions: lines.map((l) =>
                line(l.voucher, l.amount, { reversed: l.reversed }),
              ),
            },
          );
          expect(AuditDeltaSystem.staffEdit(built, built)).toBe(
            StaffEditDelta.NONE,
          );
          // A structural copy is the same visit too.
          expect(
            AuditDeltaSystem.staffEdit(built, structuredClone(built)),
          ).toBe(StaffEditDelta.NONE);
        },
      ),
    );
  });
});

describe('AuditDeltaSystem.tip — the figure of a tip act', () => {
  const at = (tip: PriceCents | null) =>
    seat('s-1', IVAN, { tip, currency: Currency.BGN });

  it('set, changed, cleared — the amount after, the one before, the seat’s currency', () => {
    expect(AuditDeltaSystem.tip(at(null), at(cents(300)))).toEqual({
      tipAmountCents: 300,
      tipFromCents: null,
      tipCurrency: 'BGN',
    });
    expect(AuditDeltaSystem.tip(at(cents(300)), at(cents(500)))).toEqual({
      tipAmountCents: 500,
      tipFromCents: 300,
      tipCurrency: 'BGN',
    });
    expect(AuditDeltaSystem.tip(at(cents(500)), at(null))).toEqual({
      tipAmountCents: null,
      tipFromCents: 500,
      tipCurrency: 'BGN',
    });
  });

  it('tipOnSeat reads the seat on each side by its id, wherever it sits', () => {
    expect(
      AuditDeltaSystem.tipOnSeat(
        [seat('s-1', IVAN), seat('s-2', MARIA, { tip: cents(100) })],
        [seat('s-2', MARIA, { tip: cents(400) }), seat('s-1', IVAN)],
        SeatId.of('s-2'),
      ),
    ).toEqual({ tipAmountCents: 400, tipFromCents: 100, tipCurrency: 'EUR' });
  });

  it('tipOnSeat on a seat the visit does not hold is a defect — the act refused it first', () => {
    expect(() =>
      AuditDeltaSystem.tipOnSeat([seat('s-1')], [seat('s-1')], SeatId.of('x')),
    ).toThrow(/defect/);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const before = deepFreeze(at(cents(100)));
    const after = deepFreeze(at(null));
    expect(AuditDeltaSystem.tip(before, after)).toEqual(
      AuditDeltaSystem.tip(before, after),
    );
  });
});

describe('AuditDeltaSystem.transitioned / cancelled — the state an act left', () => {
  const cases: readonly [BookingLifecycle, BookingStatus][] = [
    [BookingLifecycle.pending(BOOKED), BookingStatus.Pending],
    [BookingLifecycle.confirm(BOOKED), BookingStatus.Confirmed],
    [BookingLifecycle.complete(BOOKED), BookingStatus.Completed],
    [BookingLifecycle.noShow(BOOKED), BookingStatus.NoShow],
    [
      BookingLifecycle.cancel(
        BOOKED,
        CancellationReasonSet.of([CancellationReason.Other]),
      ),
      BookingStatus.Cancelled,
    ],
  ];

  it('names every from-variant and its entering stamp — a party act names no seat', () => {
    for (const [lifecycle, status] of cases) {
      const before = visit([seat('s-1')], { lifecycle });
      expect(AuditDeltaSystem.transitioned(before, null)).toEqual({
        transitionFromBookingStatus: status,
        transitionFromStatusAtUtcMs: BOOKED,
        transitionFromAttendanceState: null,
      });
      expect(AuditDeltaSystem.cancelled(before)).toEqual({
        cancellationFromBookingStatus: status,
        cancellationFromStatusAtUtcMs: BOOKED,
      });
    }
  });

  it('a seat act names that seat’s own prior attendance', () => {
    const before = visit([
      seat('s-1'),
      seat('s-2', MARIA, {
        outcome: SeatOutcome.cancelled(
          LATER,
          CancelledBy.Client,
          CancellationReason.Other,
          hourCount(24),
        ),
      }),
    ]);
    expect(
      AuditDeltaSystem.transitioned(before, SeatId.of('s-2'))
        .transitionFromAttendanceState,
    ).toBe(AttendanceState.Cancelled);
    expect(
      AuditDeltaSystem.transitioned(before, SeatId.of('s-1'))
        .transitionFromAttendanceState,
    ).toBe(AttendanceState.Scheduled);
    // A seat the visit does not hold has no prior state to name.
    expect(
      AuditDeltaSystem.transitioned(before, SeatId.of('nope'))
        .transitionFromAttendanceState,
    ).toBeNull();
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const before = deepFreeze(
      visit([seat('s-1')], { lifecycle: BookingLifecycle.confirm(BOOKED) }),
    );
    expect(AuditDeltaSystem.transitioned(before, SeatId.of('s-1'))).toEqual(
      AuditDeltaSystem.transitioned(before, SeatId.of('s-1')),
    );
    expect(AuditDeltaSystem.cancelled(before)).toEqual(
      AuditDeltaSystem.cancelled(before),
    );
  });
});
