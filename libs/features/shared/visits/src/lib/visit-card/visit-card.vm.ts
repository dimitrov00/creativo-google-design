import type { ShopNow, VisitPerspective } from '@core/components';
import type {
  AppointmentId,
  CustomerId,
  LocalDate,
  TimeZone,
  UserId,
  WaitlistRequestId,
} from '@core/primitives';
import type { UiBadgeTone } from '@creativo/ui/controls';
import type { VisitRowPhotoSource } from '../visit-row.presenter';
import type {
  VisitRowPhoto,
  VisitWaitlistWords,
  VisitWords,
} from '../visit-row.vm';

/*
 * ONE VISIT, ONE CARD (client-card revision 3 §3.10, R2-I).
 *
 * The card `/account` draws as «Предстоящ час» and the cards the staff
 * glance draws under «Посещения» are one component, `lib-visit-card`: a
 * label, THE SERVICES, the facts with the figure at their trailing edge,
 * the client's own words, the thumbs, a capsule — and the barber's face
 * in the top-trailing corner. ONE order for every kind, so a last visit
 * and a next visit read the same way.
 *
 * Types only. The card is built by pure functions
 * (`visit-card.presenter.ts`: `visitCardOf`, `waitlistCardOf`) that take
 * the translated words and the catalogue as arguments, exactly as the
 * row's builders do, so a card builds the same in a spec, on the client's
 * page and on the staff sheet.
 */

/**
 * What the card is about — the field `visitCardSlot`, the ONLY source of
 * these strings: the last worked visit, the soonest one to come, a request
 * waiting for a free slot.
 */
export const VisitCardSlot = {
  Last: 'LAST',
  Next: 'NEXT',
  Waitlist: 'WAITLIST',
} as const;
export type VisitCardSlot = (typeof VisitCardSlot)[keyof typeof VisitCardSlot];

/** Each slot as the card's host prints it in `data-kind` (`last`, `next`, `waitlist`). */
export const visitCardSlotWords = {
  [VisitCardSlot.Last]: 'last',
  [VisitCardSlot.Next]: 'next',
  [VisitCardSlot.Waitlist]: 'waitlist',
} as const satisfies Record<VisitCardSlot, string>;

/** One run of a quiet line; `fact` runs are set in primary ink at weight 500. */
export interface VisitLinePart {
  readonly text: string;
  readonly fact: boolean;
}

/**
 * What every card carries, whichever slot it fills — the two cards below
 * add their id, discriminated by `visitCardSlot`.
 */
export interface VisitCardFields {
  /** «Последно посещение» · «Следващ час» · «Предстоящ час» · «Чака свободен час». */
  readonly label: string;
  /** Always the services, deduplicated: «Фейд · Оформяне на брада». */
  readonly services: string;
  /**
   * The quiet line, its separators inside the runs — last: «5.09 · Иван ·
   * Център»; next: «пт, 23.10 · 10:00 · Иван»; waitlist: «8.10 – 9.10,
   * следобед · още 1». ONE run is the fact: the date of a last visit, the
   * time of a next one.
   */
  readonly facts: readonly VisitLinePart[];
  /** «27,50 €» (`formatCents`): staff, a worked visit; else `null`. */
  readonly figure: string | null;
  /**
   * The client's own words, already in the locale's quotation marks
   * (`visits.quote`) — only where this subject booked the visit.
   */
  readonly quote: string | null;
  /**
   * A status that is news: «Потвърден» / «Заявен» on a next visit
   * (`appointments.status.*`); `null` on a last visit and on a waiting
   * request.
   */
  readonly capsule: {
    readonly text: string;
    readonly tone: UiBadgeTone;
  } | null;
  /**
   * Who cuts, as the face in the top-trailing corner (`ui-avatar regular`,
   * 44); `null` where the host asks for none (`/account`) and for a party
   * cut by several.
   */
  readonly barber: {
    readonly name: string;
    readonly avatarSrc: string | null;
  } | null;
  /** The visit's thumbs, at most three; each opens its photo. Empty where there are none. */
  readonly photos: readonly VisitRowPhoto[];
  /**
   * The card as one sentence (`visits.card.name`): the label, then every
   * fact the eye reads — the services, the day, who, the figure, the
   * status word and the whole quote.
   */
  readonly accessibleName: string;
  /** The host's: `client-visit-last` · `client-visit-next` · `client-visit-waitlist` · `account-upcoming`. */
  readonly testId: string;
}

