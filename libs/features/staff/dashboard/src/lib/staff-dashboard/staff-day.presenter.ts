import {
  GridEvent as GridEventTag,
  type MinuteRange,
  type Money,
  Seat,
  type ShopNow,
} from '@core/components';
import type { Appointment } from '@core/entities';
import {
  type AppointmentId,
  type BarberId,
  BookingStatus,
  DraftPersonKey,
  type EndMinute,
  type LocalDate,
  type MinuteOfDay,
  type UserId,
  UtcEpochMs,
} from '@core/primitives';
import { BusySystem, PhoneSystem, VisitStorySystem } from '@core/systems';
import type { UiIconName } from '@creativo/ui/controls';
import { formatCents, formatWallClock } from '@creativo/ui/wall-clock';
import {
  bookingStatusWords,
  cancellationReasonWords,
  relativeTime,
} from '@creativo/infrastructure/i18n';
import {
  firstNameOf,
  hollowStatus,
  type StaffEventLine,
} from '@creativo/features/shared/visits';
import { ChairMoment } from '@core/components';
import type { AgendaField } from '../agenda-fields';
import { ROW_VERB_WORD, type RowVerb } from '../row-verb';
import { spanCopyOf, spanWords } from '../shared/span.words';
import type { AllDayEntry, GridEvent } from '../time-grid/staff-time-grid';
import type {
  VisitEditorClientOption,
  VisitEditorVerb,
} from '../visit-editor/staff-visit-editor';
import {
  ALL_DAY_MORE_KEY,
  type AgendaCardVm,
  AgendaRow,
  type DayRowVm,
  type FrameNeighbour,
  type LaneVm,
  STATUS_ICONS,
  type StaffDayWords,
  type StaffTranslate,
} from './staff-day.vm';
import type { StaffCatalogNames } from './staff-day-chrome.presenter';

/*
 * THE STAFF DAY, WORDED (Law 10). The row's state, its verbs, what is next and
 * what is live are `VisitStorySystem`'s, `VisitListSystem`'s and
 * `AppointmentLifecycleSystem`'s; these functions turn the answers into what
 * the agenda's card, the grid's block and the sheets print. Pure — the words,
 * the catalogue's lookups, the agenda's switches and `now` arrive as inputs,
 * and the page calls them inside the `computed()`s that read those.
 */

/** The day's words, from the catalogue as it stands. */
export function staffDayWordsOf(
  translate: StaffTranslate,
  minutesPattern: string | null,
): StaffDayWords {
  return {
    unnamedClient: translate('staff.day.unnamedClient'),
    statusName: (status) =>
      translate(`appointments.status.${bookingStatusWords[status]}`),
    exception: (status) =>
      translate(`staff.day.exception.${bookingStatusWords[status]}`),
    noShow: translate('staff.visit.resolution.noShow'),
    arrived: translate('staff.day.statusArrived'),
    remaining: (span) => translate('staff.day.agendaRemaining', { span }),
    rowMenu: (client, time) => translate('staff.day.rowMenu', { client, time }),
    cancelReason: (reason) =>
      translate(
        `staff.day.cancelReasonCode.${cancellationReasonWords[reason]}`,
      ),
    verb: (key) => translate(key),
    partyOf: (count) => translate('staff.day.partyOf', { count }),
    blocked: translate('staff.day.blockedLabel'),
    span: spanCopyOf(translate),
    daySummaryFree: (span) => translate('staff.day.daySummaryFree', { span }),
    daySummaryTips: (amount) =>
      translate('staff.day.daySummaryTips', { amount }),
    offBadge: translate('staff.day.offBadge'),
    offChip: (name) => translate('staff.day.offChip', { name }),
    allDayMore: (count) => translate('staff.day.allDayMore', { count }),
    clientReturning: translate('staff.visit.clientReturning'),
    newVisitTitle: translate('staff.visit.newTitle'),
    lastVisit: (date) => translate('staff.visit.lastVisit', { date }),
    recentClients: translate('staff.visit.clientsRecent'),
    minutesPattern,
  };
}

/**
 * The page's clock face — «13:00», 24-hour: in the reader's locale on the
 * rows, in `en-GB` in a block's accessible name.
 */
export const CLOCK_FACE: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

