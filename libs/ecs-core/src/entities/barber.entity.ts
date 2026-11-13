import type {
  BarberEmployment,
  BarberLifecycle,
  LocalizedText,
  WriteProvenance,
} from '@core/components';
import { BarberId, type LocationId, type MediaRefId } from '@core/primitives';

/**
 * The identity slice of a barber: the id and the plain 1-to-1 attributes.
 *
 * No offerings — the pricing matrix lives on each service
 * (`Service.offerings`) — and deliberately no rating: fabricated ratings
 * read as a scam. Empty `locationIds` means every location. Absent is
 * `null`: a barber with no stated title, bio, experience or Instagram still
 * has every key. New ids come from `nextId` (random UUIDs).
 */
export type BarberMeta = {
  readonly id: BarberId;
  readonly name: LocalizedText;
  /** `null` while no title is set (team onboarding D5). */
  readonly title: LocalizedText | null;
  /** `null` while no bio is set. */
  readonly bio: LocalizedText | null;
  /** A non-negative integer, or `null` when not stated. */
  readonly yearsExperience: number | null;
  readonly locationIds: readonly LocationId[];
  /** The trimmed Instagram handle, or `null` when none is given. */
  readonly instagramHandle: string | null;
  /**
   * Whether a client who chose «Който и да е» (`BarberPreference.Any`) may
   * be given this barber — read only while the barber is live (team
   * onboarding D2; a course student is out of the pool by default).
   */
  readonly barberJoinsAnyPool: boolean;
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
 * A craftsman's record — `barbers/{id}`: every 1-to-1 field at the root
 * (Law 6). Its lifecycle (`barberStatus` and the variant's fields), its
 * working period and the last writing call (`writeOperationId`) sit beside
 * the identity and the avatar. Publicly readable unless `DRAFT`
 * (`firestore.rules`); written only by callables.
 */
export type Barber = BarberMeta &
  BarberLifecycle &
  BarberEmployment &
  BarberAvatar &
  WriteProvenance;
