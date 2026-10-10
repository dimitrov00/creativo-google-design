/**
 * The keys the clientele search reads off `users/{uid}` — the only user
 * sub-struct (blueprint §2.7); names and contact stay flat on `UserEntity`.
 * `searchName` is the lower-cased full name (the list's order key);
 * `searchPrefixes` every prefix of every name token, plus the phone's digits
 * and the e-mail (whole and local part) from the third character — index #8
 * (`searchPrefixes ARRAY_CONTAINS, searchName ASC`). Computed in ONE place,
 * `SearchFieldsSystem.searchFields`, for the web, the functions and the seed.
 */
export type SearchFields = {
  readonly searchName: string;
  readonly searchPrefixes: readonly string[];
};