// ── The agenda's card ─────────────────────────────────────────────────

/** The agenda's switches (`AgendaFields.visible`). */
export type AgendaFlags = Readonly<Record<AgendaField, boolean>>;

/** What a card is worded from. */
export interface AgendaCardInput {
  readonly flags: AgendaFlags;
  readonly words: StaffDayWords;
  /** The page's tick — what keeps the relative time true. */
  readonly nowUtcMs: UtcEpochMs;
  readonly lang: string;
}

/**
 * AN HOUR THAT DID NOT HAPPEN, SAID IN ONE WORD (owner, 2026-09-24: "so
 * it's instantly recognised") — «Отказан», «Не дойде». The card puts it
 * where the countdown stood (a countdown to a visit that will not happen
 * was the card's loudest lie), the grid's block on its second line;
 * `null` for every live or finished visit. ONE word, not «Отказан от
 * салона»: at a phone's width the phrase widened the clock's column and
 * broke the service line under the name in two — and whose act it was
 * is the sheet's head, one tap away.
 */
export function stateLabel(
  entry: { readonly bookingStatus: BookingStatus },
  words: StaffDayWords,
): string | null {
  if (entry.bookingStatus === BookingStatus.NoShow) return words.noShow;
  if (entry.bookingStatus === BookingStatus.Cancelled) {
    return words.statusName(BookingStatus.Cancelled);
  }
  return null;
}

/**
 * THE STATE ON THE FACE (owner, 2026-09-24: "so it's instantly
 * recognised") — the glyph of an hour that did not happen, as a badge on
 * the client's disc, at the leading edge where a glance starts. The same
 * two glyphs the grid's block and the sheet use; `null` for everything
 * live or finished.
 */
export function stateIcon(entry: {
  readonly bookingStatus: BookingStatus;
}): UiIconName | null {
  if (entry.bookingStatus === BookingStatus.Cancelled) {
    return 'visit.cancelled';
  }
  if (entry.bookingStatus === BookingStatus.NoShow) return 'visit.noShow';
  return null;
}

/**
 * WHEN this visit is, said relatively — the third line of the interval.
 *
 * A live cut counts down to its END: the barber is standing in it and wants
 * the time left, not the time since. Everything else counts to its start,
 * which `Intl` renders as "утре", "след 2 ч", "преди 20 мин". `short`,
 * because this shares a narrow column with the clock times above it.
 */
export function whenWords(
  entry: DayRowVm,
  nowUtcMs: UtcEpochMs,
  lang: string,
  words: StaffDayWords,
): string {
  const moment = VisitStorySystem.chairMoment(entry, entry.arrived, entry.live);
  if (moment === ChairMoment.InChair) {
    // The time LEFT is real elapsed time to the chair's end — an
    // elapsed-time phrase on instants (T2, D-6.4).
    const minutes = Math.max(
      0,
      Math.round(UtcEpochMs.elapsedMs(nowUtcMs, entry.endUtcMs) / 60_000),
    );
    return words.remaining(spanWords(minutes, words.span));
  }
  // THEY ARE HERE — and that displaces the countdown rather than adding a
  // line to the card. The gloss answers "when, relative to now"; once
  // someone is in the shop, "in 20 min" is not merely less useful than
  // "arrived", it is WRONG, because the thing it counts down to has
  // already happened. This is also where the word went when the state
  // stopped being a fact row: every other state is carried by the card's
  // form, but arrival is the one that is about RIGHT NOW, and form is
  // already spoken for by `data-live` and `data-next`.
  if (moment === ChairMoment.Arrived) return words.arrived;
  return relativeTime(entry.startUtcMs, nowUtcMs, lang, 'short');
}

/**
 * The exception word, and it is NOT a field.
 *
 * It prints only for states that went other than to plan: confirmed and
 * completed say nothing, because "this booking is a booking" is not news on
 * nine cards in ten.
 */
export function exceptionWord(
  status: BookingStatus,
  words: StaffDayWords,
): string | null {
  if (status === BookingStatus.Confirmed || status === BookingStatus.Completed)
    return null;
  return words.exception(status);
}

