import type {
  BarberId,
  CartLineId,
  EndMinute,
  MinuteOfDay,
} from '@core/primitives';

/**
 * One cart line, placed: who serves it and exactly when, on the selection's
 * shop day (Law 7.3: placement is local coordinates). The barber is RESOLVED
 * even when the line asked for anyone — review must name the person. An
 * element of `ScheduleSelection.assignments` (split out of
 * `booking-flow.data.ts`, pass D D-7).
 */
export type SeatAssignment = {
  readonly lineId: CartLineId;
  readonly barberId: BarberId;
  readonly startMinutes: MinuteOfDay;
  readonly endMinutes: EndMinute;
};
