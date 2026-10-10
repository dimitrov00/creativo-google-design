import type { DayKey } from '../components/day-key.data';
import type { ExceptionEffect } from '../components/exception-effect.data';
import type { BarberId } from './barber.entity';
import type { LocationId } from './location.entity';

/**
 * The barber's day: the raw string is a `BusyKey` (`${barberId}__${dayKey}`,
 * DOUBLE underscore, `schedule-exception-document.ts:34`), built only by
 * `BusyKey.of` — the commit transaction reads this document and the
 * `barberBusy` one by the same key.
 */
export type ScheduleExceptionId = string & { readonly __brand: unique symbol };
export const ScheduleExceptionId = {
  /** The only cast site. The raw string is a `BusyKey`. */
  of: (raw: string): ScheduleExceptionId => raw as ScheduleExceptionId,
} as const;

/**
 * A barber's changed day — `scheduleExceptions/{id}`, the PUBLIC EFFECT only
 * (`schedule-exception-document.ts:39-91`, GDPR-sanitised: no reason, no
 * note). Under §9 D16(b) this effect IS the record: the reasoned detail and
 * any recurrence series live in the staff UI's memory only, and there is no
 * `scheduleExceptionNotes` collection. No `updatedAtMs` — none is stored and
 * nothing reads one.
 */
export type ScheduleExceptionEntity = {
  readonly id: ScheduleExceptionId;
  readonly barberId: BarberId;
  readonly dayKey: DayKey;
  readonly zone: string;
  readonly locationId: LocationId;
  readonly effect: ExceptionEffect;
};