/**
 * THE ROW'S ACCESSIBLE NAME — and the only place the state is still said.
 *
 * The state left the fact column because it read as one more field there,
 * and it is carried by the card's FORM now: hollow for a cancellation or a
 * no-show, dashed for pending, struck through for a cancellation
 * specifically. Not one of those reaches a screen reader —
 * `text-decoration` is not announced and a missing background certainly is
 * not — so a cancelled booking would have been indistinguishable from a
 * live one.
 *
 * It rides the name rather than a visually-hidden node in the column: the
 * row already has an explicit `aria-label`, and a second hidden line in a
 * list whose every child is a fact was exactly the arrangement the sighted
 * card just got rid of.
 */
export function rowName(entry: DayRowVm, words: StaffDayWords): string {
  const base = words.rowMenu(entry.clientLabel, entry.startLabel);
  const note = rowStateNote(entry, words);
  return note === null ? base : `${base}, ${note}`;
}

/**
 * Arrival is NOT here any more. It is visible text in the trailing gloss
 * (`whenWords`), so repeating it here would announce it twice to a screen
 * reader. What is left is exactly the set of states the card says with its
 * FORM — hollow, hollow-and-struck, dashed — none of which a screen reader can
 * perceive.
 */
export function rowStateNote(
  entry: { readonly bookingStatus: BookingStatus },
  words: StaffDayWords,
): string | null {
  return exceptionWord(entry.bookingStatus, words);
}

/**
 * The marks that ride the body row's trailing edge.
 *
 * TWO THINGS ONLY, and the rule is the owner's: an icon earns its place for
 * a note, for a repeat, and for a blocker. Nothing else.
 *
 * Status is NOT among them any more. It was a glyph on every card, which
 * made the foot row texture rather than signal; it is a word now, and only
 * for the states worth interrupting a glance for — see `rowStateNote`.
 *
 * Both survivors are facts the model actually holds: a note is
 * `contact.note`, a repeat is `Appointment.bookedFrom` (persisted and
 * round-tripped). There is no blocker glyph HERE because a block is not a
 * visit — it is its own object, and `staff-time-grid` draws it on the axis
 * where it has an extent. And no paid glyph, because payment is not
 * modelled anywhere in this codebase; an icon that can never appear is a
 * claim about the schema, not a feature.
 */
export function rowMarks(
  entry: DayRowVm,
  flags: AgendaFlags,
): readonly UiIconName[] {
  const icons: UiIconName[] = [];
  // THE TWO STATES THAT ARE NOT ORDINARY, and they lead — a row that did
  // not happen is the first thing to know about it.
  //
  // A status glyph was removed from this foot once, and correctly: it fired
  // on EVERY card, because every booking has a status, and a mark on 100%
  // of rows is texture rather than signal. These two are the opposite case.
  // They fire on the small minority of rows where something went wrong, and
  // they are the second channel for a state the card otherwise says only in
  // FORM — hollow, and struck through for a cancellation. Form reads across
  // the room; a glyph names which of the two it is without a word.
  //
  // …and since 2026-09-24 they ride the client's FACE (`stateIcon`), where
  // scanning starts: the foot keeps them only when faces are switched off.
  const state = stateIcon(entry);
  if (state !== null && !flags.avatar) icons.push(state);
  if (entry.rebooked) icons.push('visit.repeat');
  // The note is a MARK, not a row. Its text was a clamped line in the fact
  // column — the one fact there that could not be read in full, sitting in
  // a column whose whole premise is that everything gets its place. A mark
  // says "there is one" honestly; the sheet says what it is.
  if (flags.note && entry.hasNote) icons.push('visit.note');
  return icons;
}

/**
 * Is there anything for the foot to hold?
 *
 * With price, marks and the barber's face all switched off the row still
 * rendered — an empty flex box of zero height, which sounds free and is
 * not: the card's `row-gap` sits on BOTH sides of it, so every card carried
 * 8px of dead space (measured) for a row with nothing in it.
 *
 * A tag counts whether or not the card prints it, which is today's answer on
 * an hour that did not happen (Bug B2 of the F-08 inventory, not fixed here).
 */
