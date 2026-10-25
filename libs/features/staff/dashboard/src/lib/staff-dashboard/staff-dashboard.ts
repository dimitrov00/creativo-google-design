import {
  StaffDayPill,
  formatDayPill,
  formatDayPillRange,
} from '../day-pill/staff-day-pill';
import { runViewTransition } from '../shared/view-transition';
import { fill } from '../time-grid/grid-gesture';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import {
  type Appointment,
  type AppointmentPhoto,
  Profile,
  type ServiceCategory,
  type User,
} from '@core/entities';
import {
  type AppointmentId,
  type AppointmentPhotoId,
  BarberId,
  BookingStatus,
  Currency,
  type CustomerId,
  DraftPersonKey,
  DurationMinutes,
  EndMinute,
  LocalDate,
  type LocationId,
  MinuteCount,
  MinuteOfDay,
  type PriceCents,
  type Result,
  SeatId,
  type SeatKeyText,
  type ServiceId,
  ServiceVariantId,
  Tag,
  TrackMinute,
  type UserId,
  UtcEpochMs,
  defect,
} from '@core/primitives';
import {
  BookingErrorCode,
  PipelineError,
  PipelineErrorCode,
  StaffEditErrorCode,
} from '@core/errors';
import {
  AppliedDiscount,
  BookingCall,
  BookingLifecycle,
  CancellationReason,
  ClientQueryShape,
  Combinability,
  CouponValue,
  DiscountProvenance,
  DiscountSource,
  type Email,
  GridEvent as GridEventTag,
  MinuteRange,
  Principal,
  Registration,
  type Role,
  Roles,
  Seat,
  SeatOutcome,
  SeatSubject,
  type ShopNow,
  StaffVerb,
  SubjectRelationship,
  TimeCoordinate,
  VisitEditWriteOutcome,
  type VisitSides,
  VoucherRedemption,
  WallTime,
} from '@core/components';
import {
  AppointmentEditSystem,
  AppointmentLifecycleSystem,
  BarberToneSystem,
  BillingSystem,
  BusySystem,
  ClientQuerySystem,
  GridLayoutSystem,
  IntervalSetSystem,
  LocationScopeSystem,
  OfferingPriceSystem,
  PhoneSystem,
  RosterSystem,
  SearchFieldsSystem,
  type SideWrites,
  type StaffEditWords,
  StaffEditPlanSystem,
  VisitDraftSystem,
  VisitSidesSystem,
  VisitStorySystem,
  ZonedTimeSystem,
} from '@core/systems';
import {
  AUTH_DEPLOYMENT_PORTS,
  AUTH_SESSION_PORTS,
  AVATAR_PORTS,
  CATALOG_PORTS,
  CLOCK_PORTS,
  PROFILE_PORTS,
  USER_SEARCH_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { AGENDA_FIELDS, AgendaField, AgendaFields } from '../agenda-fields';
import {
  StaffVisitEditor,
  type VisitEditorBarberOption,
  type VisitEditorClientOption,
  type VisitEditorClientSection,
  VisitEditorClientSectionId,
  type VisitEditorFrameDay,
  type VisitEditorLibraryImage,
  type VisitEditorPhoto,
  type VisitEditorServiceOption,
  type VisitEditorShopOption,
  type VisitEditorCommit,
  type VisitEditorLeg,
  type VisitEditorVerb,
  type VisitEditorVm,
  type VisitEditorCodeResult,
  type VisitEditorDiscount,
  type VisitEditorVoucher,
  type VisitEditorResolution,
  snapshotCommitOf,
} from '../visit-editor/staff-visit-editor';
import {
  CatalogContentService,
  CatalogWording,
} from '@creativo/features/shared/catalog';
import { catalogTagWords } from '../shared/catalog-tag.words';
import {
  firstNameOf,
  hollowStatus,
  StaffEventHead,
  type StaffEventLine,
} from '@creativo/features/shared/visits';
import {
  formatCents,
  formatInstant,
  formatWallClock,
  formatZoneName,
  wallClockParts,
} from '@creativo/ui/wall-clock';
import {
  bookingStatusWords,
  cancellationReasonWords,
  pluralForm,
  relativeTime,
  translateCodedError,
  wordPipelineError,
} from '@creativo/infrastructure/i18n';
import {
  UiChoiceLeading,
  UiChoiceMenu,
  type UiChoiceOption,
  UiSegmentedControl,
  type UiSegment,
  UiAvatar,
  type UiBadgeTone,
  UiButton,
  UiChip,
  UiIcon,
  type UiIconName,
  UiModalSheet,
  UiSearchField,
  UiSwitch,
  UiTextField,
} from '@creativo/ui/controls';
import {
  UiFlow,
  UiScrollRow,
  UiSpacer,
  UiStack,
  UiToolbar,
} from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiFrameDirective,
  UiInteractiveDirective,
  UiPaddingDirective,
  UiTextDirective,
  UiVisuallyHiddenDirective,
  UiWeightDirective,
} from '@creativo/ui/modifiers';
import {
  UiListGroup,
  UiListRow,
  UiMenu,
  UiAlert,
  type UiAlertAction,
  UiMenuItem,
  UiMenuTrigger,
  UiPageActionBar,
  UiSheetActionBar,
  UiSheetHeadline,
  UiToast,
} from '@creativo/ui/patterns';
import {
  StaffDayStore,
  type BarberDayLane,
  StaffView,
} from '../staff-day.store';
import {
  type AllDayEntry,
  type GridColumn,
  type GridEvent,
  type OpenWindow,
  StaffTimeGrid,
} from '../time-grid/staff-time-grid';
import {
  type BlockEditorCommit,
  type BlockEditorLane,
  type BlockEditorRange,
  type BlockEditorVm,
  StaffBlockEditor,
} from '../block-editor/staff-block-editor';
import {
  clientLookupKeys,
  parseClientQuery,
  rankClients,
} from '../visit-editor/client-query';
import type { ClientCardCatalog } from '@creativo/features/staff/client-card';
import { ArrivalVerb, ROW_VERB_WORD, type RowVerb } from '../row-verb';

/**
 * A ROW'S NAME — the aggregate it belongs to, plus the lane it is drawn in.
 *
 * `#` is safe as the seam: both halves are ids the app mints itself
 * (Firestore doc ids and barber slugs), and neither can contain one. The key
 * is opaque — nothing parses it back apart, because everything that needs the
 * appointment reads `DayRowVm.appointmentId` instead.
 */
function rowKey(appointmentId: AppointmentId, barberId: BarberId): string {
  return `${appointmentId}#${barberId}`;
}

/** What a save wrote BESIDE the batch — and so what its undo writes back. */
type SaveWrites = SideWrites;

/**
 * What one write of the sheet came to (`VisitEditWriteOutcome`): refused
 * before anything went out because a side field it carries was changed by
 * somebody else (`STALE`, `VisitSidesSystem.movedUnder`), the batch refused
 * (`BATCH_REFUSED`), or the batch landed — or there was none to send
 * (`WRITTEN`); and, beside it, whether the side documents due (the team
 * note, the tip) landed too (`sidesWritten` — `true` when none was due).
 */
interface EditorWrite {
  readonly visitEditWriteOutcome: VisitEditWriteOutcome;
  readonly sidesWritten: boolean;
}

/** Did the batch land (or was there none to send)? */
function batchLanded(write: EditorWrite): boolean {
  return write.visitEditWriteOutcome === VisitEditWriteOutcome.Written;
}

/** Did the whole write land — the batch and every side document it was due? */
function writeLanded(write: EditorWrite): boolean {
  return batchLanded(write) && write.sidesWritten;
}

/**
 * Which DS options the scope switcher's «Всички» answers by — the menu's
 * option id for "every chair", never a `BarberId` (a DS option id: the
 * value the `ui-choice-menu` hands back and is handed as its selection).
 */
const SCOPE_ALL = 'all';

/**
 * The key of the all-day band's «+N» chip — every other chip is keyed by
 * its chair's id; this one opens the date itself (an opaque grid key).
 */
const ALL_DAY_MORE_KEY = 'more';

/**
 * Which sheet's ✕ is waiting on «Отхвърли промените?» — the visit sheet's
 * or the create sheet's (the field `discardPending`). Internal: compared
 * here only, printed nowhere.
 */
export const DiscardTarget = {
  Visit: 'VISIT',
  Create: 'CREATE',
} as const;
export type DiscardTarget = Tag<typeof DiscardTarget>;

/**
 * Which toolbar menu is open — the view picker or the chair picker (the
 * field `openPicker`); one at a time. Internal: compared here and in the
 * template, printed nowhere.
 */
export const DayPicker = {
  View: 'VIEW',
  Scope: 'SCOPE',
} as const;
export type DayPicker = Tag<typeof DayPicker>;

/**
 * The page's transient surfaces `presentOnly` keeps while it closes the
 * rest — the date popover, a toolbar picker, a row's overflow. Internal.
 */
const DaySurface = {
  Date: 'DATE',
  Picker: 'PICKER',
  Row: 'ROW',
} as const;
type DaySurface = Tag<typeof DaySurface>;

/**
 * What a search field of an appointment holds — the field `label` of a
 * searchable field and of a matched line. Internal: the matched lines print
 * their parts, never this tag.
 */
const SearchField = {
  Client: 'CLIENT',
  Service: 'SERVICE',
  Phone: 'PHONE',
  Email: 'EMAIL',
  Note: 'NOTE',
} as const;
type SearchField = Tag<typeof SearchField>;

/**
 * The discard alert's two answers — values: external contract (the
 * `ui-alert` action ids the alert is handed and hands back on a pick).
 */
const DiscardAnswer = {
  Discard: 'discard',
  Keep: 'keep',
} as const;

/** The opening midnight — where a minute that nobody could read falls back to (`0`, a minute of every day). */
const MIDNIGHT = MinuteOfDay.ofProven(0);
/** The closing midnight as an exclusive end (`1440`, `(0, 1440]`). */
const CLOSING = EndMinute.ofProven(24 * 60);
/** The block sheet's default range, 12:00–13:00 — two minutes of every day. */
const NOON = MinuteOfDay.ofProven(12 * 60);
const ONE_PM = EndMinute.ofProven(13 * 60);

/**
 * The stale refusal a write earns on THIS device, before anything is sent:
 * the note or the tip it carries moved under the draft. The server's own
 * stale refusal (`BOOKING_STAFF_EDIT_STALE`) is the same sentence and the
 * same reload, so it is spoken in the server's code.
 */
function sidesMovedError(): PipelineError {
  return PipelineError.of(
    PipelineErrorCode.InvalidRequest,
    StaffEditErrorCode.Stale,
    null,
    null,
  );
}

/**
 * How long an undone save waits for the listener — for the save to reach
 * the row before the way back is computed, and for the way back to reach
 * it before the sheet re-seeds. The listener delivers in well under a
 * second; this is the ceiling, not the expectation.
 */
const ROW_WAIT_MS = 5000;

/**
 * Whether a save has a way back through the same callable — the server's
 * rule (`AppointmentEditSystem.undoable`), read on the ROOT appointment's
 * status: a seat added to a FINISHED visit is worked the moment it is
 * written (the after-the-cut flow, owner 2026-09-09) and the server keeps
 * history, so its `removeSeat` would be refused every time and that save's
 * receipt carries no «Отмени» (found in review). The caller hands the root
 * (`DayRowVm.rootBookingStatus`), never the chair's summary (DEP-3).
 */
export function reversibleSave(
  root: { readonly bookingStatus: BookingStatus } | null,
  commands: readonly BookingCall.EditCommand[],
): boolean {
  return AppointmentEditSystem.undoable(root?.bookingStatus ?? null, commands);
}

/** How long an undone save gives the busy projection before its one retry. */
const BUSY_SETTLE_MS = 1500;

/**
 * The server's overlap OFFER — a lost slot naming its own code
 * (`BOOKING_STAFF_EDIT_OVERLAPS`) — as opposed to any other refusal. The
 * store's docblock on `staffEdit` names it; the sheet answers it with
 * «Запази въпреки застъпването», and an undone save answers it with one
 * more try.
 */
function isOverlapOffer(error: PipelineError | null): boolean {
  return error?.serverErrorCode === StaffEditErrorCode.Overlaps;
}

/**
 * The visit moved on under the sheet — somebody else saved it since the
 * draft was drawn (`BOOKING_STAFF_EDIT_STALE`, round 5). Never retried and
 * never written over: the sheet reloads the visit as it now stands.
 */
function isStaleRefusal(error: PipelineError | null): boolean {
  return error?.serverErrorCode === StaffEditErrorCode.Stale;
}

/**
 * The stored facts a save can change, as one string — what an undone save
 * compares the live row against to know the server has caught up.
 */
function rowShape(row: DayRowVm): string {
  return JSON.stringify({
    location: row.locationId,
    // The chair's span on the shop's wall clock (Law 7.3) — its day, its
    // start and its end, as stored.
    day: row.localDate,
    start: row.startMinute,
    end: row.endMinute,
    legs: row.legs.map((leg) => [
      leg.seatId,
      leg.serviceId,
      leg.variantId,
      leg.minutes,
      leg.barberId,
      // The price as cents in its currency, never re-read off a label (D-10.3).
      leg.priceCents,
      leg.currency,
    ]),
    discounts: row.discounts
      .map((discount) =>
        JSON.stringify([
          discount.discountSource,
          discount.grantId,
          discount.code,
          // The value as stored — exactly its variant's fields.
          CouponValue.of(discount),
        ]),
      )
      .sort(),
    vouchers: row.vouchers.map((voucher) => voucher.code),
    tip: row.tipCents,
  });
}

/**
 * The seats a move of this row to `to` addresses — `[]` for the ROOT, the
 * whole party in one call (`AppointmentLifecycleSystem.transitionSeats`):
 * the row's own seat ids.
 */
function transitionSeatsOf(
  row: DayRowVm,
  to: BookingStatus,
): readonly SeatId[] {
  return AppointmentLifecycleSystem.transitionSeats(
    to,
    row.seatIds,
    row.partySize,
  );
}

/** The street line of a postal address — everything before its first comma. */
function streetOf(address: string): string {
  const street = address.split(',')[0]?.trim() ?? '';
  return street.length > 0 ? street : address;
}

/** One question per typed name, not one per keystroke. */
const CLIENT_SEARCH_DEBOUNCE_MS = 220;
/** The most accounts one lookup key answers with (index #8's `limit`). */
const CLIENT_SEARCH_LIMIT = 20;
/** How many of the book's matches get their portrait looked up per query. */
const BOOK_FACES_PER_QUERY = 12;
/** How many recent visitors «Скорошни» lists — a display cap. */
const RECENT_CLIENTS_CAP = 8;

/**
 * An account the client search found, as its option names it: the name AS
 * WRITTEN — `searchName` is the lower-cased index key, and it read «мартин
 * илиев» on the desk's rows (2026-09-18) — else that key, else nothing.
 */
function searchLabelOf(user: User): string {
  const written = Profile.fullName(user);
  return written.length > 0 ? written : (user.searchName ?? '');
}

/**
 * What an agenda entry is — the field `agendaRow`: a booked VISIT, or a
 * sellable GAP between them. One run, two row grammars.
 */
export const AgendaRow = {
  Visit: 'VISIT',
  Gap: 'GAP',
} as const;
export type AgendaRow = (typeof AgendaRow)[keyof typeof AgendaRow];

/**
 * Which door the ＋ menu opened — a BOOKING (the visit sheet) or a BLOCK
 * (the block sheet). Passed to `openCreate`, never stored.
 */
export const CreateIntent = {
  Booking: 'BOOKING',
  Block: 'BLOCK',
} as const;
export type CreateIntent = (typeof CreateIntent)[keyof typeof CreateIntent];

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
   * answer is the wall clock's (`VisitStorySystem.hasStarted`/`hasEnded`).
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
  readonly clientLabel: string;
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
   * `toRow` is already holding the seats and the catalog.
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
   * (`reversibleSave`, DEP-3).
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
interface AgendaGroupVm {
  /** `String(startMinutes)` — the heading's DOM id segment and its track key. */
  readonly key: string;
  readonly timeLabel: string;
  /** The minute of the shop's day everything in the group begins at. */
  readonly startMinutes: MinuteOfDay;
  /** `true` once the clock has reached this heading (`VisitStorySystem.hasStarted`). */
  readonly past: boolean;
  readonly items: readonly RunEntryVm[];
}

/** A sellable hole. Same row grammar, no segment fill (§4.4). */
interface GapRowVm {
  readonly agendaRow: typeof AgendaRow.Gap;
  readonly id: string;
  readonly startLabel: string;
  readonly endLabel: string;
  readonly minutes: MinuteCount;
  /** Where the hole begins on the shop's wall clock — the run's order. */
  readonly startMinutes: MinuteOfDay;
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

type RunEntryVm = DayRowVm | GapRowVm;

/** Where an entry of the run begins on the shop's wall clock — a visit's chair start, a hole's start. */
function startMinuteOf(entry: RunEntryVm): MinuteOfDay {
  return entry.agendaRow === AgendaRow.Visit
    ? entry.startMinute
    : entry.startMinutes;
}

/** One neighbour on a sheet's frame — a name, a span on its axis, a tone. */
interface FrameNeighbour {
  readonly name: string;
  readonly startMinute: MinuteOfDay;
  readonly endMinute: EndMinute;
  readonly tone: number;
}

interface LaneVm {
  readonly barberId: BarberId;
  readonly barberName: string;
  readonly avatarSrc: string | null;
  /** Visits and gaps interleaved in clock order — the COMPLETE run. */
  readonly entries: readonly RunEntryVm[];
  readonly rostered: boolean;
  readonly failed: boolean;
}

/**
 * The glyph that doubles a TERMINAL state on a calendar block.
 *
 * Live states get none: a block that is simply filled and unmarked is the
 * ordinary case, and marking it would spend a signal on "nothing has
 * happened yet".
 */
const STATUS_ICONS: Partial<Record<BookingStatus, UiIconName>> = {
  [BookingStatus.Completed]: 'checklist.done',
  [BookingStatus.NoShow]: 'visit.noShow',
  // It was missing (found 2026-09-24): a cancelled block drew no glyph at
  // all while the card's face and the sheet carried one.
  [BookingStatus.Cancelled]: 'visit.cancelled',
};

/**
 * Status is FORM, never hue — the grid's ruling, now honoured here too.
 *
 * These badges were accent / success-green / destructive-red / warning-amber,
 * which is exactly the arrangement `staff-time-grid.state.css` quotes HIG at
 * length to forbid: a pale green beside a pale amber is the pair red-green
 * colour blindness cannot separate, and "the cut happened" versus "they never
 * came" is not a distinction to hang on a hue. Success and warning are system
 * meanings besides; a finished haircut is not a success and an absent client
 * is not a warning.
 *
 * It also became load-bearing the moment hue started meaning WHOSE CHAIR: a
 * colour cannot say "Ivan" and "no-show" at once. The badge keeps the WORD,
 * which was always the channel actually carrying the meaning.
 */
/**
 * WHAT EACH STATUS MEANS, as a tone.
 *
 * All five were flattened to `neutral` when status was an inline word among
 * other inline words — colour there was a second voice competing with the
 * accent for a fact that was usually "confirmed". In a capsule at a fixed
 * end of the header it is the only coloured thing on that line, so the tone
 * can do its job again.
 *
 * `confirmed` and `completed` stay NEUTRAL on purpose: they are the ordinary
 * outcomes and nine cards in ten are one of them, so a colour there would
 * mean nothing. Colour is spent only where something needs looking at.
 */
const STATUS_TONES = {
  [BookingStatus.Pending]: 'warning',
  [BookingStatus.Confirmed]: 'neutral',
  [BookingStatus.Completed]: 'neutral',
  [BookingStatus.Cancelled]: 'destructive',
  [BookingStatus.NoShow]: 'destructive',
} as const satisfies Record<BookingStatus, UiBadgeTone>;

/**
 * The page's clock face — «13:00», 24-hour: in the reader's locale on the
 * rows, in `en-GB` in a block's accessible name.
 */
const CLOCK_FACE: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

/** A beat of air above the anchored marker, so it does not hug the toolbar. */
const CLEARANCE = 12;
/** How many frames the anchor may spend chasing a still-settling layout. */
const ANCHOR_FRAMES = 24;
/** Close enough, in px — sub-pixel layout must not keep the loop alive. */
const ANCHOR_TOLERANCE = 2;

/**
 * One lifecycle move as the call carries it — the whole party (`seatId`
 * `null`) or one seat; a reason only on a cancellation, and a CODE only
 * (D23): what the barber typed beside «Друго…» is the visit's note, written
 * once the cancel has landed (`confirmCancel`), never the call's.
 */
function transitionOf(
  appointmentId: AppointmentId,
  toBookingStatus: BookingStatus,
  cancellationReason: CancellationReason | null,
  seatId: SeatId | null,
): BookingCall.Transition {
  return { appointmentId, toBookingStatus, cancellationReason, seatId };
}

/**
 * A block's span on the shop's wall clock — a start in `[0, 1440)` and a
 * later end in `(0, 1440]` — or `null` for anything that is not one: the
 * block sheet's draft runs on the frame's anchored axis (`TrackMinute`).
 */
function minuteRangeOf(
  startMinute: TrackMinute,
  endMinute: TrackMinute,
): MinuteRange | null {
  const start = TrackMinute.toStart(startMinute);
  const end = TrackMinute.toEnd(endMinute);
  if (!start.ok || !end.ok || end.value <= start.value) return null;
  return MinuteRange.of(start.value, end.value);
}

/** One field that matched, split so the matching run can be marked. */
interface MatchVm {
  readonly label: SearchField;
  readonly parts: readonly { readonly text: string; readonly hit: boolean }[];
}

/** One searchable field of an appointment — what it holds, and its text. */
interface SearchableField {
  readonly label: SearchField;
  readonly value: string;
}

/** One appointment the search found. */
interface SearchHitVm {
  readonly id: AppointmentId;
  readonly dayKey: LocalDate;
  readonly whenLabel: string;
  readonly past: boolean;
  readonly bookingStatus: BookingStatus;
  readonly titleParts: readonly {
    readonly text: string;
    readonly hit: boolean;
  }[];
  readonly matches: readonly MatchVm[];
}

/**
 * Does this field hold the term — by text (the Bulgarian collation, this
 * page's), or by the term's bare digits for a phone (`digits`, `null` when
 * the term is no phone number — `SearchFieldsSystem.digitQuery`)?
 */
function matches(
  field: SearchableField,
  term: string,
  digits: string | null,
): boolean {
  if (field.value.toLocaleLowerCase('bg').includes(term)) return true;
  return (
    digits !== null &&
    field.label === SearchField.Phone &&
    SearchFieldsSystem.digitsMatch(field.value, digits)
  );
}

/**
 * Split a value around every occurrence of the term.
 *
 * Case-insensitive on the BULGARIAN collation but returning the ORIGINAL
 * slices, so a match on "георги" still renders "Георги" — highlighting must
 * never rewrite what the shop typed.
 */
function splitOnTerm(
  value: string,
  term: string,
  ignoreSeparators = false,
): readonly { readonly text: string; readonly hit: boolean }[] {
  if (ignoreSeparators) return splitOnDigits(value, term);
  const haystack = value.toLocaleLowerCase('bg');
  const parts: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (;;) {
    const found = haystack.indexOf(term, at);
    if (found === -1) break;
    if (found > at) parts.push({ text: value.slice(at, found), hit: false });
    parts.push({ text: value.slice(found, found + term.length), hit: true });
    at = found + term.length;
  }
  if (at < value.length) parts.push({ text: value.slice(at), hit: false });
  return parts;
}

/**
 * Split a formatted phone around a run of digits, keeping the separators.
 *
 * "+359 88 777 8899" searched for "887778899" has to mark from the first 8
 * through the last 9 INCLUDING the spaces between them — highlighting only
 * the digit runs would break one match into three.
 */
function splitOnDigits(
  value: string,
  digits: string,
): readonly { readonly text: string; readonly hit: boolean }[] {
  const map: number[] = [];
  let bare = '';
  for (let i = 0; i < value.length; i++) {
    if (/\d/.test(value[i] as string)) {
      map.push(i);
      bare += value[i];
    }
  }
  const at = bare.indexOf(digits);
  if (at === -1) return [{ text: value, hit: false }];
  const from = map[at] as number;
  const to = (map[at + digits.length - 1] as number) + 1;
  const parts: { text: string; hit: boolean }[] = [];
  if (from > 0) parts.push({ text: value.slice(0, from), hit: false });
  parts.push({ text: value.slice(from, to), hit: true });
  if (to < value.length) parts.push({ text: value.slice(to), hit: false });
  return parts;
}

/**
 * "петък" → "Пет", "friday" → "Fri".
 *
 * THREE letters off the long name, not `Intl`'s `short`. English's short IS
 * three ("Fri"), but Bulgarian's is two ("пт") by CLDR convention — which read
 * as a different, terser system beside the reference. Slicing the long form
 * gives the idiomatic Bulgarian abbreviation (пон/вто/сря/чет/пет/съб/нед) and
 * leaves English exactly where it already was.
 */
function abbreviateWeekday(long: string, locale: string): string {
  const three = long.slice(0, 3);
  return three.charAt(0).toLocaleUpperCase(locale) + three.slice(1);
}

/**
 * How many chairs the all-day band names on one date before it says «+N»
 * (§8): a fourth chip would push the band into a second screen of chrome,
 * and a phone has no tooltip to read the rest from.
 */
const ALL_DAY_CHIP_CAP = 3;

/**
 * `/staff` — the shop's day, one lane per chair.
 *
 * ### What this screen is for
 * The three questions a person behind the counter actually asks: who is in
 * which chair today, who just walked in (confirm), and how did the visit
 * end (complete / no-show). Everything else — history, filters, feedback —
 * lives downstream of the statuses this screen finally makes real.
 *
 * ### Cancelled rows stay visible
 * Greyed, never hidden: a gap with no explanation reads as a free slot to
 * one barber and a bug to another. The chair's actual availability is the
 * client calendar's job; this sheet is the day's RECORD.
 *
 * ### Real Bulgarian copy, unlike the admin tools
 * `admin/programs` ships hardcoded English (internal-tool posture). The
 * day sheet is read by the barbers between cuts — it gets real `staff.*`
 * keys in both catalogs like every client surface.
 */
@Component({
  selector: 'lib-staff-dashboard',
  imports: [
    UiAlert,
    UiChoiceLeading,
    UiChoiceMenu,
    UiSegmentedControl,
    StaffTimeGrid,
    StaffVisitEditor,
    StaffEventHead,
    TranslocoDirective,
    UiAvatar,
    UiButton,
    StaffDayPill,
    UiChip,
    UiFlow,
    UiForegroundStyleDirective,
    UiFrameDirective,
    UiIcon,
    UiInteractiveDirective,
    UiListGroup,
    UiListRow,
    UiMenu,
    UiMenuItem,
    UiMenuTrigger,
    UiModalSheet,
    UiPaddingDirective,
    UiPageActionBar,
    UiScrollRow,
    UiSheetActionBar,
    UiSheetHeadline,
    UiSearchField,
    UiToast,
    UiSwitch,
    StaffBlockEditor,
    UiSpacer,
    UiStack,
    UiTextDirective,
    UiTextField,
    UiToolbar,
    UiVisuallyHiddenDirective,
    UiWeightDirective,
  ],
  providers: [StaffDayStore],
  templateUrl: './staff-dashboard.html',
  styleUrls: ['./staff-dashboard.css', './staff-dashboard.chrome.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'lib-staff-dashboard',
    'data-testid': 'staff-day-page',
  },
})
export class StaffDashboard {
  /** An hour that did not happen — struck on the card's head (staff-event-head). */
  protected readonly hollowStatus = hollowStatus;
  /** The agenda's two row grammars, for the template's comparison. */
  protected readonly AgendaRow = AgendaRow;
  /** The ＋ menu's two doors, for the template's calls. */
  protected readonly CreateIntent = CreateIntent;
  /** The four readings, for the template's comparisons. */
  protected readonly StaffView = StaffView;
  /** The toolbar's two menus, for the template's latch. */
  protected readonly DayPicker = DayPicker;
  /** The scope switcher's «Всички» option id, for the template. */
  protected readonly SCOPE_ALL = SCOPE_ALL;
  /** The card's switchable facts, for the template's `fields.isOn`. */
  protected readonly AgendaField = AgendaField;
  private readonly transloco = inject(TranslocoService);
  /**
   * THE LOADED TABLE, AS A SIGNAL (review r4, 2026-10-06: the agenda's
   * capsule printed «−staff.visit.minutes» on the party rows at first
   * paint). The rows are built in a `computed` that an effect reads before
   * `bg.json` has landed, and `translate()` hands the KEY back for every
   * word asked of it then — and nothing invalidates the rows afterwards,
   * because `translate()` reads no signal. `selectTranslation()` waits for
   * the load and re-emits on a language change or a `setTranslation`, so
   * the words a row carries (`copyOf`, `rawCopy`) are read through this and
   * every row is rebuilt the moment the table is there.
   */
  private readonly copyTable = toSignal(this.transloco.selectTranslation());
  private readonly title = inject(Title);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);

