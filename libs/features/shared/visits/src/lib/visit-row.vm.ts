import type { Daypart } from '@creativo/application/booking';
import type { UiIconName } from '@creativo/ui/controls';
import type { StaffEventLine } from './event-head/staff-event-line';

/*
 * ONE VISITS LIST, TWO PERSPECTIVES (client-card redesign §5.3, D5).
 *
 * «Моите часове» (a client reading their own bookings) and a client's
 * history on the staff card (a barber reading someone else's) draw the same
 * rows under the same section heads: a date tile that says what the section
 * does not, the event head's title and fact lines, one thing on the
 * trailing edge. What differs is data, never markup: the perspective picks
 * the row element and the words, the grain picks the section and the tile's
 * caption.
 *
 * The rows are built by pure functions that take the translated words
 * (`VisitWords`) and the catalogue (`VisitLookup`) as arguments, so a row
 * builds the same in a spec, in the client's page and in the staff sheet —
 * no DI anywhere, no NullInjectorError in anyone's TestBed.
 */

/** Whose list: the client's own «Моите часове», or a client's history on the staff card. */
export type VisitPerspective = 'client' | 'staff';

/** What a section heads: a month («Септември 2026 г.») or a year («2026»). */
export type VisitGrain = 'month' | 'year';

/**
 * ≙ SwiftUI's `.listStyle(…)`. `insetGrouped` runs the rows as one
 * segmented group per section (the client's look); `plain` sets them on the
 * page under pinned heads (the staff history, the glance's rows).
 */
export type VisitListStyle = 'insetGrouped' | 'plain';

/**
 * RETIRED (revision 3 §3.11, W4): a row is a row, and the featured card
 * is `lib-visit-card`. `lib-visit-row` no longer takes a variant; the alias
 * stands only for `VisitRowOptions.variant`, which `visitRowOf` accepts and
 * ignores until its last caller (the built `visitsModuleVm`) is gone — it
 * goes with that caller (contract delta Z2-1).
 */
export type VisitRowVariant = 'row' | 'card';

/**
 * How the visit went — for the SUBJECT on the staff card (their own seats
 * alone: a companion's no-show says nothing about the booker), for the
 * appointment as a whole on the client's list.
 */
export type VisitRowOutcome = 'open' | 'worked' | 'no_show' | 'cancelled';

/** The filter's one choice; `all` is the unfiltered list. */
export type VisitFilter =
  'all' | 'upcoming' | 'completed' | 'no_show' | 'cancelled';

/**
 * A 16 px glyph at the end of a staff row's second line, before its fact —
 * staff only: the visit's photos (`client.photos`, counted), a discount
 * (`promo.coupon`), a voucher (`promo.voucher`). The glyph is drawn;
 * `label` is its visually hidden word.
 */
export interface VisitRowMark {
  readonly icon: UiIconName;
  readonly label: string;
  /** Printed beside the glyph; null for a mark that counts nothing. */
  readonly count: number | null;
}

/**
 * The trailing edge: who cut, as a small face, in BOTH perspectives
 * (revision 3 §2.5, §3.11: that is the sameness of the two screens), or
 * nothing where the row names nobody. `several` is a party with more than
 * one barber — no face, the name is the group's. Money, a state in words
 * and «Този час» are never here: they are the staff's fact, at the end of
 * the row's second line (`VisitTrailingFact`).
 */
export type VisitTrailing = {
  readonly kind: 'barber';
  readonly avatarSrc: string | null;
  readonly name: string;
  readonly several: boolean;
} | null;

/**
 * What ends a STAFF row's second line (revision 3 §2.5, §3.11): money, a
 * state in words, or «Този час». At most one, and never the barber: the
 * face keeps the trailing edge in both perspectives (`trailing`), in a
 * column reserved on every row, so these facts end on one vertical line
 * and the amounts read as a column.
 */
export type VisitTrailingFact =
  /**
   * Money, always `formatMoney` («27,50 €»): charged and primary on a worked
   * visit, booked, secondary and struck on a cancelled one.
   */
  | {
      readonly kind: 'amount';
      readonly text: string;
      readonly emphasis: 'primary' | 'secondary';
      readonly struck: boolean;
    }
  /**
   * A state in words beside its glyph — «Заявен», «Не дойде». `warning`
   * tints the GLYPH only; the word keeps the primary ink.
   */
  | {
      readonly kind: 'status';
      readonly icon: UiIconName;
      readonly text: string;
      readonly tone: 'neutral' | 'warning';
    }
  /** «Този час»: the appointment the sheet is open on. */
  | { readonly kind: 'badge'; readonly text: string }
  | null;