export function footShown(entry: DayRowVm, flags: AgendaFlags): boolean {
  return (
    (flags.price && !!entry.priceLabel) ||
    // The frame's tag is a mark, never a field: it shows whenever it is.
    entry.tag !== null ||
    // ⚠ The party share joined the foot (owner ruling 2026-09-04); a card
    // whose only mark is `1 / 2` must still get a row to put it on.
    (flags.party && !!entry.partyLabel) ||
    rowMarks(entry, flags).length > 0 ||
    flags.barberAvatar
  );
}

/**
 * The lines under the client's name, in the card's fixed order — the
 * email, the phone, the service — each only when its switch is on and it
 * has something to say. A line that is not rendered costs no height.
 */
export function factLines(
  entry: DayRowVm,
  flags: AgendaFlags,
): readonly StaffEventLine[] {
  const lines: StaffEventLine[] = [];
  if (flags.email && entry.email) {
    lines.push({
      text: entry.email,
      icon: 'contact.email',
      testId: 'staff-visit-email',
    });
  }
  if (flags.phone && entry.phone) {
    lines.push({
      text: entry.phone,
      icon: 'contact.phone',
      testId: 'staff-visit-phone',
    });
  }
  if (flags.service) lines.push({ text: entry.serviceLabel });
  return lines;
}

/** The end, marked when it falls on the next day. */
export function endWords(entry: DayRowVm): string {
  return entry.crossesMidnight ? `${entry.endLabel}⁺¹` : entry.endLabel;
}

/** Everything a visit's card prints, under the switches and at the tick given. */
export function agendaCardVm(
  entry: DayRowVm,
  input: AgendaCardInput,
): AgendaCardVm {
  const { flags, words } = input;
  const state = stateLabel(entry, words);
  // An hour that did not happen — struck on the card's head (staff-event-head).
  const hollow = hollowStatus(entry.bookingStatus);
  return {
    rowLabel: rowName(entry, words),
    stateIcon: stateIcon(entry),
    struck: hollow,
    lines: factLines(entry, flags),
    guestsMark: `+${entry.seatsHere - 1}`,
    start: flags.timeStart ? entry.startLabel : null,
    end: flags.timeEnd ? endWords(entry) : null,
    gloss:
      state ??
      (flags.timeRelative
        ? whenWords(entry, input.nowUtcMs, input.lang, words)
        : null),
    glossState: state !== null,
    foot: footShown(entry, flags),
    price: flags.price && entry.priceLabel ? entry.priceLabel : null,
    partyShare: flags.party && entry.partyLabel ? entry.partyLabel : null,
    // Not on an hour that did not happen (2026-09-24): how far a run is from
    // the catalogue's length means nothing for a visit that will not run.
    tag: entry.tag && !hollow ? entry.tag : null,
    marks: rowMarks(entry, flags),
  };
}

// ── The grid's blocks ─────────────────────────────────────────────────

/**
 * A wall-clock minute of a shop day as an accessible name reads it —
 * «13:00» in `en-GB`, whatever the reader's locale (a fixed 24-hour face,
 * not a language): a laptop left in UTC must not put a barber's lunch two
 * hours out. The closing midnight reads «00:00».
 */
function nameClock(
  localDate: LocalDate,
  minute: MinuteOfDay | EndMinute,
): string {
  return formatWallClock(localDate, minute, 'en-GB', CLOCK_FACE);
}

/**
 * The block's story in words — client, service, span, and the state.
 *
 * The visual block drops its service line when it is short and says its
 * state only in form and a glyph; none of that reaches a screen reader, so
 * the whole fact is composed here.
 */
export function blockName(row: DayRowVm, words: StaffDayWords): string {
  return [
    row.clientLabel,
    row.serviceLabel,
    `${row.startLabel}–${row.endLabel}`,
    row.barberName,
    words.statusName(row.bookingStatus),
    // The party share is drawn as a glyph and a ratio, and a short block
    // drops it entirely — neither reaches a screen reader, and "this is one
    // of two seats" is exactly the fact that changes what a move means.
    ...(row.partySize > 1 ? [words.partyOf(row.partySize)] : []),
  ].join(', ');
}

