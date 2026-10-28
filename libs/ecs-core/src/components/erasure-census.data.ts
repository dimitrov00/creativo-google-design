/**
 * THE CENSUS OF A PERSON'S FOOTPRINT (audit-hardening Phase 3 WS-D,
 * P3-RU-22) — ONE flat count slice (the RU-12 delta-slice precedent),
 * intersected at the root of the erasure's audit variant
 * (`AuditContext.ClientErasure`) and of the two answers the admin's card
 * reads (`ClientPrivacyCall.ErasurePreview`, `ClientPrivacyCall.Erasure`).
 * Counts only — never a value, a name or an id of the person (R36 / T5).
 *
 * Eight PERSONAL counts — what still holds a personal value and the erasure
 * must clear (`ErasureCensus.PERSONAL_FIELDS`; every one 0 is a complete
 * erasure) — and three RETAINED counts, what the shop keeps by the owner's
 * "pseudonymize, keep records" (visits, the party contacts not provably the
 * person's, journal rows). One pure census (`ClientErasureSystem.census`)
 * computes it over the person's footprint as read, so it is recomputable on
 * any resume: the STARTED row carries it BEFORE the erasure, the ERASED row
 * the residue AFTER, and a RESWEPT row the census before a sweep of residue
 * found after completion (P3-L-19).
 */
export type ErasureCensus = {
  /** Client records still holding a personal value (0 | 1). */
  readonly erasureRecordCount: number;
  /** Accounts still holding a personal value (0 | 1; a marker name is none, P3-L-22). */
  readonly erasureAccountCount: number;
  /** Visits still carrying the person's contact. */
  readonly erasureContactCount: number;
  /** The person's walk-in seats still labelled by name. */
  readonly erasureLabelCount: number;
  /** Notes of the person's visits still present (party visits' too, P3-RU-33). */
  readonly erasureNoteCount: number;
  /** The person's photo documents still present. */
  readonly erasurePhotoCount: number;
  /** Notifications and waitlist requests still present. */
  readonly erasureDocumentCount: number;
  /** Invitations and impersonation sessions still holding a name or a reason. */
  readonly erasurePseudonymCount: number;
  /** RETAINED: the person's visits (never erased — ids, times, money and statuses stay). */
  readonly erasureVisitCount: number;
  /** RETAINED: party visits whose contact derives no record of the person (P3-L-12). */
  readonly erasureContactKeptCount: number;
  /** RETAINED: journal rows (ids and codes only — pseudonymous by design, T5). */
  readonly erasureJournalCount: number;
};

/** Nothing counted — every field 0. */
const EMPTY: ErasureCensus = {
  erasureRecordCount: 0,
  erasureAccountCount: 0,
  erasureContactCount: 0,
  erasureLabelCount: 0,
  erasureNoteCount: 0,
  erasurePhotoCount: 0,
  erasureDocumentCount: 0,
  erasurePseudonymCount: 0,
  erasureVisitCount: 0,
  erasureContactKeptCount: 0,
  erasureJournalCount: 0,
};

/** The eight counts of what still holds a personal value, in field order. */
const PERSONAL_FIELDS = [
  'erasureRecordCount',
  'erasureAccountCount',
  'erasureContactCount',
  'erasureLabelCount',
  'erasureNoteCount',
  'erasurePhotoCount',
  'erasureDocumentCount',
  'erasurePseudonymCount',
] as const satisfies readonly ErasureCensus.Field[];

/** The three counts of what the shop keeps, in field order. */
const RETAINED_FIELDS = [
  'erasureVisitCount',
  'erasureContactKeptCount',
  'erasureJournalCount',
] as const satisfies readonly ErasureCensus.Field[];

export const ErasureCensus = {
  /** Nothing counted — every field 0 (the residue of a complete erasure has its personal counts at 0). */
  EMPTY,

  /** The eight personal counts — every one 0 is a complete erasure (`ClientErasureSystem.isComplete`). */
  PERSONAL_FIELDS,

  /** The three retained counts — kept by "pseudonymize, keep records", never a residue. */
  RETAINED_FIELDS,

  /**
   * Exactly the eleven counts of any struct that carries them, in field
   * order — what a row or an answer copies, so a wider struct (an answer
   * with its `erasureStatus`, a caller's object) never leaks a stray field
   * into an audit row, and every census shares one shape.
   */
  countsOf(source: ErasureCensus): ErasureCensus {
    return {
      erasureRecordCount: source.erasureRecordCount,
      erasureAccountCount: source.erasureAccountCount,
      erasureContactCount: source.erasureContactCount,
      erasureLabelCount: source.erasureLabelCount,
      erasureNoteCount: source.erasureNoteCount,
      erasurePhotoCount: source.erasurePhotoCount,
      erasureDocumentCount: source.erasureDocumentCount,
      erasurePseudonymCount: source.erasurePseudonymCount,
      erasureVisitCount: source.erasureVisitCount,
      erasureContactKeptCount: source.erasureContactKeptCount,
      erasureJournalCount: source.erasureJournalCount,
    };
  },
} as const;

export namespace ErasureCensus {
  /** One census count's field name. */
  export type Field = keyof ErasureCensus;
}
