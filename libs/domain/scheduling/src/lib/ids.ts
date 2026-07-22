import { Id, Result, fail, ok } from '@creativo/domain/kernel';
import { EmptyIdError } from './ids.errors';

function createId<T>(
  idType: string,
  raw: string,
  factory: (value: string) => T,
): Result<T, EmptyIdError> {
  if (raw.trim().length === 0) {
    return fail(new EmptyIdError(idType));
  }
  return ok(factory(raw));
}

export class AppointmentId extends Id<'Appointment'> {
  private constructor(value: string) {
    super(value);
  }
  static create(raw: string): Result<AppointmentId, EmptyIdError> {
    return createId('AppointmentId', raw, (v) => new AppointmentId(v));
  }
  static generate(): AppointmentId {
    return new AppointmentId(crypto.randomUUID());
  }
}

export class SeatId extends Id<'Seat'> {
  private constructor(value: string) {
    super(value);
  }
  static create(raw: string): Result<SeatId, EmptyIdError> {
    return createId('SeatId', raw, (v) => new SeatId(v));
  }
  static generate(): SeatId {
    return new SeatId(crypto.randomUUID());
  }
}

/**
 * A companion/guest slot on a `BookingParty`, before it graduates into a
 * real `Seat` on the confirmed `Appointment`. Deliberately has NO
 * `generate()` (unlike every other id in this file) — v2's
 * `booking.machine.ts` assigned guest ids by array *length*, so
 * add → remove → add could resurrect a stale id once occupied by a
 * removed guest (migration-blueprint.md §7.7). The only sanctioned way to
 * mint one is `fromSequence()`, fed by `BookingParty`'s own monotonic
 * counter that is never decremented on removal — see `BookingParty.addGuest`.
 */
export class GuestId extends Id<'Guest'> {
  private constructor(value: string) {
    super(value);
  }
  static create(raw: string): Result<GuestId, EmptyIdError> {
    return createId('GuestId', raw, (v) => new GuestId(v));
  }
  /** Mint from a monotonic sequence counter — never from `array.length`/position. */
  static fromSequence(seq: number): GuestId {
    return new GuestId(`guest-${seq}`);
  }
}