/** A visit's row, as a block the grid can draw. */
export function gridVisitEvent(
  row: DayRowVm,
  attribute: boolean,
  words: StaffDayWords,
): GridEvent {
  return {
    id: row.id,
    gridEvent: GridEventTag.Visit,
    // The seat's own wall clock, as stored (Law 7.3).
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    title: row.clientLabel,
    // A cancelled or missed hour says so on the line under the name —
    // the block's clock is withheld on a narrow column, and the
    // service matters less than that it did not happen (2026-09-24).
    detail: stateLabel(row, words) ?? row.serviceLabel,
    attribution: attribute ? row.barberName : null,
    // The stored tag; the grid prints its lowercase DOM word.
    bookingStatus: row.bookingStatus,
    terminal: row.terminal,
    barberTone: row.barberTone,
    // The hour, not the outcome: whatever became of it, a 10:00 slot is
    // behind us by noon. Same rule the search sheet sorts by — the
    // row's own (`VisitStorySystem.hasEnded`, on the wall clock).
    past: row.past,
    accessibleName: blockName(row, words),
    // One vocabulary across the three surfaces (owner review
    // 2026-09-08): the sheet's arrived glyph is the block's too, for as
    // long as the visit is live.
    statusIcon: VisitStorySystem.arrivedOpen(row, row.arrived)
      ? 'visit.arrived'
      : (STATUS_ICONS[row.bookingStatus] ?? null),
    partyLabel: row.partyLabel,
  };
}

/** Whose carve-out a block is, and on which day. */
export interface GridBlockFacts {
  readonly barberId: BarberId;
  readonly barberName: string;
  readonly localDate: LocalDate;
  readonly shopNow: ShopNow | null;
  readonly attribute: boolean;
}

/** A lane's break or admin hour, as a block the grid can draw. */
export function gridBlockEvent(
  interval: MinuteRange,
  facts: GridBlockFacts,
  words: StaffDayWords,
): GridEvent {
  const { barberId, localDate, shopNow } = facts;
  const from = nameClock(localDate, interval.startMinutes);
  const to = nameClock(localDate, interval.endMinutes);
  return {
    // Stable across a re-render, and unique per lane and DAY: a
    // barber's day holds at most one exception document, so the chair,
    // the day and the start name this block uniquely without inventing
    // an id the store cannot resolve back to anything — and the day
    // keeps a block of another visible date from answering for the
    // shown day's (`openBlock`, DEP-11).
    id: `block:${barberId}:${localDate}:${interval.startMinutes}`,
    gridEvent: GridEventTag.Block,
    // The store's own wall-clock minutes — a block that closes at
    // midnight ends at 1440, anchored on its day.
    startMinute: interval.startMinutes,
    endMinute: interval.endMinutes,
    title: words.blocked,
    detail: null,
    // A carve-out is the opposite of a booking; identity is not its
    // business, and the rail stays neutral (the grid's own ruling).
    barberTone: null,
    attribution: facts.attribute ? facts.barberName : null,
    bookingStatus: null,
    terminal: false,
    past:
      shopNow !== null &&
      VisitStorySystem.hasEnded(
        { localDate, minute: interval.endMinutes },
        shopNow,
      ),
    // Says WHAT it is and WHEN — the channel the shading never had.
    accessibleName: `${words.blocked}, ${from}–${to}`,
    statusIcon: 'booking.blocked',
    // A carve-out is time, not a booking — there is no party to be part of.
    partyLabel: null,
  };
}

// ── The all-day band ──────────────────────────────────────────────────

/**
 * In the day view a column IS a barber, so the chip names the fact rather than
 * the person — the column head above it is already the name.
 */
export function offChairEntry(
  barberId: BarberId,
  name: string,
  tone: number,
  words: StaffDayWords,
): AllDayEntry {
  return {
    key: barberId,
    label: words.offBadge,
    shortLabel: words.offBadge,
    initial: firstNameOf(name).charAt(0),
    tone,
    accessibleName: words.offBadge,
  };
}

/**
 * A DATE column: the chip says WHO — the first name where the cell can carry a
 * word, the initial on the chair's tone disc where it cannot (§8) — and the
 * whole sentence stays the accessible name.
 */
export function offDateEntry(
  barberId: BarberId,
  name: string,
  tone: number,
  words: StaffDayWords,
): AllDayEntry {
  const first = firstNameOf(name);
  return {
    key: barberId,
    label: words.offChip(first),
    shortLabel: first,
    initial: first.charAt(0),
    tone,
    accessibleName: words.offChip(name),
  };
}