/** An appointment's card — the last worked visit or the next one; its id is the appointment's. */
export interface AppointmentCardVm extends VisitCardFields {
  readonly visitCardSlot: Exclude<VisitCardSlot, typeof VisitCardSlot.Waitlist>;
  readonly id: AppointmentId;
}

/** A waiting request's card; its id is the request's. */
export interface WaitlistCardVm extends VisitCardFields {
  readonly visitCardSlot: typeof VisitCardSlot.Waitlist;
  readonly id: WaitlistRequestId;
}

/**
 * One visit, or one waiting request, as `lib-visit-card` draws it — the id
 * branded by the slot (Law 7.4), told apart by `visitCardSlot`.
 */
export type VisitCardVm = AppointmentCardVm | WaitlistCardVm;

/**
 * The card's own words, read from the catalogue once. What it shares with
 * a row — the fallbacks, the quote, the sentence of the facts, the status
 * words «Потвърден» and «Заявен» — it takes from the row's words
 * (`VisitWords`), never a second copy. The staff card's words table
 * carries exactly this shape (`ClientCardWords.visitCard`).
 */
export interface VisitCardWords {
  /** «Последно посещение» (`visits.card.last`). */
  readonly last: string;
  /** «Следващ час» (`visits.card.next`). */
  readonly next: string;
  /** «{{label}}: {{sentence}}» — the card as one sentence (`visits.card.name`). */
  readonly name: (label: string, sentence: string) => string;
}

/** What `visitCardOf` takes besides the appointment and the catalogue. */
export interface VisitCardOptions {
  readonly visitCardSlot: Exclude<VisitCardSlot, typeof VisitCardSlot.Waitlist>;
  /**
   * Who reads: `staff` tells the SUBJECT's story (their seats, their
   * share, the figure of a worked visit); `client` tells the
   * appointment's, and prints no money.
   */
  readonly perspective: VisitPerspective;
  /** Whose story the staff card tells; `null` (a guest, the client's own page) tells the appointment's. */
  readonly subjectUserId: UserId | null;
  /**
   * The same person's client RECORD (D29), what the story is keyed by —
   * the staff card passes the one it resolved, `null` names a guest, and
   * absent the seat's own link names it: optional on purpose, three answers
   * of one contract (OR-59; `VisitRowOptions.subjectCustomerId`).
   */
  readonly subjectCustomerId?: CustomerId | null;
  /** "Now" on the shop's wall clock, derived ONCE by the host (Law 7.3). */
  readonly now: ShopNow;
  /** The zone `now` was read in — a photo's day falls back to it. */
  readonly timeZone: TimeZone;
  readonly locale: string;
  /**
   * The row's words, of the same perspective: the card's sentence is the
   * row's, and its capsule says `statusConfirmed` or `statusPending`.
   */
  readonly words: VisitWords;
  readonly cardWords: VisitCardWords;
  /**
   * The label in the host's own words, in place of the slot's:
   * `/account`'s «Предстоящ час» (`account.upcoming.title`).
   */
  readonly label?: string;
  /** False leaves the face out (`/account`). Defaults to true. */
  readonly barber?: boolean;
  /** The visit's photos, newest first; at most three are drawn. */
  readonly photos?: readonly VisitRowPhotoSource[];
  /**
   * False withholds the client's own words from a viewer who may not read
   * free text (a sysadmin, R15). Defaults to true.
   */
  readonly clientWords?: boolean;
  readonly testId: string;
}

/** What `waitlistCardOf` takes besides the request and the catalogue. */
export interface WaitlistCardOptions {
  /** The request's words; its label is their state, «Чака свободен час» (`waiting`). */
  readonly words: VisitWaitlistWords;
  /** Today on the request's calendar (the shop's): the days before it have passed. */
  readonly today: LocalDate;
  readonly locale: string;
  /**
   * The person's OTHER watching requests: the card names the newest one
   * and counts the rest («· още 1»). Defaults to none.
   */
  readonly otherRequests?: number;
  readonly testId: string;
}
