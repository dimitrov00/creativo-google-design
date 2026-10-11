import type { LocalizedText } from '../components/localized-text.data';
import type { EventId, LocationId } from '../primitives/ids.primitive';
import type { LocalDate } from '../primitives/local-date.primitive';
import type { MinuteOfDay } from '../primitives/minute-of-day.primitive';
import type { UtcEpochMs } from '../primitives/utc-epoch-ms.primitive';

/*
 * The id lives in `primitives/ids.primitive.ts` (flatten-spec §1.5); it is
 * re-exported here only while the barrel's staging block still names this
 * file (`index.ts`), and leaves with that line.
 */

/**
 * A community or marketing event — `events/{id}` (the stored body of
 * `event-repository.adapter.ts:24-34`), **every optional present**. Named
 * `ShopEvent` because `Event` shadows the DOM global (F-17).
 *
 * Its start is the shop's wall clock — `localDate` + `startMinutes` — and
 * ONE absolute instant, `utcEpochMs`, computed at ingestion with the zone of
 * `locationId ?? TenantConfig.defaultLocationId` (F-4: an event with no
 * location is placed on the default shop's clock); the instant is what the
 * "upcoming" range query reads (Law 7.3). No zone field: the zone is the
 * location's. No status field: upcoming vs past is that range filter.
 * `locationId` `null` is not tied to one shop; `applyUrl` (the RSVP link)
 * `null` falls back to the shop's shared contact link.
 */
export type ShopEvent = {
  readonly id: EventId;
  readonly title: LocalizedText;
  readonly description: LocalizedText;
  readonly localDate: LocalDate;
  readonly startMinutes: MinuteOfDay;
  readonly utcEpochMs: UtcEpochMs;
  readonly locationId: LocationId | null;
  readonly applyUrl: string | null;
  readonly sortOrder: number;
};