/** «+N» for the chairs past the band's cap — a fact about no one. */
export function allDayMoreEntry(
  rest: number,
  words: StaffDayWords,
): AllDayEntry {
  return {
    key: ALL_DAY_MORE_KEY,
    label: `+${rest}`,
    shortLabel: `+${rest}`,
    initial: `+${rest}`,
    tone: null,
    accessibleName: words.allDayMore(rest),
  };
}

/** One chair off the shown day, as its all-day row names it. */
export interface RestingChairVm {
  readonly id: BarberId;
  readonly name: string;
  readonly tone: number;
}

/**
 * Barbers with neither a window nor a booking (`StaffDayStore.offToday`), each
 * by the catalogue's name — by its id when the catalogue has no such chair.
 */
export function restingChairs(
  ids: readonly BarberId[],
  chairs: readonly {
    readonly id: BarberId;
    readonly name: Parameters<StaffCatalogNames['text']>[0];
  }[],
  names: Pick<StaffCatalogNames, 'text'>,
  toneOf: (id: BarberId) => number,
): readonly RestingChairVm[] {
  const byId = new Map(chairs.map((chair) => [chair.id, chair] as const));
  return ids
    .map((id) => {
      const chair = byId.get(id);
      return {
        id,
        name: chair ? names.text(chair.name) : id,
        tone: toneOf(id),
      };
    })
    .filter((barber) => barber.name.length > 0);
}

// ── The day's line ────────────────────────────────────────────────────

/** «2 ч свободни» — the unsold minutes the system summed. */
export function daySummaryWords(
  freeMinutes: number,
  words: StaffDayWords,
): string {
  return words.daySummaryFree(spanWords(freeMinutes, words.span));
}

/** «12,00 € бакшиши» — the day's recorded tips, as the system totalled them. */
export function dayTipsWords(
  total: Money,
  lang: string,
  words: StaffDayWords,
): string {
  return words.daySummaryTips(
    formatCents(total.amountCents, total.currency, lang),
  );
}

// ── The sheets' words ─────────────────────────────────────────────────

/**
 * The WORD for a verb. Reopening a no-show is not "confirm" — it is undoing
 * a judgement, and it says so.
 */
export function verbKeyOf(status: BookingStatus, verb: RowVerb): string {
  if (verb === BookingStatus.Confirmed && status === BookingStatus.NoShow) {
    return 'staff.day.act.reopen';
  }
  if (verb === BookingStatus.Confirmed && status === BookingStatus.Completed) {
    return 'staff.day.act.reopenCompleted';
  }
  if (verb === BookingStatus.Confirmed && status === BookingStatus.Cancelled) {
    return 'staff.day.act.reinstate';
  }
  return 'staff.day.act.' + ROW_VERB_WORD[verb];
}

export function editorVerb(
  row: { readonly bookingStatus: BookingStatus },
  verb: RowVerb,
  words: StaffDayWords,
): VisitEditorVerb {
  return {
    // The verb itself — what the sheet emits back through `(acted)`.
    rowVerb: verb,
    label: words.verb(verbKeyOf(row.bookingStatus, verb)),
    // ONE red in the menu (owner review, 2026-09-08). Cancelling is the
    // destructive act: it is terminal and it pages the waitlist. A no-show
    // is a fact about the client, and the graph keeps a correction edge for
    // it, so it reads as an ordinary verb rather than a second warning.
    destructive: verb === BookingStatus.Cancelled,
  };
}

/** The words the visit sheet's head and menu print for a row. */
export function visitEditorWords(
  row: DayRowVm,
  words: StaffDayWords,
): {
  readonly clientMeta: string | null;
  readonly statusLabel: string;
  readonly primaryVerb: VisitEditorVerb | null;
  readonly overflowVerbs: readonly VisitEditorVerb[];
} {
  return {
    // `rebooked` is the one durable fact the shop holds about a person here:
    // a client who came back. Anything richer needs a history read the sheet
    // does not have, so it says the true thing or nothing.
    clientMeta: row.rebooked ? words.clientReturning : null,
    statusLabel: words.statusName(row.bookingStatus),
    // Regime A, carried through unchanged. `offeredVerbs` already decided
    // what is legal and `leadVerb` already decided what leads; the editor
    // renders that decision rather than re-taking it.
    primaryVerb: row.primary ? editorVerb(row, row.primary, words) : null,
    overflowVerbs: row.overflow.map((verb) => editorVerb(row, verb, words)),
  };
}

