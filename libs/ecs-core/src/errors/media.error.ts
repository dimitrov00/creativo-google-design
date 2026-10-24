/**
 * The media context's error codes — the `E` of the media port's `resolve`
 * (`ports/media.port.ts`). The application layer's `MediaUnavailableError`
 * (`catalog.media.not_found` / `catalog.media.forbidden`,
 * `media-reader.errors.ts`) and the transient `RepositoryError` it was
 * paired with — flat structs discriminated by `errorCode` (Law 7.5),
 * SCREAMING_SNAKE with the `MEDIA_` prefix (flatten-spec §4.2).
 *
 * The split is the whole point of the type: `NotFound` and `Forbidden` are
 * Storage's PERMANENT answer (asking again returns the same, so the caller
 * shows the placeholder and stops asking), `Transient` is a dropped
 * connection, an exhausted quota or a server error — worth a bounded retry.
 * One missing cover used to cost four requests a session when the two were
 * one error. The codes differ per reason on purpose: a dangling `MediaRef`
 * is a catalogue-data problem, a forbidden one a Storage-rules problem, and
 * a log line should say which.
 *
 * The `MediaRef` shape guard's codes are catalogue codes and live in
 * `catalog.error.ts`.
 *
 * The two `MEDIA_PHOTO_*` codes are not Storage's answers: they are the
 * visit photo's wrapping of the upload guard's neutral `MediaRefusal`
 * (`MediaSystem.check`, pass C), answered by `attachVisitPhoto` BEFORE any
 * byte goes up — permanent by nature (the same file is refused again). The
 * avatar wraps the same refusal in its own `ACCOUNTS_UPLOAD_AVATAR_*` codes.
 */
export const MediaErrorCode = {
  NotFound: 'MEDIA_NOT_FOUND',
  Forbidden: 'MEDIA_FORBIDDEN',
  Transient: 'MEDIA_TRANSIENT',
  PhotoNotAnImage: 'MEDIA_PHOTO_NOT_AN_IMAGE',
  PhotoTooLarge: 'MEDIA_PHOTO_TOO_LARGE',
} as const;
export type MediaErrorCode =
  (typeof MediaErrorCode)[keyof typeof MediaErrorCode];

export type MediaError =
  | MediaError.NotFound
  | MediaError.Forbidden
  | MediaError.Transient
  | MediaError.PhotoNotAnImage
  | MediaError.PhotoTooLarge;

export const MediaError = {
  notFound(path: string): MediaError.NotFound {
    return { errorCode: MediaErrorCode.NotFound, path };
  },
  forbidden(path: string): MediaError.Forbidden {
    return { errorCode: MediaErrorCode.Forbidden, path };
  },
  transient(path: string): MediaError.Transient {
    return { errorCode: MediaErrorCode.Transient, path };
  },
  /** A visit photo that is not an image — the guard's `NOT_AN_IMAGE`, before the upload. */
  photoNotAnImage(): MediaError.PhotoNotAnImage {
    return { errorCode: MediaErrorCode.PhotoNotAnImage };
  },
  /** A visit photo not under the limit — the guard's `TOO_LARGE`, carrying the limit. */
  photoTooLarge(maxBytes: number): MediaError.PhotoTooLarge {
    return { errorCode: MediaErrorCode.PhotoTooLarge, maxBytes };
  },
  /**
   * The retry decision: `true` for Storage's permanent answers (and the
   * photo guard's refusals, which the same file earns again), `false` for
   * the one failure worth asking again — never inferred from a message.
   */
  isPermanent(error: MediaError): boolean {
    return error.errorCode !== MediaErrorCode.Transient;
  },
  /** Narrows an error to one code — `MediaError.is(e, MediaErrorCode.NotFound)`. */
  is<C extends MediaErrorCode>(
    error: MediaError,
    errorCode: C,
  ): error is Extract<MediaError, { readonly errorCode: C }> {
    return error.errorCode === errorCode;
  },
} as const;

export namespace MediaError {
  export type NotFound = {
    readonly errorCode: typeof MediaErrorCode.NotFound;
    /** The Storage object key the `MediaRef` pointed at. */
    readonly path: string;
  };
  export type Forbidden = {
    readonly errorCode: typeof MediaErrorCode.Forbidden;
    readonly path: string;
  };
  export type Transient = {
    readonly errorCode: typeof MediaErrorCode.Transient;
    readonly path: string;
  };
  export type PhotoNotAnImage = {
    readonly errorCode: typeof MediaErrorCode.PhotoNotAnImage;
  };
  export type PhotoTooLarge = {
    readonly errorCode: typeof MediaErrorCode.PhotoTooLarge;
    /** The limit the photo was not under (`MediaSystem.PHOTO_MAX_BYTES`). */
    readonly maxBytes: number;
  };
}