/** A thumb on `lib-visit-card` (`VisitCardVm.photos`); each opens its photo. */
export interface VisitRowPhoto {
  readonly id: string;
  readonly url: string;
  readonly alt: string;
}

/** One row of the list: a visit, or a request waiting for a free slot. */
export interface VisitRowVm {
  /** The appointment's id, or the waitlist request's. */
  readonly id: string;
  readonly kind: 'visit' | 'waitlist';
  /** When the visit starts, epoch ms — the order within a section. */
  readonly startMs: number;
  /** The section the row files under: `upcoming`, `YYYY-MM` or `YYYY`. */
  readonly sectionKey: string;
  readonly upcoming: boolean;
  /**
   * The date tile. Its caption says what the section does not: the weekday
   * under a month, the short month under a year (and on the glance). Null
   * on a waitlist row, which leads with a glyph instead.
   */
  readonly tile: {
    readonly caption: string;
    readonly day: number;
    readonly tone: 'upcoming' | 'past' | 'hollow';
  } | null;
  /** The waitlist row's leading glyph (`calendar.watching`); null beside a tile. */
  readonly leadingIcon: UiIconName | null;
  /** The services, deduplicated — what the visit IS. */
  readonly title: string;
  /**
   * An hour that did not happen (cancelled, no-show): the title is struck
   * through. The ONE mark — the row never fades as well (struck AND greyed
   * says one fact twice, and the fade took the stamp's caption and the
   * struck amount under 4.5:1).
   */
  readonly struck: boolean;
  /**
   * The event head's fact lines — never the date, which the tile and the
   * section already own. A staff row's first line carries the row's fact
   * at its end; a cancelled one puts its status word there, whole, and
   * the barber on the line under it (review r5).
   */
  readonly lines: readonly StaffEventLine[];
  /**
   * The client's own words, already in the locale's quotation marks
   * (`visits.quote`) — only where this subject booked the visit.
   */
  readonly quote: string | null;
  readonly trailing: VisitTrailing;
  /** The staff's fact at the end of the second line; `null` on the client's row. */
  readonly trailingFact: VisitTrailingFact;
  readonly marks: readonly VisitRowMark[];
  /** Null on a waitlist row. */
  readonly outcome: VisitRowOutcome | null;
  /** The appointment's stored status (the client row's `data-status`); null on a waitlist row. */
  readonly status: string | null;
  /**
   * The row as one sentence — every fact, the status word, the price and
   * the whole quote included, since no row carries a visible `›` or a
   * tooltip to say the rest.
   */
  readonly accessibleName: string;
  readonly testId: string;
}

/** A run of rows under one heading. */
export interface VisitSectionVm {
  /** `upcoming` · `YYYY-MM` · `YYYY` — also the `data-section-key` the client's pills jump to. */
  readonly key: string;
  /** «Предстоящи» · «Септември 2026 г.» · «2026». */
  readonly label: string;
  /** Staff: the worked visits in the section, absent at zero; the client: null. */
  readonly detail: string | null;
  readonly rows: readonly VisitRowVm[];
  readonly testId: string;
}

/**
 * The catalogue, as a row needs it. `ClientCardCatalog` satisfies it
 * structurally, so the staff sheet hands one object to both.
 */
export interface VisitLookup {
  serviceName(id: string): string | null;
  barberName(id: string): string | null;
  barberAvatarSrc(id: string): string | null;
  /**
   * The shop as a fact line names it: `Location.shortName` («Център»), not
   * its whole name. Every shop carries the tenant's brand («Креативо ·
   * Център»), so on every row the whole name would repeat the one part
   * that never changes.
   */
  locationName(id: string): string | null;
  /** More than one shop puts the shop's name in a worked visit's fact line. */
  readonly locationCount: number;
}

/**
 * The slots of the row's one sentence (`visits.rowName`): «{{title}},
 * {{when}}, {{barber}}» and then each fact that applies, carrying its own
 * leading «, », or empty. A type alias, not an interface, so it goes
 * straight into Transloco's params.
 */
