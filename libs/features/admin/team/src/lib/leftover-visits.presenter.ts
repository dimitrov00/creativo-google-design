import { type ShopNow, VisitGrain, VisitPerspective } from '@core/components';
import type { Appointment } from '@core/entities';
import type { TimeZone } from '@core/primitives';
import { VisitListSystem } from '@core/systems';
import {
  type StaffEventLine,
  type VisitBuilderWords,
  type VisitLookup,
  type VisitSectionVm,
  visitRowOf,
} from '@creativo/features/shared/visits';
import { formatWallClock } from '@creativo/ui/wall-clock';

/**
 * THE VISITS A LAST DAY LEAVES BEHIND, AS THE APP'S OWN VISIT LIST (team
 * onboarding D10) — the rows the staff search and a client's history draw
 * (`visitRowOf`), under the day each falls on. Nothing here is a new row:
 * a person who has read a visit anywhere in the app reads these.
 *
 * It words and decides nothing. Which visits are left is
 * `EmploymentSystem.leftoverVisitsOf`'s answer, handed in oldest first;
 * which day each files under is `VisitListSystem.dayGroups`'s; the row is
 * the shared list's.
 */
export interface LeftoverVisitsInput {
  /** The visits left, oldest first — as `EmploymentSystem.leftoverVisitsOf` answered them. */
  readonly visits: readonly Appointment[];
  /** "Now" on the shop's wall clock, read once by the host. */
  readonly now: ShopNow;
  readonly timeZone: TimeZone;
  readonly locale: string;
  /** The shared row's words, as staff read them. */
  readonly rowWords: VisitBuilderWords;
  /** «По-рано» — the heading of the visits before today that nobody closed. */
  readonly earlier: string;
  readonly lookup: VisitLookup;
}

/** «Вторник, 18 ноември» — a heading, so it starts with a capital. */
function headingOf(input: LeftoverVisitsInput, date: Appointment['localDate']) {
  const label = formatWallClock(date, null, input.locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return label.charAt(0).toLocaleUpperCase(input.locale) + label.slice(1);
}

/** «Елена Василева», under the person glyph; no line for a visit with nobody to call. */
function contactLinesOf(visit: Appointment): readonly StaffEventLine[] {
  return visit.contactName === null
    ? []
    : [
        {
          text: visit.contactName,
          icon: 'contact.person',
          testId: 'leftover-line-contact',
        },
      ];
}

/** The visits under their days: one section per shop day, in the order given. */
export function leftoverSectionsVm(
  input: LeftoverVisitsInput,
): readonly VisitSectionVm[] {
  return VisitListSystem.dayGroups(input.visits, input.now.localDate).map(
    (group) => ({
      key: group.groupKey,
      label:
        group.groupDate === null
          ? input.earlier
          : headingOf(input, group.groupDate),
      detail: null,
      testId: `leftover-group-${group.groupKey}`,
      rows: group.visits.map((visit) =>
        visitRowOf(
          visit,
          {
            perspective: VisitPerspective.Staff,
            grain: VisitGrain.Month,
            // Each row tells its appointment's own story: these are many
            // people's visits, not one person's history.
            subjectUserId: null,
            subjectCustomerId: null,
            currentAppointmentId: null,
            now: input.now,
            timeZone: input.timeZone,
            locale: input.locale,
            words: input.rowWords,
            // Who the shop would call about it: the booking's own contact,
            // as the desk reads it on the visit. A walk-in has none.
            matched: { titleTerms: [], matchLines: contactLinesOf(visit) },
          },
          input.lookup,
        ),
      ),
    }),
  );
}
