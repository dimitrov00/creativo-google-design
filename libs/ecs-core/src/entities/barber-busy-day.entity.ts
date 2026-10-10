import type { DayKey } from '../components/day-key.data';
import type { MinuteBlock } from '../components/minute-block.data';
import type { BarberId } from './barber.entity';

/**
 * The barber's day: the raw string is a `BusyKey` (`${barberId}__${dayKey}`,
 * DOUBLE underscore — `appointment-document.ts:1145`), built only by
 * `BusyKey.of`. Every `appointments.busyKeys[i]` is this document's id and the
 * `scheduleExceptions` id the commit transaction reads by the same key, so a
 * mis-spelt id is an empty read set and a reopened double-booking race.
 */
export type BarberBusyDayId = string & { readonly __brand: unique symbol };
export const BarberBusyDayId = {
  /** The only cast site. The raw string is a `BusyKey`. */
  of: (raw: string): BarberBusyDayId => raw as BarberBusyDayId,
} as const;

/**
 * The PUBLIC busy projection of one barber's day — `barberBusy/{id}`:
 * geometry and nothing else (no client, no service, no price), so the
 * anonymous booking grid may read it. A projection rebuilt by triggers from
 * `appointments` (`BusySystem`), a cache with a TTL (`purgeAt` is stamped by
 * the adapter at the document root, not an entity field), never the truth.
 */
export type BarberBusyDayEntity = {
  readonly id: BarberBusyDayId;
  readonly barberId: BarberId;
  readonly dayKey: DayKey;
  readonly zone: string;
  /** Occupied spans in wall-clock minutes of the day, sorted. */
  readonly blocks: readonly MinuteBlock[];
};