  /**
   * CLDR plural category for a count, in the language on screen.
   *
   * The app had no plural machinery at all, so every count read "1
   * посещения" / "1 cuts". Templates now key off this: `t(base + '.' +
   * pluralOf(n), { count: n })`. See `pluralForm` for why `Intl.PluralRules`
   * rather than the MessageFormat plugin.
   */
  protected pluralOf(count: number): string {
    return pluralForm(count, this.transloco.getActiveLang());
  }

  /**
   * Hold focus through a row's state change.
   *
   * The lead verb (`leadVerb`) is null once a visit settles and `overflow` empties
   * with it, so the control the user just pressed unmounts underneath them
   * and focus falls to `<body>` — throwing a keyboard or switch user back to
   * the top of a three-lane day on every completed cut (WCAG 2.2 SC 3.2.2).
   *
   * The row is the honest landing place: it is where the user already was,
   * and it now carries the badge that replaced the verb. `afterNextRender`
   * rather than a timeout because the row must exist in its NEW shape before
   * it can take focus. Restores ONLY when focus was genuinely lost — after
   * `arrived` the verb survives as "Готово" and moving the user off a live
   * control would be the ruder failure.
   */
  /**
   * Open where the day IS, not where it started.
   *
   * The screen opened at 09:00 on a day already half over, every time the
   * phone unlocked. Runs once per DAY-CHANGE rather than on every store tick,
   * so a barber who has scrolled somewhere on purpose is left there — which
   * is what `anchoredDay` is for.
   *
   * It waits for the marker to exist before claiming the day: the run streams
   * in over several frames, and claiming early meant claiming a day that was
   * never actually anchored.
   */
  private readonly anchoredDay = signal<LocalDate | null>(null);

  /**
   * The toolbar's REAL height, published as a custom property.
   *
   * `--staff-toolbar-height` is only the bar's FLOOR — the bar grows to fit
   * the week strip beneath its controls, and measured it renders 117px
   * against the token's 52px. The all-day band sticks directly under the bar,
   * so it needs the height the bar actually HAS, not the height it is
   * guaranteed at least. `settleOnNow` already measures the same box at
   * runtime for the same reason.
   *
   * An observer rather than a one-off read: the bar's height changes with the
   * week strip, with a locale whose weekday initials wrap, and with dynamic
   * type.
   */
  protected readonly toolbarBox = afterNextRender(
    () => this.watchToolbar(ANCHOR_FRAMES),
    { injector: this.injector },
  );

  /**
   * ...and it has to KEEP ASKING until the bar exists, which is why this is
   * not simply the body of `afterNextRender`.
   *
   * It was, and it silently did nothing: this whole template lives inside
   * `*transloco`, so at the next render after construction the structural
   * directive has not yet produced any of it and `.staff-toolbar` is null.
   * A single attempt returned early and never came back, leaving the custom
   * property unset and the band sticking to the token's 52px floor —
   * i.e. behind the bar. Same failure, same shape of fix, as `settleOnNow`.
   *
   * Two things a frame loop has to respect that a render hook gets for free:
   * it outlives the view (a page left within the budget must not register
   * `onDestroy` on a view already destroyed — NG0911), and it runs OUTSIDE
   * Angular's error handler, so anything thrown here is an uncaught
   * exception rather than a logged one. An engine without `ResizeObserver`
   * (jsdom, a server) therefore keeps the one-off measurement, the same line
   * the DS's modal sheet and the grid's frame watch draw.
   */
  private watchToolbar(framesLeft: number): void {
    if (framesLeft <= 0 || this.destroyRef.destroyed) return;
    const bar =
      this.host.nativeElement.querySelector<HTMLElement>('.staff-toolbar');
    const page =
      this.host.nativeElement.querySelector<HTMLElement>('.staff-day');
    if (bar === null || page === null) {
      requestAnimationFrame(() => this.watchToolbar(framesLeft - 1));
      return;
    }
    const publish = () =>
      page.style.setProperty(
        '--staff-toolbar-real',
        `${Math.round(bar.getBoundingClientRect().height)}px`,
      );
    publish();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(publish);
    observer.observe(bar);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }

  protected readonly anchorToNow = effect(() => {
    const day = this.store.dayKey();
    // No marker yet — the run has not rendered. Do NOT claim the day.
    if (this.agendaNowIndex() === null) return;
    if (untracked(() => this.anchoredDay()) === day) return;
    this.anchoredDay.set(day);
    afterNextRender(() => this.settleOnNow(ANCHOR_FRAMES), {
      injector: this.injector,
    });
  });

  /**
   * Scroll the marker under the toolbar, and keep asking until it lands.
   *
   * A single attempt does not survive this page. On a cold load the run
   * renders over several frames while lanes stream in, so the first attempt
   * asks the browser to scroll a document still shorter than the viewport —
   * which clamps silently to zero. The browser's own scroll restoration and
   * the router's both land after first paint too, and either would undo a
   * correct scroll.
   *
   * So: re-assert each frame until the marker sits where it should, or the
   * budget runs out. The `max > 0` guard matters — without it the first
   * no-op on an unscrollable document counted as "settled".
   */
  private settleOnNow(framesLeft: number): void {
    // A page left mid-budget must not scroll the one that replaced it.
    if (framesLeft <= 0 || this.destroyRef.destroyed) return;
    const marker =
      this.host.nativeElement.querySelector<HTMLElement>('[data-now-anchor]');
    if (!marker) {
      requestAnimationFrame(() => this.settleOnNow(framesLeft - 1));
      return;
    }
    const toolbar =
      this.host.nativeElement.querySelector<HTMLElement>('.staff-toolbar');
    const offset = (toolbar?.getBoundingClientRect().height ?? 0) + CLEARANCE;
    const current = marker.getBoundingClientRect().top;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const settled =
      Math.abs(current - offset) < ANCHOR_TOLERANCE ||
      (max > 0 && window.scrollY >= max - 1 && current < window.innerHeight);
    if (settled) return;
    window.scrollTo({
      top: Math.max(0, current + window.scrollY - offset),
      behavior: 'instant',
    });
    requestAnimationFrame(() => this.settleOnNow(framesLeft - 1));
  }

  private restoreFocusToRow(rowId: string): void {
    afterNextRender(
      () => {
        const row = this.host.nativeElement.querySelector<HTMLElement>(
          `[data-row-id="${CSS.escape(rowId)}"]`,
        );
        if (!row || row.contains(document.activeElement)) return;
        row.focus();
      },
      { injector: this.injector },
    );
  }

  protected readonly catalog = inject(CatalogContentService);
  protected readonly content = inject(CatalogWording);

  /**
   * WHO IS AT THE BOOK — the settled principal the route guard already
   * resolved. Read here for the one thing the sheet cannot decide alone:
   * whether the person may touch the shop's money.
   */
  private readonly principal = toSignal(
    inject(AUTH_SESSION_PORTS).observePrincipal(),
  );

  /**
   * A barber may stretch his own time; he may not discount the shop's money
   * (design record, §3.8) — the same front-desk-and-admin list the rules
   * use for the clientele (`Roles.MONEY`, the domain's own list — the server
   * gates the manual discount arm on it too). `content_manager` edits the
   * catalogue, not prices on a booking.
   */
  protected readonly mayReprice = computed(() => {
    const principal = this.principal();
    if (principal === undefined) return false;
    return Principal.hasAnyRole(principal, Roles.MONEY);
  });

  /**
   * WHO IS LOOKING, as the client card reads it (client-card-redesign
   * §5.2.1): the uid and the roles — its ‹role› gates and the admin-only
   * money read. Nobody while the principal is not an onboarded one.
   */
  protected readonly cardViewer = computed<{
    readonly userId: UserId;
    readonly roles: readonly Role[];
  } | null>(() => {
    const principal = this.principal();
    return principal !== undefined && Principal.isActive(principal)
      ? { userId: principal.userId, roles: [...principal.roles] }
      : null;
  });

  /** The shop's service categories — the card's «Майсторство» sections name them. */
  private readonly serviceCategories = toSignal(
    inject(CATALOG_PORTS).observeCategories(),
    { initialValue: null },
  );

  /**
   * THE CATALOGUE AS THE CLIENT CARD NAMES THINGS (§5.2.1): each lookup
   * reads the catalogue's live signals when it is ASKED — outside this
   * computed — so the card's computeds follow a late catalogue on their
   * own, and the object is rebuilt only when the shop count it carries as
   * a plain number changes (no getter on data, pass D D-7.6). Services,
   * barbers and shops in the reader's language; covers and portraits as the
   * catalogue resolved them. A shop's cover is not resolved by the
   * catalogue's media cache today (it asks for services' and barbers' only,
   * and no seeded shop carries one), so a shop family draws the first
   * letter of the shop's `shortName` given below («Център» → «Ц»), as
   * §3.3.3 orders it.
   */
  /**
   * How many shops the catalogue lists — its own computed, so the lookup
   * below is rebuilt only when the NUMBER changes, never on a re-emission
   * of the same shops (a new object re-opens the card).
   */
  private readonly locationCount = computed(
    () => this.catalog.locations().length,
  );

  protected readonly clientCardCatalog = computed<ClientCardCatalog>(() => {
    const catalog = this.catalog;
    const content = this.content;
    const categories = this.serviceCategories;
    return {
      serviceName: (id: ServiceId) => {
        const service = catalog.findService(id);
        return service === undefined ? null : content.text(service.name);
      },
      serviceCoverSrc: (id: ServiceId) => catalog.coverUrl(id) ?? null,
      serviceCategory: (id: ServiceId) => {
        const service = catalog.findService(id);
        const listed = categories();
        if (service === undefined || listed === null || !listed.ok) {
          return null;
        }
        const category = listed.value.find(
          (entry: ServiceCategory) => entry.id === service.categoryId,
        );
        return category === undefined
          ? null
          : { id: category.id, name: content.text(category.name) };
      },
      barberName: (id: BarberId) => {
        const barber = catalog.barbers().find((entry) => entry.id === id);
        return barber === undefined ? null : content.text(barber.name);
      },
      barberAvatarSrc: (id: BarberId) =>
        catalog.barberVms().find((vm) => vm.id === id)?.avatarSrc ?? null,
      // A row's fact line names the shop without the brand every shop
      // carries: `Location.shortName` (its name when the catalogue has none).
      locationName: (id: LocationId) => {
        const location = catalog.locations().find((entry) => entry.id === id);
        return location === undefined
          ? null
          : content.text(location.shortName ?? location.name);
      },
      locationCoverSrc: () => null,
      locationCount: this.locationCount(),
      // The shop's own zone: what a visit row reads "today" in (Law 7.2).
      locationTimeZone: (id: LocationId) =>
        catalog.locations().find((entry) => entry.id === id)?.timeZone ?? null,
    };
  });
  protected readonly store = inject(StaffDayStore);

  /**
   * `?day=YYYY-MM-DD`, bound from the route. Absent means today — a link that
   * pinned today would be wrong by morning.
   */
  readonly day = input<string | null>(null);
  /**
   * `?view=` and `?barber=`, bound from the route beside the day
   * (2026-09-23, the grid views' design record §10): a link pasted into
   * the staff chat says "Ivan's week", and the back button restores the
   * reading you left. Absent means the default — the view the device
   * remembers, everyone.
   */
  readonly view = input<string | null>(null);
  readonly barber = input<string | null>(null);

  constructor() {
    this.destroyRef.onDestroy(() => this.rowWatch()?.settle());
    // The URL is an INPUT here and an OUTPUT of the store, so the echo of the
    // store's own write must not be mistaken for the user asking for a day —
    // that bounced every chevron press straight back to today. Comparing
    // against what the store last published leaves only genuine external
    // changes: the first load, and the back button.
    effect(() => {
      const requested = this.day() ?? null;
      // `published` is read UNTRACKED: it changes as a RESULT of the day's
      // navigation, so tracking it re-fires this effect with a stale `day()`
      // and undoes the navigation that just happened. Only `day()` may wake
      // this. The text is the URL's: the store parses it ONCE, at its edge
      // (`applyRouteDay` → `LocalDate.parse`).
      if (requested !== untracked(() => this.store.published().day)) {
        untracked(() => this.store.applyRouteDay(requested));
      }
    });
    // The same guard for the view and the chair. An ABSENT parameter reaches
    // a route-bound input as `undefined`, not the input's `null` default —
    // the binder sets every declared input from the route's data — so both
    // are read as "silent" before the comparison. The view's published
    // value starts UNDEFINED (never written) so the first look at a silent
    // URL still reaches the store, which states the view the device
    // restored; the store sends no navigation when nothing changes.
    effect(() => {
      const requested = this.view() ?? null;
      const stated = untracked(() => this.store.published().view);
      if (stated === undefined || requested !== (stated ?? null)) {
        // UNTRACKED, like every store call from a route effect: the store
        // reads the published record before it writes it, and a read inside
        // this effect's own tracking would make the effect depend on the
        // signal it changes — and re-run on its own write, forever (found
        // live 2026-09-23 on the first silent URL after a remembered view).
        untracked(() => this.store.applyRouteView(requested));
      }
    });
    effect(() => {
      const requested = this.barber() ?? null;
      if (requested !== untracked(() => this.store.published().barber)) {
        untracked(() => this.store.applyRouteBarber(requested));
      }
    });

    // English, like every other page's title in this app (`Events ·`,
    // `Careers ·`, `Programs · Creativo Admin`). This one shipped as
    // hardcoded BULGARIAN — "Днес · Creativo" — so an English-locale staff
    // member got a Bulgarian tab, and it was a third name for the screen
    // besides the menu row's and the heading's.
    //
    // Deliberately NOT moved onto a translation key: no page in this app
    // translates its title, and adding a key for one of six would make this
    // the outlier again in the other direction. If titles should follow the
    // locale, that is one change across all six, not a special case here.
    this.title.setTitle('Schedule · Creativo');
  }

  /**
   * The page's clock — the STORE's, which goes through the injected clock
   * port. This component used to own a second one seeded from `Date.now()`,
   * so the gaps and the verb gates were reading different times.
   */
  protected readonly nowUtcMs = this.store.nowUtcMs;

  /** The clock port itself — for the nonce a re-booking's draft seats are minted with. */
  private readonly clock = inject(CLOCK_PORTS);

  /**
   * A STAMP read onto the shop's wall clock — its day and minute in the
   * day's zone through `ZonedTimeSystem` (Law 7: the one home of zone math;
   * the lawful reading of a stored instant, pass D D-6.6). `null` before
   * the zone is known, when the page shows nothing anyway.
   */
  private stampWall(atUtcMs: UtcEpochMs) {
    const zone = this.store.zone();
    return zone === null ? null : ZonedTimeSystem.toLocal(atUtcMs, zone);
  }

  /** An instant in the reader's locale, on the SHOP's calendar — `''` before the zone is known. */
  private instantLabel(
    atUtcMs: UtcEpochMs,
    options: Intl.DateTimeFormatOptions,
    locale: string = this.content.locale(),
  ): string {
    const zone = this.store.zone();
    return zone === null ? '' : formatInstant(atUtcMs, zone, locale, options);
  }

  /**
   * A stored wall-clock reading in the reader's locale — `''` while the
   * day's zone is not known, exactly as {@link instantLabel} answers then
   * (the pooled search and «Скорошни» print nothing before it, D-6.2).
   */
  private wallLabel(
    localDate: LocalDate,
    minute: MinuteOfDay | null,
    options: Intl.DateTimeFormatOptions,
  ): string {
    return this.store.zone() === null
      ? ''
      : formatWallClock(localDate, minute, this.content.locale(), options);
  }

  // ── Search ──────────────────────────────────────────────────────────

  /**
   * Results for the current term, newest-relevant first.
   *
   * Matched in memory against a window the store loaded once — Firestore
   * cannot substring-match, and the fields a shop actually searches by
   * (name, phone, email, note, service) are four different shapes, one of
   * them nested inside the `seats` array.
   */
  protected readonly searchResults = computed<readonly SearchHitVm[]>(() => {
    const term = this.store.term().trim().toLocaleLowerCase('bg');
    if (!SearchFieldsSystem.termSearchable(term)) return [];
    // Each visit is judged on ITS shop's wall clock (the physical chair
    // invariant, Law 7.2): one `ShopNow` per zone per tick, read at the
    // store's edge (`shopNowAt`, pass D D-6.2).
    const shopNowAt = this.store.shopNowAt();

    // Digits-only alias, so "887778899" finds "+359 88 777 8899". A person
    // searching by phone types the number off a screen or a card, never with
    // the formatter's spaces in it (`digitQuery`: `null` when it is none).
    const digits = SearchFieldsSystem.digitQuery(term);

    const found: { readonly hit: SearchHitVm; readonly when: WallTime }[] = [];
    for (const appointment of this.store.pool()) {
      const fields = this.searchableFields(appointment);
      const matched = fields.filter((field) => matches(field, term, digits));
      if (matched.length === 0) continue;

      // The client is the title, highlighted when it is what matched. Every
      // OTHER matched field lists beneath — so a phone search shows the
      // number it hit, and a name search does not print the name twice.
      const titleField = fields[0];
      const shopNow = shopNowAt(appointment.locationId);
      found.push({
        // The party's start on its shop's wall clock — the order outward
        // from now.
        when: WallTime.of(appointment.localDate, appointment.startMinutes),
        hit: {
          id: appointment.id,
          dayKey: appointment.localDate,
          whenLabel: this.wallLabel(
            appointment.localDate,
            appointment.startMinutes,
            {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            },
          ),
          // ONE definition of past, shared with the grid (see `eventsFor`): a
          // visit is past once it has ENDED — a cut that began ten minutes
          // ago and is still in the chair is not history. Whatever is
          // happening right now belongs with what is coming. Not past while
          // no zone is known for its shop (nothing is past yet).
          past:
            shopNow !== null &&
            VisitStorySystem.hasEnded(
              {
                localDate: appointment.localDate,
                minute: appointment.endMinutes,
              },
              shopNow,
            ),
          bookingStatus: appointment.bookingStatus,
          titleParts: titleField
            ? splitOnTerm(titleField.value, term)
            : [{ text: '', hit: false }],
          matches: matched
            .filter((field) => field !== titleField)
            .map((field) => ({
              label: field.label,
              parts: splitOnTerm(
                field.value,
                // Highlight the run that actually matched: the digits form
                // when that is what hit, the typed term otherwise.
                digits !== null && field.label === SearchField.Phone
                  ? digits
                  : term,
                digits !== null && field.label === SearchField.Phone,
              ),
            })),
        },
      });
    }

    // Soonest first among the future; most recent first among the past —
    // the two things a person searching a book is actually looking for.
    return found
      .sort((a, b) => {
        if (a.hit.past !== b.hit.past) return a.hit.past ? 1 : -1;
        return a.hit.past
          ? WallTime.compare(b.when, a.when)
          : WallTime.compare(a.when, b.when);
      })
      .map(({ hit }) => hit);
  });

  /** Every field a search is allowed to look at, in display priority. */
  private searchableFields(
    appointment: Appointment,
  ): readonly SearchableField[] {
    const out: SearchableField[] = [];
    if (appointment.contactName) {
      out.push({ label: SearchField.Client, value: appointment.contactName });
    }
    for (const seat of appointment.seats) {
      if (seat.seatSubject === SeatSubject.Anonymous) {
        out.push({ label: SearchField.Client, value: seat.guestLabel });
      }
      const service = this.catalog.findService(seat.serviceId);
      if (service) {
        out.push({
          label: SearchField.Service,
          value: this.content.text(service.name),
        });
      }
    }
    if (appointment.contactPhone !== null) {
      out.push({
        label: SearchField.Phone,
        value: PhoneSystem.formatInternational(appointment.contactPhone),
      });
    }
    if (appointment.contactEmail !== null) {
      out.push({ label: SearchField.Email, value: appointment.contactEmail });
    }
    if (appointment.contactNote) {
      out.push({ label: SearchField.Note, value: appointment.contactNote });
    }
    return out;
  }

  /** Jump the sheet to the day a hit lives on, and close the search. */
  protected openHit(hit: SearchHitVm): void {
    this.store.goToDay(hit.dayKey);
    this.closeSearchSheet();
  }

  /*
   * THE SEARCH SHEET'S FOLD (2026-09-24): the head folds while the search
   * is engaged — the field focused, or a query standing — the visit
   * sheet's own grammar, told to the bar the same way.
   */
  protected readonly searchFieldFocused = signal(false);
  /** Is the standing term long enough to search (`termSearchable`)? */
  protected readonly searchTermSearchable = computed(() =>
    SearchFieldsSystem.termSearchable(this.store.term().trim()),
  );
  protected readonly searchSheetEngaged = computed(
    () => this.searchFieldFocused() || this.store.term().trim().length > 0,
  );

  /** A field taken away while focused reports no blur; the sheet resets it. */
  protected closeSearchSheet(): void {
    this.searchFieldFocused.set(false);
    this.store.closeSearch();
  }

  /** ↓ from the field lands on the first hit, as the visit sheet's lists do. */
  protected focusFirstHit(event: KeyboardEvent): void {
    const first = this.host.nativeElement.querySelector<HTMLElement>(
      '[data-testid="staff-search-hit"]',
    );
    if (first === null) return;
    event.preventDefault();
    first.focus();
  }

  // ── The write actions ───────────────────────────────────────────────

  /**
   * The things staff ADD to a schedule — currently none, so there is no FAB.
   *
   * It shipped with three arms and two of them opened a sheet saying the
   * feature was not built. The notice was honest about itself and dishonest
   * about the screen: a receptionist who taps the primary action twice and
   * is told "not yet" both times has learned that this app does not do what
   * its buttons say, and that lesson is not undone by the third arm working.
   * Every review team called it out.
   *
   * The third arm, blocking time, was not a loss either — it was a SECOND
   * entry point to a control that already lives on each lane header, aimed
   * by default at whichever chair happened to sort first. The lane's own
   * button has always been the honest door to it, and it is now the only one.
   *
   * The FAB comes back with the walk-in write (plan item C4), at which point
   * it will have exactly one arm that works and will not need to fan out at
   * all. Until then this surface reads the day; it does not pretend to
   * author it.
   */
  protected readonly fabActions = [] as const;

  // ── The date picker ─────────────────────────────────────────────────

  protected readonly datePickerOpen = signal(false);

  /**
   * Park the strip on a week, and keep asking until it lands.
   *
   * Deliberately arithmetic rather than `scrollIntoView`: every week is
   * exactly one scrollport wide, so the target is `index x clientWidth` and
   * there is nothing to measure. `scrollIntoView` also walks every scrollable
   * ancestor, which on first paint scrolled the PAGE as a side effect.
   *
   * The retry is the same shape as `settleOnNow` and for the same reason: on
   * a cold load the strip is laid out over several frames, and a scroll
   * against a zero-width box clamps silently to nothing.
   */
  private settleOnWeek(index: number, framesLeft: number): void {
    if (framesLeft <= 0) return;
    const strip = this.host.nativeElement.querySelector<HTMLElement>(
      '[data-testid="staff-week-strip"]',
    );
    const page = strip?.clientWidth ?? 0;
    if (page === 0) {
      requestAnimationFrame(() => this.settleOnWeek(index, framesLeft - 1));
      return;
    }
    const target = index * page;
    if (Math.abs(strip!.scrollLeft - target) < 1) return;
    strip!.scrollTo({ left: target, behavior: 'instant' });
    requestAnimationFrame(() => this.settleOnWeek(index, framesLeft - 1));
  }

  /**
   * A day from the week strip is a TURN; one from the month popover is a
   * JUMP (2026-09-23, §6). Both show the day; only the jump asks the
   * calendar to reveal its working hours again — a turn keeps the reader's
   * hour under their thumb, the way Apple Calendar keeps the scroll when a
   * day is swiped. The agenda has no such distinction: it anchors to now on
   * every change of day, as it always has.
   */
  protected pickDay(dayKey: LocalDate, jump = false): void {
    if (jump) this.store.jumpToDay(dayKey);
    else this.store.goToDay(dayKey);
    this.datePickerOpen.set(false);

    // TAPPING TODAY MEANS "TAKE ME TO NOW".
    //
    // `anchorToNow` already does this when the day CHANGES to today, but it
    // claims each day once — so the second tap on today, the one a barber
    // makes precisely because they have scrolled off and want to come back,
    // did nothing at all. Releasing the claim makes today's marker the
    // destination again every time it is tapped, which is what the control
    // looks like it promises.
    //
    // Only for today: on any other day there is no "now" on the screen to
    // scroll to, and `agendaNowIndex()` is null there by construction.
    if (dayKey !== this.store.todayKey()) return;
    this.anchoredDay.set(null);
    afterNextRender(() => this.settleOnNow(ANCHOR_FRAMES), {
      injector: this.injector,
    });
  }

  // ── The calendar views ──────────────────────────────────────────────

  /**
   * The switcher's options, in the order a shop reaches for them, each with
   * its own glyph — the trigger shows the CURRENT view's icon, so the four
   * have to be distinguishable at a glance rather than by reading.
   */
  protected readonly views = [
    { id: StaffView.Agenda, icon: 'calendar.viewAgenda' },
    { id: StaffView.Day, icon: 'calendar.viewDay' },
    { id: StaffView.ThreeDay, icon: 'calendar.viewThreeDay' },
    { id: StaffView.Week, icon: 'calendar.viewWeek' },
  ] as const satisfies readonly {
    readonly id: StaffView;
    readonly icon: UiIconName;
  }[];

  protected readonly currentViewIcon = computed(
    () =>
      this.views.find((entry) => entry.id === this.store.view())?.icon ??
      'calendar.viewAgenda',
  );

  /** One menu at a time — the view picker and the chair picker share a latch. */
  protected readonly openPicker = signal<DayPicker | null>(null);

  protected readonly scopeLabel = computed(() => {
    const scope = this.store.scope();
    if (scope === null) return this.transloco.translate('staff.day.scopeAll');
    return this.barberNameOf(scope);
  });

  /** The scoped barber's portrait for the trigger, or `null` for everyone. */
  protected readonly scopeAvatar = computed(() => {
    const scope = this.store.scope();
    if (scope === null) return null;
    return this.scopeOptions().find((option) => option.id === scope) ?? null;
  });

  protected readonly isGrid = computed(
    () => this.store.view() !== StaffView.Agenda,
  );

  /**
   * The chairs the visit sheet's barber picker offers.
   *
   * The same roster the scope switcher draws, in the editor's own vocabulary
   * — one resolution of "who works here", not two, which is also why the
   * PORTRAIT comes along. `ui-avatar` falls back to a monogram whenever
   * `uiSrc` is absent, so dropping `avatarSrc` here does not fail, it just
   * quietly draws initials — which is exactly what the visit sheet was doing
   * two inches under a toolbar showing faces.
   */
  protected readonly barberOptions = computed<
    readonly VisitEditorBarberOption[]
  >(() =>
    this.scopeOptions().map((option) => ({
      id: option.id,
      label: option.name,
      tone: option.tone,
      avatarSrc: option.avatarSrc,
    })),
  );

  /**
   * THE SHOPS the «Салон» row offers — every active location, named in the
   * reader's language, pinned by its coordinates, with its STREET line as
   * the row's second line: the address up to its first comma. The city is
   * where the staff already are, and the row has two lines to spend.
   */
  protected readonly shopOptions = computed<readonly VisitEditorShopOption[]>(
    () =>
      this.catalog.locations().map((location) => ({
        id: location.id,
        label: this.content.text(location.name),
        address: streetOf(this.content.text(location.address)),
        lat: location.latitude,
        lng: location.longitude,
      })),
  );

