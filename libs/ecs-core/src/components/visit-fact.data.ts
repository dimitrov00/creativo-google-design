import type { AppointmentId, LocalDate, MinuteOfDay } from '@core/primitives';

/*
 * Split out of `client-stats.data.ts` (pass D, S-21; one name per file,
 * L-1). A type-only component: no companion, nothing to put in one.
 */

/**
 * One VISIT — a person's seats in one appointment, counted once (R33) — at
 * the appointment's start on the shop's wall clock (Law 7: windows are
 * `LocalDate` arithmetic, T8). A party of three is three visits; a cut and
 * a beard trim for one client is one. Array element.
 */
export type VisitFact = {
  readonly appointmentId: AppointmentId;
  readonly localDate: LocalDate;
  readonly startMinutes: MinuteOfDay;
};
