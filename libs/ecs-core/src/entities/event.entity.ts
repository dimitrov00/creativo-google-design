import type { LocalizedText } from '../components/localized-text.data';
import type { LocationId } from './location.entity';

export type EventId = string & { readonly __brand: unique symbol };
export const EventId = {
  /** The only cast site. Validate the raw string at the edge, not here. */
  of: (raw: string): EventId => raw as EventId,
} as const;

/**
 * A community or marketing event — `events/{id}` (the stored body of
 * `event-repository.adapter.ts:24-34`), **every optional present**: the
 * legacy reader re-added `locationId` and `applyUrl` by conditional spread.
 *
 * No status field: upcoming vs past is derived from `startMs` against a
 * `nowMs` the caller passes (an event that happened yesterday is past
 * whatever a checkbox says), and is a range filter in the query.
 * `locationId` `null` is not tied to one shop; `applyUrl` (the RSVP link)
 * `null` falls back to the shop's shared contact link.
 *
 * **Declared changes** (blueprint §2.6, repeated in §3.1): `startDateIso` →
 * `startMs` (range-queried and ordered, Law 5) and `timezone` → `zone`
 * (the one spelling of the zone field, as on `LocationEntity`).
 */
export type EventEntity = {
  readonly id: EventId;
  readonly title: LocalizedText;
  readonly description: LocalizedText;
  readonly startMs: number;
  readonly zone: string;
  readonly locationId: LocationId | null;
  readonly applyUrl: string | null;
  readonly sortOrder: number;
};
