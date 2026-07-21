// TODO(goal-03): superseded by @creativo/application/shared's ClockPort
// (blueprint §0.3 moves ports to libs/application/*/ports). Kept here,
// temporarily duplicated, only so apps/functions keeps compiling without a
// circular domain/models <-> application/* project reference. Delete this
// file once goal-03 ports every consumer over to importing from
// @creativo/application/shared.
import {
  InvalidTimeZoneError,
  Result,
  ZonedDateTime,
} from '@creativo/domain/kernel';

/** Makes "current time" injectable/fakeable in tests — also the seam if `ZonedDateTime`'s backing library ever changes. */
export interface ClockPort {
  now(zone: string): Result<ZonedDateTime, InvalidTimeZoneError>;
}
