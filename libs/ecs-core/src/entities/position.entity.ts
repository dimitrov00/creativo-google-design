import type { LocalizedText, PositionStatus } from '@core/components';
import type { LocationId, PositionId } from '@core/primitives';

/**
 * An open role on the careers page — `positions/{id}`, the body this type
 * minus `id` (Law 5), **every optional present**: before flip 4 the reader
 * re-added `applyUrl` by conditional spread, so one collection carried two
 * hidden-class shapes; now `null` is written. Empty `locationIds` means
 * every location (`LocationScopeSystem.serves`). `applyUrl` is where
 * "Apply" sends a candidate; `null` falls back to the shop's shared contact
 * link. `positionStatus` was the bare status field (N8), SCREAMING since
 * flip 4.
 */
export type Position = {
  readonly id: PositionId;
  readonly title: LocalizedText;
  readonly summary: LocalizedText;
  readonly locationIds: readonly LocationId[];
  readonly positionStatus: PositionStatus;
  readonly applyUrl: string | null;
  readonly sortOrder: number;
};
