import { Result, combine, fail, ok } from '@creativo/domain/kernel';
import {
  Appointment,
  Seat,
  SeatId,
  SeatSubject,
  TimeSlot,
} from '@creativo/domain/scheduling';
import { BarberId, LocationId, ServiceId } from '@creativo/domain/catalog';
import { ClockPort, IdGenerator } from '@creativo/application/shared';
import { AppointmentRepository } from '../ports/appointment-repository.port';
import {
  CreateBookingError,
  CreateBookingRepositoryFailure,
  CreateBookingValidationFailure,
} from './create-booking.errors';

const SCHEDULING_ZONE = 'Europe/Sofia';

export interface CreateBookingSeatInput {
  readonly subject: SeatSubject;
  readonly serviceId: ServiceId;
}

export interface CreateBookingInput {
  readonly barberId: BarberId;
  readonly locationId: LocationId;
  readonly timeSlot: TimeSlot;
  readonly seats: readonly CreateBookingSeatInput[];
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
    const nowResult = this.clock.now(SCHEDULING_ZONE);
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
      }),
    );

    const appointmentResult = Appointment.create({
      id: this.idGenerator.next(),
      barberId: input.barberId.value,
      locationId: input.locationId.value,
      timeSlot: input.timeSlot,
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