export type VisitRowNameParts = {
  readonly title: string;
  readonly when: string;
  /** Who, and where: the barber, then the shop and the party when the row shows them. */
  readonly barber: string;
  readonly outcome: string;
  readonly price: string;
  readonly marks: string;
  readonly quote: string;
};

/**
 * The translated words the row builders take — the host reads them from
 * the catalogue once, so a builder never injects and never holds copy.
 * The host picks the perspective's words (the staff sheet's «Не дойде», the
 * client's own status word).
 */
export interface VisitWords {
  /** «днес» — this appointment's day in the fact line (`visits.today`). */
  readonly today: string;
  /** «Този час» — the badge on the appointment the sheet is open on (`visits.thisVisit`). */
  readonly thisVisit: string;
  /**
   * «септ.» — the date tile's caption under a year, for the visit's month
   * (1 = January, `visits.tile.month.{1…12}`; LR4, DV9). A table, not
   * `Intl`: Bulgarian's short month is numeric («09»), and a tile's caption
   * is a label, not a fact line — R59 still holds for every sentence.
   */
  readonly tileMonth: (month: number) => string;
  /**
   * «Посещение» — the title of a visit whose services the catalogue no
   * longer lists (`appointments.visit.unknownService`).
   */
  readonly unknownService: string;
  /**
   * «Бръснар» — ONE barber the catalogue does not list (they left the shop,
   * or the catalogue has not answered yet): still one barber, never
   * «1 бръснари» (`appointments.visit.barberRole`).
   */
  readonly barberRole: string;
  /** «2 бръснари» — the client's row for a party cut by several (`appointments.visit.severalBarbers`). */
  readonly severalBarbers: (count: number) => string;
  /** «Снимка от 4 септември» — a card thumb's name (`staff.visit.photoOpen`, `{{when}}`). */
  readonly photoName: (when: string) => string;
  /** «с още 1» — the other people on the subject's party (`visits.withPeers.*`). */
  readonly withPeers: (count: number) => string;
  /** «3 снимки» — the photos mark's hidden word (`visits.marks.photos.*`). */
  readonly photos: (count: number) => string;
  /** «с отстъпка» — the discount mark's hidden word (`visits.marks.discount`). */
  readonly discount: string;
  /** «Заявен» (`appointments.status.pending`). */
  readonly statusPending: string;
  /**
   * «Потвърден» (`appointments.status.confirmed`) — the capsule of a next
   * visit on `lib-visit-card`, where a status is news. NEW in revision 3
   * (W0) and optional until `visitWordsOf` fills it; a card built from
   * words without it draws no capsule for a confirmed visit.
   */
  readonly statusConfirmed?: string;
  /** «Не дойде» (`staff.visit.resolution.noShow`). */
  readonly noShow: string;
  /**
   * «Отказан от клиента» · «Отказан от салона»
   * (`staff.visit.resolution.cancelledByClient` / `.cancelledByStaff`).
   */
  readonly cancelledBy: (side: 'client' | 'shop') => string;
  /** «„…“» — the client's words under the facts (`visits.quote`). */
  readonly quote: (text: string) => string;
  /** «, от клиента: „…“» — the quote inside the row's sentence (`visits.quoteName`). */
  readonly quoteName: (text: string) => string;
  /** The row's one sentence (`visits.rowName`). */
  readonly rowName: (parts: VisitRowNameParts) => string;
}

/**
 * The words of the row a waiting request draws on the staff glance
 * (`clientCard.visits.waitlist*`, `.daypart.*`) — its own set, so the
 * client's list, which never shows one, is never asked for them. The one
 * word it shares with a visit's row is the fallback title.
 */
export interface VisitWaitlistWords extends Pick<VisitWords, 'unknownService'> {
  /**
   * «Чака свободен час» — the state, on a fact line of its own over the
   * days, so no ellipsis can take the one thing that says this row is a
   * request and not a booked visit (wave D r3).
   */
  readonly waiting: string;
  /** «{{services}}, чака свободен час: {{when}}» — the row's sentence, the days spelled out. */
  readonly name: (services: string, when: string) => string;
  /** «сутрин» · «следобед» · «вечер» — the domain's parts (`daypartsTouchedBy`). */
  readonly daypart: (part: Daypart) => string;
  /** «и още 2» — the watched days past the first three. */
  readonly moreDays: (count: number) => string;
  /** «· още 1» — the person's other watching requests, after the newest one's line. */
  readonly moreRequests: (count: number) => string;
}
