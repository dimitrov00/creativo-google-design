/**
 * The keys the clientele search reads off `users/{uid}` — a slice of `User`
 * at the document root (blueprint §2.7, flatten-spec §3.7); names and
 * contact stay flat on `User` too. `searchName` is the lower-cased full name
 * (the list's order key), `null` on a provisioned stub that has no name
 * yet; `searchPrefixes` every prefix of every name token, plus the phone's
 * digits and the e-mail (whole and local part) from the third character —
 * index #8 (`searchPrefixes ARRAY_CONTAINS, searchName ASC`), `[]` on a
 * stub. Computed in ONE place, `SearchFieldsSystem.searchFields`, for the
 * web, the functions and the seed — which always answers a name.
 */
export type SearchFields = {
  readonly searchName: string | null;
  readonly searchPrefixes: readonly string[];
};
