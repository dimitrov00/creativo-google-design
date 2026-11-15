import { MediaRef, type StoredObjectFacts } from '@core/components';
import {
  type BarberId,
  type OperationId,
  Result,
  type UserId,
} from '@core/primitives';
import { TeamError } from '@core/errors';
import type { Barber } from '@core/entities';

/** The largest photo taken: the staging rule's own cap (`storage.rules`). */
const MAX_BYTES = 5 * 1024 * 1024;

/** The image types the shop shows. */
const CONTENT_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

/** The widest picture a reference describes: far past any camera, and a bound on what metadata may claim. */
const MAX_PIXELS = 20_000;

/** Whole pixels, more than none and no more than {@link MAX_PIXELS}. */
function isPixelSize(value: number | null): value is number {
  return (
    value !== null &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= MAX_PIXELS
  );
}

/** A staged file's name: one path segment the browser minted, nothing that climbs or nests. */
const STAGED_NAME = /^[A-Za-z0-9_-]{8,64}$/;

/** What `setBarberPhoto` is sent beside the caller and the act's name. */
export type BarberPhotoInput = {
  readonly callerUserId: UserId;
  readonly barberId: BarberId;
  /** The act's name — and the new object's, so a replay names the same one. */
  readonly operationId: OperationId;
  /** The staged file's name under the caller's own staging folder. */
  readonly stagedName: string;
  /** The picture's pixel size, as the browser measured it. */
  readonly mediaWidth: number;
  readonly mediaHeight: number;
};

/** Where the bytes are, and the reference the record will hold. */
export type BarberPhotoPlan = {
  /** `staffUploads/{caller}/{name}` — the caller's own staged upload. */
  readonly stagedPath: string;
  /** The record's next photo: its object under `media/`, its size, a centred crop. */
  readonly media: MediaRef;
};

/**
 * BarberPhotoSystem — a barber's ONE photo
 * (`docs/architecture/decisions/2026-11-15-one-photo-per-barber.md`): where
 * the staged bytes are, what the record will point at, whether an uploaded
 * object is a picture the shop shows, and which objects a change leaves
 * behind. Pure: the pipeline stats, copies and deletes; this decides.
 */
export const BarberPhotoSystem = {
  MAX_BYTES,
  CONTENT_TYPES,

  /** The caller's staged upload `stagedName` — the path the staging rule guards. */
  stagedPathOf(userId: UserId, stagedName: string): string {
    return `staffUploads/${userId}/${stagedName}`;
  },

  /** The one object a person's account avatar is (`storage.rules`' single-object convention). */
  accountAvatarPathOf(userId: UserId): string {
    return `avatars/${userId}/original`;
  },

  /** The folder a barber's photos are kept in. */
  folderOf(barberId: BarberId): string {
    return `media/barbers/${barberId}/`;
  },

  /**
   * The plan of one photo change: the staged path under the CALLER'S own
   * folder (a name that is one plain segment, else `TEAM_INVALID_INPUT`
   * naming `stagedName`), and the reference the record will hold — an
   * object named after the act under the barber's folder, so the name
   * cannot be guessed and a replay names the same object; the size as
   * measured (positive whole pixels, else `TEAM_INVALID_INPUT` naming the
   * axis); no blurhash; a centred crop.
   */
  planOf(input: BarberPhotoInput): Result<BarberPhotoPlan, TeamError> {
    if (!STAGED_NAME.test(input.stagedName)) {
      return Result.err(TeamError.invalidInput('stagedName'));
    }
    if (!isPixelSize(input.mediaWidth)) {
      return Result.err(TeamError.invalidInput('mediaWidth'));
    }
    if (!isPixelSize(input.mediaHeight)) {
      return Result.err(TeamError.invalidInput('mediaHeight'));
    }
    const media = BarberPhotoSystem.referenceOf(
      input.barberId,
      input.operationId,
      input.mediaWidth,
      input.mediaHeight,
    );
    // The fields were checked above: a refusal here is the act's name.
    if (media === null)
      return Result.err(TeamError.invalidInput('operationId'));
    return Result.ok({
      stagedPath: BarberPhotoSystem.stagedPathOf(
        input.callerUserId,
        input.stagedName,
      ),
      media,
    });
  },

  /**
   * The reference a barber record holds for a photo named `mediaId` under
   * its own folder: the size as measured, no blurhash, a centred crop.
   * `null` when the name or the size is none a reference takes.
   */
  referenceOf(
    barberId: BarberId,
    mediaId: string,
    mediaWidth: number,
    mediaHeight: number,
  ): MediaRef | null {
    const media = MediaRef.parse({
      mediaId,
      mediaPath: `${BarberPhotoSystem.folderOf(barberId)}${mediaId}`,
      mediaWidth,
      mediaHeight,
      mediaBlurhash: null,
      ...MediaRef.centerFocus(),
    });
    return media.ok ? media.value : null;
  },

  /**
   * The photo a barber record takes from the account just linked to it
   * (decision F6): the account's avatar, when it is a picture the shop
   * shows ({@link BarberPhotoSystem.admitObject}) and its uploader measured
   * it — the reference a copy named `mediaId` would hold. `null` when there
   * is no avatar to take, or its size is unknown: the record then stays
   * without a photo until someone sets one.
   */
  adoptionOf(
    barberId: BarberId,
    mediaId: string,
    avatar: StoredObjectFacts | null,
  ): MediaRef | null {
    if (avatar === null || !BarberPhotoSystem.admitObject(avatar).ok) {
      return null;
    }
    const { pixelWidth, pixelHeight } = avatar;
    return isPixelSize(pixelWidth) && isPixelSize(pixelHeight)
      ? BarberPhotoSystem.referenceOf(
          barberId,
          mediaId,
          pixelWidth,
          pixelHeight,
        )
      : null;
  },

  /**
   * Whether a staged object is a picture the shop shows: one of the image
   * types, holding something, no larger than {@link MAX_BYTES} — else
   * `TEAM_PHOTO_INVALID`. The staging rule asks the same of the upload; the
   * call asks again, because a rule is not the last word.
   */
  admitObject(facts: StoredObjectFacts): Result<void, TeamError> {
    return facts.contentType !== null &&
      CONTENT_TYPES.includes(facts.contentType) &&
      facts.sizeBytes > 0 &&
      facts.sizeBytes <= MAX_BYTES
      ? Result.ok(undefined)
      : Result.err(TeamError.photoInvalid());
  },

  /** The record already holds this photo: the act landed before, and is being replayed. */
  isHeld(barber: Barber, media: MediaRef): boolean {
    return barber.avatarMediaPath === media.mediaPath;
  },

  /**
   * The object a photo change leaves behind: the record's photo before it,
   * when it was one of the barber's own (under their folder) and is not
   * the one it holds now. A catalogue picture kept elsewhere — the seed's
   * — is nobody's to delete, and `null` says there is nothing to remove.
   */
  replacedPathOf(before: Barber, after: Barber): string | null {
    const path = before.avatarMediaPath;
    return path !== null &&
      path !== after.avatarMediaPath &&
      path.startsWith(BarberPhotoSystem.folderOf(before.id))
      ? path
      : null;
  },
} as const;
