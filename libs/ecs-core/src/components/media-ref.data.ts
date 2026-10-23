import { MediaRefId, Result } from '@core/primitives';
import { CatalogError, MediaDimension } from '@core/errors';

/**
 * A denormalised image pointer embedded where a cover or avatar renders
 * without a second read — an element of `ShopLocation.photos`, and the field
 * group a 1-to-1 `cover` / `avatar` flattens to by prefix (N9:
 * `coverMediaId … coverMediaFocalY`, all `| null` together). Flat (Law 6):
 * the legacy nested `focalPoint: { x, y }` folds into `mediaFocalX` /
 * `mediaFocalY` (`focalPoint: null` ↔ both `null`); nothing invented (no
 * `alt`: captions are not stored) and nothing dropped (`mediaWidth` /
 * `mediaHeight` drive every cover/avatar crop). Absent is `null`, never a
 * missing key.
 *
 * `mediaId` is the Storage object key — **kept** (catalog-kernel Q8): the
 * media resolver and `pnpm run seed:dev` address uploads by it.
 */
export type MediaRef = {
  readonly mediaId: MediaRefId;
  /** Storage path, e.g. `'barbers/ivan/avatar.jpg'`. */
  readonly mediaPath: string;
  /** Intrinsic pixel width — a positive integer. */
  readonly mediaWidth: number;
  /** Intrinsic pixel height — a positive integer. */
  readonly mediaHeight: number;
  /** Placeholder hash painted before the bytes arrive; `null` when none was computed. */
  readonly mediaBlurhash: string | null;
  /** A 0..1 normalised focal point (`0, 0` is the top-left corner); both `null` together. */
  readonly mediaFocalX: number | null;
  readonly mediaFocalY: number | null;
};

/** A ref as authored (the catalogue seed, an upload's metadata), before its edge guard. */
export type MediaRefInput = {
  readonly mediaId: string;
  readonly mediaPath: string;
  readonly mediaWidth: number;
  readonly mediaHeight: number;
  readonly mediaBlurhash: string | null;
  readonly mediaFocalX: number | null;
  readonly mediaFocalY: number | null;
};

const CENTER: Pick<MediaRef, 'mediaFocalX' | 'mediaFocalY'> = {
  mediaFocalX: 0.5,
  mediaFocalY: 0.5,
};

export const MediaRef = {
  /** The normalised midpoint — the crop a ref without a focal point gets. */
  centerFocus(): Pick<MediaRef, 'mediaFocalX' | 'mediaFocalY'> {
    return CENTER;
  },

  /** Both axes finite and inside 0..1, or `CATALOG_MEDIA_REF_FOCAL_POINT_OUT_OF_RANGE`. */
  parseFocus(
    x: number,
    y: number,
  ): Result<Pick<MediaRef, 'mediaFocalX' | 'mediaFocalY'>, CatalogError> {
    return isUnit(x) && isUnit(y)
      ? Result.ok({ mediaFocalX: x, mediaFocalY: y })
      : Result.err(CatalogError.mediaRefFocalPointOutOfRange(x, y));
  },

  /** The same focal point — both axes, `null` meaning none. */
  sameFocus(
    a: Pick<MediaRef, 'mediaFocalX' | 'mediaFocalY'>,
    b: Pick<MediaRef, 'mediaFocalX' | 'mediaFocalY'>,
  ): boolean {
    return a.mediaFocalX === b.mediaFocalX && a.mediaFocalY === b.mediaFocalY;
  },

  /**
   * The edge guard for an authored ref, every violation at once: a blank id
   * (`CATALOG_ID_EMPTY`), a blank path, a width or height that is not a
   * positive integer, a focal point outside 0..1 (or half of one). The path
   * is trimmed; a blank or whitespace-only blurhash becomes `null`; the id is
   * kept exactly as given.
   */
  parse(raw: MediaRefInput): Result<MediaRef, readonly CatalogError[]> {
    const errors: CatalogError[] = [];
    if (raw.mediaId.trim().length === 0) {
      errors.push(CatalogError.idEmpty('MediaRefId'));
    }
    const mediaPath = raw.mediaPath.trim();
    if (mediaPath.length === 0) {
      errors.push(CatalogError.mediaRefEmptyPath());
    }
    if (!isPositiveInteger(raw.mediaWidth)) {
      errors.push(
        CatalogError.mediaRefInvalidDimension(
          MediaDimension.Width,
          raw.mediaWidth,
        ),
      );
    }
    if (!isPositiveInteger(raw.mediaHeight)) {
      errors.push(
        CatalogError.mediaRefInvalidDimension(
          MediaDimension.Height,
          raw.mediaHeight,
        ),
      );
    }
    let focus: Pick<MediaRef, 'mediaFocalX' | 'mediaFocalY'> = {
      mediaFocalX: null,
      mediaFocalY: null,
    };
    if (raw.mediaFocalX !== null || raw.mediaFocalY !== null) {
      const parsed = MediaRef.parseFocus(
        raw.mediaFocalX ?? Number.NaN,
        raw.mediaFocalY ?? Number.NaN,
      );
      if (parsed.ok) focus = parsed.value;
      else errors.push(parsed.error);
    }
    if (errors.length > 0) return Result.err(errors);
    const blurhash = raw.mediaBlurhash === null ? '' : raw.mediaBlurhash.trim();
    return Result.ok({
      mediaId: MediaRefId.of(raw.mediaId),
      mediaPath,
      mediaWidth: raw.mediaWidth,
      mediaHeight: raw.mediaHeight,
      mediaBlurhash: blurhash.length > 0 ? blurhash : null,
      mediaFocalX: focus.mediaFocalX,
      mediaFocalY: focus.mediaFocalY,
    });
  },
} as const;

function isUnit(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= 1;
}

function isPositiveInteger(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}
