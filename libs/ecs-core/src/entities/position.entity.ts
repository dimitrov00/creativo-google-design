import type {
  LocalizedText,
  PositionStatus,
  ProgramContact,
  WorkplaceMode,
} from '@core/components';
import type { LocationId, PositionId } from '@core/primitives';

/**
 * An open role on the careers page — `positions/{id}`, the body this type
 * minus `id` (Law 5), every field present, so the collection carries one
 * shape. Empty `locationIds` means every location
 * (`LocationScopeSystem.serves`). `contacts` are the ways a candidate
 * answers — by phone, e-mail, Instagram or a link; none falls back to the
 * shop's Instagram. `positionStatus` was the bare status field (N8), SCREAMING since
 * flip 4. `workplaceMode` says where the role is worked; a remote one
 * names no shop (`locationIds` is `[]`, and stands for no shop at all).
 */
export type Position = {
  readonly id: PositionId;
  readonly title: LocalizedText;
  readonly summary: LocalizedText;
  readonly workplaceMode: WorkplaceMode;
  readonly locationIds: readonly LocationId[];
  readonly positionStatus: PositionStatus;
  /** The ways to answer it, canonical, at most one per method; `[]` falls back to the shop's Instagram. */
  readonly contacts: readonly ProgramContact[];
  readonly sortOrder: number;
};
