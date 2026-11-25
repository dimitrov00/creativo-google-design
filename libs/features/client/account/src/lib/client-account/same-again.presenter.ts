import type { Appointment } from '@core/entities';
import {
  type SameAgain,
  SameAgainReach,
  type ShopNow,
  VisitPerspective,
} from '@core/components';
import type { BarberId, ServiceId, TimeZone } from '@core/primitives';
import {
  VisitCardSlot,
  type VisitCardWords,
  type VisitLookup,
  type VisitWords,
  joinedNames,
  visitCardOf,
} from '@creativo/features/shared/visits';
import type { SameAgainVm, SameAgainWords } from './same-again.vm';

/** What {@link sameAgainVm} words. */
export interface SameAgainInput {
  /** The visit to book again (`SameAgainSystem.sourceOf`). */
  readonly source: Appointment;
  /** What today's catalogue can book of it (`SameAgainSystem.reachOf`). */
  readonly reach: SameAgain;
  /** "Now" on the visit's own shop's wall clock. */
  readonly now: ShopNow;
  /** That shop's zone. */
  readonly timeZone: TimeZone;
  readonly locale: string;
  readonly words: VisitWords;
  readonly cardWords: VisitCardWords;
  readonly sameAgainWords: SameAgainWords;
  readonly lookup: VisitLookup;
}

/**
 * «Пак същото» as `/account` draws it — or `null` when the system found
 * nothing of the visit to book (`NONE`). The card is the shared visit card
 * in its LAST slot under the page's own label, with the services and the
 * barber's face (owner ruling Q6); the notes word what the system says
 * changed — the away barbers, the gone services — by name where the
 * catalogue names them all.
 */
export function sameAgainVm(input: SameAgainInput): SameAgainVm | null {
  const { reach, sameAgainWords: words, lookup } = input;
  if (reach.sameAgainReach === SameAgainReach.None) return null;
  const card = visitCardOf(
    input.source,
    {
      visitCardSlot: VisitCardSlot.Last,
      perspective: VisitPerspective.Client,
      subjectUserId: null,
      now: input.now,
      timeZone: input.timeZone,
      locale: input.locale,
      words: input.words,
      cardWords: input.cardWords,
      label: words.title,
      testId: 'account-same-again',
    },
    lookup,
  );
  const notes: string[] = [];
  const away = namesOf(reach.awayBarberIds, (id: BarberId) =>
    lookup.barberName(id),
  );
  if (away !== null) {
    notes.push(
      away.length === reach.awayBarberIds.length
        ? words.barberAway(joinedNames(away, input.locale), away.length)
        : words.barberAwayUnnamed,
    );
  }
  const gone = namesOf(reach.goneServiceIds, (id: ServiceId) =>
    lookup.serviceName(id),
  );
  if (gone !== null) {
    notes.push(
      gone.length === reach.goneServiceIds.length
        ? words.serviceGone(joinedNames(gone, input.locale), gone.length)
        : words.serviceGoneUnnamed,
    );
  }
  return { card, notes };
}

/** The names the lookup knows of `ids`, in their order — `null` when there are no ids. */
function namesOf<I>(
  ids: readonly I[],
  nameOf: (id: I) => string | null,
): readonly string[] | null {
  if (ids.length === 0) return null;
  const names: string[] = [];
  for (const id of ids) {
    const name = nameOf(id);
    if (name !== null) names.push(name);
  }
  return names;
}
