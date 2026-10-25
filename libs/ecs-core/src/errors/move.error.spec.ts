import { describe, expect, it } from 'vitest';
import { LocationId, SeatId } from '@core/primitives';
import {
  CarriedSeatRefusal,
  MoveCarriedSeatUnplaceable,
  MoveErrorCode,
  MoveRefusal,
} from './move.error';

/*
 * The move's dictionaries, moved from `move.system.ts` (Law 7.5, Phase 4a
 * 4A-6) — values unchanged; the refusal reasons keep their lowercase
 * spelling (i18n key segments, flatten-spec §4.1).
 */
describe('MoveErrorCode and CarriedSeatRefusal', () => {
  it('keeps the move’s codes and the five carried-seat reasons verbatim', () => {
    // The carried-seat refusal, then the three client-side refusals folded in
    // from the retired `MoveRefusalReason` (pass D, D-9.2).
    expect(MoveErrorCode).toEqual({
      CarriedSeatUnplaceable: 'BOOKING_RESCHEDULE_CARRIED_SEAT_UNPLACEABLE',
      CompanionsOnly: 'BOOKING_RESCHEDULE_COMPANIONS_ONLY',
      Unavailable: 'BOOKING_RESCHEDULE_UNAVAILABLE',
      CarriedOutOfReach: 'BOOKING_RESCHEDULE_CARRIED_OUT_OF_REACH',
    });
    expect(Object.values(CarriedSeatRefusal).sort()).toEqual([
      'barber_unavailable',
      'outside_booking_window',
      'party_conflict',
      'service_unavailable',
      'shop_only',
    ]);
  });

  it('builds the refusal as a flat struct naming the seats', () => {
    expect(
      MoveCarriedSeatUnplaceable.of(CarriedSeatRefusal.ShopOnly, [
        SeatId.of('seat-2'),
      ]),
    ).toEqual({
      errorCode: 'BOOKING_RESCHEDULE_CARRIED_SEAT_UNPLACEABLE',
      refusal: 'shop_only',
      seatIds: ['seat-2'],
    });
  });
});

describe('MoveRefusal — a refused move link, as a flat struct', () => {
  const center = LocationId.of('loc-center');

  it('builds each refusal with its code and its shop', () => {
    expect(MoveRefusal.companionsOnly(center)).toEqual({
      errorCode: 'BOOKING_RESCHEDULE_COMPANIONS_ONLY',
      locationId: 'loc-center',
    });
    expect(MoveRefusal.unavailable(null)).toEqual({
      errorCode: 'BOOKING_RESCHEDULE_UNAVAILABLE',
      locationId: null,
    });
    expect(MoveRefusal.carriedOutOfReach(center)).toEqual({
      errorCode: 'BOOKING_RESCHEDULE_CARRIED_OUT_OF_REACH',
      locationId: 'loc-center',
    });
  });

  it('is pure — the same shop builds the same struct, every key at the root', () => {
    const a = MoveRefusal.companionsOnly(center);
    const b = MoveRefusal.companionsOnly(center);
    expect(a).toEqual(b);
    expect(Object.keys(a)).toEqual(['errorCode', 'locationId']);
  });
});
