import type { MinuteBlock } from '@core/components';
import {
  type BarberId,
  BarberBusyDayId,
  type LocalDate,
  type UtcEpochMs,
} from '@core/primitives';

/**
 * The PUBLIC busy projection of one barber's shop day — `barberBusy/{id}`,
 * the id a `BusyKey` (`${barberId}__${localDate}`, DOUBLE underscore):
 * geometry and nothing else (no client, no service, no price), so the
 * anonymous booking grid may read it. A projection rebuilt by triggers from
 * `appointments` (`BusySystem`), a cache with a TTL (`purgeAt` is stamped by
 * the adapter at the document root, not an entity field), never the truth.
 *
 * No zone (Law 7.2 — the zone is the location's). `blocks` are the shop
 * day's wall-clock minutes; `utcEpochMs` is the day's FIRST instant
 * (`ZonedTimeSystem.startOfLocalDay`, flatten-spec §2.5, F-28), computed once
 * at ingestion — for range indexes and TTL math only, never placement.
 */
export type BarberBusyDay = {
  readonly id: BarberBusyDayId;
  readonly barberId: BarberId;
  readonly localDate: LocalDate;
  readonly utcEpochMs: UtcEpochMs;
  /** Occupied spans on the day's wall clock, sorted. */
  readonly blocks: readonly MinuteBlock[];
};
