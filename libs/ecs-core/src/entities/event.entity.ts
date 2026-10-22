import type { LocalizedText } from '@core/components';
import type {
  EventId,
  LocationId,
  LocalDate,
  MinuteOfDay,
  UtcEpochMs,
} from '@core/primitives';

/**
 * The two fields of an event an admin never types: its id and the absolute
 * instant of its start, `utcEpochMs`, computed ONCE at ingestion (the save
 * pipeline, Law 7.3) with the zone of `locationId ?? the default shop`
 * (F-4: an event with no location is placed on the default shop's clock).
 * The instant is what the upcoming/past range query reads — a range on a
 * stamp, never placement math.
 */
export type ShopEventMeta = {
  readonly id: EventId;
  readonly utcEpochMs: UtcEpochMs;
};

/**
 * What an event says, as the admin set it: its texts, its start on the
 * shop's wall clock — `localDate` + `startMinutes` — and where it is.
 * `locationId` `null` is not tied to one shop; `applyUrl` (the RSVP link)
 * `null` falls back to the shop's shared contact link. Every optional is
 * present (`null` is written, never a conditional spread).
 */
export type ShopEventContent = {
  readonly title: LocalizedText;
  readonly description: LocalizedText;
  readonly localDate: LocalDate;
  readonly startMinutes: MinuteOfDay;
  readonly locationId: LocationId | null;
  readonly applyUrl: string | null;
  readonly sortOrder: number;
};

/**
 * A community or marketing event — `events/{id}`, the body this type minus
 * `id` (Law 5). Named `ShopEvent` because `Event` shadows the DOM global
 * (F-17). No zone field: the zone is the location's (Law 7.2). No status
 * field: upcoming vs past is the range filter on `utcEpochMs`.
 */
export type ShopEvent = ShopEventMeta & ShopEventContent;
