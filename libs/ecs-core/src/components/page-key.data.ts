/**
 * A page key: the stored value a page is ordered and resumed by. GENERIC and
 * OPAQUE on purpose (flatten-spec §3.9): the system only compares keys, so
 * the typed cursor — `beforeUtcMs: UtcEpochMs` on `PageClientHistory`, a
 * journal sequence on `PageClientJournal` — belongs to the caller's port,
 * never to the paging system.
 */
export type PageKey = string | number;
