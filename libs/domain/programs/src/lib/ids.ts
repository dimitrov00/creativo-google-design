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

export class PositionId extends Id<'Position'> {
  private constructor(value: string) {
    super(value);
  }
  static create(raw: string): Result<PositionId, EmptyIdError> {
    return createId('PositionId', raw, (v) => new PositionId(v));
  }
  static generate(): PositionId {
    return new PositionId(crypto.randomUUID());
  }
}

export class CourseId extends Id<'Course'> {
  private constructor(value: string) {
    super(value);
  }
  static create(raw: string): Result<CourseId, EmptyIdError> {
    return createId('CourseId', raw, (v) => new CourseId(v));
  }
  static generate(): CourseId {
    return new CourseId(crypto.randomUUID());
  }
}

/** Named `ShopEvent`, not `Event` — `Event` is a DOM global every Angular
 *  component already imports; colliding with it here would shadow that
 *  global for any consumer of this barrel. */
export class ShopEventId extends Id<'ShopEvent'> {
  private constructor(value: string) {
    super(value);
  }
  static create(raw: string): Result<ShopEventId, EmptyIdError> {
    return createId('ShopEventId', raw, (v) => new ShopEventId(v));
  }
  static generate(): ShopEventId {
    return new ShopEventId(crypto.randomUUID());
  }
}