  /**
   * The catalogue the visit sheet's quick-add menu offers.
   *
   * ⚠ `[uiServices]` HAD NEVER BEEN BOUND. The editor has declared this
   * input since it was written and the dashboard passed only `[uiBarbers]`,
   * so the pushed service-search page has always rendered `Няма такава
   * услуга в каталога.` in the running app — a whole surface fed by nothing.
   * The quick-add menu is what finally made the hole visible, because an
   * empty menu is a hole you cannot navigate past.
   *
   * PRICED AND TIMED FOR THIS CHAIR. The catalogue prices per barber — a
   * fade is 30 minutes with one and 45 with another — so a menu quoting the
   * default terms would offer a duration the chair cannot honour. The chair
   * comes off the LANE holding this row, which `visitEditorVm` already looks
   * up for its neighbours; `DayRowVm` need not grow a field for it.
   *
   * ⚠ THE SERVER'S TERMS, not a second resolver: every chair is offered
   * the whole catalogue, a service he does not perform included, and the
   * terms are `OfferingPriceSystem.termsFor` — the resolution the server's
   * own decision prices an added seat with. It reads the chair's offering
   * and, for a chair with none, the service's OWN terms; the VM path this
   * replaced fell back to the FIRST barber's offering and quoted another
   * chair's price and minutes for a seat the server would charge
   * differently. `serviceVms()` still names the services and variants, and
   * `CatalogWording.price` words the figure as the client's catalogue
   * does.
   */
  protected readonly visitServiceOptions = computed<
    readonly VisitEditorServiceOption[]
  >(() => {
    // The chair the sheet is about: the open visit's lane, or the chair a
    // NEW visit is being drafted on — the catalogue is priced per chair.
    const row = this.visitSheetRow();
    const lane =
      row === null
        ? null
        : this.lanes().find((entry) =>
            entry.entries.some(
              (e) => e.agendaRow === AgendaRow.Visit && e.id === row.id,
            ),
          );
    // The DRAFT's chair first (2026-09-09): the catalogue and its terms are
    // per chair, so a switched barber offers his own services.
    const barberId: BarberId | null =
      this.visitDraftChair() ??
      lane?.barberId ??
      this.createVisit()?.barberId ??
      null;
    if (barberId === null) return [];
    return this.catalog
      .serviceVms()
      .flatMap((vm): VisitEditorServiceOption[] => {
        const service = this.catalog.findService(vm.id);
        // The VM is the entity's own (`serviceVms` maps `services`); one
        // the list no longer holds has no terms to quote.
        if (service === undefined) return [];
        // The chair's terms as the server resolves them: the cents, the
        // currency and the minutes straight off `ServiceTerms` (D-10.3);
        // the LABEL is those cents in their own currency, worded as the
        // client's catalogue words them (`CatalogWording.price`).
        const termsOf = (variantId: ServiceVariantId | null) =>
          OfferingPriceSystem.termsFor(service, barberId, variantId);
        const name = this.content.text(vm.name);
        // A service WITH variants is offered per variant — `Класическа
        // подстрижка · Дълга коса` — and never bare: the server refuses a
        // seat whose price the variant would move. Terms come from the
        // chair's own matrix, falling back to its base for a variant it has
        // not priced separately (`termsFor`).
        if (vm.variants.length > 0) {
          return vm.variants.map((variant) => {
            const terms = termsOf(variant.id);
            return {
              id: `${vm.id}:${variant.id}`,
              serviceId: service.id,
              variantId: variant.id,
              label: `${name} · ${this.content.text(variant.name)}`,
              serviceLabel: name,
              variantLabel: this.content.text(variant.name),
              minutes: terms.durationMinutes,
              priceCents: terms.priceCents,
              currency: terms.currency,
              priceLabel: this.content.price({
                amountCents: terms.priceCents,
                currency: terms.currency,
              }),
            };
          });
        }
        const terms = termsOf(null);
        return [
          {
            id: vm.id,
            serviceId: service.id,
            variantId: null,
            label: name,
            serviceLabel: name,
            minutes: terms.durationMinutes,
            priceCents: terms.priceCents,
            currency: terms.currency,
            priceLabel: this.content.price({
              amountCents: terms.priceCents,
              currency: terms.currency,
            }),
          },
        ];
      });
  });

  /** Chairs the scope picker offers — every chair that works this period. */
  protected readonly scopeOptions = computed(() =>
    // `barberVms` rather than `barbers`: the presenter has already resolved
    // the portraits the lane headers draw, and a second resolution here would
    // be a second answer to the same question.
    this.catalog.barberVms().map((vm) => ({
      id: vm.id,
      name: this.content.text(vm.name),
      avatarSrc: vm.avatarSrc ?? null,
      // THE LEGEND. Which colour means which chair is learnable nowhere else
      // on this screen: the rail teaches the alphabet but never says what the
      // letters stand for.
      tone: this.toneOf(vm.id),
    })),
  );

