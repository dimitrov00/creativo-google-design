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

export class ServiceCategoryId extends Id<'ServiceCategory'> {
  private constructor(value: string) {
    super(value);
  }
  static create(raw: string): Result<ServiceCategoryId, EmptyIdError> {
    return createId('ServiceCategoryId', raw, (v) => new ServiceCategoryId(v));
  }
  static generate(): ServiceCategoryId {
    return new ServiceCategoryId(crypto.randomUUID());
  }
}

export class BarberId extends Id<'Barber'> {
  private constructor(value: string) {
    super(value);
  }
  static create(raw: string): Result<BarberId, EmptyIdError> {
    return createId('BarberId', raw, (v) => new BarberId(v));
  }
  static generate(): BarberId {
    return new BarberId(crypto.randomUUID());
  }
}

export class LocationId extends Id<'Location'> {
  private constructor(value: string) {
    super(value);
  }
  static create(raw: string): Result<LocationId, EmptyIdError> {
    return createId('LocationId', raw, (v) => new LocationId(v));
  }
  static generate(): LocationId {
    return new LocationId(crypto.randomUUID());
  }
}

export class MediaRefId extends Id<'MediaRef'> {
  private constructor(value: string) {
    super(value);
  }
  static create(raw: string): Result<MediaRefId, EmptyIdError> {
    return createId('MediaRefId', raw, (v) => new MediaRefId(v));
  }
  static generate(): MediaRefId {
    return new MediaRefId(crypto.randomUUID());
  }
}
