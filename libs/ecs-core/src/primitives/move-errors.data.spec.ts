import { describe, expect, it } from 'vitest';
import { SeatId } from './ids.primitive';
import {
  CarriedSeatRefusal,
  MoveCarriedSeatUnplaceable,
  MoveErrorCode,
} from './move-errors.data';

/*
 * The move's dictionaries, moved from `move.system.ts` (Law 7.5, Phase 4a
 * 4A-6) — values unchanged; the refusal reasons keep their lowercase
 * spelling (i18n key segments, flatten-spec §4.1).
 */
describe('MoveErrorCode and CarriedSeatRefusal', () => {
  it('keeps the move’s one code and the five carried-seat reasons verbatim', () => {
    expect(MoveErrorCode).toEqual({
      CarriedSeatUnplaceable: 'BOOKING_RESCHEDULE_CARRIED_SEAT_UNPLACEABLE',
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
