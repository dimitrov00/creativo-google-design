import type {
  BarberId,
  LocalDate,
  LocationId,
  MinuteOfDay,
} from '@core/primitives';

/**
 * Where a client's move took the visit — the before and after of a
 * `BOOKING_RESCHEDULED` row (audit-hardening WS-2), intersected into
 * {@link AuditContext.Rescheduled}. The shop's wall clock on each side, with
 * the shop it is read in (a move may change shop; a `LocalDate` and a
 * `MinuteOfDay` mean nothing without it — Law 7.2), and the barbers in seat
 * order. Every field is always set: a move is never "untouched".
 *
 * The barber lists are POSITIONAL — seat order on each side, duplicates kept
 * (one barber on two seats appears twice) — never id-aligned: a move re-ids
 * its cart seats, so seat `i` before and seat `i` after are compared by
 * place only. Ids, wall-clock coordinates and shops only — no contact, no
 * name (R36).
 */
export type RescheduleDelta = {
  readonly rescheduleFromLocalDate: LocalDate;
  readonly rescheduleToLocalDate: LocalDate;
  readonly rescheduleFromStartMinutes: MinuteOfDay;
  readonly rescheduleToStartMinutes: MinuteOfDay;
  readonly rescheduleFromBarberIds: readonly BarberId[];
  readonly rescheduleToBarberIds: readonly BarberId[];
  readonly rescheduleFromLocationId: LocationId;
  readonly rescheduleToLocationId: LocationId;
};
