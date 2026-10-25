import { VisitFilter, VisitGrain, VisitPerspective } from '@core/components';

/*
 * The visit list's lowercase words (UI residue cleanup §2.2, UR-3; the
 * Phase 4a 4A-10 precedent of `booking-status-words.ts` — flip-4 F4-7's
 * programs status words moved into the catalogues in pass E, E-17) — what the `visits.filter.<word>` keys, the
 * filter and section test ids (`…-filter-no_show`, `history-month-2026-09`,
 * `history-year-2026`) and the lists' `data-perspective` have always
 * spelled. The `VisitListSystem` tags are SCREAMING; the words are not. ONE
 * table per dictionary, here because three libs print them (the visits lib,
 * the client appointments page, the staff client card).
 */

/** A list filter as its `visits.filter.<word>` key segment and test-id suffix. */
export const visitFilterWords = {
  [VisitFilter.All]: 'all',
  [VisitFilter.Upcoming]: 'upcoming',
  [VisitFilter.Completed]: 'completed',
  [VisitFilter.Cancelled]: 'cancelled',
  [VisitFilter.NoShow]: 'no_show',
} as const satisfies Record<VisitFilter, string>;

/** A list's section grain as its section test-id segment. */
export const visitGrainWords = {
  [VisitGrain.Month]: 'month',
  [VisitGrain.Year]: 'year',
} as const satisfies Record<VisitGrain, string>;

/** Who reads a list, as its `data-perspective` value. */
export const visitPerspectiveWords = {
  [VisitPerspective.Client]: 'client',
  [VisitPerspective.Staff]: 'staff',
} as const satisfies Record<VisitPerspective, string>;
