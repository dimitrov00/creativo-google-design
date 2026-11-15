/**
 * What Cloud Storage says of one object, as far as a decision reads it:
 * how many bytes it holds and what it says it is. The server's
 * `statStoredObject` answers it; `BarberPhotoSystem.admitObject` judges it.
 */
export type StoredObjectFacts = {
  /** The object's size in bytes. */
  readonly sizeBytes: number;
  /** Its `Content-Type`, as stored; `null` when it holds none. */
  readonly contentType: string | null;
};