/** Another chair's row of the same booking, as the sheet lists it. */
export function peerRowOf(entry: DayRowVm) {
  return {
    rowId: entry.id,
    clientLabel: entry.clientLabel,
    chairName: entry.barberName,
    chairTone: entry.barberTone,
    timeLabel: `${entry.startLabel} – ${entry.endLabel}`,
  };
}

/**
 * WHAT OCCUPIES `barberId`'s CHAIR beside the visit `excludeId` names
 * (`null`: a new one), read off one day's documents —
 * `BusySystem.chairOccupants`, the server's collision rule (DEP-2): one
 * neighbour per seat the chair holds, on the seat's own wall clock.
 */
export function occupantNeighbours(
  appointments: readonly Appointment[],
  barberId: BarberId,
  excludeId: AppointmentId | null,
  tone: number,
  words: StaffDayWords,
): FrameNeighbour[] {
  return BusySystem.chairOccupants(appointments, barberId, excludeId).map(
    ({ appointment, seat }) => ({
      name: appointment.contactName ?? words.unnamedClient,
      // The seat's own wall clock — the frame's axis (Law 7.3).
      startMinute: seat.startMinutes,
      endMinute: Seat.endMinutes(seat),
      tone,
    }),
  );
}

/**
 * The same answer on the shown day, where the agenda already drew each
 * chair's rows: the lane's visit rows whose appointment occupies the chair
 * by `BusySystem.chairOccupants` over the store lane's documents (the
 * ones the rows were drawn from) — one neighbour per row, on the row's
 * own wall clock. Which rows are drawn is the agenda's; which occupy is
 * the system's.
 */
export function occupyingRows(
  lane: LaneVm | undefined,
  appointments: readonly Appointment[],
  excludeId: AppointmentId | null,
): FrameNeighbour[] {
  if (lane === undefined) return [];
  const occupying = new Set<AppointmentId>();
  for (const { appointment } of BusySystem.chairOccupants(
    appointments,
    lane.barberId,
    excludeId,
  )) {
    occupying.add(appointment.id);
  }
  return lane.entries
    .filter(
      (entry): entry is DayRowVm =>
        entry.agendaRow === AgendaRow.Visit &&
        occupying.has(entry.appointmentId),
    )
    .map((entry) => ({
      name: entry.clientLabel,
      // The visit's own wall clock, as stored (Law 7.3).
      startMinute: entry.startMinute,
      endMinute: entry.endMinute,
      tone: entry.barberTone,
    }));
}

/** What a client option on the add-client page is worded from. */
export interface RecentClientWords {
  readonly words: StaffDayWords;
  /** A wall-clock reading prints nothing before the zone is known (D-6.2). */
  readonly zoneKnown: boolean;
  readonly locale: string;
}

/** A recent visitor on «Скорошни»: the last contact, and the day of the visit. */
export function recentClientOption(
  userId: UserId,
  visit: Appointment,
  input: RecentClientWords,
): VisitEditorClientOption {
  const phone = visit.contactPhone;
  return {
    id: DraftPersonKey.account(userId),
    label: visit.contactName ?? input.words.unnamedClient,
    phone: phone === null ? null : PhoneSystem.formatInternational(phone),
    phoneHref: phone,
    meta: input.words.lastVisit(
      // `3 авг` — the day a person was last here, as stored.
      input.zoneKnown
        ? formatWallClock(visit.localDate, null, input.locale, {
            day: 'numeric',
            month: 'short',
          })
        : '',
    ),
    email: visit.contactEmail,
  };
}

/** An account of the book — searched by the omnibox, never listed. */
export function bookClientOption(
  userId: UserId,
  visit: Appointment,
  contactName: string,
): VisitEditorClientOption {
  const phone = visit.contactPhone;
  return {
    id: DraftPersonKey.account(userId),
    label: contactName,
    phone: phone === null ? null : PhoneSystem.formatInternational(phone),
    phoneHref: phone,
    meta: null,
    email: visit.contactEmail,
  };
}
