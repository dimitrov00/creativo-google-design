/**
 * The saved search's error code — a stored recent that does not read back as
 * a `SearchQuery` (`SearchQuery.parse`), a flat struct discriminated by
 * `errorCode` (Law 7.5), SCREAMING_SNAKE with the `SEARCH_QUERY_` prefix.
 */
export const SearchQueryErrorCode = {
  /** The stored value is not a well-formed query; `field` names the first offending part. */
  Invalid: 'SEARCH_QUERY_INVALID',
} as const;
export type SearchQueryErrorCode =
  (typeof SearchQueryErrorCode)[keyof typeof SearchQueryErrorCode];

export type SearchQueryError = SearchQueryError.Invalid;

export const SearchQueryError = {
  invalid(field: string): SearchQueryError.Invalid {
    return { errorCode: SearchQueryErrorCode.Invalid, field };
  },
} as const;

export namespace SearchQueryError {
  export type Invalid = {
    readonly errorCode: typeof SearchQueryErrorCode.Invalid;
    /** The path of the first offending part (`searchFilters[1].filterBarberIds[0]`). */
    readonly field: string;
  };
}
