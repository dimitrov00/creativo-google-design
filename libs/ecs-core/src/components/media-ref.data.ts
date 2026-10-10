import { CatalogError, MediaDimension } from './catalog-errors.data';
import { Result } from './result.data';

/**
 * The Storage object key a `MediaRef` names — **kept** (catalog-kernel Q8):
 * the media resolver and `pnpm run seed:dev` address uploads by it, and
 * dropping it would orphan every uploaded object. A brand over the plain
 * stored string.
 */
export type MediaRefId = string & { readonly __brand: unique symbol };

export const MediaRefId = {
  /** The only cast site. Validate with `MediaRef.parse` at the edge, not here. */
  of: (raw: string): MediaRefId => raw as MediaRefId,
} as const;

/**
 * A 0..1 normalised focal point — `{ x: 0, y: 0 }` is the top-left corner.
 * Replaces a CSS `object-position` string (CSS-as-tenant-data); the UI's
 * avatar/cover crop math reads it.
 */
export type FocalPoint = {
  readonly x: number;
  readonly y: number;
};

export const FocalPoint = {
  /** The normalised midpoint — the crop a ref without a focal point gets. */
  center(): FocalPoint {
    return { x: 0.5, y: 0.5 };
  },

  /** Both axes finite and inside 0..1, or `catalog.media_ref.focal_point_out_of_range`. */
  parse(x: number, y: number): Result<FocalPoint, CatalogError> {
    return isUnit(x) && isUnit(y)
      ? Result.ok({ x, y })
      : Result.err(CatalogError.mediaRefFocalPointOutOfRange(x, y));
  },

  equals(a: FocalPoint, b: FocalPoint): boolean {
    return a.x === b.x && a.y === b.y;
  },
} as const;

/**
 * A denormalised image pointer embedded where a cover or avatar renders
 * without a second read (`Barber.avatar`, `Service.cover`,
 * `Location.cover`/`photos`) — the **stored body** of `media-ref.ts:49-56`
 * and the seed, nothing invented (no `alt`: captions are not stored) and
 * nothing dropped (`width`/`height` drive every cover/avatar crop). The
 * stored key is `focalPoint`, as `catalog-reader.adapter.ts:65` reads it.
 * Absent is `null`, never a missing key.
 */
export type MediaRef = {
  readonly id: MediaRefId;
  /** Storage path, e.g. `'barbers/ivan/avatar.jpg'`. */
  readonly path: string;
  /** Intrinsic pixel width — a positive integer. */
  readonly width: number;
  /** Intrinsic pixel height — a positive integer. */
  readonly height: number;
  /** Placeholder hash painted before the bytes arrive; `null` when none was computed. */
  readonly blurhash: string | null;
  readonly focalPoint: FocalPoint | null;
};

export const MediaRef = {
  /**
   * The edge guard for an authored ref (the catalogue seed, an upload's
   * metadata), every violation at once: a blank id (`catalog.id.empty`), a
   * blank path, a width or height that is not a positive integer, a focal
   * point outside 0..1. The path is trimmed; a blank or whitespace-only
   * blurhash becomes `null`; the id is kept exactly as given.
   */
  parse(
    raw: Omit<MediaRef, 'id'> & { readonly id: string },
  ): Result<MediaRef, readonly CatalogError[]> {
    const errors: CatalogError[] = [];
    if (raw.id.trim().length === 0) {
      errors.push(CatalogError.idEmpty('MediaRefId'));
    }
    const path = raw.path.trim();
    if (path.length === 0) {
      errors.push(CatalogError.mediaRefEmptyPath());
    }
    if (!isPositiveInteger(raw.width)) {
      errors.push(
        CatalogError.mediaRefInvalidDimension(MediaDimension.Width, raw.width),
      );
    }
    if (!isPositiveInteger(raw.height)) {
      errors.push(
        CatalogError.mediaRefInvalidDimension(
          MediaDimension.Height,
          raw.height,
        ),
      );
    }
    let focalPoint: FocalPoint | null = null;
    if (raw.focalPoint !== null) {
      const parsed = FocalPoint.parse(raw.focalPoint.x, raw.focalPoint.y);
      if (parsed.ok) focalPoint = parsed.value;
      else errors.push(parsed.error);
    }
    if (errors.length > 0) return Result.err(errors);
    const blurhash = raw.blurhash === null ? '' : raw.blurhash.trim();
    return Result.ok({
      id: MediaRefId.of(raw.id),
      path,
      width: raw.width,
      height: raw.height,
      blurhash: blurhash.length > 0 ? blurhash : null,
      focalPoint,
    });
  },
} as const;

function isUnit(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= 1;
}

function isPositiveInteger(n: number): boolean {
  return Number.isInteger(n) && n > 0;
}