  /**
   * Columns for the grid.
   *
   * The day view columns by CHAIR; the multi-day views column by DATE. That
   * is the whole difference between them — five chairs across seven days is
   * thirty-five columns, so the multi-day views merge chairs into a date and
   * attribute each block instead.
   */
  protected readonly gridColumns = computed<readonly GridColumn[]>(() => {
    const shopNow = this.store.shopNow();
    const cells = this.store.dayCells();
    const today = this.store.todayKey();

    if (this.store.view() === StaffView.Day) {
      const cell = cells.find((entry) => entry.dayKey === this.store.dayKey());
      // EVERY barber in scope gets a column, including one who is off.
      //
      // The filter that used to sit here dropped unrostered chairs, and a
      // dropped column is not a quiet answer — it is no answer. "Off today",
      // "not in this scope", "no longer at the shop" and "the roster failed
      // to load" all rendered as the same nothing, and the day view's column
      // count changed with the data, so the same chair sat in a different
      // place on different days. An off barber is now an explicitly muted
      // column with a day-off chip in the all-day row (owner ruling
      // 2026-08-10).
      return (cell?.lanes ?? []).map((lane) => ({
        id: lane.barberId,
        title: this.barberNameOf(lane.barberId),
        // THE HEAD AT THREE WIDTHS (2026-09-23, §4): the first name where
        // the whole one would truncate, the portrait alone below that; the
        // whole name stays on the accessible label.
        shortTitle: firstNameOf(this.barberNameOf(lane.barberId)),
        initial: null,
        fullTitle: this.barberNameOf(lane.barberId),
        detail: null,
        dayNumber: null,
        // Barber columns all sit on the anchor day, so they are "today"
        // together — which is what tells the grid whether to draw the
        // now-line at all.
        isToday: this.store.dayKey() === today,
        avatarSrc:
          this.scopeOptions().find((option) => option.id === lane.barberId)
            ?.avatarSrc ?? null,
        events:
          cell === undefined
            ? []
            : this.eventsFor(lane, cell.dayKey, shopNow, false),
        // THIS chair's hours, not the shop's. Two barbers on different
        // shifts is the normal case, and shading both columns to the widest
        // of the two would say the early one is working at 20:00.
        open: this.openWindowsOf([lane]),
      }));
    }

    // Only the days ON SCREEN: the cells also carry the visit sheet's probe
    // day, which is subscribed for the sheet's frame and is not a column.
    const visible = this.store.visibleDays();
    return cells
      .filter((cell) => visible.includes(cell.dayKey))
      .map((cell) => ({
        id: cell.dayKey,
        title: this.weekdayLabel(cell.dayKey),
        // The short weekday beside the capsule while the column can carry a
        // word; the weekday's INITIAL over it below that — the same narrow
        // form the week strip writes, from the same formatter (§4). The
        // long date is the accessible name at every width.
        shortTitle: this.weekdayLabel(cell.dayKey),
        initial: this.weekdayInitial(cell.dayKey),
        fullTitle: this.formatTitled(cell.dayKey, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        }),
        detail: null,
        dayNumber: LocalDate.parts(cell.dayKey).day,
        isToday: cell.dayKey === today,
        avatarSrc: null,
        events: cell.lanes
          .filter((lane) =>
            RosterSystem.worksDay(
              lane.rostered.length,
              lane.appointments.length,
            ),
          )
          .flatMap((lane) =>
            // Gaps are omitted once chairs are merged into one date column:
            // Ivan's free 14:00 is not the shop's free 14:00, and drawing both
            // as holes in the same column would state something untrue.
            this.eventsFor(
              lane,
              cell.dayKey,
              shopNow,
              this.store.scope() === null,
            ),
          )
          .sort((a, b) => a.startMinute - b.startMinute),
        // Chairs are merged into a date here, so the column is open whenever
        // ANY of them is — the union, not the intersection. A date nobody works
        // has no windows at all and shades solid, which is how a closed Sunday
        // finally looks different from an empty one.
        open: this.openWindowsOf(cell.lanes),
      }));
  });

  /**
   * The working windows of these lanes, merged, as minutes from midnight.
   *
   * Merged rather than concatenated (`IntervalSetSystem.normalize`: sorted,
   * touching and overlapping windows joined): overlapping shifts would
   * otherwise carve a phantom "closed" sliver between two barbers who are
   * both at work. The lanes carry the store's own wall-clock minutes, so a
   * shift that closes at midnight ends at 1440 rather than wrapping to 0.
   */
  private openWindowsOf(
    lanes: readonly BarberDayLane[],
  ): readonly OpenWindow[] {
    return IntervalSetSystem.normalize(
      // Rostered time AND the time carved out of it — together they are the
      // day the barber is AT WORK, which is what the shading is answering.
      //
      // `rostered` alone is post-carve, so a blocked hour was shaded closed
      // AND drawn as a block on top of it: the same span said twice, in two
      // vocabularies, one of which meant "the shop is shut". Shading now says
      // only "not working"; a block says "working, but taken".
      lanes.flatMap((lane) => [...lane.rostered, ...lane.blocks]),
    ).map((window) => ({
      startMinute: window.startMinutes,
      endMinute: window.endMinutes,
    }));
  }

  /** Tapping a block in the grid opens the row it stands for. */
  protected openVisit(rowId: string): void {
    const row = this.lanes()
      .flatMap((lane) => lane.entries)
      .find(
        (entry): entry is DayRowVm =>
          entry.agendaRow === AgendaRow.Visit && entry.id === rowId,
      );
    // The visit SHEET, not the row popover this used to open — that surface
    // was removed with the row's overflow, so a tap on a calendar block had
    // quietly become a no-op.
    if (row) this.openVisitSheet(row);
  }

  /**
   * The zone abbreviation every time on this surface is stated in — "EEST"
   * in summer, "EET" in winter, resolved rather than hardcoded so it stays
   * true across the changeover (`formatZoneName`, the shared cached face; the
   * `en-GB` abbreviation whatever the reader's language).
   */
  protected readonly zoneLabel = computed(() => {
    const zone = this.store.zone();
    if (zone === null) return '';
    return formatZoneName(this.nowUtcMs(), zone, 'en-GB');
  });

  /** The zone the device's clock is set to, as the platform resolves it. */
  protected readonly deviceZone = signal(
    new Intl.DateTimeFormat().resolvedOptions().timeZone,
  );

  /**
   * The grid corner's zone label — only while the device's clock is NOT
   * the shop's (review r4, 2026-10-06: «EEST» in every grid's corner read
   * as a debug label; a barber's phone is in the shop's zone and nothing
   * else in the app names one). Apple Calendar leaves the corner empty.
   * The zone is named where it would otherwise be assumed wrongly — a
   * phone abroad, a desktop set to UTC — and the alert that explains it
   * opens from that label. Empty, the grid draws a blank corner.
   */
  protected readonly zoneCorner = computed(() =>
    this.deviceZone() === this.store.zone() ? '' : this.zoneLabel(),
  );

  /**
   * What is true of a WHOLE column and has no hour to sit at.
   *
   * Today that is one thing: a barber not rostered. It is real content — a
   * date column showing four chairs must say the fifth is off, or the shop
   * reads an empty column as "free" rather than "away".
   */
  protected readonly allDay = computed<Record<string, readonly AllDayEntry[]>>(
    () => {
      const out: Record<string, AllDayEntry[]> = {};

      // In the day view a column IS a barber, so the chip names the fact rather
      // than the person — the column head above it is already the name. The
      // shading says "nothing can happen here"; this says WHY, which shading
      // alone cannot, and which is the only form a screen reader can read.
      if (this.store.view() === StaffView.Day) {
        const cell = this.store
          .dayCells()
          .find((entry) => entry.dayKey === this.store.dayKey());
        const off = this.transloco.translate('staff.day.offBadge');
        for (const lane of cell?.lanes ?? []) {
          if (lane.rostered.length === 0) {
            out[lane.barberId] = [
              {
                key: lane.barberId,
                label: off,
                shortLabel: off,
                initial: firstNameOf(this.barberNameOf(lane.barberId)).charAt(
                  0,
                ),
                tone: this.toneOf(lane.barberId),
                accessibleName: off,
              },
            ];
          }
        }
        return out;
      }

      // A DATE column: the chip says WHO — the first name where the cell
      // can carry a word, the initial on the chair's tone disc where it
      // cannot (§8) — and the whole sentence stays the accessible name.
      // Three chips, then «+N»: a phone has no tooltips, and a scroller
      // inside the pinned band would be a trap.
      for (const cell of this.store.dayCells()) {
        const off = cell.lanes
          .filter((lane) => lane.rostered.length === 0)
          .map((lane) => {
            const name = this.barberNameOf(lane.barberId);
            const first = firstNameOf(name);
            return {
              key: lane.barberId,
              label: this.transloco.translate('staff.day.offChip', {
                name: first,
              }),
              shortLabel: first,
              initial: first.charAt(0),
              tone: this.toneOf(lane.barberId),
              accessibleName: this.transloco.translate('staff.day.offChip', {
                name,
              }),
            };
          });
        if (off.length === 0) continue;
        if (off.length <= ALL_DAY_CHIP_CAP) {
          out[cell.dayKey] = off;
          continue;
        }
        // Three named, then «+N» for the rest — never fewer names as more
        // chairs are off (an off-by-one found in review, 2026-09-23).
        const rest = off.length - ALL_DAY_CHIP_CAP;
        const more = this.transloco.translate('staff.day.allDayMore', {
          count: rest,
        });
        out[cell.dayKey] = [
          ...off.slice(0, ALL_DAY_CHIP_CAP),
          {
            key: ALL_DAY_MORE_KEY,
            label: `+${rest}`,
            shortLabel: `+${rest}`,
            initial: `+${rest}`,
            tone: null,
            accessibleName: more,
          },
        ];
      }
      return out;
    },
  );

  /**
   * The zone is DISPLAY-ONLY and single-valued today: every shop keeps the
   * one clock (blueprint §7.1), so there is nothing to switch TO. Saying so
   * plainly beats a picker with one entry pretending otherwise.
   */
  protected explainZone(): void {
    this.zoneNoticeOpen.set(true);
  }

  protected readonly zoneNoticeOpen = signal(false);

  /** The now-line belongs to one column in the date-columned views. */
  protected readonly nowColumnId = computed(() =>
    this.store.view() === StaffView.Day ? null : this.store.todayKey(),
  );

  private eventsFor(
    lane: BarberDayLane,
    localDate: LocalDate,
    shopNow: ShopNow | null,
    attribute: boolean,
  ): readonly GridEvent[] {
    const nowUtcMs = this.nowUtcMs();
    const visits = lane.appointments.flatMap((appointment) => {
      const row = this.toRow(appointment, lane.barberId, nowUtcMs, shopNow);
      return [
        {
          id: row.id,
          gridEvent: GridEventTag.Visit,
          // The seat's own wall clock, as stored (Law 7.3).
          startMinute: row.startMinute,
          endMinute: row.endMinute,
          title: row.clientLabel,
          // A cancelled or missed hour says so on the line under the name —
          // the block's clock is withheld on a narrow column, and the
          // service matters less than that it did not happen (2026-09-24).
          detail: this.stateLabel(row) ?? row.serviceLabel,
          attribution: attribute ? this.barberNameOf(lane.barberId) : null,
          // The stored tag; the grid prints its lowercase DOM word.
          bookingStatus: row.bookingStatus,
          terminal: row.terminal,
          barberTone: this.toneOf(lane.barberId),
          // The hour, not the outcome: whatever became of it, a 10:00 slot is
          // behind us by noon. Same rule the search sheet sorts by — the
          // row's own (`VisitStorySystem.hasEnded`, on the wall clock).
          past: row.past,
          accessibleName: this.blockName(row, lane.barberId),
          // One vocabulary across the three surfaces (owner review
          // 2026-09-08): the sheet's arrived glyph is the block's too, for as
          // long as the visit is live.
          statusIcon:
            row.arrived && !row.terminal
              ? 'visit.arrived'
              : (STATUS_ICONS[row.bookingStatus] ?? null),
          partyLabel: row.partyLabel,
        },
      ];
    });
    // NO gap blocks on the grid.
    //
    // A proportional canvas already draws a hole as a hole — empty space IS
    // the gap, which is the same argument the list's gap ROW rests on
    // inverted: a list has no empty space to read, so it needs the row, and a
    // grid has nothing but empty space, so the row is chrome over a fact the
    // eye already has. Drawing both filled the calendar with boxes saying
    // "nothing here".
    //
    // A CARVE-OUT is the opposite case and does get drawn. It is not empty
    // space — it is time somebody took, and the only non-visit thing on this
    // surface a person is meant to be able to move or lift.
    return [...visits, ...this.blocksFor(lane, localDate, shopNow, attribute)];
  }

  /** A lane's breaks and admin hours, as blocks the grid can draw. */
  private blocksFor(
    lane: BarberDayLane,
    localDate: LocalDate,
    shopNow: ShopNow | null,
    attribute: boolean,
  ): readonly GridEvent[] {
    const label = this.transloco.translate('staff.day.blockedLabel');
    return lane.blocks.map((interval) => {
      const from = this.nameClock(localDate, interval.startMinutes);
      const to = this.nameClock(localDate, interval.endMinutes);
      return {
        // Stable across a re-render, and unique per lane and DAY: a
        // barber's day holds at most one exception document, so the chair,
        // the day and the start name this block uniquely without inventing
        // an id the store cannot resolve back to anything — and the day
        // keeps a block of another visible date from answering for the
        // shown day's (`openBlock`, DEP-11).
        id: `block:${lane.barberId}:${localDate}:${interval.startMinutes}`,
        gridEvent: GridEventTag.Block,
        // The store's own wall-clock minutes — a block that closes at
        // midnight ends at 1440, anchored on its day.
        startMinute: interval.startMinutes,
        endMinute: interval.endMinutes,
        title: label,
        detail: null,
        // A carve-out is the opposite of a booking; identity is not its
        // business, and the rail stays neutral (the grid's own ruling).
        barberTone: null,
        attribution: attribute ? this.barberNameOf(lane.barberId) : null,
        bookingStatus: null,
        terminal: false,
        past:
          shopNow !== null &&
          VisitStorySystem.hasEnded(
            { localDate, minute: interval.endMinutes },
            shopNow,
          ),
        // Says WHAT it is and WHEN — the channel the shading never had.
        accessibleName: `${label}, ${from}–${to}`,
        statusIcon: 'booking.blocked' as const,
        // A carve-out is time, not a booking — there is no party to be part of.
        partyLabel: null,
      };
    });
  }

  /**
   * A wall-clock minute of a shop day as an accessible name reads it —
   * «13:00» in `en-GB`, whatever the reader's locale (a fixed 24-hour face,
   * not a language): a laptop left in UTC must not put a barber's lunch two
   * hours out. The closing midnight reads «00:00».
   */
  private nameClock(localDate: LocalDate, minute: MinuteOfDay | EndMinute) {
    return formatWallClock(localDate, minute, 'en-GB', CLOCK_FACE);
  }

  /**
   * The outer edges of a chair's roster windows on the shop's wall clock —
   * the earliest start and the latest end (`IntervalSetSystem.hull`) — or
   * `null` for none, which each caller answers with its own fallback. The
   * windows are the store's own minutes, so one that closes at midnight
   * ends at 1440.
   */
  private rosterHull(windows: readonly MinuteRange[]): MinuteRange | null {
    return IntervalSetSystem.hull(windows);
  }

  /**
   * The first working minute across every visible day — where the grid
   * SCROLLS TO on a day with no now-line to anchor on.
   *
   * Not an extent any more: each column carries its own hours (see
   * `openWindowsOf`) and the axis is the whole day regardless. Only the start
   * survives, because only the start answers "where should this open".
   */
  protected readonly rosterExtent = computed<{
    readonly start: MinuteOfDay | null;
  }>(() => {
    let start: MinuteOfDay | null = null;
    for (const cell of this.store.dayCells()) {
      for (const lane of cell.lanes) {
        for (const window of lane.rostered) {
          if (start === null || window.startMinutes < start) {
            start = window.startMinutes;
          }
        }
      }
    }
    return { start };
  });

  /**
   * Now, as minutes from midnight — the grid's own axis (the store's
   * `ShopNow`); the opening midnight while no zone is known, as the page
   * always drew it then.
   */
  protected readonly nowMinute = computed<MinuteOfDay>(
    () => this.store.shopNow()?.currentMinute ?? MIDNIGHT,
  );

  /**
   * The block's story in words — client, service, span, and the state.
   *
   * The visual block drops its service line when it is short and says its
   * state only in form and a glyph; none of that reaches a screen reader, so
   * the whole fact is composed here.
   */
  private blockName(row: DayRowVm, barberId: BarberId): string {
    return [
      row.clientLabel,
      row.serviceLabel,
      `${row.startLabel}–${row.endLabel}`,
      this.barberNameOf(barberId),
      this.transloco.translate(
        `appointments.status.${bookingStatusWords[row.bookingStatus]}`,
      ),
      // The party share is drawn as a glyph and a ratio, and a short block
      // drops it entirely — neither reaches a screen reader, and "this is one
      // of two seats" is exactly the fact that changes what a move means.
      ...(row.partySize > 1
        ? [
            this.transloco.translate('staff.day.partyOf', {
              count: row.partySize,
            }),
          ]
        : []),
    ].join(', ');
  }

  /** The same sum, formatted («27,50 €»). */
  private seatsPrice(seats: readonly Seat[]): string | null {
    const sum = BillingSystem.subtotalOf(seats);
    return sum.ok
      ? formatCents(
          sum.value.amountCents,
          sum.value.currency,
          this.transloco.getActiveLang(),
        )
      : null;
  }

  /**
   * What this chair's seats were tipped, as a figure and in cents.
   *
   * `null` on both when NOT ONE seat carries a recording — which is not the
   * same as a chair that was tipped nothing, and is why an unrecorded row
   * offers `＋ Добави бакшиш` while a zero one states `0,00 €`.
   */
  private seatsTip(seats: readonly Seat[]): {
    tipLabel: string | null;
    tipCents: PriceCents | null;
  } {
    const first = seats[0];
    // Mixed currencies within one chair is a data error, not a feature;
    // the tips are read in the chair's own currency (`BillingSystem.tipsOf`).
    const total =
      first === undefined ? null : BillingSystem.tipsOf(seats, first.currency);
    if (total === null) return { tipLabel: null, tipCents: null };
    return {
      tipLabel: formatCents(
        total.amountCents,
        total.currency,
        this.transloco.getActiveLang(),
      ),
      tipCents: total.amountCents,
    };
  }

  private barberNameOf(barberId: BarberId): string {
    const barber = this.catalog
      .barbers()
      .find((entry) => entry.id === barberId);
    return barber ? this.content.text(barber.name) : barberId;
  }

  private weekdayLabel(dayKey: LocalDate): string {
    return abbreviateWeekday(
      this.formatTitled(dayKey, { weekday: 'long' }),
      this.content.locale(),
    );
  }

  /**
   * The weekday's one-letter form — the week strip's own, from the same
   * `Intl` narrow formatter, so a date column too narrow for a word writes
   * its day the way the strip above it does (never a second formatter: the
   * pickers may not differ in facts, 2026-09-04).
   */
  private weekdayInitial(dayKey: LocalDate): string {
    const locale = this.content.locale();
    return formatWallClock(dayKey, null, locale, { weekday: 'narrow' });
  }

  /**
   * Format, with the MONTH capitalised.
   *
   * Bulgarian writes month names lowercase in prose ("7 август"), and `Intl`
   * follows the language. A heading is not prose — the reference's `May` is
   * title case, and "7 Август" reads as a label rather than a sentence
   * fragment. Only the month part is touched, so the day number and any
   * separators come back untouched, and English (already capitalised) is
   * unchanged.
   */
  private formatTitled(
    at: LocalDate,
    options: Intl.DateTimeFormatOptions,
  ): string {
    const locale = this.content.locale();
    return wallClockParts(at, null, locale, options)
      .map((part) =>
        part.type === 'month'
          ? part.value.charAt(0).toLocaleUpperCase(locale) + part.value.slice(1)
          : part.value,
      )
      .join('');
  }

  /**
   * «ср, 9.09» for a day; «21 – 27.09» for a period — the pill's ONE
   * numeric grammar for both (2026-09-23, the grid views' design record
   * §9). The range used to be written in the long month («23 – 25
   * Септември») for a headline segment that no longer exists, and in the
   * pill it pushed the search and the chair picker off a 390px bar.
   */
  protected readonly periodLabel = computed(() => {
    const days = this.store.visibleDays();
    const first = days[0];
    // NO DAYS YET — a cold load before the shop's zone is read, when there
    // is no "today" to anchor a period on. The canvas binds its region
    // label off this before `store.ready()`, so it names nothing rather
    // than formatting a day that is not there (it threw on every load).
    if (first === undefined) return '';
    if (days.length <= 1) {
      /*
       * ⚠ THE WEEKDAY LEADS. (owner ruling 2026-09-04)
       *
       * This read `4 Септември` while the visit sheet's pill two taps away
       * read `пт, 4.09` — the same date, and one of them never said which
       * day of the week it was. The two pickers may differ in DENSITY, a
       * page title against a field value, and Apple's own apps do exactly
       * that; they must not differ in FACTS. In a barbershop a Saturday is
       * not a Tuesday, and the day a barber is standing in was the one
       * thing this label left out.
       */
      // The pill's own grammar — one formatter for both pickers.
      return formatDayPill(first, this.content.locale());
    }
    const last = days.at(-1) ?? first;
    return formatDayPillRange(first, last, this.content.locale());
  });

  /**
   * The scroller's accessible name — which period the region holds, so a
   * keyboard or a switch control landing on 3000px of two-axis scroll
   * knows what it has reached.
   */
  protected readonly regionLabel = computed(() =>
    this.transloco.translate('staff.day.gridRegion', {
      period: this.periodLabel(),
    }),
  );

  /**
   * Every barber's identity tone, assigned once for the whole catalogue.
   *
   * Keyed off the CATALOGUE rather than the day's lanes on purpose: a
   * barber's colour must not change because they happen to be off on
   * Tuesday, and the calendar views read the same map.
   */
  protected readonly barberTones = computed<ReadonlyMap<string, number>>(() => {
    const ids = this.catalog.barberVms().map((vm) => vm.id);
    // The system answers parallel to the roster; the views look a chair
    // up by its id.
    const tones = BarberToneSystem.assignBarberTones(ids);
    return new Map<string, number>(
      ids.map((id, index) => [id, tones.at(index) ?? 0]),
    );
  });

  /**
   * A chair's tone by its id — a `BarberId`, or a menu option's id that
   * names one (the scope switcher's rows; `'all'` names none and reads 0).
   */
  protected toneOf(barberId: string): number {
    return this.barberTones().get(barberId) ?? 0;
  }

  protected readonly lanes = computed<readonly LaneVm[]>(() => {
    const vmById = new Map(
      this.catalog.barberVms().map((vm) => [vm.id, vm] as const),
    );
    const nowUtcMs = this.nowUtcMs();
    const shopNow = this.store.shopNow();
    // The lanes are the shown day's (`workingLanes`).
    const localDate = this.store.dayKey();

    return this.store.workingLanes().map((lane) => {
      const vm = vmById.get(lane.barberId);

      const visits = lane.appointments.map((appointment) =>
        this.toRow(appointment, lane.barberId, nowUtcMs, shopNow),
      );
      const barberName = vm ? this.content.text(vm.name) : lane.barberId;
      const gaps: GapRowVm[] = lane.gaps.map((gap) => ({
        agendaRow: AgendaRow.Gap,
        // The BARBER in the id: two chairs free from 14:00 are two different
        // holes, and a shared key would collapse them in the agenda's track.
        // The START too, since one hole now splits into two at the clock.
        id: `gap-${lane.barberId}-${gap.startMinutes}`,
        startLabel:
          localDate === null ? '' : this.wallTime(localDate, gap.startMinutes),
        endLabel:
          localDate === null ? '' : this.wallTime(localDate, gap.endMinutes),
        minutes: gap.minutes,
        startMinutes: gap.startMinutes,
        past: !gap.sellable,
        sellable: gap.sellable,
        barberName,
        barberAvatarSrc: vm?.avatarSrc ?? null,
        barberTone: this.toneOf(lane.barberId),
      }));

      // One run in clock order, on the shop's wall clock (one shop day per
      // lane). A gap and a visit never share a start minute — a hole holds
      // no visit's start — so the stable sort is total without a tiebreak.
      const clockOrder: RunEntryVm[] = [...visits, ...gaps].sort(
        (a, b) => startMinuteOf(a) - startMinuteOf(b),
      );

      // ── The present tense ──────────────────────────────────────────────
      //
      // The run had none: nothing separated a cut finished at ten from one
      // three hours out, and the screen opened at 09:00 on a day already
      // half over. The chair's next unstarted visit is the row the eye
      // should find first; the NOW hairline is where the day actually is.
      // The FIRST in the lane's own order (the envelope order the day's
      // reader delivers) that has not begun on the shop's wall clock
      // (`VisitStorySystem.hasStarted`).
      const next =
        shopNow === null
          ? undefined
          : visits.find(
              (row) =>
                !row.terminal &&
                !VisitStorySystem.hasStarted(
                  WallTime.of(row.localDate, row.startMinute),
                  shopNow,
                ),
            );
      const entries: RunEntryVm[] = clockOrder.map((entry) =>
        entry.agendaRow === AgendaRow.Visit && entry.id === next?.id
          ? { ...entry, isNext: true }
          : entry,
      );

      return {
        barberId: lane.barberId,
        barberName,
        avatarSrc: vm?.avatarSrc ?? null,
        entries,
        rostered: lane.rostered.length > 0,
        failed: lane.failed,
      };
    });
  });

  /**
   * THE AGENDA — every chair's day as one clock-ordered run.
   *
   * Built from `lanes()` rather than replacing it: the lane model is still
   * what the calendar views column by, and what tells a gap whose chair it
   * belongs to. This flattens that into the shape a person reads.
   *
   * Gaps come along and stay ATTRIBUTED (owner ruling): free time is a
   * property of one chair, so a gap card names the barber it belongs to or
   * it is nonsense sitting between two other people's cuts.
   *
   * The now marker is inserted ONCE for the whole shop, not once per chair —
   * three hairlines all reading 15:50 was the clearest symptom that the old
   * list was three schedules rather than one.
   */
  protected readonly agenda = computed<readonly AgendaGroupVm[]>(() => {
    const shopNow = this.store.shopNow();
    // The run is the shown day's — every group begins on it.
    const localDate = this.store.dayKey();

    /**
     * ELAPSED HOLES, at the whole shop's scope, are not rows.
     *
     * `lane-gaps.spec.ts` rules that a hole which has passed is still a fact
     * — the chair sat empty and nobody filled it — and that hiding it makes
     * an idle morning and a booked one render identically. That ruling is
     * about the STORE, and the store still computes every one of them: the
     * `sellable: false` gaps are all there, and the day's summary line reads
     * its total straight off them. What is settled here is only whether each
     * one earns a card.
     *
     * At one chair it does: the barber between cuts is looking at their own
     * morning and the holes in it are the subject. At five chairs it cannot
     * — five lanes × every twenty-minute hole is a screenful of things that
     * already happened and that nobody can act on, filed between the
     * bookings that are the reason the screen is open. The fact the spec
     * protects survives in the summary above the run, in words, which is
     * where a total belongs anyway.
     */
    const wholeShop = this.store.scope() === null;
    const freeTime = this.fields.isOn(AgendaField.FreeTime);
    const items = this.lanes()
      .flatMap((lane) => lane.entries)
      .filter((entry) => {
        if (entry.agendaRow !== AgendaRow.Gap) return true;
        // Holes are a SECOND question — off unless someone is asking it.
        if (!freeTime) return false;
        return !(wholeShop && !entry.sellable);
      });

    if (localDate === null) return [];
    const byStart = new Map<MinuteOfDay, RunEntryVm[]>();
    for (const item of items) {
      // Minute resolution — the wall clock's own grain: every entry begins
      // on a stored minute of the shown day.
      const minute = startMinuteOf(item);
      const bucket = byStart.get(minute);
      if (bucket) bucket.push(item);
      else byStart.set(minute, [item]);
    }

    return [...byStart.entries()]
      .sort(([a], [b]) => a - b)
      .map(([startMinutes, group]) => ({
        key: String(startMinutes),
        timeLabel: this.wallTime(localDate, startMinutes),
        startMinutes,
        // The heading is past once the shop's clock has reached it — its
        // minute begun (`VisitStorySystem.hasStarted`, DEP-4).
        past:
          shopNow !== null &&
          VisitStorySystem.hasStarted(
            WallTime.of(localDate, startMinutes),
            shopNow,
          ),
        // Visits before gaps at the same minute — what is booked outranks
        // what is merely available, and a stable order stops cards jumping
        // as the store ticks.
        items: [...group].sort((a, b) => {
          if (a.agendaRow !== b.agendaRow) {
            return a.agendaRow === AgendaRow.Visit ? -1 : 1;
          }
          return a.agendaRow === AgendaRow.Visit &&
            b.agendaRow === AgendaRow.Visit
            ? a.barberName.localeCompare(b.barberName)
            : 0;
        }),
      }));
  });

  /**
   * Where the now line goes: before the first group the clock has not
   * reached. `null` when today is not on screen, or when the day is over.
   */
  protected readonly agendaNowIndex = computed<number | null>(() => {
    if (!this.store.isToday()) return null;
    const groups = this.agenda();
    if (groups.length === 0) return null;
    // The first heading the shop's clock has not reached (`past` is
    // `hasStarted`, DEP-4).
    const at = groups.findIndex((group) => !group.past);
    return at === -1 ? groups.length : at;
  });

  // ── The week strip ───────────────────────────────────────────────────
  //
  // A run of weeks that SLIDES, one whole week per gesture, with no chevrons.
  // `ui-scroll-row` supplies the mechanics — `scroll-snap-type: x mandatory`
  // with `scroll-snap-align: start` on each child — so the snapping is the
  // browser's, on the compositor, and there is no scroll listener anywhere.
  // Each child is exactly one week wide, which is what makes a flick advance
  // by a week rather than by a day.
  //
  // The window is BOUNDED and anchored to today rather than to the selection:
  // 4 weeks back for looking up what happened, 8 forward for the booking
  // horizon. Anchoring to the selection instead would re-key every week on
  // every tap, and `@for` would rebuild the strip under the user's thumb.

  /** How far the strip runs either side of this week. */
  private static readonly WEEKS_BACK = 4;
  private static readonly WEEKS_AHEAD = 8;

  /**
   * The strip's CELLS — thirteen weeks of them, and not one of them depends
   * on which day is SHOWN.
   *
   * This used to live inside `weekStrip`, which reads `dayKey()`. So every
   * tap rebuilt all ninety-one cells and, inside the loop, constructed a
   * hundred and eighty-two `Intl.DateTimeFormat`s to re-derive labels that
   * had not changed — constructing a formatter resolves locale data and is
   * the expensive half of `Intl` by a wide margin. Measured, that was ~33ms
   * between the tap and the disc starting to move: two frames of dead air
   * that no easing curve can hide, because the transition cannot begin until
   * change detection lets go.
   *
   * Split out, the skeleton recomputes only when the DATE or the LOCALE
   * turns over, and the two faces come from the shared, cached formatters
   * (`formatWallClock`) instead of two built per cell.
   */
  private readonly weekCalendar = computed(() => {
    const today = this.store.todayKey();
    // No today before the shop's zone is known: no strip to build.
    if (today === null) return [];
    const locale = this.content.locale();
    const first = LocalDate.addDays(
      LocalDate.startOfWeek(today),
      -StaffDashboard.WEEKS_BACK * 7,
    );
    const weeks = StaffDashboard.WEEKS_BACK + StaffDashboard.WEEKS_AHEAD + 1;

    return Array.from({ length: weeks }, (_, w) => {
      const weekStart = LocalDate.addDays(first, w * 7);
      return {
        key: weekStart,
        days: Array.from({ length: 7 }, (_, d) => {
          const key = LocalDate.addDays(weekStart, d);
          return {
            key,
            // The weekday INITIAL, Apple's own strip: the column position
            // already says which day it is, so the letter is a reminder and
            // not a label.
            initial: formatWallClock(key, null, locale, { weekday: 'narrow' }),
            number: formatWallClock(key, null, locale, { day: 'numeric' }),
            today: key === today,
          };
        }),
      };
    });
  });

  /**
   * The strip, with the selection laid over it.
   *
   * Only the marker's column is derived here. Whether a given day is the
   * shown one is a comparison the template makes against `store.dayKey()`
   * directly — the same idiom the date picker already uses — so `week.days`
   * keeps its identity from `weekCalendar` and a tap allocates thirteen
   * objects rather than a hundred and four.
   */
  protected readonly weekStrip = computed(() => {
    const selected = this.store.dayKey();
    return this.weekCalendar().map((week) => ({
      ...week,
      // Which column the marker parks in, or -1 when the shown day is not in
      // this week. The marker is per-week and slides between columns, so the
      // week has to own the index rather than the day owning a flag.
      selectedIndex: week.days.findIndex((day) => day.key === selected),
    }));
  });

  /** Which week holds the shown day — the one the strip scrolls to. */
  protected readonly selectedWeek = computed(() => {
    const day = this.store.dayKey();
    return day === null ? null : LocalDate.startOfWeek(day);
  });

  /**
   * Keep the strip on the shown day's week.
   *
   * Only when the day moves to a DIFFERENT week — tapping a day inside the
   * visible week must not re-scroll under the thumb that just tapped it.
   * `scrollIntoView` on the week element rather than a computed offset: the
   * browser already knows where its own snap points are.
   */
  private readonly strippedWeek = signal<LocalDate | null>(null);

  protected readonly followWeek = effect(() => {
    const week = this.selectedWeek();
    // No day yet (the shop's zone is resolving): nothing to follow.
    if (week === null) return;
    if (untracked(() => this.strippedWeek()) === week) return;
    this.strippedWeek.set(week);
    const first = untracked(() => this.weekCalendar())[0]?.key ?? week;
    const index = Math.round(LocalDate.daysBetween(first, week) / 7);
    afterNextRender(() => this.settleOnWeek(index, ANCHOR_FRAMES), {
      injector: this.injector,
    });
  });

  protected readonly nowLabel = computed(() => this.time(this.nowUtcMs()));

  /**
   * Which group the run should OPEN on.
   *
   * The list has no now-line — a rule drawn at the current time is a
   * day-view mark, true only on a continuous axis where the distance between
   * two rows is the minutes between them. In a list, two cards are 4px apart
   * whether they are ten minutes or six hours apart, so the line points at
   * nothing.
   *
   * The clock still decides where the run opens, though, which is the part
   * that was doing real work. The group the line would have sat before takes
   * the anchor; when the clock has passed the whole board, the last group
   * does, because that is where the day ended.
   */
  protected isNowAnchor(index: number): boolean {
    const at = this.agendaNowIndex();
    if (at === null) return false;
    const groups = this.agenda().length;
    return at === index || (at >= groups && index === groups - 1);
  }

  // ── Which facts each card carries ────────────────────────────────────
  protected readonly fields = inject(AgendaFields);
  protected readonly agendaFieldIds = AGENDA_FIELDS;
  protected readonly fieldsOpen = signal(false);

  protected openFields(): void {
    this.presentOnly();
    this.fieldsOpen.set(true);
  }

  /**
   * HOW MUCH OF THE DAY NOBODY BOUGHT — and nothing else.
   *
   * It used to lead with a visit count, and the count was WRONG on screen:
   * it counts appointments while the run renders one row per appointment PER
   * LANE, so a party across two chairs is one visit and two cards. The
   * seeded day showed "4 визити" above six rows. A number that disagrees with
   * the list beside it is worse than no number, and a count of a countable
   * list was never worth much anyway.
   *
   * What survives is the part nobody can derive by looking: the unsold
   * minutes. It is what pays for free time shipping OFF — the day still says
   * it was quiet even when the holes are not drawn.
   *
   * Stated AT ONE CHAIR only. Summed across five it is chair-hours, and
   * chair-hours read as clock hours: the whole shop's quiet Tuesday printed
   * "22 h free" over a nine-hour day.
   */
  protected readonly daySummary = computed<string | null>(() => {
    if (this.store.scope() === null) return null;
    const lanes = this.lanes();
    if (lanes.length === 0) return null;

    // The plain sum of the chair's gaps, sellable and elapsed alike
    // (`GridLayoutSystem.totalMinutes`).
    const gaps: GapRowVm[] = [];
    for (const lane of lanes) {
      for (const entry of lane.entries) {
        if (entry.agendaRow === AgendaRow.Gap) gaps.push(entry);
      }
    }
    const freeMinutes = GridLayoutSystem.totalMinutes(gaps);
    if (freeMinutes === 0) return null;
    return this.transloco.translate('staff.day.daySummaryFree', {
      span: this.span(freeMinutes),
    });
  });

  /**
   * WHAT THE DAY WAS TIPPED, at whatever scope is being looked at.
   *
   * Summed from the SEATS rather than from the rows, because the seat is
   * where a tip is recorded and the seat is what names the barber. Walking
   * each lane and taking only that lane's own seats means a party split
   * between two chairs contributes each half to the barber who earned it,
   * and nothing is counted twice.
   *
   * `null` when the day has no recording at all — an empty figure is worse
   * than no line, and `0,00 €` would claim every visit had been settled.
   */
  protected readonly dayTips = computed<string | null>(() => {
    const seats: Seat[] = [];
    for (const lane of this.store.lanes()) {
      for (const appointment of lane.appointments) {
        for (const seat of appointment.seats) {
          if (seat.barberId === lane.barberId) seats.push(seat);
        }
      }
    }
    // Strict: nothing recorded, or a mixed-currency day — a data error, not
    // a feature — is no figure (`BillingSystem.recordedTipsTotal`).
    const total = BillingSystem.recordedTipsTotal(seats);
    return total === null
      ? null
      : this.transloco.translate('staff.day.daySummaryTips', {
          amount: formatCents(
            total.amountCents,
            total.currency,
            this.transloco.getActiveLang(),
          ),
        });
  });

  /**
   * "in 20 minutes" / "tomorrow", for the relative-time field.
   *
   * Reads `nowUtcMs` so it re-renders with the store's clock rather than going
   * stale — the whole value of this field is that it is true right now.
   */
  /**
   * Barbers with neither a window nor a booking — an ALL-DAY EVENT each.
   *
   * This was one sentence of grey footnote type under the run: "Почиват
   * днес: X, Y". It read as a caption about the screen rather than as
   * something ON the day, which is what it actually is — Apple Calendar puts
   * exactly this class of fact at the TOP of the day as a compact all-day
   * banner, and a shop reads "who is even in today" before it reads the ten
   * o'clock.
   *
   * One entry per barber rather than one joined string, because each is its
   * own all-day event and wears its own chair's tone — which is also the
   * third place that colour gets explained.
   */
  protected readonly resting = computed(() => {
    const vmById = new Map(
      this.catalog.barberVms().map((vm) => [vm.id, vm] as const),
    );
    return this.store
      .offToday()
      .map((id) => {
        const vm = vmById.get(id);
        return {
          id,
          name: vm ? this.content.text(vm.name) : id,
          tone: this.toneOf(id),
        };
      })
      .filter((barber) => barber.name.length > 0);
  });

  /**
   * The FACE column, reserved on the run exactly as a trail would be.
   *
   * Run-level and not per card: a card whose client has no disc must still
   * hold the column, or every name on a mixed day sits at a different x and
   * the run stops being scannable down its leading edge.
   */
  protected readonly faceWidth = computed(() => {
    const visible = this.fields.visible();
    if (!visible.avatar && !visible.barberAvatar) return '0px';
    return 'calc(var(--control-size-regular) + var(--sys-space-compact))';
  });

  /**
   * WHEN this visit is, said relatively — the third line of the interval.
   *
   * A live cut counts down to its END: the barber is standing in it and wants
   * the time left, not the time since. Everything else counts to its start,
   * which `Intl` renders as "утре", "след 2 ч", "преди 20 мин". `short`,
   * because this shares a narrow column with the clock times above it.
   */
  /**
   * The lines under the client's name, in the card's fixed order — the
   * email, the phone, the service — each only when its switch is on and it
   * has something to say. A line that is not rendered costs no height.
   */
  protected factLines(entry: DayRowVm): readonly StaffEventLine[] {
    const lines: StaffEventLine[] = [];
    if (this.fields.isOn(AgendaField.Email) && entry.email) {
      lines.push({
        text: entry.email,
        icon: 'contact.email',
        testId: 'staff-visit-email',
      });
    }
    if (this.fields.isOn(AgendaField.Phone) && entry.phone) {
      lines.push({
        text: entry.phone,
        icon: 'contact.phone',
        testId: 'staff-visit-phone',
      });
    }
    if (this.fields.isOn(AgendaField.Service))
      lines.push({ text: entry.serviceLabel });
    return lines;
  }

  /** The end, marked when it falls on the next day. */
  protected endLabel(entry: DayRowVm): string {
    return entry.crossesMidnight ? `${entry.endLabel}⁺¹` : entry.endLabel;
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
  protected stateLabel(entry: DayRowVm): string | null {
    if (entry.bookingStatus === BookingStatus.NoShow) {
      return this.transloco.translate('staff.visit.resolution.noShow');
    }
    if (entry.bookingStatus === BookingStatus.Cancelled) {
      return this.transloco.translate(
        `appointments.status.${bookingStatusWords[BookingStatus.Cancelled]}`,
      );
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
  protected stateIcon(entry: DayRowVm): UiIconName | null {
    if (entry.bookingStatus === BookingStatus.Cancelled) {
      return 'visit.cancelled';
    }
    if (entry.bookingStatus === BookingStatus.NoShow) return 'visit.noShow';
    return null;
  }

  protected whenLabel(entry: DayRowVm): string {
    const lang = this.transloco.getActiveLang();
    if (entry.live) {
      // The time LEFT is real elapsed time to the chair's end — an
      // elapsed-time phrase on instants (T2, D-6.4).
      const minutes = Math.max(
        0,
        Math.round(
          UtcEpochMs.elapsedMs(this.nowUtcMs(), entry.endUtcMs) / 60_000,
        ),
      );
      return this.transloco.translate('staff.day.agendaRemaining', {
        span: this.span(minutes),
      });
    }
    // THEY ARE HERE — and that displaces the countdown rather than adding a
    // line to the card. The gloss answers "when, relative to now"; once
    // someone is in the shop, "in 20 min" is not merely less useful than
    // "arrived", it is WRONG, because the thing it counts down to has
    // already happened. This is also where the word went when the state
    // stopped being a fact row: every other state is carried by the card's
    // form, but arrival is the one that is about RIGHT NOW, and form is
    // already spoken for by `data-live` and `data-next`.
    if (entry.arrived && !entry.terminal) {
      return this.transloco.translate('staff.day.statusArrived');
    }
    return relativeTime(entry.startUtcMs, this.nowUtcMs(), lang, 'short');
  }

  /** "45 мин" / "1 ч" / "6 ч 30 мин" — never a bare minute count. */
  protected span(totalMinutes: number): string {
    const minutes = Math.max(0, Math.round(totalMinutes));
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    if (hours === 0) {
      return this.transloco.translate('staff.day.spanMinutes', { minutes });
    }
    if (rest === 0) {
      return this.transloco.translate('staff.day.spanHours', { hours });
    }
    return this.transloco.translate('staff.day.spanHoursMinutes', {
      hours,
      minutes: rest,
    });
  }

  /**
   * The exception word, and it is NOT a field.
   *
   * It prints only for states that went other than to plan: confirmed and
   * completed say nothing, because "this booking is a booking" is not news on
   * nine cards in ten.
   */
  protected statusWord(status: BookingStatus): string | null {
    if (
      status === BookingStatus.Confirmed ||
      status === BookingStatus.Completed
    )
      return null;
    return this.transloco.translate(
      'staff.day.exception.' + bookingStatusWords[status],
    );
  }

  protected statusTone(status: BookingStatus): UiBadgeTone {
    // eslint-disable-next-line security/detect-object-injection -- closed union.
    return STATUS_TONES[status];
  }

  /** The DOM's lowercase word for a status (`data-status`) — the shared table. */
  protected readonly statusWords = bookingStatusWords;

  /**
   * WHAT BECAME OF IT — a word, and only when there is something to say.
   *
   * This was a capsule, then a glyph, and the glyph was the problem: it fired
   * on EVERY card, because every booking has a status. A mark on 100% of rows
   * is not a signal, it is texture — and it made the foot row read as heavy
   * on the nine cards in ten where the answer is "confirmed, like all the
   * others".
   *
   * So it is a word again, printing for the four states that are worth
   * interrupting a glance for and staying silent for the two that are not.
   * `confirmed` and `completed` say nothing at all; a cancelled row is
   * additionally struck through, and a past one is already striped and faded.
   */
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
  protected rowLabel(entry: DayRowVm): string {
    const base = this.transloco.translate('staff.day.rowMenu', {
      client: entry.clientLabel,
      time: entry.startLabel,
    });
    const note = this.statusNote(entry);
    return note === null ? base : `${base}, ${note}`;
  }

  protected statusNote(entry: DayRowVm): string | null {
    // Arrival is NOT here any more. It is visible text in the trailing
    // gloss (`whenLabel`), so repeating it here would announce it twice to
    // a screen reader. What is left is exactly the set of states the card
    // says with its FORM — hollow, hollow-and-struck, dashed — none of
    // which a screen reader can perceive.
    return this.statusWord(entry.bookingStatus);
  }

  /**
   * The marks that ride the body row's trailing edge.
   *
   * TWO THINGS ONLY, and the rule is the owner's: an icon earns its place for
   * a note, for a repeat, and for a blocker. Nothing else.
   *
   * Status is NOT among them any more. It was a glyph on every card, which
   * made the foot row texture rather than signal; it is a word now, and only
   * for the states worth interrupting a glance for — see `statusNote`.
   *
   * Both survivors are facts the model actually holds: a note is
   * `contact.note`, a repeat is `Appointment.bookedFrom` (persisted and
   * round-tripped). There is no blocker glyph HERE because a block is not a
   * visit — it is its own object, and `staff-time-grid` draws it on the axis
   * where it has an extent. And no paid glyph, because payment is not
   * modelled anywhere in this codebase; an icon that can never appear is a
   * claim about the schema, not a feature.
   */
  protected rowIcons(entry: DayRowVm): readonly UiIconName[] {
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
    const state = this.stateIcon(entry);
    if (state !== null && !this.fields.isOn(AgendaField.Avatar))
      icons.push(state);
    if (entry.rebooked) icons.push('visit.repeat');
    // The note is a MARK, not a row. Its text was a clamped line in the fact
    // column — the one fact there that could not be read in full, sitting in
    // a column whose whole premise is that everything gets its place. A mark
    // says "there is one" honestly; the sheet says what it is.
    if (this.fields.isOn(AgendaField.Note) && entry.hasNote)
      icons.push('visit.note');
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
   * The three conditions are the same three the template asks, and they have
   * to stay that way — `hasFootMatchesTheFoot` in the suite is what holds
   * them together.
   */
  protected hasFoot(entry: DayRowVm): boolean {
    return (
      (this.fields.isOn(AgendaField.Price) && !!entry.priceLabel) ||
      // The frame's tag is a mark, never a field: it shows whenever it is.
      entry.tag !== null ||
      // ⚠ The party share joined the foot (owner ruling 2026-09-04); a card
      // whose only mark is `1 / 2` must still get a row to put it on.
      (this.fields.isOn(AgendaField.Party) && !!entry.partyLabel) ||
      this.rowIcons(entry).length > 0 ||
      this.fields.isOn(AgendaField.BarberAvatar)
    );
  }

  protected onVisitRowClick(event: Event, row: DayRowVm): void {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('button, a, input, [role="button"]')
    ) {
      return;
    }
    this.openVisitSheet(row);
  }

  /** The barber's headshot, or nothing if HR never uploaded one. */
  private barberAvatarOf(barberId: BarberId): string | null {
    return (
      this.catalog.barberVms().find((vm) => vm.id === barberId)?.avatarSrc ??
      null
    );
  }

  /** An instant's wall clock, in SHOP time — never the reader's device zone. */
  private time(atUtcMs: UtcEpochMs): string {
    return this.instantLabel(atUtcMs, CLOCK_FACE);
  }

  /** A stored wall-clock reading — the visit's own day and minute — as the page's clock. */
  private wallTime(localDate: LocalDate, minute: MinuteOfDay | EndMinute) {
    return formatWallClock(
      localDate,
      minute,
      this.content.locale(),
      CLOCK_FACE,
    );
  }

  /**
   * When a stamp landed, in shop time: the clock alone on the visit's own
   * day, the day before it otherwise — in the day pill's short form, so a
   * cancellation the evening before reads `24.08, 18:40`.
   */
  private stampLabel(atUtcMs: UtcEpochMs, visitLocalDate: LocalDate): string {
    if (this.stampWall(atUtcMs)?.localDate === visitLocalDate) {
      return this.time(atUtcMs);
    }
    return this.instantLabel(atUtcMs, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  /**
   * WHAT SETTLED THIS CHAIR, for the sheet's head (owner, 2026-09-11: "the
   * cancellation reason or no-show is not showing in the event detail
   * sheets").
   *
   * From the chair's OWN seats, the same way its status is
   * (`VisitStorySystem.chairResolution`, DEP-1): the stamp that closed the
   * last of them is the moment; a cancellation's side is the one the card's
   * rows and the statistics read — the seat called off last, by its reason
   * first; and the reasons are the DISTINCT ones — a father and son called
   * off together for one reason read as one line, not two. A reason nobody
   * gave adds nothing rather than "no reason", and «Друго» is the barber's
   * own words. `null` on a live chair and on a finished one. The clock and
   * the reason words are this page's.
   */
  private resolutionOf(
    seats: readonly Seat[],
    status: BookingStatus,
    visitLocalDate: LocalDate,
  ): VisitEditorResolution | null {
    const resolution = VisitStorySystem.chairResolution(status, seats);
    if (resolution === null) return null;
    const details = new Set<string>();
    for (const reason of resolution.reasons) {
      details.add(
        this.transloco.translate(
          'staff.day.cancelReasonCode.' + cancellationReasonWords[reason],
        ),
      );
    }
    return {
      // What settled the chair — the stored tag the system narrowed.
      bookingStatus: resolution.bookingStatus,
      by: resolution.cancelledBy,
      whenLabel: this.stampLabel(resolution.atUtcMs, visitLocalDate),
      detail: details.size > 0 ? [...details].join(' · ') : null,
    };
  }

  /**
   * One lane's view of one appointment.
   *
   * Only THIS chair's seats: a two-barber party appears in both lanes, each
   * lane naming its own work.
   */
  /**
   * The chair's catalogue minutes for a seat's service and variant, or
   * nothing when the catalogue no longer knows the service — the seat's own
   * booked terms then stand in, exactly as they do on the sheet.
   */
  private chairMinutesOf(
    seat: Seat,
    barberId: BarberId,
  ): DurationMinutes | null {
    const service = this.catalog.findService(seat.serviceId);
    if (service === undefined) return null;
    // The server's resolution (`OfferingPriceSystem.termsFor`): a chair
    // that does not perform the service is measured against the service's
    // own minutes — never against another chair's offering.
    return OfferingPriceSystem.termsFor(service, barberId, seat.variantId)
      .durationMinutes;
  }

  /**
   * The frame's tag, on the row: the run's distance from the catalogue.
   *
   * The pattern («{{minutes}} мин») is read FIRST, off the loaded table,
   * and filled here — the way the editors word their drag readouts — so
   * every row depends on the table: built before `bg.json` has landed, the
   * tag is withheld rather than printed as its key, and the row is rebuilt
   * the moment the words are there (review r4, 2026-10-06).
   */
  private catalogTag(
    seats: readonly Seat[],
    barberId: BarberId,
    startMinute: MinuteOfDay,
    endMinute: EndMinute,
  ): string | null {
    const pattern = this.copyOf('staff.visit.minutes');
    if (pattern === null) return null;
    // The chair's run on the shop's wall clock (DEP-8). A visit lasts a
    // positive whole number of minutes by construction, so a span that is
    // not one is a broken invariant, never an input.
    const span = DurationMinutes.of(MinuteCount.span(startMinute, endMinute));
    if (!span.ok) {
      return defect(`not a visit's span: ${startMinute}–${endMinute}`);
    }
    // A seat the catalogue no longer knows stands at its booked length.
    const sold = VisitDraftSystem.catalogMinutesOf(
      seats.map((seat) => ({
        catalogMinutes: this.chairMinutesOf(seat, barberId),
        bookedMinutes: seat.durationMinutes,
      })),
    );
    return catalogTagWords(
      VisitDraftSystem.minutesDelta(span.value, sold),
      (minutes) => fill(pattern, { minutes }),
    );
  }

  private toRow(
    appointment: Appointment,
    barberId: BarberId,
    nowUtcMs: UtcEpochMs,
    shopNow: ShopNow | null,
  ): DayRowVm {
    const seats = appointment.seats.filter(
      (seat) => seat.barberId === barberId,
    );
    // The chair's own span on the visit's shop day (Law 7.3): its first
    // seat's start to its last seat's end — the envelope's when it holds none.
    const first = seats[0];
    const last = seats.at(-1);
    const startMinute = first?.startMinutes ?? appointment.startMinutes;
    const endMinute =
      last === undefined ? appointment.endMinutes : Seat.endMinutes(last);
    // HAS IT BEGUN, HAS IT ENDED — on the shop's wall clock, against the
    // store's `ShopNow` (Law 7.3 T1, pass D D-6): the visit's day and the
    // chair's minutes, never an instant. Neither before a zone is known.
    const start = WallTime.of(appointment.localDate, startMinute);
    const started =
      shopNow !== null && VisitStorySystem.hasStarted(start, shopNow);
    const ended =
      shopNow !== null &&
      VisitStorySystem.hasEnded(
        { localDate: appointment.localDate, minute: endMinute },
        shopNow,
      );

    const serviceLabel = seats
      .map((seat) => {
        const service = this.catalog.findService(seat.serviceId);
        return service ? this.content.text(service.name) : seat.serviceId;
      })
      .join(' + ');

    /*
     * WHO IS IN THIS CHAIR — not who made the booking. (owner ruling
     * 2026-09-03)
     *
     * The contact used to win outright, which named the booker in every lane
     * of a party: a father booked for himself with Ivan and his son with
     * Stefan, and Stefan's row said "Стоян Колев" — the son was invisible in
     * the whole staff app, and the two rows were indistinguishable.
     *
     * A row is one chair's share, so it is named by the people sitting in it.
     * When every seat here is a guest, their labels are the name; the contact
     * is still the number to ring, which is the only job it had. A chair
     * holding the account holder — alone or beside a guest — keeps the
     * contact's name, because that IS the person in it.
     */
    const contactName = appointment.contactName;
    const contactPhone = appointment.contactPhone;
    const phoneLabel =
      contactPhone === null
        ? null
        : PhoneSystem.formatInternational(contactPhone);
    const guestLabels = guestLabelsOf(seats);
    const allGuests = seats.length > 0 && guestLabels.length === seats.length;
    const clientLabel: string =
      (allGuests ? guestLabels.join(' + ') : contactName) ??
      guestLabels[0] ??
      this.transloco.translate('staff.day.unnamedClient');

    /*
     * THE PEOPLE, from the seats themselves. `clientLabel` above is one
     * string for the row; the sheet needs each person as their own key so a
     * party keeps its grammar when reopened (owner ruling 2026-09-08). The
     * booker's own seat carries the contact; a guest carries only their
     * label, which is all the shop holds about them.
     *
     * A COMPANION ACCOUNT IS NOT THE BOOKER (client-card-redesign §3.1.4,
     * the P0 audit's defect): the contact is the booker's, so a son booked
     * by his father never wears the father's name or number. He is named
     * by his own profile once it is read (`companionNames`), and his card
     * reads `users/{uid}` itself; his number is his profile's, never the
     * booking's.
     */
    const companionNames = this.companionNames();
    // Each person by the sheet's draft key (`DraftPersonKey`): a guest by
    // `guest-<label>`, an account by its uid — no address is known for any
    // of them here (`email: null`, what the client search reads as none).
    const personOf = (seat: Seat): VisitEditorClientOption =>
      seat.seatSubject === SeatSubject.Anonymous
        ? {
            id: DraftPersonKey.guest(seat.guestLabel),
            label: seat.guestLabel,
            phone: null,
            phoneHref: null,
            meta: null,
            email: null,
          }
        : seat.subjectRelationship === SubjectRelationship.Companion
          ? {
              id: DraftPersonKey.account(seat.subjectUserId),
              label:
                companionNames[seat.subjectUserId] ??
                this.transloco.translate('staff.day.unnamedClient'),
              phone: null,
              phoneHref: null,
              meta: null,
              email: null,
            }
          : {
              id: DraftPersonKey.account(seat.subjectUserId),
              label:
                contactName ??
                this.transloco.translate('staff.day.unnamedClient'),
              phone: phoneLabel,
              phoneHref: contactPhone,
              meta: null,
              email: null,
            };
    // One entry per PERSON, the first of their seats — the people key of
    // the server's party check (`VisitStorySystem.seatPersonKey`).
    const peopleSeen = new Set<SeatKeyText>();
    const people: VisitEditorClientOption[] = [];
    for (const seat of seats) {
      const key = VisitStorySystem.seatPersonKey(seat);
      if (peopleSeen.has(key)) continue;
      peopleSeen.add(key);
      people.push(personOf(seat));
    }

    /*
     * THIS CHAIR'S status, not the party's (found live, 2026-09-11).
     *
     * A party across two chairs is one appointment whose ROOT stays
     * `CONFIRMED` while any seat is still scheduled — so a guest cancelled
     * out of it kept reading as a live visit on his own chair, the sheet
     * offered «Откажи часа» a second time, and the server refused it as
     * already resolved with nothing the sheet could say but "something went
     * wrong". Once every seat on this chair is resolved, the chair's own
     * outcome is the row's status: the domain's fold (`SeatOutcome.summarize`
     * — cancelled if all cancelled, completed if any worked, else no-show),
     * applied to this chair's seats. A chair with a seat still open keeps
     * the root's word, as before; a one-chair visit is unchanged, because
     * the root was folded from the same seats when it was written.
     */
    const chairLifecycle = SeatOutcome.summarize(seats, appointment, nowUtcMs);
    const status = chairLifecycle.bookingStatus;
    // What the graph allows from the CHAIR, plus the same-day correction
    // edge (owner ruling 2026-09-08) — the root settled the same way and the
    // shop still in the visit's day (`offeredVerbs`, over `reopenable`).
    const legal = AppointmentLifecycleSystem.offeredVerbs(
      chairLifecycle,
      appointment,
      appointment.localDate,
      this.store.shopNow()?.localDate ?? null,
    );
    const arrived = appointment.arrivedAtUtcMs !== null;
    // Which verb leads, drawn from the legal set (`leadVerb`).
    const primary = AppointmentLifecycleSystem.leadVerb(
      chairLifecycle,
      legal,
      arrived,
    );
    const seatCount = appointment.seats.length;
    /*
     * "1 / 2" — this chair's share over the whole party.
     *
     * It was computed here and rendered NOWHERE, while the only party mark the
     * agenda drew was a `+N` keyed on `seatsHere`, which counts one chair. A
     * party split across two chairs has `seatsHere === 1` in both of them, so
     * the one case that most needs saying so — two rows, same time, same
     * booking, different barbers — was the exact case that showed nothing.
     */
    // «1/2», set tight (owner, 2026-09-16): a share, not a sum.
    const partyLabel = seatCount > 1 ? `${seats.length}/${seatCount}` : null;
    const note = appointment.contactNote?.trim() || null;
    // What the chair's seats come to, in the seats' own currency — the
    // shop's one for a chair holding none, or a mixed one (no figure then).
    const subtotal = BillingSystem.subtotalOf(seats);

    return {
      agendaRow: AgendaRow.Visit,
      id: rowKey(appointment.id, barberId),
      appointmentId: appointment.id,
      revision: appointment.revision,
      locationId: appointment.locationId,
      seatId: first?.seatId ?? null,
      seatIds: seats.map((seat) => seat.seatId),
      selfSeat: seats.some((seat) => Seat.isOwnAccount(seat)),
      ownerUserId: appointment.ownerUserId,
      ownerCustomerId: appointment.ownerCustomerId,
      arrived,
      arrivedAtUtcMs: appointment.arrivedAtUtcMs,
      localDate: appointment.localDate,
      startMinute,
      endMinute,
      // The chair's instants off the STORED start (`TimeCoordinate.instantAt`,
      // D-6.5) — the countdown's and the live remaining's only.
      startUtcMs: TimeCoordinate.instantAt(appointment, startMinute),
      endUtcMs: TimeCoordinate.instantAt(appointment, endMinute),
      partySize: seatCount,
      seatsHere: seats.length,
      // The stored wall clock, printed as stored (Law 7.3).
      startLabel: this.wallTime(appointment.localDate, startMinute),
      endLabel: this.wallTime(appointment.localDate, endMinute),
      tag: this.catalogTag(seats, barberId, startMinute, endMinute),
      priceLabel: this.seatsPrice(seats),
      // In cents — what a tip preset is a share of. `subtotalOf` refuses
      // two currencies: a party mixed-currency has no number at all rather
      // than a wrong one.
      priceCents: subtotal.ok ? subtotal.value.amountCents : null,
      currency: subtotal.ok
        ? subtotal.value.currency
        : (first?.currency ?? Currency.EUR),
      barberName: this.barberNameOf(barberId),
      barberAvatarSrc: this.barberAvatarOf(barberId),
      barberTone: this.toneOf(barberId),
      past: ended,
      live: started && !ended && !BookingLifecycle.isSettled(chairLifecycle),
      // Set by the lane, which is the only scope that can know which visit is
      // FIRST — a row cannot see its siblings.
      isNext: false,
      // One shop day per visit (F-6): a chair that runs to the closing
      // midnight ends on the next day's first instant — mark it, never move it.
      crossesMidnight: endMinute >= 24 * 60,
      serviceLabel,
      clientLabel,
      phone: phoneLabel,
      phoneHref: contactPhone,
      email: appointment.contactEmail,
      rebooked: appointment.bookedFromAppointmentId !== null,
      // The note's EXISTENCE is a row signal; its prose belongs in the sheet.
      hasNote: note !== null,
      note,
      partyLabel,
      ...this.seatsTip(seats),
      discounts: discountsOf(appointment),
      vouchers: vouchersOf(appointment),
      resolution: this.resolutionOf(seats, status, appointment.localDate),
      people,
      legs: seats.map((seat) => {
        const service = this.catalog.findService(seat.serviceId);
        const seatBarberId = seat.barberId;
        return {
          seatId: seat.seatId,
          serviceId: seat.serviceId,
          variantId: seat.variantId,
          clientId: personOf(seat).id,
          serviceLabel: service
            ? this.content.text(service.name)
            : seat.serviceId,
          minutes: seat.durationMinutes,
          // The same resolver the card's tag reads, so the frame agrees.
          catalogMinutes: this.chairMinutesOf(seat, seatBarberId),
          // The seat's own price in its currency; the label is printed from
          // it (D-10.3).
          priceCents: seat.priceCents,
          currency: seat.currency,
          priceLabel: this.seatsPrice([seat]),
          barberId: seatBarberId,
          barberName: this.barberNameOf(seatBarberId),
          barberTone: this.toneOf(seatBarberId),
          // The catalogue's terms are kept only when the stored ones DIFFER
          // (`Seat.termsOf`), so their presence is the override mark.
          overridden: Seat.overridden(seat),
        };
      }),
      bookingStatus: status,
      rootBookingStatus: appointment.bookingStatus,
      primary,
      overflow: legal.filter((verb) => verb !== primary),
      terminal: BookingLifecycle.isSettled(chairLifecycle),
    };
  }

  /**
   * The WORD for a verb. Reopening a no-show is not "confirm" — it is undoing
   * a judgement, and it says so.
   */
  protected verbKey(status: BookingStatus, verb: RowVerb): string {
    if (verb === BookingStatus.Confirmed && status === BookingStatus.NoShow) {
      return 'staff.day.act.reopen';
    }
    if (
      verb === BookingStatus.Confirmed &&
      status === BookingStatus.Completed
    ) {
      return 'staff.day.act.reopenCompleted';
    }
    if (
      verb === BookingStatus.Confirmed &&
      status === BookingStatus.Cancelled
    ) {
      return 'staff.day.act.reinstate';
    }
    return 'staff.day.act.' + ROW_VERB_WORD[verb];
  }

  /**
   * Perform a verb. Cancelling opens the reason sheet rather than firing —
   * a destructive act on someone's booking asks why first.
   */
  protected async act(row: DayRowVm, to: RowVerb): Promise<void> {
    this.openMenuId.set(null);
    if (to === ArrivalVerb.Arrived) {
      // Arriving is the PARTY walking in, not a chair filling: the stamp lives
      // on the appointment, so it takes the aggregate id and no seat.
      const done = await this.store.markArrived(row.appointmentId);
      // Arriving is the party's, so its way back is whatever the scope.
      const inverse = done
        ? AppointmentLifecycleSystem.inverseOf(ArrivalVerb.Arrived, true)
        : null;
      if (inverse !== null) this.offerUndo(row, ArrivalVerb.Arrived, inverse);
      else if (!done) this.refuse(this.store.errorFor(row.appointmentId));
      this.restoreFocusToRow(row.id);
      return;
    }
    if (to === ArrivalVerb.Unarrived) {
      if (!(await this.store.clearArrival(row.appointmentId))) {
        this.refuse(this.store.errorFor(row.appointmentId));
      }
      this.restoreFocusToRow(row.id);
      return;
    }
    if (to === BookingStatus.Cancelled) {
      this.cancelId.set(row.appointmentId);
      this.cancelSeatIds.set(transitionSeatsOf(row, BookingStatus.Cancelled));
      this.cancelReasonCode.set(null);
      this.cancelNote.set('');
      this.cancelNoteFiled.set(false);
      return;
    }
    if (
      to === BookingStatus.Confirmed ||
      to === BookingStatus.Completed ||
      to === BookingStatus.NoShow
    ) {
      // `CONFIRMED` is not a per-seat verb — the server rejects it as one, so
      // it always addresses the root (`transitionSeats`).
      const seatIds = transitionSeatsOf(row, to);
      const move = (seatId: SeatId | null): Promise<boolean> =>
        this.store.transition(
          transitionOf(row.appointmentId, to, null, seatId),
        );
      let done = true;
      if (seatIds.length === 0) {
        done = await move(null);
      } else {
        for (const seatId of seatIds) {
          done = (await move(seatId)) && done;
        }
      }
      if (!done) this.refuse(this.store.errorFor(row.appointmentId));
      // A correction is not itself undoable — the toast it came from is gone
      // with it — and a per-seat stamp has no inverse the callable offers
      // (`inverseOf`).
      const inverse = done
        ? AppointmentLifecycleSystem.inverseOf(to, seatIds.length === 0)
        : null;
      if (inverse !== null) {
        this.offerUndo(row, to, inverse);
      } else if (to === BookingStatus.Confirmed) {
        this.undo.set(null);
      }
      this.restoreFocusToRow(row.id);
    }
  }

  /* ── The way back ───────────────────────────────────────────────── */

  /**
   * The one undo on offer, or `null`. An 8-second `ui-toast` carries it
   * (owner ruling 2026-09-08). Each entry names what just happened and holds
   * the INVERSE WRITE — a real second request through the same callables,
   * obeying the same refusals (a reinstated cancellation whose slot has
   * since been taken is refused, and the row's error says so). Never a
   * client-side rollback: the day must not lie, even for a second.
   */
  protected readonly undo = signal<{
    readonly message: string;
    readonly inverse: () => Promise<boolean>;
  } | null>(null);

  /**
   * The toast for an act `did` whose way back is `inverse` — the verb
   * `AppointmentLifecycleSystem.inverseOf` answered. Taking the arrival
   * stamp back clears it; any other way back is the party's own move to
   * that status, through the same callable.
   */
  private offerUndo(row: DayRowVm, did: RowVerb, inverse: RowVerb): void {
    let write: (() => Promise<boolean>) | null = null;
    if (inverse === ArrivalVerb.Unarrived) {
      write = () => this.store.clearArrival(row.appointmentId);
    } else if (Tag.has(BookingStatus, inverse)) {
      const to = inverse;
      write = () =>
        this.store.transition(transitionOf(row.appointmentId, to, null, null));
    }
    if (write === null) return;
    this.offerUndoOf(
      this.transloco.translate('staff.day.undo.' + ROW_VERB_WORD[did]),
      write,
    );
  }

  /** One toast per page: the newest act's way back replaces the last. */
  private offerUndoOf(message: string, inverse: () => Promise<boolean>): void {
    this.undo.set({ message, inverse });
  }

  /**
   * A REFUSAL, AS A TOAST (owner, 2026-09-17: "if there is an error message
   * it should appear as a toast"): the row's own error line lives on the
   * agenda, behind the sheet whose «Запази» was just refused — so nobody
   * saw why a save with two haircuts never landed. Every refusal reached
   * from the sheet raises the page's one toast with the server's sentence;
   * it replaces an undo on offer, and the agenda keeps its line. It also
   * carries the one receipt that has no way back (see `reversibleSave`).
   */
  protected readonly notice = signal<string | null>(null);

  private refuse(
    error: PipelineError | null,
    fallbackKey = `errors.${BookingErrorCode.CallFailed}`,
  ): void {
    this.undo.set(null);
    this.notice.set(
      error ? this.describeError(error) : this.transloco.translate(fallbackKey),
    );
  }

  protected async runUndo(): Promise<void> {
    const offer = this.undo();
    this.undo.set(null);
    if (offer) await offer.inverse();
  }

  /**
   * The visit the sheet is showing, or `null`.
   *
   * Held by ID rather than by value, so the sheet re-reads the row on every
   * store tick: acting from inside it must redraw the verbs it is offering,
   * not go stale against the day it came from.
   */
  protected readonly visitSheetId = signal<string | null>(null);
  /**
   * THE TRAIL through a party (owner, 2026-09-17): each hop to a peer's
   * visit leaves the visit it came from here, newest last, so the sheet's
   * ‹ can walk back to it — the same sheet, re-subjected, not a page.
   */
  protected readonly visitTrail = signal<readonly string[]>([]);

  /** A peer's row on the sheet: over to their visit, the way back kept. */
  protected hopToPeer(rowId: string): void {
    const current = this.visitSheetId();
    if (current !== null && current !== rowId) {
      this.visitTrail.update((trail) => [...trail, current]);
    }
    this.visitSheetId.set(rowId);
  }

  /** The ‹ at the root of a hopped-to visit: back to the one before it. */
  protected backAlongTrail(): void {
    const trail = this.visitTrail();
    const previous = trail.at(-1);
    if (previous === undefined) return;
    this.visitTrail.set(trail.slice(0, -1));
    this.visitSheetId.set(previous);
  }

  /**
   * The day the open sheet's DRAFT is on — `null` while no sheet is open.
   *
   * The editor owns its draft and the parent owns the data, so the day has to
   * cross the boundary for the frame to be about the right one. It is set
   * from the editor's `dayChanged` and released on close, which is also what
   * drops the store's probe subscription.
   */
  private readonly visitDraftDay = signal<LocalDate | null>(null);
  /** The chair the sheet's draft has moved the visit to, or `null` (the row's). */
  private readonly visitDraftChair = signal<BarberId | null>(null);

  /** Bumped when a save lands, so the sheet can rebaseline. See `saveFromEditor`. */
  protected readonly visitSavedMark = signal(0);

  /**
   * What the sheet's frame draws AROUND the block — for the DRAFTED day.
   *
   * Kept out of `visitEditorVm` on purpose: that VM seeds the editor's draft
   * and is what `dirty` measures against, so it must not move when the draft
   * does. This does move — that is its entire job — and nothing here is ever
   * seeded or compared.
   *
   * On the anchor day it resolves the same lane `visitEditorVm` already
   * used, so the ordinary sheet is unchanged; only a stepped pill reaches
   * the probe's cell.
   */
  protected readonly visitFrameDay = computed<VisitEditorFrameDay | null>(
    () => {
      const row = this.visitSheetRow();
      if (row === null) return null;
      const shownDay = this.store.dayKey();
      const draftDay = this.visitDraftDay() ?? shownDay;
      const lane = this.lanes().find((entry) =>
        entry.entries.some(
          (e) => e.agendaRow === AgendaRow.Visit && e.id === row.id,
        ),
      );
      const rowChair = lane?.barberId ?? null;
      // THE DRAFT'S CHAIR, not the row's (owner, 2026-09-09): switching the
      // barber in the sheet must show that barber's day — his bookings, his
      // hours — the same way stepping the day shows another day.
      const barberId = this.visitDraftChair() ?? rowChair;
      if (draftDay === shownDay && barberId === rowChair) return null;
      const cell = draftDay === null ? null : this.store.cellFor(draftDay);
      const draftLane = cell?.lanes.find(
        (entry) => entry.barberId === barberId,
      );

      /*
       * The probe's cell holds APPOINTMENTS, not agenda rows — `toRow` runs
       * for the day on screen and nothing builds rows for a day nobody is
       * looking at. The frame needs three fields per neighbour, so it takes
       * them off the documents rather than making the whole agenda run twice.
       * What occupies the chair is what the server's overlap refusal reads —
       * the chair's seats of every other visit whose ROOT is live
       * (`BusySystem.chairOccupants`, DEP-2).
       */
      // No chair (a row on no lane) has nobody beside it.
      const neighbours =
        barberId === null
          ? []
          : this.occupantNeighbours(
              draftLane?.appointments ?? [],
              barberId,
              row.appointmentId,
            );

      const roster = this.rosterHull(draftLane?.rostered ?? []);

      return {
        neighbours,
        rosterStartMinute: roster?.startMinutes ?? MIDNIGHT,
        rosterEndMinute: roster?.endMinutes ?? CLOSING,
        // ⚠ The DRAFTED day against today: the `now` line was staying lit on
        // a frame stepped onto tomorrow.
        nowMinute: draftDay === this.store.todayKey() ? this.nowMinute() : null,
      };
    },
  );

  protected onVisitDayChanged(dayKey: LocalDate): void {
    this.visitDraftDay.set(dayKey);
    this.store.probeDay(dayKey);
  }

  protected onVisitChairChanged(barberId: BarberId): void {
    this.visitDraftChair.set(barberId);
  }

  /**
   * The create sheet's chair follows its draft: the VM is rebuilt for the
   * new barber (name, tone, neighbours, roster) under the SAME nonce, so the
   * draft — services picked, people seated — survives the switch.
   */
  protected onCreateChairChanged(barberId: BarberId): void {
    this.createVisit.update((create) =>
      create === null || create.barberId === barberId
        ? create
        : { ...create, barberId },
    );
  }

  protected readonly visitSheetRow = computed<DayRowVm | null>(() => {
    const id = this.visitSheetId();
    if (id === null) return null;
    for (const lane of this.lanes()) {
      for (const entry of lane.entries) {
        if (entry.agendaRow === AgendaRow.Visit && entry.id === id) {
          return entry;
        }
      }
    }
    return null;
  });

  /** The chair this visit sits in — the sheet says whose lane it is. */
  protected readonly visitSheetBarber = computed<string | null>(
    () => this.visitSheetRow()?.barberName ?? null,
  );

  /**
   * The row, plus the context only the day knows — its neighbours, its roster
   * and its clock.
   *
   * The editor draws a frame, and a frame is meaningless without what surrounds
   * the block: the chair's other visits are what make an overlap visible before
   * it is committed. Those live on the lane, not the row, which is why this is
   * assembled here rather than inside the editor.
   */
  protected readonly visitEditorVm = computed<VisitEditorVm | null>(() => {
    const row = this.visitSheetRow();
    if (row === null) return null;
    // A row is drawn only on a shown day, so the day is known here.
    const dayKey = this.store.dayKey();
    if (dayKey === null) return null;

    // The agenda lane holds the neighbours; the STORE lane holds the roster
    // windows. `LaneVm.rostered` is a boolean — "does this chair work today" —
    // and the intervals it is named after live one layer down.
    const lane = this.lanes().find((entry) =>
      entry.entries.some(
        (e) => e.agendaRow === AgendaRow.Visit && e.id === row.id,
      ),
    );
    const storeLane = this.store
      .lanes()
      .find((entry) => entry.barberId === lane?.barberId);

    // What occupies the chair: the visits beside this one whose ROOT is
    // live — the server's overlap rule (`BusySystem.chairOccupants`, DEP-2).
    const neighbours = this.occupyingRows(
      lane,
      storeLane?.appointments ?? [],
      row.appointmentId,
    );

    const roster = this.rosterHull(storeLane?.rostered ?? []);

    return {
      appointmentId: row.appointmentId,
      rowId: row.id,
      // The revision the sheet's draft is drawn from — what «Запази» claims.
      revision: row.revision,
      locationId: row.locationId,
      // The shop's own zone, else the day's (`StaffDayStore.zoneAt`).
      timeZone: this.store.zoneAt()(row.locationId),
      /*
       * THE REST OF THE BOOKING.
       *
       * Every row of the same appointment that is not this one — which on an
       * ordinary visit is none, and on a split party is the other chair. The
       * sheet frames one chair's share; this is what stops that framing from
       * reading as the whole visit, and it is the only way to reach the other
       * half without going back to the day and hunting for a second card at
       * the same minute.
       */
      peers: this.lanes()
        .flatMap((lane) => lane.entries)
        .filter(
          (entry): entry is DayRowVm =>
            entry.agendaRow === AgendaRow.Visit &&
            entry.appointmentId === row.appointmentId &&
            entry.id !== row.id,
        )
        .map((entry) => ({
          rowId: entry.id,
          clientLabel: entry.clientLabel,
          chairName: entry.barberName,
          chairTone: entry.barberTone,
          timeLabel: `${entry.startLabel} – ${entry.endLabel}`,
        })),
      /*
       * ⚠ THE APPOINTMENT'S OWN DAY, never the drafted one.
       *
       * This VM is the BASELINE: `seedDraft` copies it into the draft and
       * `dirty` compares the draft back against it, so NOTHING the draft can
       * change may be fed from the draft. Pointing these at the drafted day
       * closed a loop — draft → `dayChanged` → the parent's signal → this VM
       * → `seedDraft` → draft — and cost two bugs before the shape was
       * right: the draft reseeded on every step, snapping the pill back
       * while the frame moved without it; and `dirty` went blind to the day,
       * because the seed moved with the very value it was measuring.
       *
       * The frame still follows the pill — through `visitFrameDay`, a
       * SEPARATE input carrying only what is drawn and never seeded.
       */
      dayKey,
      dayLabel: this.dayPillLabel(dayKey),
      // The chair's own wall clock, as stored (Law 7.3).
      startMinute: row.startMinute,
      endMinute: row.endMinute,
      legs: row.legs,
      clientLabel: row.clientLabel,
      people: row.people,
      clientUserId: row.ownerUserId,
      clientCustomerId: row.ownerCustomerId,
      phone: row.phone,
      phoneHref: row.phoneHref,
      // `rebooked` is the one durable fact the shop holds about a person here:
      // a client who came back. Anything richer needs a history read the sheet
      // does not have, so it says the true thing or nothing.
      clientMeta: row.rebooked
        ? this.transloco.translate('staff.visit.clientReturning')
        : null,
      note: row.note,
      teamNote: this.store.teamNote(),
      photos: this.store
        .visitPhotos()
        .map((photo) => this.toEditorPhoto(photo)),
      photoBusy: this.store.photoBusy(),
      priceLabel: row.priceLabel,
      priceCents: row.priceCents,
      currency: row.currency,
      tipLabel: row.tipLabel,
      tipCents: row.tipCents,
      discounts: row.discounts,
      vouchers: row.vouchers,
      resolution: row.resolution,
      // The chair's stored tag; the sheet prints its word where it shows one.
      bookingStatus: row.bookingStatus,
      statusLabel: this.transloco.translate(
        'appointments.status.' + bookingStatusWords[row.bookingStatus],
      ),
      // The arrival STAMP read onto the shop's wall clock (the opening
      // midnight while no zone is known, as it always read then).
      arrivedMinute:
        row.arrivedAtUtcMs === null
          ? null
          : (this.stampWall(row.arrivedAtUtcMs)?.minute ?? MIDNIGHT),
      chairId: lane?.barberId ?? null,
      chairName: row.barberName,
      chairTone: row.barberTone,
      neighbours,
      rosterStartMinute: roster?.startMinutes ?? MIDNIGHT,
      rosterEndMinute: roster?.endMinutes ?? CLOSING,
      // The store's `ShopNow` — the sheet reads "today" and "now" off it
      // (pass D D-10.5).
      now: this.store.shopNow(),
      // Regime A, carried through unchanged. `offeredVerbs` already decided
      // what is legal and `leadVerb` already decided what leads; the editor
      // renders that decision rather than re-taking it.
      primaryVerb: row.primary ? this.toEditorVerb(row, row.primary) : null,
      overflowVerbs: row.overflow.map((verb) => this.toEditorVerb(row, verb)),
      // Busy while the store holds the visit, or while a save of it is
      // under way here — a note or a tip alone never touches the store's
      // pending set, and «Запази» must turn its ring for those too.
      acting:
        this.store.isPending(row.appointmentId) ||
        this.savingVisitId() === row.appointmentId,
    };
  });

  private toEditorVerb(row: DayRowVm, verb: RowVerb): VisitEditorVerb {
    return {
      // The verb itself — what the sheet emits back through `(acted)`.
      rowVerb: verb,
      label: this.transloco.translate(this.verbKey(row.bookingStatus, verb)),
      // ONE red in the menu (owner review, 2026-09-08). Cancelling is the
      // destructive act: it is terminal and it pages the waitlist. A no-show
      // is a fact about the client, and the graph keeps a correction edge for
      // it, so it reads as an ordinary verb rather than a second warning.
      destructive: verb === BookingStatus.Cancelled,
    };
  }

  /**
   * `пт, 4.09` / `Fri, Sep 4` — the date as the pill wears it.
   *
   * ⚠ TWINNED WITH `StaffVisitEditor.dayLabelFor`, which formats the SAME
   * pill after the barber steps a day while this one formats it on open.
   * Two functions for one label is why shortening it in the editor alone
   * left the sheet still rendering `пт, 4 септември` until this changed
   * too. Both now call `formatDayPill`, so they cannot drift again.
   */
  private dayPillLabel(dayKey: LocalDate): string {
    // The pill's own formatter — `weekday: 'short'`, `day: 'numeric'`,
    // `month: 'short'` on UTC — which the editor's twin already calls, so
    // the two can no longer drift. ⚠ `short`, reversing the `long` this
    // carried (owner ruling 2026-09-04): numeric IS bg's abbreviated date
    // (CLDR gives `dateStyle: 'medium'` as `4.09.2026 г.`, exactly as it
    // gives `Sep 4, 2026` in en). UTC throughout: the key is a wall-clock
    // date with no instant behind it.
    return formatDayPill(dayKey, this.transloco.getActiveLang());
  }

  protected openVisitSheet(row: DayRowVm): void {
    this.presentOnly();
    this.visitSheetId.set(row.id);
    this.store.probeNote(row.appointmentId);
    this.store.probePhotos(row.appointmentId);
    // The client's own coupons, for the discount row — nobody's for a
    // walk-in, which reads as none.
    this.store.probeGrants(row.ownerCustomerId);
    this.visitCodeResult.set(null);
  }

  /*
   * THE DISCARD GUARD (2026-09-18, the order review). A ✕, the scrim or
   * Escape on a sheet holding UNSAVED EDITS asks first — Calendar's own
   * «Discard Changes?» — instead of dropping a beard trim somebody just
   * added. The shell's dismiss lands here; a programmatic close (a
   * rebooking, a cancellation) still uses `closeVisitSheet` directly and
   * never asks.
   */
  private readonly visitEditorRef = viewChild<StaffVisitEditor>('visitEditor');
  private readonly createEditorRef =
    viewChild<StaffVisitEditor>('createEditor');
  /** Which sheet's ✕ is waiting on «Отхвърли промените?», or none. */
  protected readonly discardPending = signal<DiscardTarget | null>(null);

  protected dismissVisitSheet(): void {
    if (this.visitEditorRef()?.dirty()) {
      this.discardPending.set(DiscardTarget.Visit);
      return;
    }
    this.closeVisitSheet();
  }

  protected dismissCreateSheet(): void {
    if (this.createEditorRef()?.dirty()) {
      this.discardPending.set(DiscardTarget.Create);
      return;
    }
    this.closeCreateSheet();
  }

  protected confirmDiscard(): void {
    const which = this.discardPending();
    this.discardPending.set(null);
    if (which === DiscardTarget.Visit) this.closeVisitSheet();
    if (which === DiscardTarget.Create) this.closeCreateSheet();
  }

  /**
   * The alert's two answers (2026-09-23): the destructive one, and the
   * safe one — bold, last in the stack, and what Escape and the scrim mean.
   */
  protected readonly discardActions = computed<readonly UiAlertAction[]>(() => [
    {
      id: DiscardAnswer.Discard,
      label: this.rawCopy('staff.visit.discard'),
      role: 'destructive',
      testId: 'staff-discard-confirm',
    },
    {
      id: DiscardAnswer.Keep,
      label: this.rawCopy('staff.visit.keepEditing'),
      role: 'cancel',
      preferred: true,
      testId: 'staff-discard-keep',
    },
  ]);

  protected onDiscardPick(id: string): void {
    if (id === DiscardAnswer.Discard) this.confirmDiscard();
    else this.discardPending.set(null);
  }

  /** The zone notice's one way out. */
  protected readonly zoneActions = computed<readonly UiAlertAction[]>(() => [
    {
      id: 'close',
      label: this.rawCopy('staff.day.cancelDismiss'),
      role: 'cancel',
      preferred: true,
      testId: 'staff-zone-close',
    },
  ]);

  protected closeVisitSheet(): void {
    const id = this.visitSheetId();
    this.visitSheetId.set(null);
    this.visitTrail.set([]);
    // The probe is the sheet's own subscription — a closed sheet must not
    // keep a listener open on a day nothing is looking at.
    this.visitDraftDay.set(null);
    this.visitDraftChair.set(null);
    this.store.probeDay(null);
    this.store.probeNote(null);
    this.store.probePhotos(null);
    this.store.probeGrants(null);
    this.visitCodeResult.set(null);
    // Back to the row that opened it, or a keyboard user lands on <body>.
    if (id !== null) this.restoreFocusToRow(id);
  }

  /**
   * THE CODE THE BARBER TYPED, answered.
   *
   * The sheet asks (`promoCodeEntered`) and reads the answer back off this
   * input, the same shape as the client search: the editor stays free of
   * the port, and a stale answer cannot apply to a newer code because the
   * result names the code it is for.
   */
  protected readonly visitCodeResult = signal<VisitEditorCodeResult | null>(
    null,
  );

  protected async resolveCodeFromEditor(code: string): Promise<void> {
    const coupon = await this.store.resolveCode(code);
    if (coupon !== null) {
      this.visitCodeResult.set({
        code,
        promo: {
          label: coupon.name,
          // The coupon's value slice, exactly its variant's fields.
          value: CouponValue.of(coupon),
          exclusive: Combinability.isExclusive(coupon.combinability),
        },
        voucher: null,
        refusal: null,
      });
      return;
    }
    // Not a coupon: perhaps a gift voucher. Returned whatever its state, so
    // the sheet can say WHY an empty or a void one will not take.
    const found = await this.store.resolveVoucher(code);
    this.visitCodeResult.set({
      code,
      promo: null,
      voucher:
        found === null
          ? null
          : {
              voucherId: found.voucher.id,
              code: found.voucher.code,
              availableCents: found.voucher.balanceCents,
            },
      refusal: found?.refusal ?? null,
    });
  }

  /**
   * Act from inside the sheet.
   *
   * Terminal acts close it — the record they described is settled and the
   * sheet would be offering verbs that no longer exist. Everything else
   * keeps it open, so "arrived" then "done" is two taps in one place.
   */
  protected async actFromSheet(row: DayRowVm, to: RowVerb): Promise<void> {
    // An hour that did not happen — cancelled, or nobody came.
    if (StaffVerb.didNotHappen(to)) this.visitSheetId.set(null);
    await this.act(row, to);
  }

  /**
   * The editor's `(acted)`, resolved back to the row it belongs to.
   *
   * The editor is handed a flat view model and emits a `RowVerb`; it has no
   * `DayRowVm` and must not need one. Resolving the row here keeps the party
   * arithmetic — which seat a terminal act settles — in the one place that
   * already knows it.
   */
  protected async actFromEditor(
    appointmentId: AppointmentId | null,
    verb: RowVerb,
  ): Promise<void> {
    const row = this.visitSheetRow();
    // The editor speaks the AGGREGATE's name — `visitSheetRow` has already
    // resolved which of a party's rows is open, so this only guards against a
    // late emit from a sheet that has since moved on.
    if (row === null || row.appointmentId !== appointmentId) return;
    // The row's own verbs are what the sheet may have said — a verb none of
    // them wears asks for nothing.
    if (
      verb !== row.primary &&
      !row.overflow.some((offered) => offered === verb)
    ) {
      return;
    }
    await this.actFromSheet(row, verb);
  }

  /**
   * `Запази` — the draft, as the commands the server actually has, and THE
   * RECEIPT (owner, 2026-09-23: "build the save receipt with whole-save
   * undo"). A save that lands raises the page's toast, «Промените са
   * запазени», and its «Отмени» maps the visit back to what the sheet was
   * opened on: ONE batch through the same callable, decided by the server
   * like any edit, never a client-side rollback. The snapshot is the
   * editor's seed as it would have saved it untouched (`snapshotCommitOf`),
   * and the way back is this save's own arithmetic (`commandsFor`) run
   * from the LIVE row towards that snapshot — a seat the save added is
   * removed, one it removed is re-added with its old terms, the block
   * moves home, the bill, the tip and the note go back.
   *
   * The editor speaks in minutes-from-midnight because it knows the day only
   * as a key; the instant is built HERE, where the shop's zone lives. That
   * split is deliberate — an editor that invented a timezone would be wrong in
   * one shop out of every two.
   *
   * ⚠ ONE REQUEST, not one per change. `staffEdit` takes a batch and folds it
   * over the stored seats before deciding once, so a save that moves the day
   * AND stretches the block lands whole or not at all. Sending them
   * separately would be two placement decisions and a booking left moved but
   * not stretched when the second is refused.
   *
   * WHAT TRAVELS: the day, the start, the span, each leg's minutes, chair
   * and typed price, services added and removed (`addSeat`/`removeSeat`),
   * the bill's discount (`discount`, 2026-09-10), and — beside the batch,
   * in its own document — the team note. What still does not: a client
   * added to an EXISTING visit, which is the party grammar's job.
   */
  private async saveFromEditor(
    appointmentId: AppointmentId,
    commit: VisitEditorCommit,
    row: DayRowVm | null,
  ): Promise<void> {
    // The snapshot, taken BEFORE the write from the seed the sheet holds —
    // the row as the server last said it, with the note beside it.
    const vm = this.visitEditorVm();
    const before =
      row !== null && vm !== null && vm.appointmentId === appointmentId
        ? snapshotCommitOf(vm)
        : null;
    /*
     * THE SIDE FIELDS this save writes (round 5): the ones the barber
     * CHANGED from what the draft drew them from — never one they left
     * alone, however long the sheet has been open
     * (`VisitSidesSystem.writesOf`). The sheet follows the stored note and
     * tip while they are untouched, so a colleague's tip recorded after it
     * opened is shown, not written over.
     * A commit that does not say what it drew (`drawn: null`) is measured
     * against what is stored now.
     */
    const drawn: VisitSides = commit.drawn ?? {
      note: this.store.teamNote(),
      tipCents: row?.tipCents ?? null,
    };
    const touched = VisitSidesSystem.writesOf(commit, drawn);
    const writes: SaveWrites = {
      note: touched.note,
      tip: touched.tip && row !== null && row.seatIds[0] !== undefined,
    };
    /*
     * What the way back has to work with: whether this save has one at all
     * (`reversibleSave`), and whether it could change the row's shape — a
     * note alone cannot, and its undo need not wait for the listener.
     */
    const built = this.commandsFor(commit, row);
    const commands = built.ok ? built.value : [];
    const reversible = reversibleSave(
      row === null ? null : { bookingStatus: row.rootBookingStatus },
      commands,
    );
    const undone = before === null ? null : this.commandsFor(before, row);
    const shapeNeutral =
      !writes.tip &&
      built.ok &&
      undone !== null &&
      undone.ok &&
      JSON.stringify(commands) === JSON.stringify(undone.value);
    const landed = await this.writeFromEditor(
      appointmentId,
      commit,
      row,
      writes,
      drawn,
    );
    /*
     * ⚠ ONLY ON SUCCESS. The mark tells the sheet the server has spoken, and
     * the sheet then takes the server's own encoding of the time as its
     * baseline — which is the only way the save button can ever go away,
     * because a `resize` comes back as a changed SEAT DURATION while the
     * draft holds an override on an unchanged leg. Two encodings of one
     * visit; the stored one wins.
     */
    if (batchLanded(landed)) this.visitSavedMark.update((mark) => mark + 1);
    // The sheet stays, the toast says why (owner, 2026-09-17) — and a
    // save that lands takes a stale refusal down with it.
    if (!writeLanded(landed)) {
      const error =
        landed.visitEditWriteOutcome === VisitEditWriteOutcome.Stale
          ? sidesMovedError()
          : this.store.errorFor(appointmentId);
      this.refuse(error);
      // SOMEBODY ELSE SAVED IT FIRST: the toast says so in one line, and
      // the sheet reloads the visit as it now stands — the draft drawn
      // from the older screen is never written over theirs.
      if (!batchLanded(landed) && isStaleRefusal(error)) {
        void this.reloadStale(appointmentId, row, error);
      }
      return;
    }
    if (before !== null && row !== null && reversible) {
      this.notice.set(null);
      this.offerSaveUndo(appointmentId, row, before, writes, shapeNeutral, {
        note: commit.note,
        tipCents: commit.tipCents,
      });
      return;
    }
    /*
     * THE RECEIPT WITHOUT A WAY BACK: a seat added after the cut is worked
     * the moment it is written and the server keeps history, so «Отмени»
     * would only ever be refused. The toast still says the save landed.
     */
    this.undo.set(null);
    this.notice.set(this.transloco.translate('staff.day.undo.saved'));
  }

  /**
   * THE WRITES a target state costs from a row: the batch (`commandsFor`),
   * and beside it the team note and the tip, each only when the caller says
   * it changed — a save knows what it typed, and its undo knows what the
   * save wrote. `drawn` is what those side fields were when the change was
   * made: the draft's for a save, what the save wrote for its undo.
   *
   * ⚠ THE BATCH GOES FIRST, AND ALONE DECIDES (round 5). The batch claims
   * the revision the draft was drawn from; the note and the tip are written
   * only once it has landed. Written before it, a save the server then
   * refused as stale had already put the old screen's note and tip over a
   * colleague's — the very overwrite the claim exists to stop. And a side
   * field somebody else changed under the draft refuses the write before
   * anything goes out (`VisitSidesSystem.movedUnder`): the note and the tip
   * do not move the revision, so this device's own view is the only guard
   * they have.
   */
  private async writeFromEditor(
    appointmentId: AppointmentId,
    target: VisitEditorCommit,
    row: DayRowVm | null,
    writes: SaveWrites,
    drawn: VisitSides,
  ): Promise<EditorWrite> {
    // What this device hears now: the note's own listener, which may not
    // answer (`undefined`), and the row's tip, unheard without a row. A
    // field this device does not hear is not judged.
    const liveNote = this.store.teamNoteOf(appointmentId);
    if (
      VisitSidesSystem.movedUnder(writes, drawn, target, {
        note: liveNote ?? null,
        noteHeard: liveNote !== undefined,
        tipCents: row === null ? null : row.tipCents,
        tipHeard: row !== null,
      })
    ) {
      return {
        visitEditWriteOutcome: VisitEditWriteOutcome.Stale,
        sidesWritten: false,
      };
    }

    // The batch claims the revision the draft was drawn from (round 5): a
    // colleague's save since is refused as stale, never overwritten. A save
    // that changed only the note or the tip has no batch to send.
    const built = this.commandsFor(target, row);
    if (!built.ok) {
      // A placement the call cannot carry (a minute off the shop's day) is
      // refused here as the server refuses it — nothing goes out.
      this.store.refuse(appointmentId, built.error);
      return {
        visitEditWriteOutcome: VisitEditWriteOutcome.BatchRefused,
        sidesWritten: false,
      };
    }
    const commands = built.value;
    if (commands.length > 0) {
      const batch = await this.store.staffEdit({
        appointmentId,
        commands,
        acknowledgedOverlap: false,
        expectedVersion: target.revision,
        operationId: null,
      });
      if (!batch) {
        return {
          visitEditWriteOutcome: VisitEditWriteOutcome.BatchRefused,
          sidesWritten: false,
        };
      }
    }

    /*
     * THE TEAM NOTE writes beside the batch, not inside it: it lives in a
     * staff-only sibling collection the availability engine never sees, so
     * there is no command for it and no reason to hold it hostage to a
     * placement decision. An unchanged note writes nothing.
     */
    const noteWritten = writes.note
      ? await this.store.saveTeamNote(appointmentId, target.note)
      : true;

    /*
     * THE TIP writes beside the batch too (2026-09-15): a stamp on one of
     * the chair's seats, not a `staffEdit` command (the port says why), and
     * drafted with the rest of the sheet so «Запази» is the receipt's one
     * verb. Unchanged writes nothing; a new visit carries none. The seat is
     * the row's first that the batch KEPT (`StaffEditPlanSystem.tipSeat`) —
     * the batch has already run, and a seat it removed takes a stamp with
     * it.
     */
    const tipSeat = StaffEditPlanSystem.tipSeat(row, target);
    const tipWritten =
      writes.tip && tipSeat !== null
        ? await this.recordTip(appointmentId, tipSeat, target.tipCents)
        : true;

    return {
      visitEditWriteOutcome: VisitEditWriteOutcome.Written,
      sidesWritten: noteWritten && tipWritten,
    };
  }

  /**
   * One chair's tip as the call carries it (`amountCents`, `null` clears).
   * The figure is already a price: the sheet's entry made it one at the
   * field (`PriceCents.of`), and a stored or preset tip is one by
   * construction.
   */
  private recordTip(
    appointmentId: AppointmentId,
    seatId: SeatId,
    amountCents: PriceCents | null,
  ): Promise<boolean> {
    return this.store.recordTip({ appointmentId, seatId, amountCents });
  }

  /**
   * THE BATCH from a row to a target — the save's arithmetic, and the
   * undo's, since both are "make the stored visit say this"
   * (`StaffEditPlanSystem.commandsFor`, pass D D-10.1; every command is
   * decided by the server in one fold — see `saveFromEditor`). The row
   * passes AS IS (Law 3). This page adds only what it alone holds: every
   * guest label the VISIT holds on any loaded day — a stranger joining
   * this chair is numbered past the other chairs' walk-ins too
   * (`visitGuestLabels`) — and the catalogue's walk-in words.
   */
  private commandsFor(
    commit: VisitEditorCommit,
    row: DayRowVm | null,
  ): Result<readonly BookingCall.EditCommand[], PipelineError> {
    return StaffEditPlanSystem.commandsFor(
      commit,
      row,
      row === null ? [] : this.visitGuestLabels(row.appointmentId),
      this.walkInWords(),
    );
  }

  /**
   * The catalogue words a save names its unnamed people by —
   * «Случаен клиент», then «Случаен клиент 2»… (`staff.visit.walkIn`,
   * `staff.visit.walkInNumbered`).
   */
  private walkInWords(): StaffEditWords {
    return {
      walkIn: this.transloco.translate('staff.visit.walkIn'),
      walkInNumbered: (number) =>
        this.transloco.translate('staff.visit.walkInNumbered', { number }),
    };
  }

  /**
   * THE WAY BACK FROM A SAVE. The toast holds the snapshot; its action waits
   * for the listener to deliver the save it is undoing (the callable
   * answers first), reads the visit AS IT NOW IS — the live row, on
   * whichever loaded day or chair the save put it — and runs the save's own
   * arithmetic from there towards the snapshot, then asks the sheet on that
   * visit to re-seed once the server's row agrees. Edits typed into the
   * sheet in the eight seconds after a save go with the save: «Отмени»
   * means "as it was before I saved". A row the save moved beyond the
   * loaded days is undone from its own snapshot, which brings the block
   * home and leaves a seat change made in that same save for the sheet to
   * show.
   */
  private offerSaveUndo(
    appointmentId: AppointmentId,
    rowBefore: DayRowVm,
    before: VisitEditorCommit,
    writes: SaveWrites,
    shapeNeutral: boolean,
    /** The note and the tip the save wrote — what the undo is drawn from. */
    wrote: VisitSides,
  ): void {
    const shape = rowShape(rowBefore);
    const find = () => this.rowFor(rowBefore.id, rowBefore.seatIds);
    this.offerUndoOf(
      this.transloco.translate('staff.day.undo.saved'),
      async () => {
        /*
         * THE SAVE MUST HAVE REACHED THE ROW. The receipt is offered the
         * moment the callable answers, and the listener that redraws the
         * lane is a second channel: an undo computed from a row the save
         * has not yet reached would find nothing to take back and report
         * success (found in review). A save that could not change the
         * row's shape — the note alone — has nothing to wait for.
         */
        if (!shapeNeutral) {
          await this.awaitRow(
            find,
            (row) => row === null || rowShape(row) !== shape,
          );
        }
        // Drawn from what the save wrote: a colleague's note or tip since
        // is refused as stale, never written over (round 5).
        const write = () =>
          this.writeFromEditor(
            appointmentId,
            before,
            find() ?? rowBefore,
            writes,
            wrote,
          );
        let landed = await write();
        /*
         * THE VISIT'S OWN GHOST. The busy projection is only UNIONED inside
         * the save's transaction; the span the save vacated is cleared by a
         * trigger a moment later, so an undo fired at once can be refused
         * as overlapping the slot it is returning to — its own. One more
         * try after the projection has had its moment; a second refusal is
         * a real one (somebody took the slot in between) and the toast
         * says so.
         */
        if (
          landed.visitEditWriteOutcome === VisitEditWriteOutcome.BatchRefused &&
          isOverlapOffer(this.store.errorFor(appointmentId))
        ) {
          await new Promise((resolve) => setTimeout(resolve, BUSY_SETTLE_MS));
          landed = await write();
        }
        if (!writeLanded(landed)) {
          /*
           * A REFUSED UNDO is not "try again": the receipt is spent and the
           * sheet is clean on the SAVED visit. The toast says the save
           * stands, and why (found in review).
           */
          const error =
            landed.visitEditWriteOutcome === VisitEditWriteOutcome.Stale
              ? sidesMovedError()
              : this.store.errorFor(appointmentId);
          this.undo.set(null);
          this.notice.set(
            this.transloco.translate('staff.day.undo.refused', {
              reason: error === null ? '' : this.describeError(error),
            }),
          );
          // Somebody else saved the visit after this save: the undo is not
          // written over them, and the sheet shows what they left.
          if (!batchLanded(landed) && isStaleRefusal(error)) {
            void this.reloadStale(appointmentId, find(), error);
          }
          return false;
        }
        void this.reseedWhenBack(appointmentId, find, shape);
        return true;
      },
    );
  }

  /**
   * Once the server's row agrees with the snapshot — or the ceiling passes,
   * for a server that normalised the way back into something the shape does
   * not name — the sheet showing THAT visit takes the live row as its draft
   * again. The mark carries the visit so a sheet opened on another one in
   * the meantime keeps what was typed there (found in review).
   */
  private async reseedWhenBack(
    appointmentId: AppointmentId,
    find: () => DayRowVm | null,
    shape: string,
  ): Promise<void> {
    await this.awaitRow(find, (row) => row !== null && rowShape(row) === shape);
    this.visitReseedMark.update(({ n }) => ({ appointmentId, n: n + 1 }));
  }

  /**
   * THE STALE-SCREEN RELOAD (round 5). A save or an undo the server refused
   * as stale: somebody else's save landed after this sheet's draft was
   * drawn. Once the live row has caught up with the revision the server
   * reported (`serverParams.actual`) — or the ceiling passes — the sheet showing
   * that visit takes the live row as its draft again, with the toast
   * already saying why. Nothing is re-sent: what the barber meant to change
   * may no longer make sense over what their colleague did.
   */
  private async reloadStale(
    appointmentId: AppointmentId,
    row: DayRowVm | null,
    error: PipelineError | null,
  ): Promise<void> {
    const actual = Number(error?.serverParams['actual']);
    if (row !== null && Number.isInteger(actual)) {
      const find = () => this.rowFor(row.id, row.seatIds);
      await this.awaitRow(
        find,
        (live) => live !== null && (live.revision ?? -1) >= actual,
      );
    }
    this.visitReseedMark.update(({ n }) => ({ appointmentId, n: n + 1 }));
  }

  /**
   * A row by its own name — on the shown day first, then on any loaded day
   * — and, failing that, by the SEATS it held: a save that restaffed the
   * chair moved the visit to another lane and renamed its row, and its
   * undo must still find it there (found in review). `seatIds` empty means
   * by name alone.
   */
  private rowFor(
    rowId: string,
    seatIds: readonly SeatId[] = [],
  ): DayRowVm | null {
    const hash = rowId.lastIndexOf('#');
    const appointmentId = hash < 0 ? rowId : rowId.slice(0, hash);
    const barberId = hash < 0 ? '' : rowId.slice(hash + 1);
    const holds = (ids: readonly SeatId[]) =>
      ids.some((id) => seatIds.includes(id));
    const shown = this.lanes().flatMap((lane) =>
      lane.entries.filter(
        (entry): entry is DayRowVm => entry.agendaRow === AgendaRow.Visit,
      ),
    );
    const named = shown.find((entry) => entry.id === rowId);
    if (named !== undefined) return named;
    const bySeat = shown.find(
      (entry) => entry.appointmentId === appointmentId && holds(entry.seatIds),
    );
    if (bySeat !== undefined) return bySeat;

    const nowUtcMs = this.nowUtcMs();
    const shopNow = this.store.shopNow();
    for (const cell of this.store.dayCells()) {
      for (const lane of cell.lanes) {
        const appointment = lane.appointments.find(
          (entry) => entry.id === appointmentId,
        );
        if (appointment === undefined) continue;
        const here = appointment.seats
          .filter((seat) => seat.barberId === lane.barberId)
          .map((seat) => seat.seatId);
        if (lane.barberId === barberId || holds(here)) {
          return this.toRow(appointment, lane.barberId, nowUtcMs, shopNow);
        }
      }
    }
    return null;
  }

  /* ── Waiting on the live row, and the sheet's re-seed ──────────────── */

  /**
   * Bumped, FOR ONE VISIT, when the sheet showing it must take the live row
   * as its draft again — the editor answers only a mark that names its own
   * subject.
   */
  protected readonly visitReseedMark = signal<{
    readonly appointmentId: AppointmentId | null;
    readonly n: number;
  }>({ appointmentId: null, n: 0 });

  /**
   * How long an undone save waits on the listener, each way, before going
   * on with what is live. The listener delivers in well under a second;
   * this is the ceiling, not the expectation. A field so a test can lower it.
   */
  protected rowWaitMs = ROW_WAIT_MS;

  private readonly rowWatch = signal<{
    readonly find: () => DayRowVm | null;
    readonly done: (row: DayRowVm | null) => boolean;
    readonly settle: () => void;
  } | null>(null);

  /**
   * Resolves once the live row satisfies `done`, or when the ceiling
   * passes. One wait at a time: a newer one stands the older down, settled
   * at once, and a destroyed page settles whatever it was waiting on.
   */
  private awaitRow(
    find: () => DayRowVm | null,
    done: (row: DayRowVm | null) => boolean,
  ): Promise<void> {
    return new Promise((resolve) => {
      this.rowWatch()?.settle();
      let timer: ReturnType<typeof setTimeout> | null = null;
      const settle = () => {
        if (timer !== null) clearTimeout(timer);
        if (this.rowWatch()?.settle === settle) this.rowWatch.set(null);
        resolve();
      };
      timer = setTimeout(settle, this.rowWaitMs);
      this.rowWatch.set({ find, done, settle });
    });
  }

  protected readonly rowWatched = effect(() => {
    const watch = this.rowWatch();
    if (watch === null) return;
    const row = watch.find();
    if (watch.done(row)) untracked(() => watch.settle());
  });

  /** The visit whose save from the editor is in flight — «Запази» turns its ring on it. */
  private readonly savingVisitId = signal<AppointmentId | null>(null);

  /* ── The shop's photos of the visit ─────────────────────────────────── */

  /** A photo as the sheet shows it: the chair by name, where the catalogue still has it. */
  private toEditorPhoto(photo: AppointmentPhoto): VisitEditorPhoto {
    return {
      photoId: photo.id,
      url: photo.url,
      takenAtUtcMs: photo.takenAtUtcMs,
      barberId: photo.barberId,
      barberName:
        this.barberOptions().find((chair) => chair.id === photo.barberId)
          ?.label ?? null,
      clientLabel: photo.clientLabel,
      width: photo.width,
      height: photo.height,
      photoOrigin: photo.photoOrigin,
      label: photo.label,
    };
  }

  /**
   * THE SHOP'S OWN PICTURES on offer to a visit (owner, 2026-09-17:
   * "assign an image that is already in the system"): every service's
   * cover and work shots, named for the service, each once.
   */
  protected readonly visitLibraryImages = computed<
    readonly VisitEditorLibraryImage[]
  >(() => {
    const seen = new Set<string>();
    const images: VisitEditorLibraryImage[] = [];
    for (const vm of this.catalog.serviceVms()) {
      const label = this.content.text(vm.name);
      for (const url of [vm.coverSrc, ...vm.gallery]) {
        if (!url || seen.has(url)) continue;
        seen.add(url);
        images.push({ id: `${vm.id}:${images.length}`, url, path: url, label });
      }
    }
    return images;
  });

  /** The gallery page's pick: the picture pointed at, with the visit's facts. */
  protected async adoptPhotoFromEditor(
    vm: VisitEditorVm,
    image: VisitEditorLibraryImage,
  ): Promise<void> {
    // A saved visit in a chair — the only sheet a photo can be put on.
    if (vm.appointmentId === null || vm.chairId === null) return;
    const done = await this.store.adoptPhoto({
      appointmentId: vm.appointmentId,
      barberId: vm.chairId,
      clientCustomerId: vm.clientCustomerId,
      clientLabel: vm.clientLabel,
      path: image.path,
      url: image.url,
      label: image.label,
    });
    if (!done) this.refuse(null, 'staff.visit.photoFailed');
  }

  /**
   * The editor's shutter (owner, 2026-09-17): the picture goes up with the
   * VISIT's facts — the chair the sheet is on, the client it is for — and
   * a refusal is the page's toast. Nothing is placed locally: the live read
   * draws the photo once it is on the visit.
   */
  protected async attachPhotoFromEditor(
    vm: VisitEditorVm,
    file: File,
  ): Promise<void> {
    // A saved visit in a chair — the only sheet a photo can be put on.
    if (vm.appointmentId === null || vm.chairId === null) return;
    const done = await this.store.attachPhoto({
      appointmentId: vm.appointmentId,
      barberId: vm.chairId,
      clientCustomerId: vm.clientCustomerId,
      clientLabel: vm.clientLabel,
      file,
    });
    if (!done) this.refuse(null, 'staff.visit.photoFailed');
  }

  protected async removePhotoFromEditor(
    photoId: AppointmentPhotoId,
  ): Promise<void> {
    const photo = this.store
      .visitPhotos()
      .find((entry) => entry.id === photoId);
    if (photo === undefined) return;
    if (!(await this.store.removePhoto(photo))) {
      this.refuse(null, 'staff.visit.photoRemoveFailed');
    }
  }

  /**
   * THE SHEET'S ONE COMMIT IS «Запази» (owner, 2026-09-23).
   *
   * The frame's drag and resize committed on release from 2026-09-03 to the
   * order review of 2026-09-18 — the sheet's one immediate write, guarded
   * to the shown day, with the page's toast holding the inverse gesture.
   * That way back rewrote the SERVER while the editor's draft kept the
   * dragged time: «Отмени» moved the agenda's row home, and the frame,
   * «Начало» and the dock went on saying otherwise ("you click cancel but
   * your frame edit doesn't revert"). A drag is a draft edit now, carried
   * by the save with everything else — the seat scope, the shop's zone and
   * the day all travel the one road below — and there is no gesture toast
   * left to be wrong about.
   */
  protected async commitFromEditor(
    appointmentId: AppointmentId | null,
    commit: VisitEditorCommit,
  ): Promise<void> {
    // The visit sheet edits a saved visit; a create commits through
    // `createFromEditor`.
    if (appointmentId === null) return;
    const row = this.visitSheetRow();
    this.savingVisitId.set(appointmentId);
    try {
      await this.saveFromEditor(appointmentId, commit, row);
    } finally {
      this.savingVisitId.set(null);
    }
  }

  protected readonly cancelId = signal<AppointmentId | null>(null);
  /**
   * WHICH SEATS this cancellation resolves — empty means the whole booking.
   *
   * A list rather than one id: a row is one chair's share, and a chair can
   * hold two seats (a father and son booked together). Naming only the first
   * called off half a row and reported success for all of it.
   */
  protected readonly cancelSeatIds = signal<readonly SeatId[]>([]);
  protected readonly cancelReasonCode = signal<CancellationReason | null>(null);
  protected readonly cancelNote = signal('');
  /**
   * Whether this sheet has already filed its «Друго…» words. ONCE PER
   * SHEET: a chair whose second seat was refused files them with the first
   * seat's cancel, and the retry that lands the second must not append them
   * again (`appendTeamNote` appends, it never replaces).
   */
  private readonly cancelNoteFiled = signal(false);

  /** The codes a human may pick — the domain's list, not a local copy. */
  protected readonly reasonCodes = SeatOutcome.OFFERED_REASONS;
  /** Each code's lowercase word — its chip's test id and its catalogue key. */
  protected readonly reasonWords = cancellationReasonWords;
  /** The template's dictionary — «Друго…» is the arm that carries a note. */
  protected readonly Reason = CancellationReason;

  /**
   * Pick a reason, or let go of the one picked. The reason is optional
   * (owner, 2026-09-11), so "none" has to be reachable again after a tap —
   * a chip that could only be replaced would make the first tap binding.
   */
  protected toggleReason(code: CancellationReason): void {
    this.cancelReasonCode.update((current) => (current === code ? null : code));
  }

  protected async confirmCancel(): Promise<void> {
    const appointmentId = this.cancelId();
    if (appointmentId === null) return;
    const seatIds = this.cancelSeatIds();
    /*
     * THE REASON IS OPTIONAL (owner, 2026-09-11: "barbers may not have time
     * to enter such issue"). Nothing picked sends no code, and the server
     * files the cancellation as `unspecified`. «Друго…» with nothing
     * written is the same: a door opened and not walked through, not a
     * reason — and a disabled button would have stopped the barber who
     * tapped the chip by accident with no word about why.
     *
     * THE CALL CARRIES THE CODE ONLY (D23). What the barber wrote under
     * «Друго…» is the visit's note, saved below once the cancel has landed.
     */
    const note = this.cancelNote().trim();
    const reasonCode = BookingCall.staffCancelReason(
      this.cancelReasonCode(),
      note,
    );
    const cancel = (seatId: SeatId | null): Promise<boolean> =>
      this.store.transition(
        transitionOf(
          appointmentId,
          BookingStatus.Cancelled,
          reasonCode,
          seatId,
        ),
      );

    /*
     * One call per seat, in sequence.
     *
     * `transitionAppointment` resolves ONE seat per request, and the two
     * writes are not independent: the second re-reads a root the first has
     * already re-derived, so firing them together would race on the same
     * aggregate. A chair holding two seats is the only case that loops.
     */
    let done: boolean;
    let landed: boolean;
    if (seatIds.length === 0) {
      done = await cancel(null);
      landed = done;
    } else {
      const refused: SeatId[] = [];
      for (const seatId of seatIds) {
        if (!(await cancel(seatId))) refused.push(seatId);
      }
      done = refused.length === 0;
      landed = refused.length < seatIds.length;
      /*
       * A CANCEL THAT ONLY PARTLY LANDED keeps the sheet open on the seats
       * still to go. The ones that landed are resolved now, and sending them
       * again was refused as already resolved — on every retry, so the sheet
       * could never close and the second seat never be called off.
       */
      if (!done) this.cancelSeatIds.set(refused);
    }
    if (done) {
      this.cancelId.set(null);
      // Whole-booking cancellations get the way back; a seat cancelled out
      // of a party has no inverse the callable offers (`inverseOf`).
      const row = this.lanes()
        .flatMap((lane) => lane.entries)
        .find(
          (entry): entry is DayRowVm =>
            entry.agendaRow === AgendaRow.Visit &&
            entry.appointmentId === appointmentId,
        );
      const inverse = AppointmentLifecycleSystem.inverseOf(
        BookingStatus.Cancelled,
        seatIds.length === 0,
      );
      if (row && inverse !== null) {
        this.offerUndo(row, BookingStatus.Cancelled, inverse);
      }
    }
    /*
     * THE WORDS GO ON THE VISIT'S NOTE (D23: "free text, when staff type
     * it, is an appointment note") — only once a cancel landed, so a
     * refused cancel files nothing, and BELOW a note the visit already
     * has, never over it (`appendTeamNote`). ANY seat landing is enough: a
     * chair whose second seat was refused still carries the first seat's
     * OTHER, and its words belong beside it now rather than after a retry
     * that may never come. Once per sheet (`cancelNoteFiled`), so the retry
     * that lands the second seat does not append them twice. A note that
     * did not save raises the page's toast in place of the way back,
     * saying the cancellation itself stands.
     */
    if (
      reasonCode === CancellationReason.Other &&
      landed &&
      !this.cancelNoteFiled()
    ) {
      this.cancelNoteFiled.set(true);
      if (!(await this.store.appendTeamNote(appointmentId, note))) {
        this.refuse(null, 'staff.day.cancelNoteFailed');
      }
    }
  }

  // ── Creating a visit ─────────────────────────────────────────────────
  //
  // THE SAME SHEET, drafting a visit that does not exist yet (owner review
  // 2026-09-08). The editor gets a VM with an empty `appointmentId`; its
  // `Запази` publishes legs and clients, and this page turns them into one
  // `commitBooking` placed by the shop — for a named client, or for nobody
  // (a walk-in of guest seats).

  private readonly userSearch = inject(USER_SEARCH_PORTS);

  /** The last create's nonce — counted, never read off the clock (UR-11). */
  private createSeq = 0;

  protected readonly createVisit = signal<{
    readonly barberId: BarberId;
    /** Where the draft starts on the frame's anchored axis. */
    readonly startMinute: TrackMinute;
    /** A span to draw, when the caller knows one (a block turned visit). */
    readonly minutes?: DurationMinutes;
    /**
     * Fresh per create — the editor keys its draft on it (`new-<nonce>`).
     * A counter (`createSeq`), so two creates are strictly distinct even
     * under a pinned clock.
     */
    readonly nonce: number;
    /** Prefilled from a finished visit (`Запиши пак`). */
    readonly legs?: readonly VisitEditorLeg[];
    readonly client?: {
      /** The person's account, or `null` for a walk-in. */
      readonly id: UserId | null;
      readonly label: string;
      readonly phone: string | null;
    };
    /** The visit a `Запиши пак` came from — the rebooking edge. */
    readonly bookedFrom?: AppointmentId;
  } | null>(null);

  /** Which create door the ＋ is showing: the kind menu. */
  protected readonly createMenu = signal(false);

  /** The client search's results, refreshed as the barber types. */
  protected readonly visitClientOptions = signal<
    readonly VisitEditorClientOption[]
  >([]);

  protected readonly createVm = computed<VisitEditorVm | null>(() => {
    const create = this.createVisit();
    if (create === null) return null;
    // A create opens only once the day is known (`openCreate`'s `ready`).
    const dayKey = this.store.dayKey();
    if (dayKey === null) return null;
    const lane = this.lanes().find(
      (entry) => entry.barberId === create.barberId,
    );
    const storeLane = this.store
      .lanes()
      .find((entry) => entry.barberId === create.barberId);
    const roster = this.rosterHull(storeLane?.rostered ?? []);
    // What occupies the chair — the server's rule (DEP-2).
    const neighbours = this.occupyingRows(
      lane,
      storeLane?.appointments ?? [],
      null,
    );
    const chair = this.scopeOptions().find(
      (option) => option.id === create.barberId,
    );
    // A new visit starts in the chair's own shop — the first it is
    // rostered at — and the «Салон» row may move it before the save.
    const chairBarber = this.catalog
      .barbers()
      .find((barber) => barber.id === create.barberId);
    const locationId =
      (chairBarber === undefined
        ? null
        : LocationScopeSystem.homeOf(chairBarber)) ??
      this.catalog.locations()[0]?.id ??
      null;
    return {
      // Not saved yet: no id (the sheet's «new» visit).
      appointmentId: null,
      rowId: `new-${create.nonce}`,
      locationId,
      // The shop's own zone, else the day's (`StaffDayStore.zoneAt`).
      timeZone: this.store.zoneAt()(locationId),
      peers: [],
      dayKey,
      dayLabel: this.dayPillLabel(dayKey),
      startMinute: create.startMinute,
      endMinute: TrackMinute.plus(
        create.startMinute,
        create.minutes ?? VisitDraftSystem.DEFAULT_SPAN_MINUTES,
      ),
      legs: create.legs ?? [],
      // A walk-in has a name and no account; a booking starts with nobody —
      // unless it is a rebooking, which starts with last time's client.
      clientLabel: create.client?.label ?? '',
      clientUserId: create.client?.id ?? null,
      // No client record yet: it is the save that names one.
      clientCustomerId: null,
      phone: create.client?.phone ?? null,
      phoneHref: create.client?.phone ?? null,
      clientMeta: null,
      note: null,
      teamNote: null,
      priceLabel: null,
      priceCents: null,
      // Nothing is priced yet: the shop's one currency.
      currency: Currency.EUR,
      tipLabel: null,
      tipCents: null,
      // A visit the server has not seen cannot be discounted or paid yet:
      // the rows wait for the first save, like the tip's.
      discounts: [],
      vouchers: [],
      // Nothing has happened to a visit that does not exist yet.
      resolution: null,
      // Not booked yet: no stored tag (the sheet's «new» visit).
      bookingStatus: null,
      statusLabel: this.transloco.translate('staff.visit.newTitle'),
      arrivedMinute: null,
      chairId: create.barberId,
      chairName: chair?.name ?? this.barberNameOf(create.barberId),
      chairTone: chair?.tone ?? this.toneOf(create.barberId),
      neighbours,
      rosterStartMinute: roster?.startMinutes ?? MIDNIGHT,
      rosterEndMinute: roster?.endMinutes ?? CLOSING,
      now: this.store.shopNow(),
      primaryVerb: null,
      overflowVerbs: [],
      acting: this.store.creating(),
    };
  });

  /**
   * The chair a create aims at: the scoped one, else the first working
   * lane, else the first chair of the roster.
   *
   * THE LAST FALLBACK IS THE DOOR (owner, 2026-09-09: "adding a blocker
   * when all are blocked for the selected date is not working — it should
   * always open"). A day everyone is off has no working lane, and the ＋
   * used to resolve to nobody and quietly do nothing. A block is exactly
   * what one adds to — or lifts from — such a day, and a booking on it is
   * the sheet's to warn about, not the button's to refuse.
   */
  private createChair(): BarberId | null {
    const scope = this.store.scope();
    if (
      scope !== null &&
      this.scopeOptions().some((option) => option.id === scope)
    ) {
      return scope;
    }
    return this.lanes()[0]?.barberId ?? this.scopeOptions()[0]?.id ?? null;
  }

  /** Now, snapped UP to the grain — a walk-in starts next tick (`snapUp`). */
  private nowSnapped(): TrackMinute {
    return VisitDraftSystem.snapUp(this.nowMinute());
  }

  /**
   * ONE kind of new visit (owner, 2026-09-09). «Бърз час» was a second
   * door that bundled two unrelated facts — a person without a profile and
   * a start of "now" — and someone at the counter may well want tomorrow.
   * The sheet now starts at the next tick, since somebody is usually in
   * front of the barber, and the frame moves it anywhere; the walk-in is
   * one tap in the people group.
   */
  protected openCreate(createIntent: CreateIntent): void {
    this.createMenu.set(false);
    // No day before the shop's zone is known (4A-11): nothing to author on.
    if (!this.store.ready()) return;
    const chair = this.createChair();
    if (chair === null) return;
    if (createIntent === CreateIntent.Block) {
      this.openBlockSheet(chair);
      return;
    }
    this.presentOnly();
    this.visitClientOptions.set([]);
    this.createVisit.set({
      barberId: chair,
      startMinute: this.nowSnapped(),
      nonce: ++this.createSeq,
    });
  }

  protected closeCreateSheet(): void {
    this.createVisit.set(null);
  }

  /**
   * `Запиши пак` — a NEW visit prefilled from a finished one: same chair,
   * same services, same client; the day is the barber's to pick. Legs get
   * fresh draft ids so the commit mints new seats rather than naming old,
   * and the finished visit rides along as `bookedFromAppointmentId`.
   */
  protected rebookFromEditor(vm: VisitEditorVm): void {
    // A visit sheet is always on a chair (its row's lane).
    const chair = vm.chairId;
    if (chair === null) return;
    this.closeVisitSheet();
    this.presentOnly();
    this.visitClientOptions.set([]);
    // The finished visit's own start and span (2026-09-18): the day is the
    // desk's to pick, the hour is what the client already comes at.
    this.createVisit.set({
      barberId: chair,
      startMinute: vm.startMinute,
      minutes: VisitDraftSystem.floorSpan(
        TrackMinute.span(vm.startMinute, vm.endMinute),
      ),
      nonce: ++this.createSeq,
      legs: vm.legs.map((leg, index) => ({
        ...leg,
        // A fresh draft seat — a `SeatId` by construction (`draft-…`).
        seatId: SeatId.of(
          `draft-${leg.serviceId}-${index}-${this.clock.nowUtcMs().toString(36)}`,
        ),
        overridden: false,
      })),
      client: {
        id: vm.clientUserId,
        label: vm.clientLabel,
        phone: vm.phone,
      },
      ...(vm.appointmentId === null ? {} : { bookedFrom: vm.appointmentId }),
    });
  }

  /**
   * THE ADD-CLIENT PAGE'S SECTIONS (2026-09-18): «Скорошни» — the shop's
   * last visitors, newest first, each with their last date, read from the
   * same window the search sheet reads. Built when the page opens, kept
   * for the sheet's life; a new source is one more section here. «Днес»
   * — the people booked on the shown day — was the first section and was
   * dropped (owner, 2026-09-22): a person already in today's book is not
   * one a barbershop adds to another visit, and the section only invited
   * the double booking.
   */
  protected readonly visitClientSections = signal<
    readonly VisitEditorClientSection[]
  >([]);

  /**
   * THE FACES (2026-09-18; owner: "where is the user avatar"): a client's
   * portrait lives in Storage under their id (`avatars/{uid}/original`,
   * readable by staff), not on the user document — so every person the
   * add-client page shows is looked up once per session, and the option
   * carries the url the moment it is known. Guests have no account and
   * no portrait to look for.
   */
  private readonly avatars = inject(AVATAR_PORTS);
  private readonly avatarUrls = signal<Readonly<Record<string, string | null>>>(
    {},
  );
  private readonly avatarLookups = new Set<string>();

  private resolveAvatars(ids: readonly DraftPersonKey[]): void {
    for (const id of ids) {
      // A guest has no account and no portrait to look for.
      const owner = DraftPersonKey.accountOf(id);
      if (owner === null || this.avatarLookups.has(id)) continue;
      this.avatarLookups.add(id);
      void this.avatars.findAvatar(owner).then((found) => {
        const url = found.ok ? (found.value?.url ?? null) : null;
        this.avatarUrls.update((urls) => ({ ...urls, [id]: url }));
      });
    }
  }

  /**
   * COMPANIONS' NAMES (client-card-redesign §3.1.4): a companion account
   * on a booking — the son his father booked — is named by his OWN
   * profile, never the booker's contact. Looked up once per session for
   * every companion in the loaded days, as the book loads, so the sheet
   * usually seeds with his name; until it lands his row reads «Клиент без
   * име» and his card names him from `users/{uid}` itself. A `PROVISIONED`
   * stub (signed in, never registered) names nobody: the port answers the
   * stored body, and a stub is no profile (flip-2 plan §3.5). Without a
   * profile port (a test bed) nobody is looked up.
   */
  private readonly profiles = inject(PROFILE_PORTS, { optional: true });
  protected readonly companionNames = signal<Readonly<Record<string, string>>>(
    {},
  );
  private readonly companionLookups = new Set<string>();

  protected readonly lookUpCompanions = effect(() => {
    const ids = new Set<UserId>();
    const lanes = [
      ...this.store.lanes(),
      ...this.store.dayCells().flatMap((cell) => cell.lanes),
    ];
    for (const lane of lanes) {
      for (const appointment of lane.appointments) {
        for (const seat of appointment.seats) {
          if (
            seat.seatSubject === SeatSubject.Account &&
            seat.subjectRelationship === SubjectRelationship.Companion
          ) {
            ids.add(seat.subjectUserId);
          }
        }
      }
    }
    untracked(() => this.resolveCompanionNames([...ids]));
  });

  private resolveCompanionNames(ids: readonly UserId[]): void {
    const profiles = this.profiles;
    if (profiles === null) return;
    for (const id of ids) {
      if (this.companionLookups.has(id)) continue;
      this.companionLookups.add(id);
      void profiles.loadProfile(id).then((found) => {
        // A failed read is asked again when the book next changes.
        if (!found.ok) this.companionLookups.delete(id);
        const user = found.ok ? found.value : null;
        const name =
          user !== null && Registration.isRegistered(user)
            ? Profile.fullName(user)
            : '';
        if (name.length === 0) return;
        this.companionNames.update((names) => ({ ...names, [id]: name }));
      });
    }
  }

  private withFaces(
    options: readonly VisitEditorClientOption[],
  ): readonly VisitEditorClientOption[] {
    const urls = this.avatarUrls();
    return options.map((option) => ({
      ...option,
      avatarSrc: urls[option.id] ?? null,
    }));
  }

  protected readonly visitClientOptionsWithFaces = computed(() =>
    this.withFaces(this.visitClientOptions()),
  );

  protected readonly visitClientSectionsWithFaces = computed(() =>
    this.visitClientSections().map((section) => ({
      ...section,
      clients: this.withFaces(section.clients),
    })),
  );

  protected async browseClients(): Promise<void> {
    await this.store.ensureWindow();
    // The visits that have BEGUN, newest first — each on its own shop's
    // wall clock, at the store's tick (`shopNowAt`, Law 7.3 T1, pass D
    // D-6.2): a visit begun is one whose start is at or before its shop's
    // "now". A shop whose zone is not known yet keeps the stamp rule (the
    // stored instant against the tick — stamp ordering, no zone needed).
    // Whose account each one is, once per person, is `recentAccounts`'
    // (the booker's, never a companion's — DEP-5).
    const nowUtcMs = this.store.nowUtcMs();
    const shopNowAt = this.store.shopNowAt();
    const startOf = (visit: Appointment): WallTime =>
      WallTime.of(visit.localDate, visit.startMinutes);
    const past = this.store
      .window()
      .filter((visit) => {
        const shopNow = shopNowAt(visit.locationId);
        return shopNow === null
          ? UtcEpochMs.compare(visit.utcEpochMs, nowUtcMs) < 0
          : VisitStorySystem.hasStarted(startOf(visit), shopNow);
      })
      .sort((a, b) => WallTime.compare(startOf(b), startOf(a)));
    const recent: VisitEditorClientOption[] = ClientQuerySystem.recentAccounts(
      past,
      RECENT_CLIENTS_CAP,
    ).map(({ userId, visit }) => {
      const phone = visit.contactPhone;
      return {
        id: DraftPersonKey.account(userId),
        label:
          visit.contactName ??
          this.transloco.translate('staff.day.unnamedClient'),
        phone: phone === null ? null : PhoneSystem.formatInternational(phone),
        phoneHref: phone,
        meta: this.transloco.translate('staff.visit.lastVisit', {
          // `3 авг` — the day a person was last here, as stored.
          date: this.wallLabel(visit.localDate, null, {
            day: 'numeric',
            month: 'short',
          }),
        }),
        email: visit.contactEmail,
      };
    });
    /*
     * THE BOOK (2026-09-18): every account in the loaded days, past and to
     * come — the omnibox ranks these on the keystroke, before the index
     * answers. Newest contact first, so a changed number is the one read
     * (`bookAccounts` orders them: each named account once, the booker's).
     */
    const book: VisitEditorClientOption[] = ClientQuerySystem.bookAccounts(
      this.store.window(),
    ).map(({ userId, visit, contactName }) => {
      const phone = visit.contactPhone;
      return {
        id: DraftPersonKey.account(userId),
        label: contactName,
        phone: phone === null ? null : PhoneSystem.formatInternational(phone),
        phoneHref: phone,
        meta: null,
        email: visit.contactEmail,
      };
    });
    this.visitClientBook.set(book);
    this.visitClientSections.set([
      {
        id: VisitEditorClientSectionId.Recent,
        title: this.transloco.translate('staff.visit.clientsRecent'),
        clients: recent,
      },
    ]);
    this.resolveAvatars(recent.map((client) => client.id));
  }

  /** Everyone in the loaded days — searched by the omnibox, never listed. */
  protected readonly visitClientBook = signal<
    readonly VisitEditorClientOption[]
  >([]);

  protected readonly visitClientBookWithFaces = computed(() =>
    this.withFaces(this.visitClientBook()),
  );

  /**
   * THE LOOKUP BEHIND THE OMNIBOX (2026-09-18). What was typed is parsed
   * once (`client-query.ts`) and the index is asked by its most selective
   * part — the mail, else the number in EVERY form the index holds it
   * («0887…», «359887…», the bare «887…» read aloud), else the longest word
   * of the name — in parallel, merged and de-duplicated. Debounced, so a
   * typed name is one question, not eight; and sequenced, so an answer
   * that comes back late can never replace the answer to a newer query.
   */
  protected readonly visitClientSearching = signal(false);
  private readonly deployment = inject(AUTH_DEPLOYMENT_PORTS).authDeployment;
  private clientSearchSeq = 0;
  private clientSearchTimer: ReturnType<typeof setTimeout> | null = null;

  protected searchClients(query: string): void {
    if (this.clientSearchTimer !== null) clearTimeout(this.clientSearchTimer);
    const parsed = parseClientQuery(query);
    // By the shop's own dial code: «088…» is asked as «359 88…» too — the
    // query's own default when the country has none.
    const code =
      PhoneSystem.countryCallingCode(this.deployment.defaultCountry) ??
      undefined;
    const keys = clientLookupKeys(parsed, code);
    // The book's own matches are on screen already — their faces are owed
    // now, not when the index answers. Only the rows a phone can show.
    if (parsed.clientQueryShape !== ClientQueryShape.Empty) {
      this.resolveAvatars(
        rankClients(this.visitClientBook(), parsed, code)
          .slice(0, BOOK_FACES_PER_QUERY)
          .map(({ client }) => client.id),
      );
    }
    const seq = ++this.clientSearchSeq;
    if (keys.length === 0) {
      this.visitClientOptions.set([]);
      this.visitClientSearching.set(false);
      return;
    }
    this.visitClientSearching.set(true);
    this.clientSearchTimer = setTimeout(() => {
      this.clientSearchTimer = null;
      void this.runClientSearch(keys, seq);
    }, CLIENT_SEARCH_DEBOUNCE_MS);
  }

  private async runClientSearch(
    keys: readonly string[],
    seq: number,
  ): Promise<void> {
    const answers = await Promise.all(
      keys.map((key) => {
        // The index's own form of the key; one it could never match is
        // asked nothing (no account holds an empty prefix).
        const prefix = SearchFieldsSystem.normalizeQuery(key);
        return prefix.length === 0
          ? null
          : this.userSearch.searchUsers(prefix, CLIENT_SEARCH_LIMIT);
      }),
    );
    // A newer query owns the list now.
    if (seq !== this.clientSearchSeq) return;
    const seen = new Set<string>();
    const options: VisitEditorClientOption[] = [];
    for (const answer of answers) {
      if (answer === null || !answer.ok) continue;
      for (const hit of answer.value) {
        if (seen.has(hit.id)) continue;
        seen.add(hit.id);
        options.push({
          id: DraftPersonKey.account(hit.id),
          label: searchLabelOf(hit),
          // Read as the profile prints it — «+359 88 765 4321», not the E.164.
          phone:
            hit.phone === null
              ? null
              : PhoneSystem.formatInternational(hit.phone),
          phoneHref: hit.phone,
          meta: hit.email,
          email: hit.email,
        });
      }
    }
    this.visitClientOptions.set(options);
    this.visitClientSearching.set(false);
    this.resolveAvatars(options.map((option) => option.id));
  }

  /**
   * EVERY GUEST LABEL THE VISIT HOLDS, whichever chair holds it (round 4,
   * 2026-09-25). The server's party check groups guests by label across the
   * whole APPOINTMENT (`personKey`), not per chair, so a stranger added on
   * one chair of a split party must be numbered past a walk-in already on
   * the other — `DayRowVm.people` is one chair's. Read off the stored
   * aggregate on any loaded day (the fallback `rowFor` uses too), so the
   * other chair counts whether or not its row is drawn.
   */
  private visitGuestLabels(appointmentId: AppointmentId): readonly string[] {
    for (const cell of this.store.dayCells()) {
      for (const lane of cell.lanes) {
        const appointment = lane.appointments.find(
          (entry) => entry.id === appointmentId,
        );
        if (appointment !== undefined) return guestLabelsOf(appointment.seats);
      }
    }
    return [];
  }

  /**
   * The create sheet's `Запази` — a booking placed by staff
   * (`StaffEditPlanSystem.bookingRequest`, pass D D-10.1).
   *
   * THE PARTY GRAMMAR (2026-09-08): every leg names its person, so a visit
   * for two is two people with a service each, never one person with a
   * crowd beside them. The owner of the appointment is the FIRST client
   * with an account (`onBehalfOfUserId`, seats `self`); everyone else — a
   * walk-in's placeholder, a client minted on the search page, a second
   * account-holder — rides as a `guest` seat under their name. One owner
   * per appointment is the domain's shape, not this page's shortcut.
   *
   * Legs run serially from the chosen minute, in ladder order, whatever
   * chair each sits on; a party across two chairs at once is not drawn yet.
   * The request is the system's; the page hands it the chair's home shop
   * (where the sheet offered no «Салон» pick), the person the sheet opened
   * for, and the visit a «Запиши пак» came from — and sends what comes back.
   */
  protected async createFromEditor(commit: VisitEditorCommit): Promise<void> {
    const create = this.createVisit();
    if (create === null) return;
    const chairBarber = this.catalog
      .barbers()
      .find((barber) => barber.id === create.barberId);
    const clientUserId = create.client?.id ?? null;
    const request = StaffEditPlanSystem.bookingRequest(
      commit,
      {
        homeLocationId:
          chairBarber === undefined
            ? null
            : LocationScopeSystem.homeOf(chairBarber),
        clientId:
          clientUserId === null ? null : DraftPersonKey.account(clientUserId),
        bookedFrom: create.bookedFrom ?? null,
      },
      this.walkInWords(),
    );
    // No leg, or no shop to place it at: nothing to send.
    if (request === null) return;
    if (!request.ok) {
      // A seat past the shop's midnight cannot be placed on its day: the
      // server's refusal of such a start, said before anything goes out.
      this.refuse(request.error, 'staff.visit.createFailed');
      return;
    }
    const done = await this.store.createBooking(request.value);
    if (done) this.createVisit.set(null);
    else this.refuse(this.store.createError(), 'staff.visit.createFailed');
  }

  // ── Blocking time ───────────────────────────────────────────────────
  //
  // ONE SHEET for a block, create and edit alike (owner review 2026-09-08):
  // the block editor draws the block over the chair's real day and drafts
  // it; this page owns the store and writes. A day's blocks ACCUMULATE now
  // — `putRange` merges into the day's document — so a second lunch no
  // longer overwrites the first, and one range can be lifted on its own.

  /** The block being drafted or edited, or `null`. */
  protected readonly blockEdit = signal<{
    /**
     * The block's key — the grid event's (`block:<chair>:<day>:<minute>`)
     * or a day off's (`day:<chair>`), an opaque UI key — or `null` for a
     * new block.
     */
    readonly blockId: string | null;
    /** The chairs the sheet opens with — one, unless the sheet adds more. */
    readonly barberIds: readonly BarberId[];
    /** The day the sheet opens ON, when it is not the shown one — a date column's band. */
    readonly dayKey?: LocalDate;
    readonly allDay: boolean;
    /** The range on the frame's anchored axis. */
    readonly startMinute: TrackMinute;
    readonly endMinute: TrackMinute;
  } | null>(null);

  /** The chair the block sheet is aimed at. */
  protected readonly blockLaneId = computed(
    () => this.blockEdit()?.barberIds[0] ?? null,
  );

  /**
   * The day the block sheet's DRAFT is on — `null` while it sits on the
   * shown day. Set from the editor's `dayChanged`, released on close; the
   * store's probe keeps that day's lanes live for the frame, exactly as the
   * visit sheet's `visitDraftDay` does.
   */
  private readonly blockDraftDay = signal<LocalDate | null>(null);

  protected onBlockDayChanged(dayKey: LocalDate): void {
    this.blockDraftDay.set(dayKey);
    this.store.probeDay(dayKey);
  }

  /**
   * Arms the day-wide lift, because lifting a DAY is not a surgical undo:
   * it takes every block on it and the absence with them. Two taps, with the
   * second one naming what goes. One range lifts on one tap.
   */
  protected readonly blockLiftArmed = signal(false);

  protected readonly blockEditorVm = computed<BlockEditorVm | null>(() => {
    const edit = this.blockEdit();
    if (edit === null) return null;
    // The sheet opens only on a known day (a shown day exists once the
    // shop's zone is read).
    const shownDay = this.store.dayKey();
    if (shownDay === null) return null;
    const openedDay = edit.dayKey ?? shownDay;
    const frameDay = this.blockDraftDay() ?? openedDay;
    return {
      blockId: edit.blockId,
      barberIds: edit.barberIds,
      // The day the sheet OPENED on seeds the draft — the shown day, or the
      // date whose all-day band was tapped; the frame follows the draft's
      // own day through `lanes`.
      dayKey: openedDay,
      allDay: edit.allDay,
      startMinute: edit.startMinute,
      endMinute: edit.endMinute,
      lanes: this.scopeOptions().map((option) =>
        this.blockLaneFor(option.id, frameDay, shownDay),
      ),
      // The store's `ShopNow` — the sheet reads "today" and "now" off it.
      now: this.store.shopNow(),
      // By the OPENED day's own lanes — a date column's band may open a
      // day that is not the shown one.
      dayIsOff: this.offOn(edit.barberIds[0], openedDay),
      liftArmed: this.blockLiftArmed(),
      acting: this.store.absencePending(),
    };
  });

  /**
   * WHAT OCCUPIES `barberId`'s CHAIR beside the visit `excludeId` names
   * (`null`: a new one), read off one day's documents —
   * `BusySystem.chairOccupants`, the server's collision rule (DEP-2): one
   * neighbour per seat the chair holds, on the seat's own wall clock.
   */
  private occupantNeighbours(
    appointments: readonly Appointment[],
    barberId: BarberId,
    excludeId: AppointmentId | null,
  ): FrameNeighbour[] {
    return BusySystem.chairOccupants(appointments, barberId, excludeId).map(
      ({ appointment, seat }) => ({
        name:
          appointment.contactName ??
          this.transloco.translate<string>('staff.day.unnamedClient'),
        // The seat's own wall clock — the frame's axis (Law 7.3).
        startMinute: seat.startMinutes,
        endMinute: Seat.endMinutes(seat),
        tone: this.toneOf(barberId),
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
  private occupyingRows(
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

  /**
   * One chair's real day for the block sheet's frame: the agenda's own rows
   * on the shown day, the probe's documents on any other — the same two
   * sources `visitFrameDay` reads, for the same reason.
   */
  private blockLaneFor(
    barberId: BarberId,
    frameDay: LocalDate,
    shownDay: LocalDate,
  ): BlockEditorLane {
    const windows = (rostered: readonly MinuteRange[]) => {
      const roster = this.rosterHull(rostered);
      // NO ROSTER IS A SHUT DAY, not an open one. This fell back to the
      // civil day, so a chair standing down all day — the case the block
      // sheet now opens on — drew as a chair free from midnight to midnight.
      // An empty window (midnight to midnight) is what the frame shades.
      return {
        rosterStartMinute: roster?.startMinutes ?? MIDNIGHT,
        rosterEndMinute: roster?.endMinutes ?? MIDNIGHT,
      };
    };
    if (frameDay === shownDay) {
      const lane = this.lanes().find((entry) => entry.barberId === barberId);
      const storeLane = this.store
        .lanes()
        .find((entry) => entry.barberId === barberId);
      return {
        barberId,
        // What occupies the chair — the server's rule (DEP-2).
        neighbours: this.occupyingRows(
          lane,
          storeLane?.appointments ?? [],
          null,
        ),
        ...windows(storeLane?.rostered ?? []),
      };
    }
    const cell = this.store.cellFor(frameDay);
    const draftLane = cell?.lanes.find((entry) => entry.barberId === barberId);
    return {
      barberId,
      neighbours: this.occupantNeighbours(
        draftLane?.appointments ?? [],
        barberId,
        null,
      ),
      ...windows(draftLane?.rostered ?? []),
    };
  }

  protected openBlockSheet(
    barberId: BarberId,
    range?: {
      readonly startMinute: TrackMinute;
      readonly endMinute: TrackMinute;
    },
  ): void {
    this.presentOnly();
    this.blockLiftArmed.set(false);
    this.blockEdit.set({
      blockId: null,
      barberIds: [barberId],
      allDay: false,
      startMinute: range?.startMinute ?? NOON,
      endMinute: range?.endMinute ?? ONE_PM,
    });
  }

  /*
   * ACROSS THE KINDS (owner, 2026-09-09: "what if the barber wants to block
   * time but accidentally added an appointment"). The ＋ chooses the kind;
   * a SAVED item is a fact — a booking has a client — so its way across is
   * the compound act at its foot, named for both halves: cancel-and-block
   * on a visit, lift-and-book on a block. (A kind switch at the head of a
   * new item was built and withdrawn the same day: the ＋ had already asked.)
   */
  private draftVisitOn(range: BlockEditorRange): void {
    this.closeBlockSheet();
    this.presentOnly();
    this.visitClientOptions.set([]);
    this.createVisit.set({
      barberId: range.barberId,
      startMinute: range.startMinute,
      // The shortest visit a converted block may draft — the grain.
      minutes: VisitDraftSystem.floorSpan(
        TrackMinute.span(range.startMinute, range.endMinute),
      ),
      nonce: ++this.createSeq,
    });
  }

  /** «Откажи и блокирай времето»: the cancel, then the block sheet on its range. */
  protected async blockInsteadFromEditor(vm: VisitEditorVm): Promise<void> {
    const row = this.visitSheetRow();
    if (row === null || row.appointmentId !== vm.appointmentId) return;
    const chair = vm.legs[0]?.barberId ?? this.visitDraftChair() ?? null;
    await this.actFromSheet(row, BookingStatus.Cancelled);
    this.closeVisitSheet();
    if (chair === null) return;
    this.openBlockSheet(chair, {
      startMinute: vm.startMinute,
      endMinute: vm.endMinute,
    });
  }

  /** «Превърни в час»: the block lifted, and a visit drafted on its range. */
  protected async convertBlockFromEditor(
    range: BlockEditorRange,
  ): Promise<void> {
    // A saved block is opened from the grid, on the day on screen; a draft
    // stepped elsewhere has nothing saved to lift.
    if (range.dayKey !== this.store.dayKey()) return;
    const lifted = minuteRangeOf(range.startMinute, range.endMinute);
    if (lifted === null) return;
    const done = await this.store.clearBlock(
      range.barberId,
      lifted,
      range.dayKey,
    );
    if (!done) return;
    this.draftVisitOn(range);
  }

  /**
   * A card-shaped thing at a full touch target that does nothing when
   * pressed is a worse lie than the footnote it replaced. The rest day opens
   * in the same editor with the all-day switch already on, because the
   * barber IS off all day and the sheet should show that rather than ask.
   */
  protected openRestDay(
    barberId: BarberId,
    dayKey: LocalDate | null = this.store.dayKey(),
  ): void {
    // No day before the shop's zone is known: nothing to open on.
    if (dayKey === null) return;
    this.openBlockSheet(barberId);
    this.blockEdit.update((edit) =>
      edit === null
        ? null
        : { ...edit, blockId: `day:${barberId}`, allDay: true, dayKey },
    );
    if (dayKey !== this.store.dayKey()) this.onBlockDayChanged(dayKey);
  }

  /**
   * A CHIP in the all-day band (owner, 2026-09-23): a chair's day off opens
   * to be edited or lifted — on the shown day in the day view, on that DATE
   * in the date views; «+N» opens the date itself, where every chair's chip
   * has room.
   */
  protected openAllDayEntry(pick: {
    readonly columnId: string;
    readonly key: string;
  }): void {
    // «+N» only rides a DATE column, whose id is its day — minted from the
    // cell's `LocalDate`, so the parse never refuses.
    if (pick.key === ALL_DAY_MORE_KEY) {
      const day = LocalDate.parse(pick.columnId);
      if (day.ok) this.openDay(day.value);
      return;
    }
    // Every other chip is keyed by its chair's id — minted from the lane's
    // `BarberId`.
    const barberId = BarberId.of(pick.key);
    if (this.store.view() === StaffView.Day) {
      this.openRestDay(barberId, this.store.dayKey());
      return;
    }
    const day = LocalDate.parse(pick.columnId);
    if (day.ok) this.openRestDay(barberId, day.value);
  }

  /**
   * Is this chair off for the whole of that day — by that day's own lanes:
   * rostered nowhere, the shown day included, whatever it still holds
   * (DEP-4). A chair stood down all day with bookings on it is off, so its
   * lift is the whole day's — the range lift the store refuses on a closed
   * day is never offered.
   */
  private offOn(barberId: BarberId | undefined, dayKey: LocalDate): boolean {
    if (barberId === undefined) return false;
    const lane = this.store
      .cellFor(dayKey)
      ?.lanes.find((entry) => entry.barberId === barberId);
    return lane !== undefined && lane.rostered.length === 0;
  }

  /**
   * THE ALL-DAY BAND IS A DOOR (owner, 2026-09-23): a tap on the empty band
   * above a column opens the block sheet with «цял ден» already on — for
   * that chair on the shown day (the day view), or for the create chair on
   * that DATE (the date views), the frame drawing the tapped day. A whole-
   * day fact sits in that band, so that is where one is made.
   */
  protected openAllDay(columnId: string): void {
    const shownDay = this.store.dayKey();
    if (shownDay === null) return;
    const isChair = this.store.view() === StaffView.Day;
    // A chair column's id is its chair's `BarberId`; a date column's is its
    // day — each minted from the brand, so neither read refuses.
    const barberId = isChair ? BarberId.of(columnId) : this.createChair();
    if (barberId === null) return;
    let dayKey = shownDay;
    if (!isChair) {
      const day = LocalDate.parse(columnId);
      if (!day.ok) return;
      dayKey = day.value;
    }
    this.openBlockSheet(barberId);
    this.blockEdit.update((edit) =>
      edit === null ? null : { ...edit, allDay: true, dayKey },
    );
    if (dayKey !== shownDay) this.onBlockDayChanged(dayKey);
  }

  /**
   * A block on the grid was tapped: edit THAT range — the shown day's
   * (`block:<chair>:<day>:<start minute>`, read from its end so the chair's
   * id is taken whole). A block of ANOTHER day — a date column of the
   * three-day and week views — opens nothing: the sheet lifts and rewrites
   * the shown day's blocks, and the anchor day's block at the same chair
   * and minute is not the one tapped (DEP-11).
   */
  protected openBlock(blockId: string): void {
    const parts = blockId.split(':');
    const dayRaw = parts.at(-2);
    const barberRaw = parts.slice(1, -2).join(':');
    if (dayRaw === undefined || dayRaw !== this.store.dayKey()) return;
    const start = MinuteOfDay.of(Number(parts.at(-1)));
    if (!start.ok) return;
    const lane = this.store
      .lanes()
      .find((entry) => entry.barberId === barberRaw);
    const interval = lane?.blocks.find(
      (block) => block.startMinutes === start.value,
    );
    if (lane === undefined || interval === undefined) return;
    this.presentOnly();
    this.blockLiftArmed.set(false);
    this.blockEdit.set({
      blockId,
      barberIds: [lane.barberId],
      allDay: false,
      // The block's own wall-clock minutes (DEP-9).
      startMinute: interval.startMinutes,
      endMinute: interval.endMinutes,
    });
  }

  protected closeBlockSheet(): void {
    this.blockLiftArmed.set(false);
    this.blockEdit.set(null);
    this.blockDraftDay.set(null);
    this.store.probeDay(null);
  }

  /**
   * «Запази» on the block sheet — one range (or a whole day) on EVERY chosen
   * chair, on EVERY day of the series (owner, 2026-09-09: several barbers,
   * recurrence). The document is per barber-day, so that is the write: the
   * one day through `blockTime`, a series through `blockSeries` — one
   * batched pass per chair (2026-09-24) — and the sheet closes when the
   * last chair has landed. The DAYS are the sheet's: it expanded the rule
   * with the same `RecurrenceSeries` it counted aloud. An EDITED range is
   * lifted where it was first — its own chair, the shown day — then
   * written where it now is.
   */
  protected async commitBlock(commit: BlockEditorCommit): Promise<void> {
    const edit = this.blockEdit();
    if (edit === null) return;
    const shownDay = this.store.dayKey();
    if (shownDay === null) return;
    if (edit.blockId !== null && !edit.allDay) {
      const old = minuteRangeOf(edit.startMinute, edit.endMinute);
      const from = edit.barberIds[0];
      if (old !== null && from !== undefined) {
        const lifted = await this.store.clearBlock(from, old, shownDay);
        if (!lifted) return;
      }
    }
    let ranges: readonly MinuteRange[] = [];
    if (!commit.allDay) {
      const range = minuteRangeOf(commit.startMinute, commit.endMinute);
      if (range === null) return;
      ranges = [range];
    }
    const days = commit.days;
    const only = days.length === 1 ? days[0] : undefined;
    for (const barberId of commit.barberIds) {
      const barber = this.catalog
        .barbers()
        .find((entry) => entry.id === barberId);
      const locationId =
        barber === undefined ? null : LocationScopeSystem.homeOf(barber);
      if (locationId === null) continue;
      const done =
        only !== undefined
          ? await this.store.blockTime(barberId, locationId, ranges, only)
          : await this.store.blockSeries(barberId, locationId, ranges, days);
      if (!done) return;
    }
    this.closeBlockSheet();
  }

  protected async liftFromEditor(): Promise<void> {
    const edit = this.blockEdit();
    if (edit === null) return;
    // The day the sheet OPENED on — a date column's band may have opened a
    // day that is not the shown one, and the lift must take THAT day.
    const dayKey = edit.dayKey ?? this.store.dayKey();
    const barberId = edit.barberIds[0];
    // The sheet always opens on a chair, on a known day.
    if (barberId === undefined || dayKey === null) return;
    const wholeDay = edit.allDay || this.offOn(barberId, dayKey);
    if (wholeDay) {
      if (!this.blockLiftArmed()) {
        this.blockLiftArmed.set(true);
        return;
      }
      const done = await this.store.clearBlock(barberId, null, dayKey);
      this.blockLiftArmed.set(false);
      if (done) this.closeBlockSheet();
      return;
    }
    const range = minuteRangeOf(edit.startMinute, edit.endMinute);
    if (range === null) return;
    const done = await this.store.clearBlock(barberId, range, dayKey);
    if (done) this.closeBlockSheet();
  }

  /** Which row's overflow menu is open — one at a time, by construction. */
  protected readonly openMenuId = signal<string | null>(null);

  /**
   * ONE transient surface at a time.
   *
   * The FAB, the date popover, the view/scope pickers and a row's overflow
   * each owned their own open flag and none of them knew about the others,
   * so opening the date picker left the FAB fanned out behind it — three
   * interactive layers with the FAB's full-screen scrim still swallowing
   * outside taps underneath them all. Every opener now routes through here,
   * which is the only place that decides what stays up.
   *
   * `keep` names the surface being opened; everything else goes. Passing
   * nothing closes them all, which is what an act, a navigation or a sheet
   * presentation wants.
   */
  private presentOnly(keep?: DaySurface): void {
    if (keep !== DaySurface.Date) this.datePickerOpen.set(false);
    if (keep !== DaySurface.Picker) this.openPicker.set(null);
    if (keep !== DaySurface.Row) this.openMenuId.set(null);
  }

  protected toggleMenu(rowId: string): void {
    const opening = this.openMenuId() !== rowId;
    this.presentOnly(opening ? DaySurface.Row : undefined);
    this.openMenuId.set(opening ? rowId : null);
  }

  protected toggleDatePicker(): void {
    this.setDatePicker(!this.datePickerOpen());
  }

  /** The shared day pill reports its own open/close; the page keeps the
   *  one-popover-at-a-time rule. */
  protected setDatePicker(open: boolean): void {
    this.presentOnly(open ? DaySurface.Date : undefined);
    this.datePickerOpen.set(open);
  }

  /** The four readings, as `ui-choice-menu` options (owner, 2026-09-09). */
  protected readonly viewChoices = computed<readonly UiChoiceOption[]>(() =>
    this.views.map((view) => ({
      id: view.id,
      label: this.rawCopy(`staff.day.view.${view.id}`),
      icon: view.icon,
      testId: `staff-view-${view.id}`,
    })),
  );

  /**
   * A view switch CROSS-FADES (2026-09-23, §10) — Apple's own transition
   * between Day and Week on iPad; no slide, because the views are not
   * adjacent things. The platform's transition, through the same helper the
   * frame's full screen uses; a plain switch where there is none or motion
   * is reduced.
   */
  protected pickView(id: string): void {
    const view = this.views.find((option) => option.id === id);
    if (!view || view.id === this.store.view()) return;
    runViewTransition(() => this.store.setView(view.id), this.injector);
  }

  /**
   * The same four readings as SEGMENTS — the toolbar's icon pill from
   * 600px of bar, where four 44px segments fit beside the pill and the
   * cluster (Apple switches views from a menu on iPhone and from a toolbar
   * segmented control on iPad and Mac). Both carriers are in the DOM; the
   * bar's own width shows one.
   */
  protected readonly viewSegments = computed<readonly UiSegment[]>(() =>
    this.views.map((view) => ({
      id: view.id,
      label: this.rawCopy(`staff.day.view.${view.id}`),
      icon: view.icon,
      iconOnly: true,
      testId: `staff-view-segment-${view.id}`,
    })),
  );

  /** A DATE column's head, tapped: that day, in the day view (§4). */
  protected openDay(dayKey: LocalDate): void {
    runViewTransition(() => {
      this.store.goToDay(dayKey);
      this.store.setView(StaffView.Day);
    }, this.injector);
  }

  private readonly grid = viewChild<StaffTimeGrid>('grid');

  /**
   * The present has left the frame — the grid reports it from its own
   * scroll path (§6), and the bar offers the way back to it: «Към сега»
   * on today, the way Google's today control appears once you have
   * scrolled away from now.
   */
  protected readonly nowAway = signal(false);

  /** Back to the present: a glide on today, the jump home on any other day. */
  protected backToNow(): void {
    if (this.store.isToday() && this.isGrid()) {
      this.grid()?.scrollToNow('smooth');
    } else {
      this.store.jumpToToday();
    }
    // The button removes itself once the present is back in view; the
    // keyboard lands on the region it just scrolled, not on the body
    // (found in review, 2026-09-23).
    this.grid()?.focusFrame();
  }

  /** Everyone, then each chair — the scope switcher's options. */
  protected readonly scopeChoices = computed<readonly UiChoiceOption[]>(() => [
    {
      id: SCOPE_ALL,
      label: this.rawCopy('staff.day.scopeAll'),
      testId: 'staff-scope-all',
    },
    ...this.scopeOptions().map((option) => ({
      id: option.id,
      label: option.name,
      avatarSrc: option.avatarSrc,
      testId: `staff-scope-${option.id}`,
    })),
  ]);

  /**
   * The menu hands back an option id: «Всички», or a chair's — each option
   * built from a catalogue `BarberId` (a brand by construction, D-8.6).
   */
  protected pickScope(id: string): void {
    this.store.setScope(id === SCOPE_ALL ? null : BarberId.of(id));
  }

  /**
   * A string from the loaded table, or `null` while the table is not here.
   * Read through `copyTable`, so a `computed` that words itself with it is
   * rebuilt when the words land — `translate()` would hand the key back
   * and never say when the real word arrived.
   */
  private copyOf(key: string): string | null {
    const table =
      this.copyTable() ??
      this.transloco.getTranslation(this.transloco.getActiveLang());
    const raw = (table as Record<string, unknown> | undefined)?.[key];
    return typeof raw === 'string' ? raw : null;
  }

  /**
   * A string from the loaded table — the key itself until it loads, which
   * is what a missing string looks like everywhere else in the app.
   */
  private rawCopy(key: string): string {
    return this.copyOf(key) ?? this.transloco.translate(key);
  }

  protected togglePicker(which: DayPicker): void {
    const opening = this.openPicker() !== which;
    this.presentOnly(opening ? DaySurface.Picker : undefined);
    this.openPicker.set(opening ? which : null);
  }

  /**
   * The refusal renders IN THE ROW that earned it.
   *
   * A page banner puts the sentence three screens away from the tap that
   * caused it on a forty-row day, which is how staff conclude the button is
   * broken rather than learning what the server actually said.
   */
  protected rowError(rowKey: string): string | null {
    // ⚠ The template hands the ROW's key (`entry.id`, `appointment#chair`)
    // while the store keeps errors by APPOINTMENT id, so this answers
    // nothing today (carried as found, pass D — see the package note). The
    // lookup is by text so the answer stays exactly today's.
    for (const [appointmentId, error] of this.store.errors()) {
      if (appointmentId === rowKey) return this.describeError(error);
    }
    return null;
  }

  /** The cancel sheet's own error, which has no row to live in. */
  protected readonly cancelError = computed(() => {
    const id = this.cancelId();
    if (id === null) return null;
    const error = this.store.errorFor(id);
    return error ? this.describeError(error) : null;
  });

  /**
   * A refusal, as a sentence.
   *
   * The server's OWN code (`serverErrorCode`) is the one that knows why. It
   * is translated first, when the catalogue has a line for it, with a status
   * name in the shop's words rather than the graph's; a seat already
   * resolved has its own line, because "from resolved to cancelled" is the
   * graph talking. The surface's own "something went wrong"
   * (`BookingErrorCode.CallFailed`) is only the fallback.
   */
  private describeError(error: PipelineError): string {
    // THE TRANSITION'S TWO STATUSES, in the shop's words: the wire carries
    // the stored tags (`fromBookingStatus`, `toBookingStatus`), and the
    // sentence says them as the rows do — the shared words table, then the
    // catalogue's label for the word. A seat already resolved has its own
    // line, because "from resolved to cancelled" is the graph talking.
    const extra: Record<string, string> = {};
    if (error.serverErrorCode === BookingErrorCode.TransitionNotAllowed) {
      const fromRaw = error.serverParams['fromBookingStatus'];
      const from = Tag.has(BookingStatus, fromRaw) ? fromRaw : null;
      // A SEAT already resolved names no status it moves from.
      if (typeof fromRaw === 'string' && fromRaw.length > 0 && from === null) {
        return this.transloco.translate(
          `errors.${BookingErrorCode.TransitionSeatResolved}`,
        );
      }
      const toRaw = error.serverParams['toBookingStatus'];
      const to = Tag.has(BookingStatus, toRaw) ? toRaw : null;
      for (const [side, status] of [
        ['from', from],
        ['to', to],
      ] as const) {
        if (status === null) continue;
        const word = bookingStatusWords[status];
        const key = 'appointments.status.' + word;
        const label = this.transloco.translate(key);
        extra[side] = label !== key ? label : word;
      }
    }
    // ONE LEVEL DEEPER FIRST (round 4, 2026-09-25): the refusal's own
    // reason (`field` — «one person, two chairs», a shared guest label — or
    // a carried seat's `refusal`) has copy of its own, so
    // `<serverErrorCode>.<reason>` is tried before `<serverErrorCode>`, then
    // the surface's own generic key. The client's rule
    // (`wordPipelineError`), reused: a staff save refused for seating one
    // person twice said only "invalid input".
    return wordPipelineError(
      error,
      (code, params) =>
        translateCodedError(this.transloco, { ...params, errorCode: code }),
      BookingErrorCode.CallFailed,
      extra,
    );
  }
}

/**
 * The labels these seats' guests ride under, seat by seat — a guest's only
 * identity, and what the server's party check tells people apart by
 * (`personKey`).
 */
function guestLabelsOf(seats: readonly Seat[]): string[] {
  return seats.flatMap((seat) =>
    seat.seatSubject === SeatSubject.Anonymous ? [seat.guestLabel] : [],
  );
}

/**
 * The bill's discounts as the sheet reads them — every snapshot, in stored
 * order: its provenance and its value as the domain stored them (exactly
 * their variants' fields), with the coupon's name, the grant it honoured,
 * the code it was opened with and whether it must be alone on the bill.
 */
function discountsOf(appointment: Appointment): VisitEditorDiscount[] {
  return appointment.discounts.map((applied) => ({
    ...provenanceOf(applied),
    ...CouponValue.of(applied),
    label: applied.label,
    grantId: DiscountProvenance.grantIdOf(applied),
    code: DiscountProvenance.codeOf(applied),
    exclusive: AppliedDiscount.isExclusive(applied),
  }));
}

/** The provenance slice of a stored discount — exactly its variant's fields. */
function provenanceOf(applied: DiscountProvenance): DiscountProvenance {
  switch (applied.discountSource) {
    case DiscountSource.Grant:
      return DiscountProvenance.grant(applied.discountGrantId);
    case DiscountSource.Code:
      return DiscountProvenance.code(applied.discountCode);
    case DiscountSource.Manual:
      return DiscountProvenance.manual();
  }
}

/**
 * The vouchers still paying the bill. `availableCents` is what THIS visit
 * may draw on that voucher if the bill changes: its own amount plus what
 * the voucher had left after it — the server re-clamps on save.
 */
function vouchersOf(appointment: Appointment): VisitEditorVoucher[] {
  return appointment.voucherRedemptions
    .filter(VoucherRedemption.isLive)
    .map((redemption) => ({
      voucherId: redemption.voucherId,
      code: redemption.code,
      availableCents: VoucherRedemption.drawableCents(redemption),
    }));
}
