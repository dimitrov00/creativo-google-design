import { BookingStatus } from '@core/primitives';
import type {
  AppointmentId,
  BarberId,
  Currency,
  CustomerId,
  EndMinute,
  LocalDate,
  LocationId,
  MinuteCount,
  MinuteOfDay,
  PriceCents,
  SeatId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import type { CancellationReason, Email } from '@core/components';
import type { UiIconName } from '@creativo/ui/controls';
import type { StaffEventLine } from '@creativo/features/shared/visits';
import type { SpanWords } from '../shared/span.words';
import type {
  VisitEditorClientOption,
  VisitEditorDiscount,
  VisitEditorLeg,
  VisitEditorResolution,
  VisitEditorVoucher,
} from '../visit-editor/staff-visit-editor';
import type { RowVerb } from '../row-verb';

/*
 * THE STAFF DAY'S DISPLAY MODEL (Law 10.3) — the structs the page's template
 * prints and the tables they print from: types and tag-to-word tables only.
 * `staff-day.presenter.ts` and `staff-day-chrome.presenter.ts` fill them;
 * what a row IS (its status, its verbs, whether it is next) is a system's.
 */

/**
 * How a host's catalogue answers — Transloco's `translate`, or anything shaped
 * like it (a spec's own reading of the catalogue). A presenter reads it only
 * through a words struct the page builds inside a `computed()` that reads the
 * loaded table (review r4: `translate()` itself reads no signal).
 */
export type StaffTranslate = (
  key: string,
  params?: Readonly<Record<string, string | number>>,
) => string;

/** The day's words from the catalogue, read once (`staffDayWordsOf`). */
export interface StaffDayWords {
  /** «Клиент без име» — `staff.day.unnamedClient`. */
  readonly unnamedClient: string;
  /** «Отказан» — `appointments.status.<word>`. */
  readonly statusName: (status: BookingStatus) => string;
  /** «Заявен» — `staff.day.exception.<word>`, for a state worth interrupting a glance. */
  readonly exception: (status: BookingStatus) => string;
  /** «Не дойде» — `staff.visit.resolution.noShow`. */
  readonly noShow: string;
  /** «Дошъл» — `staff.day.statusArrived`. */
  readonly arrived: string;
  /** «още 12 мин» — `staff.day.agendaRemaining`. */
  readonly remaining: (span: string) => string;
  /** «Още действия — Иван, 10:00» — `staff.day.rowMenu`. */
  readonly rowMenu: (client: string, time: string) => string;
  /** A reason's words — `staff.day.cancelReasonCode.<word>`. */
  readonly cancelReason: (reason: CancellationReason) => string;
  /** A verb's word, by its catalogue key (`verbKeyOf`). */
  readonly verb: (key: string) => string;
  /** «Група от 2» — `staff.day.partyOf`. */
  readonly partyOf: (count: number) => string;
  /** «Блокирано» — `staff.day.blockedLabel`. */
  readonly blocked: string;
  /** «45 мин», «1 ч», «6 ч 30 мин» — `staff.day.span*`. */
  readonly span: SpanWords;
  /** «2 ч свободни» — `staff.day.daySummaryFree`. */
  readonly daySummaryFree: (span: string) => string;
  /** «12,00 € бакшиши» — `staff.day.daySummaryTips`. */
  readonly daySummaryTips: (amount: string) => string;
  /** «Почивен ден» — `staff.day.offBadge`. */
  readonly offBadge: string;
  /** «Иван почива» — `staff.day.offChip`. */
  readonly offChip: (name: string) => string;
  /** «още 2» — `staff.day.allDayMore`. */
  readonly allDayMore: (count: number) => string;
  /** «Редовен» — `staff.visit.clientReturning`. */
  readonly clientReturning: string;
  /** «Нов час» — `staff.visit.newTitle`. */
  readonly newVisitTitle: string;
  /** «посл. 3 авг» — `staff.visit.lastVisit`. */
  readonly lastVisit: (date: string) => string;
  /** «Скорошни» — `staff.visit.clientsRecent`. */
  readonly recentClients: string;
  /**
   * «{{minutes}} мин», raw off the LOADED table, or `null` while it is not
   * here — the tag is withheld then rather than printed as its key (review r4,
   * `staff.visit.minutes`).
   */
  readonly minutesPattern: string | null;
}

/**
 * Which DS options the scope switcher's «Всички» answers by — the menu's
 * option id for "every chair", never a `BarberId` (a DS option id: the
 * value the `ui-choice-menu` hands back and is handed as its selection).
 */
export const SCOPE_ALL = 'all';

/**
 * The key of the all-day band's «+N» chip — every other chip is keyed by
 * its chair's id; this one opens the date itself (an opaque grid key).
 */
export const ALL_DAY_MORE_KEY = 'more';

/**
 * The discard alert's two answers — values: external contract (the
 * `ui-alert` action ids the alert is handed and hands back on a pick).
 */
export const DiscardAnswer = {
  Discard: 'discard',
  Keep: 'keep',
} as const;

/**
 * What an agenda entry is — the field `agendaRow`: a booked VISIT, or a
 * sellable GAP between them. One run, two row grammars.
 */
export const AgendaRow = {
  Visit: 'VISIT',
  Gap: 'GAP',
  /** Time a chair took off the book — a break, an admin hour (owner, 2026-11-05: blocked time visible in the list too). */
  Block: 'BLOCK',
} as const;
export type AgendaRow = (typeof AgendaRow)[keyof typeof AgendaRow];

export interface DayRowVm {
  readonly agendaRow: typeof AgendaRow.Visit;
  /**
   * THE ROW'S OWN IDENTITY — `appointmentId#barberId`, never the bare
   * appointment id. (owner ruling 2026-09-03)
   *
   * A party is ONE appointment fanned out to one row PER LANE, so keying a row
   * on the aggregate gives two rows the same name. Every lookup that took that
   * name then returned whichever came first: tapping Stefan's block opened
   * Ivan's sheet, `restoreFocusToRow` restored the wrong row, and the grid
   * measured the wrong block while dragging. Two `@for` tracks collided
   * outright — the 3-day and week views merge lanes into one date column, and
   * the agenda groups by start minute, so both of a 16:00 party's rows land in
   * the same list under one key.
   *
   * The lane is what distinguishes them, so the lane is in the key. Anything
   * addressing the AGGREGATE — a gateway call, a pending flag, a row error —
   * wants `appointmentId` and must not use this.
   */
  readonly id: string;
  /** The aggregate this row is a share of. What the server is told about. */
  readonly appointmentId: AppointmentId;
  /**
   * The stored revision the visit was read at (`Appointment.revision`), or
   * `null` where the reader did not say. What a sheet drawn from this row
   * claims on its next save — see `StaffIntent`.
   */
  readonly revision: number | null;
  /** WHERE the visit is — the root's own fact, one place for every chair. */
  readonly locationId: LocationId;
  /**
   * THIS lane's seat. A row is one barber's share of a party, so resolving it
   * must name the seat — the root can hold one answer and a party has several.
   * `null` for a chair holding none of the visit's seats.
   */
  readonly seatId: SeatId | null;
  /**
   * EVERY seat of this row's own chair, in order.
   *
   * `seatId` is only the first, which is right for a lane holding one seat and
   * silently wrong for a father and son in one chair: cancelling that row has
   * two seats to resolve, and naming one of them calls off half a row while
   * reporting success.
   */
  readonly seatIds: readonly SeatId[];
  /**
   * Whether the person in this chair is the BOOKER (an account `self` seat)
   * rather than a guest. A service added from the sheet joins the visit as
   * a seat for the same person, and this is how the command names them.
   */
  readonly selfSeat: boolean;
  /** The account the booking belongs to, or `null` for a walk-in. */
  readonly ownerUserId: UserId | null;
  /**
   * The booker's client RECORD (D29) — what their held coupons, the photos
   * of the visit and the client card are keyed by; `null` for a walk-in.
   */
  readonly ownerCustomerId: CustomerId | null;
  /** Seats in the whole party, across every lane. `1` is the ordinary case. */
  readonly partySize: number;
  /**
   * Seats in THIS row's own chair — which is what the card's `+N` counts.
   *
   * `partySize` spans lanes, and the agenda renders one row per appointment
   * PER LANE, so a two-chair party is already two rows: marking each of them
   * "+1" counts the same people twice and says the run holds four when it
   * holds two. A father and son booked into one chair, though, is genuinely
   * one row holding two seats — and that is the case worth a mark.
   */
  readonly seatsHere: number;
  /** The visit's shop day — what its wall-clock minutes are on (Law 7.3). */
  readonly localDate: LocalDate;
  /** This chair's start on the shop's wall clock, as stored (`startMinutes`). */
  readonly startMinute: MinuteOfDay;
  /** This chair's end on the same axis — `1440` is the closing midnight. */
  readonly endMinute: EndMinute;
  /**
   * The chair's start and end as INSTANTS — for the countdown and the live
   * remaining only (an elapsed-time phrase, T2: pass D D-6.4), read off the
   * stored start (`TimeCoordinate.instantAt`). Every "has it begun / ended"
   * answer is the wall clock's (`VisitListSystem.hasStarted`/`hasEnded`).
   */
  readonly startUtcMs: UtcEpochMs;
  readonly endUtcMs: UtcEpochMs;
  readonly startLabel: string;
  readonly endLabel: string;
  /**
   * THE TAG — how far this chair's run is from the catalogue's length,
   * «−5 мин»: exactly the frame's own mark (owner, 2026-09-10: "the events
   * here should look a lot like the ones in the frame"). `null` when the
   * visit runs as sold, or when the catalogue cannot say.
   */
  readonly tag: string | null;
  /**
   * What this chair's share of the party is worth, formatted.
   *
   * The seat's OWN snapshot (`terms.price`), summed across this lane's seats
   * — not `Appointment.subtotal()`, which is the whole party across every
   * chair and would print Stefan's cut in Ivan's row. `null` when the seats
   * disagree on currency, which the domain treats as a data error rather
   * than a feature.
   */
  readonly priceLabel: string | null;
  /** The same, in cents — for the tip presets — beside its currency. */
  readonly priceCents: PriceCents | null;
  /** The chair's currency — its seats' (the shop's one where it holds none). */
  readonly currency: Currency;
  readonly barberName: string;
  readonly barberAvatarSrc: string | null;
  /** Which of the five identity tones this chair wears — `BarberToneSystem`. */
  readonly barberTone: number;
  /** Set only when the seat runs past midnight — "00:15⁺¹". */
  readonly crossesMidnight: boolean;
  readonly serviceLabel: string;
  /** Who sits in this chair — what the card and the grid print. */
  readonly clientLabel: string;
  /**
   * Who the booking's contact and account answer to: `clientLabel`, but on a
   * chair of companions, where it stays the booker. What the sheet's call
   * button, its photos and a rebooking are named by, beside the booker's number
   * and account.
   */
  readonly contactLabel: string;
  /** Formatted for reading — "+359 88 123 4567". */
  readonly phone: string | null;
  /**
   * The same number in E.164, for the `tel:` href.
   *
   * Separate from `phone` because a dial string must not carry the display
   * formatter's spaces: some dialers take them literally and fail to place
   * the call, and the URI grammar has no room for them either.
   */
  readonly phoneHref: string | null;
  /** The client's address, when they left one. */
  readonly email: Email | null;
  /**
   * Whether this visit was rebooked from a previous one.
   *
   * `Appointment.bookedFrom` — a real, persisted link that round-trips
   * through the repository, not a guess. It is the closest thing the model
   * has to "a regular": a client who came back.
   */
  readonly rebooked: boolean;
  readonly hasNote: boolean;
  /**
   * The note's PROSE — for the visit sheet only.
   *
   * The row shows `hasNote` and nothing else, because that surface is held
   * up in front of the person it describes. A sheet is opened deliberately,
   * by someone who has already decided to look, which is where the mapper's
   * own comment always said this belonged.
   */
  readonly note: string | null;
  readonly partyLabel: string | null;
  /**
   * What this chair's barber was left, summed across the row's own seats —
   * `null` when nothing has been recorded on any of them.
   *
   * Summed rather than taken from one seat because a chair holding a father
   * and son is one barber and one tip in practice; the storage is per seat
   * and the reading is per chair, which is the unit a barber counts in.
   */
  readonly tipLabel: string | null;
  readonly tipCents: PriceCents | null;
  /**
   * WHAT WAS TAKEN OFF the bill, as the server snapshotted it — every
   * discount on the visit, empty at full price. The whole appointment's,
   * not this chair's: a discount is a fact about what is owed, and a party
   * across two chairs owes one bill.
   */
  readonly discounts: readonly VisitEditorDiscount[];
  /**
   * WHAT VOUCHERS PAID — the live draw-downs, each with what this visit may
   * still draw (its own amount plus what the voucher had left).
   */
  readonly vouchers: readonly VisitEditorVoucher[];
  /**
   * WHAT SETTLED THIS CHAIR — who called it off and when, and why, or that
   * nobody came — for the sheet's head. `null` while the chair is live and
   * on a finished visit, whose ending needs no explaining.
   */
  readonly resolution: VisitEditorResolution | null;
  /**
   * THIS lane's seats, one entry each — the editor's service rows.
   *
   * `serviceLabel` joins them with `+` for the agenda card, which is the right
   * shape for a line the eye skims and the wrong one for a list you edit: a
   * leg carries its own duration, its own price and its own barber, and the
   * join throws all three away. Built here rather than in the editor because
   * `dayRowVm` is already holding the seats and the catalog.
   */
  readonly legs: readonly VisitEditorLeg[];
  /**
   * EVERYONE seated in this chair, keyed the way the sheet keys people: an
   * account by its user id, a guest by `guest-<label>`. One entry for the
   * ordinary visit; a party reopened lists each person and names each leg.
   */
  readonly people: readonly VisitEditorClientOption[];
  /** THIS chair's status — the stored tag (`SeatOutcome.summarize`). */
  readonly bookingStatus: BookingStatus;
  /**
   * The ROOT appointment's status, as stored — the party's, which a split
   * party's chair may not share. What the server's save rules read
   * (the save plan's way back, `StaffEditPlanSystem.savePlan`, DEP-3).
   */
  readonly rootBookingStatus: BookingStatus;
  /** Whether the party has walked in — the gate for offering "Done". */
  readonly arrived: boolean;
  /**
   * WHEN they walked in — the stored stamp — or `null`. The sheet's state
   * header reads the waiting time off it; `arrived` alone could only say
   * that it exists.
   */
  readonly arrivedAtUtcMs: UtcEpochMs | null;
  /** The ONE verb this row leads with, or `null` on a settled row. */
  readonly primary: RowVerb | null;
  /** Everything else `canTransition` allows — the overflow menu. */
  readonly overflow: readonly BookingStatus[];
  readonly terminal: boolean;
  /**
   * Already over. ONE definition of past, shared with the grid and the
   * search sheet: a visit is past once it has ENDED, so a cut that began ten
   * minutes ago and is still in the chair is not history.
   */
  readonly past: boolean;
  /**
   * The chair's next unstarted visit — at most one per lane.
   *
   * The run had no present tense at all: nothing separated a cut finished at
   * ten from one three hours out, so answering "who's next" meant reading
   * timestamps down a scrolling list between cuts. This is the row the eye
   * should find in under a second.
   */
  readonly isNext: boolean;
  /**
   * Started and not yet over — someone is in this chair right now.
   *
   * The third time-state, and the one an agenda ordered by START cannot
   * otherwise show: a 12:00 cut is still running when the 12:30 group is
   * read, and without this the earlier card looks as finished as the 10:00
   * one. It is also what makes overlap legible in a list — the grid views
   * draw simultaneity spatially, the agenda says it in words.
   */
  readonly live: boolean;
}

/**
 * One start time, and everything that begins at it.
 *
 * ### Why the agenda groups by TIME rather than by chair
 * The run used to be one list per barber, stacked. That reads as three
 * schedules printed on one page: the same 16:00 appears three times, the now
 * line has to be drawn three times to mean one thing, and answering "what is
 * happening at four" means scanning three places. Grouping by start time is
 * how every calendar agenda worth copying does it — the time is said once,
 * in the heading, and concurrency becomes something you SEE rather than
 * something you reconstruct.
 *
 * It also gives the time back to the card: with the hour in the heading, the
 * card's width is free for the fields the viewer actually chose.
 */
export interface AgendaGroupVm {
  /** `String(startMinutes)` — the heading's DOM id segment and its track key. */
  readonly key: string;
  readonly timeLabel: string;
  /** The minute of the shop's day everything in the group begins at. */
  readonly startMinutes: MinuteOfDay;
  /** `true` once the clock has reached this heading (`VisitListSystem.hasStarted`). */
  readonly past: boolean;
  readonly items: readonly AgendaItemVm[];
}

/** A sellable hole. Same row grammar, no segment fill (§4.4). */
export interface GapRowVm {
  readonly agendaRow: typeof AgendaRow.Gap;
  readonly id: string;
  readonly startLabel: string;
  readonly endLabel: string;
  readonly minutes: MinuteCount;
  /** How long the hole runs, in words — «45 мин», «1 ч». */
  readonly spanLabel: string;
  /** Where the hole begins on the shop's wall clock — the run's order. */
  readonly startMinutes: MinuteOfDay;
  /** Where it ends — a block from it takes the whole hole. */
  readonly endMinutes: EndMinute;
  /**
   * Where «Нов час» from it starts: the first minute a new client can take
   * after the barber's turnaround (`GridLayoutSystem.bookableFrom`) — 11:45
   * in a hole that opens at 11:35 behind a 10-minute reset.
   */
  readonly bookableFromMinutes: MinuteOfDay;
  /** The chair it is free on — what a booking or a block from it seats. */
  readonly barberId: BarberId;
  /**
   * Already elapsed — the run's one definition of past, shared with visits.
   *
   * An elapsed hole is a RECORD: the chair sat empty and nobody filled it.
   * A future hole is INVENTORY. Same geometry, opposite tense, and the card
   * says so rather than rendering an offer nobody can take.
   */
  readonly past: boolean;
  readonly sellable: boolean;
  /**
   * WHOSE chair is free (owner ruling 2026-08-20).
   *
   * Unattributed free time is meaningless the moment the agenda stops being
   * one list per barber: "110 мин свободни" sitting between two of Niko's
   * cuts says nothing about which chair a walk-in could take.
   */
  readonly barberName: string;
  readonly barberAvatarSrc: string | null;
  readonly barberTone: number;
}

/**
 * A BLOCK in the run — time a chair took off the book, on the shop's wall
 * clock. The grid's block said in a line: the word, how long, whose chair;
 * a press opens it in the block editor, as the grid's does. Its id is the
 * grid block's (`block:<chair>:<day>:<start minute>`), so both open it
 * through one door.
 */
export interface BlockRowVm {
  readonly agendaRow: typeof AgendaRow.Block;
  readonly id: string;
  readonly startMinutes: MinuteOfDay;
  /** The clock, as a visit's: start over end on the trailing side. */
  readonly startLabel: string;
  readonly endLabel: string;
  /** «Блокирано». */
  readonly label: string;
  /** «1 ч». */
  readonly spanLabel: string;
  /** «Блокирано, 12:00–13:00». */
  readonly accessibleName: string;
  /** The block has ended on the shop's clock. */
  readonly past: boolean;
  readonly barberName: string;
  readonly barberTone: number;
}

export type RunEntryVm = DayRowVm | GapRowVm | BlockRowVm;

/**
 * WHAT A VISIT'S CARD PRINTS, as the agenda's switches and the clock leave it —
 * built with the group, in the `computed()` that reads the tick, so the words
 * that say "right now" stay true and every row keeps its `@for` identity.
 */
export interface AgendaCardVm {
  /** The row's accessible name — and the only place its state is still said. */
  readonly rowLabel: string;
  /** The glyph of an hour that did not happen, on the client's disc. */
  readonly stateIcon: UiIconName | null;
  /** An hour that did not happen: the head is struck through. */
  readonly struck: boolean;
  /** The lines under the name, each with something to say and its switch on. */
  readonly lines: readonly StaffEventLine[];
  /** «+1» — the rest of this chair's seats, on the face's badge. */
  readonly guestsMark: string;
  readonly start: string | null;
  /** The end, marked when it falls on the next day: «00:15⁺¹». */
  readonly end: string | null;
  /** The state's one word, else the relative time, else nothing. */
  readonly gloss: string | null;
  /** The gloss says a state, not a time. */
  readonly glossState: boolean;
  /** Is there anything for the foot to hold? */
  readonly foot: boolean;
  readonly price: string | null;
  readonly partyShare: string | null;
  /** How far the run is from the catalogue — never on an hour that did not happen. */
  readonly tag: string | null;
  readonly marks: readonly UiIconName[];
}

/** A visit as the agenda draws it: the row, and its card's words. */
export type AgendaVisitVm = DayRowVm & { readonly card: AgendaCardVm };

/** One entry of a time group. */
export type AgendaItemVm = AgendaVisitVm | GapRowVm | BlockRowVm;

/** One neighbour on a sheet's frame — a name, a span on its axis, a tone. */
export interface FrameNeighbour {
  readonly name: string;
  readonly startMinute: MinuteOfDay;
  readonly endMinute: EndMinute;
  readonly tone: number;
}

export interface LaneVm {
  readonly barberId: BarberId;
  readonly barberName: string;
  readonly avatarSrc: string | null;
  /** Visits and gaps interleaved in clock order — the COMPLETE run. */
  readonly entries: readonly RunEntryVm[];
  readonly rostered: boolean;
  readonly failed: boolean;
}

/**
 * Every booking state's glyph — the ONE table, so a state wears the same
 * mark on a calendar block, a sheet and a search row. Completed is the
 * registry's «done» (a filled end), never the bare tick a selection draws.
 */
export const BOOKING_STATUS_ICONS = {
  [BookingStatus.Pending]: 'visit.pending',
  [BookingStatus.Confirmed]: 'visit.confirmed',
  [BookingStatus.Completed]: 'visit.completed',
  [BookingStatus.NoShow]: 'visit.noShow',
  [BookingStatus.Cancelled]: 'visit.cancelled',
} as const satisfies Record<BookingStatus, UiIconName>;

/** One state in the schedule's status filter: its mark, its word, and whether it is drawn. */
export interface StatusFilterRowVm {
  readonly bookingStatus: BookingStatus;
  readonly glyph: UiIconName;
  /** «Отказани». */
  readonly label: string;
  readonly shown: boolean;
}

/**
 * The glyph that doubles a TERMINAL state on a calendar block.
 *
 * Live states get none: a block that is simply filled and unmarked is the
 * ordinary case, and marking it would spend a signal on "nothing has
 * happened yet".
 */
export const STATUS_ICONS: Partial<Record<BookingStatus, UiIconName>> = {
  [BookingStatus.Completed]: BOOKING_STATUS_ICONS[BookingStatus.Completed],
  [BookingStatus.NoShow]: BOOKING_STATUS_ICONS[BookingStatus.NoShow],
  // It was missing (found 2026-09-24): a cancelled block drew no glyph at
  // all while the card's face and the sheet carried one.
  [BookingStatus.Cancelled]: BOOKING_STATUS_ICONS[BookingStatus.Cancelled],
};
