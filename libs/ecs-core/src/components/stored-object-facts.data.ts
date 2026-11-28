import type { UtcEpochMs } from '@core/primitives';

/**
 * What Cloud Storage says of one object, as far as a decision reads it:
 * how many bytes it holds, what it says it is and — for a picture whose
 * uploader measured it — its pixel size. The server's `statStoredObject`
 * answers it; `BarberPhotoSystem.admitObject` and `adoptionOf` judge it.
 */
export type StoredObjectFacts = {
  /** The object's size in bytes. */
  readonly sizeBytes: number;
  /** Its `Content-Type`, as stored; `null` when it holds none. */
  readonly contentType: string | null;
  /**
   * The picture's pixel size, as the uploader wrote it beside the bytes
   * (the object's `mediaWidth` / `mediaHeight` custom metadata); both
   * `null` when it wrote none, or wrote something that is no whole number.
   */
  readonly pixelWidth: number | null;
  readonly pixelHeight: number | null;
};

export const StoredObjectFacts = {
  /** An object nobody measured: its size and its type alone. */
  unmeasured(sizeBytes: number, contentType: string | null): StoredObjectFacts {
    return { sizeBytes, contentType, pixelWidth: null, pixelHeight: null };
  },
} as const;

/**
 * One object of a folder's listing, as far as a sweep reads it: where it
 * is and when it was written. The server's `listStoredObjects` answers it;
 * `ProgramImageSystem.staleOf` judges it.
 */
export type StoredObjectEntry = {
  readonly path: string;
  /** When the object was written; `null` when Storage did not say. */
  readonly createdUtcMs: UtcEpochMs | null;
};
