import type { BarberStatus, LocalizedText } from '@core/components';
import { BarberId, type LocationId, type MediaRefId } from '@core/primitives';

/**
 * The identity slice of a barber: the id and the plain 1-to-1 attributes.
 *
 * No offerings — the pricing matrix lives on each service
 * (`Service.offerings`) — and deliberately no rating: fabricated ratings
 * read as a scam. Empty `locationIds` means every location. Absent is
 * `null`: a barber with no stated experience or no Instagram still has every
 * key.
 */
export type BarberMeta = {
  readonly id: BarberId;
  readonly name: LocalizedText;
  /** The trimmed, non-blank public handle. */
  readonly handle: string;
  readonly title: LocalizedText;
  readonly bio: LocalizedText;
  /** A non-negative integer, or `null` when not stated. */
  readonly yearsExperience: number | null;
  readonly locationIds: readonly LocationId[];
  /** The trimmed Instagram handle, or `null` when none is given. */
  readonly instagramHandle: string | null;
  readonly barberStatus: BarberStatus;
  readonly sortOrder: number;
};

/**
 * The barber's avatar — the 1-to-1 `avatar: MediaRef | null` flattened by
 * prefix (N9, flatten-spec §3.1): the seven `MediaRef` fields, ALL `null`
 * together when the barber has no avatar.
 */
export type BarberAvatar = {
  readonly avatarMediaId: MediaRefId | null;
  readonly avatarMediaPath: string | null;
  readonly avatarMediaWidth: number | null;
  readonly avatarMediaHeight: number | null;
  readonly avatarMediaBlurhash: string | null;
  readonly avatarMediaFocalX: number | null;
  readonly avatarMediaFocalY: number | null;
};

/**
 * A craftsman's public profile — `barbers/{id}` (`barber.ts:28-34`,
 * `catalog-reader.adapter.ts:174-186`): every 1-to-1 field at the root
 * (Law 6). Until the booking-core flip the stored document kept its legacy
 * body (`status`, the nested `avatar`), which the legacy shims converted.
 */
export type Barber = BarberMeta & BarberAvatar;
