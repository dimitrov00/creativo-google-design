import type { AppointmentCardVm } from '@creativo/features/shared/visits';

/*
 * «ПАК СЪЩОТО» — the client home's lead card when no visit is next (owner
 * ruling Q6 of the role-aware homes brief, 2026-11-25): the visit the
 * person had last, as the shared visit card draws it, with what today's
 * catalogue changed about it and the way to book it again.
 */

/** The card as `/account` draws it. */
export interface SameAgainVm {
  /** The visit, as the shared card in its LAST slot: «Пак същото», the services, the day, the barber's face. */
  readonly card: AppointmentCardVm;
  /**
   * What booking it again changes, each a sentence: a barber who no longer
   * takes online bookings, a service no longer offered. Empty when it
   * books as it was.
   */
  readonly notes: readonly string[];
}

/**
 * The card's own words, read once from the catalogue (`account.sameAgain.*`)
 * in the loaded language: the plural forms are chosen by the host
 * (`pluralForm`), the names arrive joined.
 */
export interface SameAgainWords {
  /** «Пак същото» — the card's label. */
  readonly title: string;
  /** «Иван вече не приема онлайн часове — …», for `count` named barbers. */
  barberAway(names: string, count: number): string;
  /** The same sentence for a barber the client cannot name. */
  readonly barberAwayUnnamed: string;
  /** «Брада вече не се предлага.», for `count` named services. */
  serviceGone(names: string, count: number): string;
  /** The same sentence for services the client cannot name. */
  readonly serviceGoneUnnamed: string;
}
