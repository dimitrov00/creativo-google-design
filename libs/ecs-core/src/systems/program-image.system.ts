import {
  type ProgramId,
  RichBlockKind,
  RichText,
  type LocalizedText,
  type StoredObjectEntry,
  type StoredObjectFacts,
} from '@core/components';
import {
  Locale,
  type OperationId,
  PositionId,
  ProgramImageId,
  Result,
  Tag,
  type UserId,
  UtcEpochMs,
} from '@core/primitives';
import {
  EngagementError,
  EngagementErrorCode,
  type ProgramFieldError,
} from '@core/errors';
import { BarberPhotoSystem } from './barber-photo.system';
import { RichTextSystem } from './rich-text.system';

/** The largest picture taken: the staging rule's own cap (`storage.rules`). */
const MAX_BYTES = 5 * 1024 * 1024;

/** The image types a description shows. */
const CONTENT_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

/** A picture's long side, at most — the browser re-encodes to it before the upload. */
const LONG_EDGE = 2400;

/**
 * The most objects one description's folder holds: the pictures two
 * languages may name between them, and as many again waiting for the sweep.
 */
const FOLDER_MAX = 48;

/** How long a picture no description names is kept: an editor may hold it, unsaved. */
const GRACE_HOURS = 1;

/** A staged file's name, and the act's: one plain path segment. */
const STAGED_NAME = /^[A-Za-z0-9_-]{8,64}$/;
const ACT_NAME = /^[A-Za-z0-9_-]{16,48}$/;
/** A folder is named after a stored id: one path segment, bounded. */
const FOLDER_NAME_MAX = 128;

/** Whole pixels, more than none and no more than {@link LONG_EDGE}. */
function isPixelSize(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= LONG_EDGE;
}

/** What `addProgramImage` is sent beside the caller. */
export type ProgramImageInput = {
  readonly callerUserId: UserId;
  readonly programId: ProgramId;
  /** The act's name — the picture's id is made from it. */
  readonly operationId: OperationId;
  /** The staged file's name under the caller's own staging folder. */
  readonly stagedName: string;
  /** The picture's pixel size, as the browser measured it. */
  readonly mediaWidth: number;
  readonly mediaHeight: number;
};

/** Where the bytes are, and where they go. */
export type ProgramImagePlan = {
  /** `pending/{caller}/{name}` — the caller's own staged upload. */
  readonly stagedPath: string;
  /** The id a description names the picture by. */
  readonly imageId: ProgramImageId;
  /** The picture's object under `media/`. */
  readonly mediaPath: string;
  /** The folder it joins, to count before it does. */
  readonly folder: string;
};

/**
 * ProgramImageSystem — the pictures of a description
 * (`docs/architecture/decisions/2026-11-27-rich-text-for-programs-and-posts.md`,
 * decisions 3, 4 and 8): where a picture lives, what it is called, whether
 * an uploaded object is one a description shows, and which objects a saved
 * description leaves behind. Pure: the pipelines stat, copy, list and
 * delete; this decides.
 *
 * A picture's id is the act's name and its pixel size (`{act}_{w}x{h}`):
 * unguessable, the same on a replay, and enough for a page to hold the
 * picture's place before its bytes arrive (`RichText.imageSize`).
 */
