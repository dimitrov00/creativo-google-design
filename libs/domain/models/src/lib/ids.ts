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

export class TenantId extends Id<'Tenant'> {
  private constructor(value: string) {
    super(value);
  }
  static create(raw: string): Result<TenantId, EmptyIdError> {
    return createId('TenantId', raw, (v) => new TenantId(v));
  }
  static generate(): TenantId {
    return new TenantId(crypto.randomUUID());
  }
}

export class UserId extends Id<'User'> {
  private constructor(value: string) {
    super(value);
  }
  static create(raw: string): Result<UserId, EmptyIdError> {
    return createId('UserId', raw, (v) => new UserId(v));
  }
  static generate(): UserId {
    return new UserId(crypto.randomUUID());
  }
}

export class StaffId extends Id<'Staff'> {
  private constructor(value: string) {
    super(value);
  }
  static create(raw: string): Result<StaffId, EmptyIdError> {
    return createId('StaffId', raw, (v) => new StaffId(v));
  }
  static generate(): StaffId {
    return new StaffId(crypto.randomUUID());
  }
}

export class ServiceId extends Id<'Service'> {
  private constructor(value: string) {
    super(value);
  }
  static create(raw: string): Result<ServiceId, EmptyIdError> {
    return createId('ServiceId', raw, (v) => new ServiceId(v));
  }
  static generate(): ServiceId {
    return new ServiceId(crypto.randomUUID());
  }
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

export class OtpId extends Id<'Otp'> {
  private constructor(value: string) {
    super(value);
  }
  static create(raw: string): Result<OtpId, EmptyIdError> {
    return createId('OtpId', raw, (v) => new OtpId(v));
  }
  static generate(): OtpId {
    return new OtpId(crypto.randomUUID());
  }
}
