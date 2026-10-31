import {
  BarberId,
  EndMinute,
  MinuteOfDay,
  StoredFields,
} from '@core/primitives';

/**
 * One chair a visit being moved holds on its shop day — a barber and the
 * minutes, padding included, on that day's wall clock. The grid hands them
 * back before it places the visit again (`AvailabilitySystem.paddedBusy`'s
 * `release`), so the visit never collides with itself. Plain data the flat
 * `BookingDraft` names (minutes on its `rescheduleLocalDate`, never
 * instants), so it lives in the components tier (Law 8; moved down from
 * `availability.system.ts`, Phase 4a 4A-9).
 */
export type ChairTime = {
  readonly barberId: BarberId;
  readonly startMinutes: MinuteOfDay;
  readonly endMinutes: EndMinute;
};

export const ChairTime = {
  /**
   * The restore guard (the booking store's `isChairTime`, lifted onto the
   * wall clock): a barber id the grid can name, a start and an exclusive
   * end its minute primitives accept, the start before the end. A chair
   * the grid could not name a barber for is one it would silently stop
   * handing back, so it does not restore.
   */
  is(raw: unknown): raw is ChairTime {
    if (raw === null || typeof raw !== 'object') return false;
    const barberId = StoredFields.field(raw, 'barberId');
    const start = StoredFields.field(raw, 'startMinutes');
    const end = StoredFields.field(raw, 'endMinutes');
    return (
      typeof barberId === 'string' &&
      BarberId.parse(barberId).ok &&
      typeof start === 'number' &&
      MinuteOfDay.of(start).ok &&
      typeof end === 'number' &&
      EndMinute.of(end).ok &&
      start < end
    );
  },
} as const;
