import { Result, combineAll, fail, ok } from '@creativo/domain/kernel';
import { MediaRefId } from './ids';
import {
  EmptyMediaPathError,
  FocalPointOutOfRangeError,
  InvalidMediaDimensionError,
  MediaRefValidationError,
} from './media-ref.errors';

export interface FocalPointProps {
  x: number;
  y: number;
}

/**
 * 0..1 normalized focal point — replaces a CSS `object-position` string
 * (CSS-as-tenant-data is a smell); drives avatar/cover crop math in the UI
 * layer. Small VO co-located here (like `WorkingHoursRange`/`WorkingHours`
 * in `libs/domain/models`) since it only ever appears inside a `MediaRef`.
 */
export class FocalPoint {
  private constructor(
    readonly x: number,
    readonly y: number,
  ) {}

  static create(
    props: FocalPointProps,
  ): Result<FocalPoint, FocalPointOutOfRangeError> {
    if (!FocalPoint.isUnitRange(props.x) || !FocalPoint.isUnitRange(props.y)) {
      return fail(new FocalPointOutOfRangeError(props.x, props.y));
    }
    return ok(new FocalPoint(props.x, props.y));
  }

  static center(): FocalPoint {
    return new FocalPoint(0.5, 0.5);
  }

  equals(other: FocalPoint): boolean {
    return this.x === other.x && this.y === other.y;
  }

  private static isUnitRange(n: number): boolean {
    return Number.isFinite(n) && n >= 0 && n <= 1;
  }
}

export interface MediaRefProps {
  id: string;
  path: string;
  width: number;
  height: number;
  blurhash?: string;
  focalPoint?: FocalPointProps;
}

/**
 * Denormalized image pointer embedded where a cover/avatar renders without
 * a second read (`Barber.avatar`, `Service.cover`, `Location.cover`/
 * `photos`). Ports v2's `MediaRef` value object; the full `MediaAsset`
 * aggregate it normally snapshots from (processing pipeline, contributor
 * credit, per-service gallery links) is out of scope for this pass — see
 * the deviation log. Callers construct a `MediaRef` directly (there is no
 * `MediaAsset` to snapshot from yet).
 */
export class MediaRef {
  private constructor(
    readonly id: MediaRefId,
    readonly path: string,
    readonly width: number,
    readonly height: number,
    readonly blurhash: string | null,
    readonly focalPoint: FocalPoint | null,
  ) {}

  static create(
    props: MediaRefProps,
  ): Result<MediaRef, MediaRefValidationError[]> {
    return MediaRef.build(props);
  }

  static reconstitute(
    props: MediaRefProps,
  ): Result<MediaRef, MediaRefValidationError[]> {
    return MediaRef.build(props);
  }

  private static build(
    props: MediaRefProps,
  ): Result<MediaRef, MediaRefValidationError[]> {
    const idResult = MediaRefId.create(props.id);
    const pathResult = MediaRef.validatePath(props.path);
    const widthResult = MediaRef.validateDimension('width', props.width);
    const heightResult = MediaRef.validateDimension('height', props.height);
    const focalPointResult: Result<
      FocalPoint | null,
      FocalPointOutOfRangeError
    > = props.focalPoint ? FocalPoint.create(props.focalPoint) : ok(null);

    const combined = combineAll([
      idResult,
      pathResult,
      widthResult,
      heightResult,
      focalPointResult,
    ] as const);
    if (combined.isFailure()) {
      return fail(combined.error);
    }
    const [id, path, width, height, focalPoint] = combined.value;

    const blurhash = props.blurhash?.trim();
    return ok(
      new MediaRef(
        id,
        path,
        width,
        height,
        blurhash && blurhash.length > 0 ? blurhash : null,
        focalPoint,
      ),
    );
  }

  private static validatePath(
    raw: string,
  ): Result<string, EmptyMediaPathError> {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? ok(trimmed) : fail(new EmptyMediaPathError());
  }

  private static validateDimension(
    dimension: 'width' | 'height',
    raw: number,
  ): Result<number, InvalidMediaDimensionError> {
    return Number.isInteger(raw) && raw > 0
      ? ok(raw)
      : fail(new InvalidMediaDimensionError(dimension, raw));
  }
}
