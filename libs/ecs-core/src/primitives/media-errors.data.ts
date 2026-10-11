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
 * `catalog-errors.data.ts`.
 */
export const MediaErrorCode = {
  NotFound: 'MEDIA_NOT_FOUND',
  Forbidden: 'MEDIA_FORBIDDEN',
  Transient: 'MEDIA_TRANSIENT',
} as const;
export type MediaErrorCode =
  (typeof MediaErrorCode)[keyof typeof MediaErrorCode];

export type MediaError =
  MediaError.NotFound | MediaError.Forbidden | MediaError.Transient;

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
  /**
   * The retry decision: `true` for Storage's permanent answers, `false` for
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
}
