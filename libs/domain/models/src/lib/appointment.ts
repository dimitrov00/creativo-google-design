import {
  Result,
  ZonedDateTime,
  combineAll,
  fail,
  ok,
} from '@creativo/domain/kernel';
import {
  AppointmentNotInFutureError,
  InvalidAppointmentTimeRangeError,
  InvalidTransitionError,
  ScheduleAppointmentError,
} from './appointment.errors';
import {
  AppointmentStatus,
  cancelled as cancelledStatus,
  COMPLETED,
  CONFIRMED,
  NO_SHOW,
  PENDING_DEPOSIT,
} from './appointment-status';
import { AppointmentId, ServiceId, StaffId, TenantId, UserId } from './ids';

export interface ScheduleAppointmentProps {
  id: string;
  tenantId: string;
  clientUid: string;
  staffId: string;
  serviceId: string;
  startIso: string;
  endIso: string;
  zone: string;
}

export interface ReconstituteAppointmentProps extends ScheduleAppointmentProps {
  status: AppointmentStatus;
  depositPaymentIntentId: string | null;
}

/**
 * The aggregate root for booking. Immutable — every behavior method below
 * returns a *new* `Appointment` instance rather than mutating `this`, which
 * keeps the `Result`-returning API honest and the aggregate trivially
 * testable without hidden state.
 */
export class Appointment {
  private constructor(
    readonly id: AppointmentId,
    readonly tenantId: TenantId,
    readonly clientUid: UserId,
    readonly staffId: StaffId,
    readonly serviceId: ServiceId,
    readonly start: ZonedDateTime,
    readonly end: ZonedDateTime,
    readonly status: AppointmentStatus,
    readonly depositPaymentIntentId: string | null,
  ) {}

  /** New appointment — enforces creation-only invariants (must start in the future) that a reconstituted past appointment legitimately doesn't satisfy. */
  static schedule(
    props: ScheduleAppointmentProps,
    now: ZonedDateTime,
  ): Result<Appointment, ScheduleAppointmentError[]> {
    return Appointment.build(props, PENDING_DEPOSIT, null, now);
  }

  /** Rebuilding from persistence — same field validation, skips the "must be in the future" creation invariant. */
  static reconstitute(
    props: ReconstituteAppointmentProps,
  ): Result<Appointment, ScheduleAppointmentError[]> {
    return Appointment.build(
      props,
      props.status,
      props.depositPaymentIntentId,
      null,
    );
  }

  private static build(
    props: ScheduleAppointmentProps,
    status: AppointmentStatus,
    depositPaymentIntentId: string | null,
    /** Only present when enforcing the future-dated creation invariant — omitted on reconstitution. */
    enforceFutureAgainst: ZonedDateTime | null,
  ): Result<Appointment, ScheduleAppointmentError[]> {
    const idResult = AppointmentId.create(props.id);
    const tenantIdResult = TenantId.create(props.tenantId);
    const clientUidResult = UserId.create(props.clientUid);
    const staffIdResult = StaffId.create(props.staffId);
    const serviceIdResult = ServiceId.create(props.serviceId);
    const startResult = ZonedDateTime.fromISO(props.startIso, props.zone);
    const endResult = ZonedDateTime.fromISO(props.endIso, props.zone);

    const combined = combineAll([
      idResult,
      tenantIdResult,
      clientUidResult,
      staffIdResult,
      serviceIdResult,
      startResult,
      endResult,
    ] as const);
    if (combined.isFailure()) {
      return fail(combined.error);
    }
    const [id, tenantId, clientUid, staffId, serviceId, start, end] =
      combined.value;

    const errors: ScheduleAppointmentError[] = [];
    if (!start.isBefore(end)) {
      errors.push(new InvalidAppointmentTimeRangeError());
    }
    if (enforceFutureAgainst && !start.isAfter(enforceFutureAgainst)) {
      errors.push(new AppointmentNotInFutureError());
    }
    if (errors.length > 0) {
      return fail(errors);
    }

    return ok(
      new Appointment(
        id,
        tenantId,
        clientUid,
        staffId,
        serviceId,
        start,
        end,
        status,
        depositPaymentIntentId,
      ),
    );
  }

  confirm(): Result<Appointment, InvalidTransitionError> {
    if (this.status.kind !== 'pending_deposit') {
      return fail(new InvalidTransitionError(this.status.kind, 'confirmed'));
    }
    return ok(this.withStatus(CONFIRMED));
  }

  cancel(reason: string): Result<Appointment, InvalidTransitionError> {
    if (this.status.kind === 'completed' || this.status.kind === 'cancelled') {
      return fail(new InvalidTransitionError(this.status.kind, 'cancelled'));
    }
    return ok(this.withStatus(cancelledStatus(reason)));
  }

  complete(): Result<Appointment, InvalidTransitionError> {
    if (this.status.kind !== 'confirmed') {
      return fail(new InvalidTransitionError(this.status.kind, 'completed'));
    }
    return ok(this.withStatus(COMPLETED));
  }

  markNoShow(): Result<Appointment, InvalidTransitionError> {
    if (this.status.kind !== 'confirmed') {
      return fail(new InvalidTransitionError(this.status.kind, 'no_show'));
    }
    return ok(this.withStatus(NO_SHOW));
  }

  private withStatus(status: AppointmentStatus): Appointment {
    return new Appointment(
      this.id,
      this.tenantId,
      this.clientUid,
      this.staffId,
      this.serviceId,
      this.start,
      this.end,
      status,
      this.depositPaymentIntentId,
    );
  }
}
