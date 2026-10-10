/**
 * The media context's error codes — the `E` of the media port's `resolve`
 * (`ports/media.port.ts`). The application layer's `MediaUnavailableError`
 * (`catalog.media.not_found` / `catalog.media.forbidden`,
 * `media-reader.errors.ts`) and the transient `RepositoryError` it was
 * paired with, renamed to the dotted convention (blueprint §2.7 Errors row).
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
 * The `MediaRef` shape guard's codes (`catalog.media_ref.*`) are catalogue
 * codes and live in `catalog-errors.data.ts` (§2.2: the 25 dotted catalog
 * codes reused as is).
 */
export const MediaErrorCode = {
  NotFound: 'media.not_found',
  Forbidden: 'media.forbidden',
  Transient: 'media.transient',
} as const;
export type MediaErrorCode =
  (typeof MediaErrorCode)[keyof typeof MediaErrorCode];

export type MediaError =
  MediaError.NotFound | MediaError.Forbidden | MediaError.Transient;

export const MediaError = {
  notFound(path: string): MediaError.NotFound {
    return { code: MediaErrorCode.NotFound, path };
  },
  forbidden(path: string): MediaError.Forbidden {
    return { code: MediaErrorCode.Forbidden, path };
  },
  transient(path: string): MediaError.Transient {
    return { code: MediaErrorCode.Transient, path };
  },
  /**
   * The retry decision: `true` for Storage's permanent answers, `false` for
   * the one failure worth asking again — never inferred from a message.
   */
  isPermanent(error: MediaError): boolean {
    return error.code !== MediaErrorCode.Transient;
  },
  /** Narrows an error to one code — `MediaError.is(e, MediaErrorCode.NotFound)`. */
  is<C extends MediaErrorCode>(
    error: MediaError,
    code: C,
  ): error is Extract<MediaError, { readonly code: C }> {
    return error.code === code;
  },
} as const;

export namespace MediaError {
  export type NotFound = {
    readonly code: typeof MediaErrorCode.NotFound;
    /** The Storage object key the `MediaRef` pointed at. */
    readonly path: string;
  };
  export type Forbidden = {
    readonly code: typeof MediaErrorCode.Forbidden;
    readonly path: string;
  };
  export type Transient = {
    readonly code: typeof MediaErrorCode.Transient;
    readonly path: string;
  };
}
