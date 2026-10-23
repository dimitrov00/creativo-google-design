import { VisitFilter, VisitGrain, VisitPerspective } from '@core/systems';

/*
 * The visit list's lowercase words (UI residue cleanup §2.2, UR-3; the
 * flip-4 F4-7 / Phase 4a 4A-10 precedent of `program-status-words.ts` and
 * `booking-status-words.ts`) — what the `visits.filter.<word>` keys, the
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
