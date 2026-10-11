import type { ExceptionEffectRule } from '../components/exception-effect.data';
import type {
  BarberId,
  LocationId,
  ScheduleExceptionId,
} from '../primitives/ids.primitive';
import type { LocalDate } from '../primitives/local-date.primitive';
import type { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';

/*
 * F0 STAGING BRIDGE (flatten-spec §1.5): the id is declared once, in
 * `primitives/ids.primitive.ts`; the barrel's flatten block and the legacy
 * id type-specs still name this file for it until the integrator deletes
 * those lines — this re-export goes with them.
 */

/**
 * The identity slice of a barber's changed day. The id's raw string is a
 * `BusyKey` (`${barberId}__${localDate}`, DOUBLE underscore,
 * `schedule-exception-document.ts:34`), built only by `BusyKey.of` — the
 * commit transaction reads this document and the `barberBusy` one by the
 * same key. `utcEpochMs` is the first instant of the shop day
 * (`ZonedTimeSystem.startOfLocalDay(localDate, location.timeZone)`, computed
 * once at ingestion, F-28) — for range indexes only; no zone is stored
 * (Law 7.2: the zone is the location's).
 */
export type ScheduleExceptionMeta = {
  readonly id: ScheduleExceptionId;
  readonly barberId: BarberId;
  readonly localDate: LocalDate;
  readonly utcEpochMs: UtcEpochMs;
  readonly locationId: LocationId;
};

/**
 * A barber's changed day — `scheduleExceptions/{id}`, the PUBLIC EFFECT only
 * (`schedule-exception-document.ts:39-91`, GDPR-sanitised: no reason, no
 * note). Under §9 D16(b) this effect IS the record: the reasoned detail and
 * any recurrence series live in the staff UI's memory only, and there is no
 * `scheduleExceptionNotes` collection. No `updatedAtUtcMs` — none is stored
 * and nothing reads one.
 *
 * Flat (Law 6): the identity slice intersected with the effect's variant
 * slice, so `exceptionEffect` and `exceptionRanges` sit at the root.
 */
export type ScheduleException = ScheduleExceptionMeta & ExceptionEffectRule;
