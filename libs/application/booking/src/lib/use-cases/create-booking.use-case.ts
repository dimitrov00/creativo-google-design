import { Result, combine, fail, ok } from '@creativo/domain/kernel';
import {
  Appointment,
  Seat,
  SeatId,
  SeatSubject,
  TimeSlot,
} from '@creativo/domain/scheduling';
import {
  BarberId,
  LocationId,
  ServiceId,
  ServiceTerms,
  ServiceVariantId,
} from '@creativo/domain/catalog';
import { ClockPort, IdGenerator } from '@creativo/application/shared';
import { AppointmentRepository } from '../ports/appointment-repository.port';
import {
  CreateBookingError,
  CreateBookingRepositoryFailure,
  CreateBookingValidationFailure,
} from './create-booking.errors';

/**
 * One line of the commit: WHO, WHAT, WITH WHOM, WHEN and AT WHAT PRICE.
 *
 * `barberId` and `slot` are RESOLVED values the availability engine
 * produced — never a `BarberPref`, never the party's envelope. That is what
 * lets a party commit in any arrangement the shop can offer: two seats at
 * the same time with different barbers, or the same barber back to back
 * (owner ruling 2026-07-29).
 *
 * `terms` is the snapshot. The caller resolved it through
 * `Service.termsFor(barberId, variantId)` against the barber this seat
 * actually got, so the price committed is the price that was quoted.
 */
export interface CreateBookingSeatInput {
  readonly subject: SeatSubject;
  readonly serviceId: ServiceId;
  readonly variantId: ServiceVariantId | null;
  readonly barberId: BarberId;
  readonly terms: ServiceTerms;
  readonly slot: TimeSlot;
}

export interface CreateBookingInput {
  readonly locationId: LocationId;
  readonly seats: readonly CreateBookingSeatInput[];
  /**
   * The shop's own zone — `Location.timezone`, passed in rather than held
   * as a module constant. A multi-location tenant breaks a hardcoded zone
   * the day it opens its second shop, and "now" has to be evaluated in the
   * zone the appointment is scheduled against (blueprint §7.1).
   */
  readonly schedulingZone: string;
}

export class CreateBookingUseCase {
  constructor(
    private readonly appointments: AppointmentRepository,
    private readonly clock: ClockPort,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(
    input: CreateBookingInput,
  ): Promise<Result<Appointment, CreateBookingError>> {
    const nowResult = this.clock.now(input.schedulingZone);
    if (nowResult.isFailure()) {
      return fail(nowResult.error);
    }

    const seatIdsResult = combine(
      input.seats.map(() => SeatId.create(this.idGenerator.next())),
    );
    if (seatIdsResult.isFailure()) {
      return fail(new CreateBookingValidationFailure(seatIdsResult.error));
    }
    const seats = input.seats.map((seatInput, i) =>
      Seat.of({
        id: seatIdsResult.value[i] as SeatId,
        subject: seatInput.subject,
        serviceId: seatInput.serviceId,
        variantId: seatInput.variantId,
        barberId: seatInput.barberId,
        terms: seatInput.terms,
        // The seat derives its own end from `terms.durationMinutes`, so only
        // the start crosses this boundary — the availability engine already
        // sized the slot from the same duration.
        startsAt: seatInput.slot.start,
      }),
    );

    const appointmentResult = Appointment.create({
      id: this.idGenerator.next(),
      locationId: input.locationId.value,
      seats,
      now: nowResult.value,
    });
    if (appointmentResult.isFailure()) {
      return fail(new CreateBookingValidationFailure(appointmentResult.error));
    }
    const appointment = appointmentResult.value;

    const saveResult = await this.appointments.save(appointment);
    if (saveResult.isFailure()) {
      return fail(new CreateBookingRepositoryFailure(saveResult.error));
    }

    return ok(appointment);
  }
}