export const ProgramImageSystem = {
  MAX_BYTES,
  CONTENT_TYPES,
  LONG_EDGE,
  FOLDER_MAX,

  /** The folder one description's pictures are kept in. */
  folderOf(programId: ProgramId): string {
    return `media/programs/${programId}/`;
  },

  /** The object a description's picture is. */
  pathOf(programId: ProgramId, imageId: ProgramImageId): string {
    return `${ProgramImageSystem.folderOf(programId)}${imageId}`;
  },

  /** The id of the picture an act uploads: its name and the size measured. */
  imageIdOf(
    operationId: OperationId,
    mediaWidth: number,
    mediaHeight: number,
  ): ProgramImageId {
    return ProgramImageId.of(`${operationId}_${mediaWidth}x${mediaHeight}`);
  },

  /**
   * A folder's name, read off the wire: a stored id that is one plain path
   * segment — `null` for anything else.
   */
  programIdOf(raw: unknown): ProgramId | null {
    if (typeof raw !== 'string' || raw.length > FOLDER_NAME_MAX) return null;
    const id = PositionId.parse(raw);
    return id.ok ? id.value : null;
  },

  /**
   * The plan of one upload: the staged path under the CALLER'S own folder,
   * the picture's id and its object. Refused, naming the field
   * (`ENGAGEMENT_PROGRAM_IMAGE_INVALID_INPUT`): a staged name or an act's
   * name that is not one plain segment, a size that is not whole pixels
   * within {@link LONG_EDGE}.
   */
  planOf(
    input: ProgramImageInput,
  ): Result<ProgramImagePlan, EngagementError.ProgramImageInvalidInput> {
    if (!STAGED_NAME.test(input.stagedName)) {
      return Result.err(EngagementError.programImageInvalidInput('stagedName'));
    }
    if (!ACT_NAME.test(input.operationId)) {
      return Result.err(
        EngagementError.programImageInvalidInput('operationId'),
      );
    }
    if (!isPixelSize(input.mediaWidth)) {
      return Result.err(EngagementError.programImageInvalidInput('mediaWidth'));
    }
    if (!isPixelSize(input.mediaHeight)) {
      return Result.err(
        EngagementError.programImageInvalidInput('mediaHeight'),
      );
    }
    const imageId = ProgramImageSystem.imageIdOf(
      input.operationId,
      input.mediaWidth,
      input.mediaHeight,
    );
    return Result.ok({
      stagedPath: BarberPhotoSystem.stagedPathOf(
        input.callerUserId,
        input.stagedName,
      ),
      imageId,
      mediaPath: ProgramImageSystem.pathOf(input.programId, imageId),
      folder: ProgramImageSystem.folderOf(input.programId),
    });
  },

  /**
   * Whether a staged object is a picture a description shows: one of the
   * image types, holding something, no larger than {@link MAX_BYTES} — else
   * `ENGAGEMENT_PROGRAM_IMAGE_INVALID`. The staging rule asks the same of
   * the upload; the call asks again.
   */
  admitObject(
    facts: StoredObjectFacts,
  ): Result<void, EngagementError.ProgramImageInvalid> {
    return facts.contentType !== null &&
      CONTENT_TYPES.includes(facts.contentType) &&
      facts.sizeBytes > 0 &&
      facts.sizeBytes <= MAX_BYTES
      ? Result.ok(undefined)
      : Result.err(EngagementError.programImageInvalid());
  },

  /** Whether a folder holding `count` objects takes one more. */
  hasRoom(count: number): boolean {
    return count < FOLDER_MAX;
  },

  /**
   * The pictures a description names, across its languages, each once —
   * `[]` for no description.
   */
  namedIn(body: LocalizedText | null): readonly ProgramImageId[] {
    if (body === null) return [];
    const named = new Set<ProgramImageId>();
    for (const locale of Tag.values(Locale)) {
      for (const block of RichTextSystem.parse(body[locale])) {
        if (block.richBlockKind === RichBlockKind.Image) {
          named.add(block.imageId);
        }
      }
    }
    return [...named];
  },

  /**
   * A description judged for its pictures, before it is saved: no language
   * may name more than `RichText.BODY_MAX_IMAGES` — else one
   * `ENGAGEMENT_PROGRAM_BODY_TOO_MANY_IMAGES` per language over, naming how
   * many it holds. No description names none.
   */
  admitBody(
    body: LocalizedText | null,
  ): Result<void, readonly ProgramFieldError[]> {
    if (body === null) return Result.ok(undefined);
    const over: ProgramFieldError[] = [];
    for (const locale of Tag.values(Locale)) {
      let images = 0;
      for (const block of RichTextSystem.parse(body[locale])) {
        if (block.richBlockKind === RichBlockKind.Image) images++;
      }
      if (images > RichText.BODY_MAX_IMAGES) {
        over.push(
          EngagementError.program(
            EngagementErrorCode.ProgramBodyTooManyImages,
            images,
          ),
        );
      }
    }
    return over.length > 0 ? Result.err(over) : Result.ok(undefined);
  },

  /**
   * The objects of a description's folder to delete after a save: those the
   * saved description does not name, written more than an hour ago — a
   * younger one may be held by an editor that has not saved yet, and one
   * with no date is kept. An object outside the folder is never answered.
   */
  staleOf(
    programId: ProgramId,
    listed: readonly StoredObjectEntry[],
    named: readonly ProgramImageId[],
    nowUtcMs: UtcEpochMs,
  ): readonly string[] {
    const folder = ProgramImageSystem.folderOf(programId);
    const kept = new Set<string>();
    for (const imageId of named) kept.add(`${folder}${imageId}`);
    const out: string[] = [];
    for (const entry of listed) {
      if (!entry.path.startsWith(folder) || kept.has(entry.path)) continue;
      if (entry.createdUtcMs === null) continue;
      const settled = UtcEpochMs.plusHours(entry.createdUtcMs, GRACE_HOURS);
      if (UtcEpochMs.compare(settled, nowUtcMs) <= 0) out.push(entry.path);
    }
    return out;
  },
} as const;
