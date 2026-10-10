import { BusyKey } from '../components/busy-key.data';
import { DayKey } from '../components/day-key.data';
import { SeatId } from '../components/seat.data';
import { AppointmentId } from './appointment.entity';
import { AppointmentPhotoId } from './appointment-photo.entity';
import { BarberId } from './barber.entity';
import { BarberBusyDayId } from './barber-busy-day.entity';
import { BarberLeadTimeSampleId } from './barber-lead-time-sample.entity';
import { BookingPolicySettingsId } from './booking-policy-settings.entity';
import { CapacityMonthId } from './capacity-month.entity';
import { ScheduleExceptionId } from './schedule-exception.entity';
import { WaitlistRequestId } from './waitlist-request.entity';

/**
 * Compile-time-only assertions for the scheduling id brands — no runtime
 * `expect()`/`it()`, run by `nx typecheck` through `tsconfig.spec.json`.
 * Proves (a) a bare `string` cannot stand in for a branded id, (b) the
 * brands are not interchangeable although every one is a plain string at run
 * time — the two barber-day documents included, which share a raw key — and
 * (c) `XId.of(raw)` (and `BusyKey.of`) is the way in and the brand still
 * reads as a string.
 */

declare function requireAppointmentId(id: AppointmentId): void;
declare function requireWaitlistRequestId(id: WaitlistRequestId): void;
declare function requireScheduleExceptionId(id: ScheduleExceptionId): void;
declare function requireBarberBusyDayId(id: BarberBusyDayId): void;
declare function requireCapacityMonthId(id: CapacityMonthId): void;
declare function requireBookingPolicySettingsId(
  id: BookingPolicySettingsId,
): void;
declare function requireBarberLeadTimeSampleId(
  id: BarberLeadTimeSampleId,
): void;
declare function requireAppointmentPhotoId(id: AppointmentPhotoId): void;
declare function requireSeatId(id: SeatId): void;
declare function requireBusyKey(key: BusyKey): void;
declare function requireString(raw: string): void;

// (a) A plain string is rejected where a branded id is expected.
// @ts-expect-error — a bare string is not an AppointmentId.
requireAppointmentId('appt-1');
// @ts-expect-error — a bare string is not a WaitlistRequestId.
requireWaitlistRequestId('wl_abc');
// @ts-expect-error — a bare string is not a ScheduleExceptionId.
requireScheduleExceptionId('ivan__2026-10-07');
// @ts-expect-error — a bare string is not a BarberBusyDayId.
requireBarberBusyDayId('ivan__2026-10-07');
// @ts-expect-error — a bare string is not a CapacityMonthId.
requireCapacityMonthId('2026-10');
// @ts-expect-error — a bare string is not a BookingPolicySettingsId.
requireBookingPolicySettingsId('bookingPolicy');
// @ts-expect-error — a bare string is not a BarberLeadTimeSampleId.
requireBarberLeadTimeSampleId('ivan__2026-10-07');
// @ts-expect-error — a bare string is not an AppointmentPhotoId.
requireAppointmentPhotoId('photo-1');
// @ts-expect-error — a bare string is not a SeatId.
requireSeatId('seat-1');
// @ts-expect-error — a bare string is not a BusyKey; BusyKey.of is the only builder.
requireBusyKey('ivan__2026-10-07');

// (b) The brands are nominal — not interchangeable.
declare const appointmentId: AppointmentId;
declare const busyDayId: BarberBusyDayId;
declare const exceptionId: ScheduleExceptionId;
declare const busyKey: BusyKey;
// @ts-expect-error — an AppointmentId is not a WaitlistRequestId.
requireWaitlistRequestId(appointmentId);
// @ts-expect-error — the busy day and the exception share a raw key, never a type.
requireScheduleExceptionId(busyDayId);
// @ts-expect-error — the busy day and the exception share a raw key, never a type.
requireBarberBusyDayId(exceptionId);
// @ts-expect-error — a BusyKey must go through the entity's `of` to become its id.
requireBarberBusyDayId(busyKey);
// @ts-expect-error — an AppointmentId is not a SeatId.
requireSeatId(appointmentId);

// (c) `of` is the way in, and every brand still reads as a string.
const key = BusyKey.of(BarberId.of('ivan'), DayKey.of('2026-10-07'));
requireBusyKey(key);
requireBarberBusyDayId(BarberBusyDayId.of(key));
requireScheduleExceptionId(ScheduleExceptionId.of(key));
requireAppointmentId(AppointmentId.of('appt-1'));
requireWaitlistRequestId(WaitlistRequestId.of('wl_abc'));
requireCapacityMonthId(CapacityMonthId.of('2026-10'));
requireBookingPolicySettingsId(
  BookingPolicySettingsId.of(BookingPolicySettingsId.FIXED),
);
requireBarberLeadTimeSampleId(BarberLeadTimeSampleId.of('ivan__2026-10-07'));
requireAppointmentPhotoId(AppointmentPhotoId.of('photo-1'));
requireSeatId(SeatId.of('seat-1'));
requireString(appointmentId);
requireString(busyKey);
