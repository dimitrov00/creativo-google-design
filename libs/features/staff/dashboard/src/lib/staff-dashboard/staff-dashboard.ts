import { StaffDayPill, formatDayPill } from '../day-pill/staff-day-pill';
import { runViewTransition } from '../shared/view-transition';
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
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import {
  type AppointmentPhoto,
  Profile,
  type ServiceCategory,
} from '@core/entities';
import {
  type AppointmentId,
  type AppointmentPhotoId,
  BarberId,
  BookingStatus,
  type ClientOperationId,
  Currency,
  DraftPersonKey,
  DurationMinutes,
  EndMinute,
  LocalDate,
  type LocationId,
  MinuteOfDay,
  type Result,
  SeatId,
  type ServiceId,
  Tag,
  TrackMinute,
  type UserId,
  UtcEpochMs,
} from '@core/primitives';
import {
  BookingErrorCode,
  PipelineError,
  PipelineErrorCode,
  StaffEditErrorCode,
} from '@core/errors';
import {
  BookingCall,
  CancellationReason,
  ClientQueryShape,
  Combinability,
  CouponValue,
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
  VisitEditWrite,
  VisitEditWriteOutcome,
  type VisitSides,
  WallTime,
} from '@core/components';
import {
  AppointmentEditSystem,
  AppointmentLifecycleSystem,
  BarberToneSystem,
  BillingSystem,
  ClientQuerySystem,
  GridLayoutSystem,
  IntervalSetSystem,
  LocationScopeSystem,
  PhoneSystem,
  RosterSystem,
  ScheduleExceptionSystem,
  SearchFieldsSystem,
  type SideWrites,
  StaffEditPlanSystem,
  type StaffEditWords,
  VisitDraftSystem,
  VisitListSystem,
  ZonedTimeSystem,
} from '@core/systems';
import type { SaveVisitEditCommand } from '@core/pipelines';
import {
  AUTH_DEPLOYMENT_PORTS,
  AUTH_SESSION_PORTS,
  AVATAR_PORTS,
  CATALOG_PORTS,
  CLOCK_PORTS,
  PROFILE_PORTS,
  CUSTOMER_SEARCH_PORTS,
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
  type VisitEditorVm,
  type VisitEditorCodeResult,
  snapshotCommitOf,
} from '../visit-editor/staff-visit-editor';
import {
  CatalogContentService,
  CatalogWording,
} from '@creativo/features/shared/catalog';
import { StaffEventHead } from '@creativo/features/shared/visits';
import {
  bookingStatusWords,
  cancellationReasonWords,
  operationReferenceWords,
  pluralForm,
  translateCodedError,
} from '@creativo/infrastructure/i18n';
import {
  UiChoiceLeading,
  UiChoiceMenu,
  type UiChoiceOption,
  UiSegmentedControl,
  type UiSegment,
  UiAvatar,
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
  dayHealthRowsOf,
  dayHealthWordsOf,
} from '../day-health/day-health.presenter';
import type {
  DayHealthChair,
  DayHealthRowVm,
} from '../day-health/day-health.vm';
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
import { rankClients } from '../visit-editor/client-query';
import { clientSearchOptions } from '../visit-editor/client-search';
import type { ClientCardCatalog } from '@creativo/features/staff/client-card';
import { ArrivalVerb, ROW_VERB_WORD, type RowVerb } from '../row-verb';
import {
  AgendaRow,
  ALL_DAY_MORE_KEY,
  DiscardAnswer,
  SCOPE_ALL,
  type AgendaGroupVm,
  type AgendaItemVm,
  type DayRowVm,
  type GapRowVm,
  type LaneVm,
  type RunEntryVm,
  type StaffTranslate,
} from './staff-day.vm';
import { guestLabelsOf } from './staff-day-guest.words';
import { refusalSentence } from './staff-day-error.words';
import {
  chairColumnHead,
  dateColumnHead,
  discardActionsOf,
  periodLabelOf,
  scopeChoicesOf,
  serviceOptionsOf,
  shopOptionsOf,
  staffChromeWordsOf,
  type StaffCatalogNames,
  viewChoicesOf,
  viewSegmentsOf,
  weekCalendarOf,
  zoneActionsOf,
  zoneLabelOf,
} from './staff-day-chrome.presenter';
import {
  type AgendaCardInput,
  type AgendaFlags,
  chairMinutesOf,
  type DayRowContext,
  dayRowVm,
  gapRowVm,
  wallClockLabel,
  agendaCardVm,
  allDayMoreEntry,
  bookClientOption,
  daySummaryWords,
  dayTipsWords,
  exceptionWord,
  footShown,
  gridBlockEvent,
  gridVisitEvent,
  occupantNeighbours,
  occupyingRows,
  offChairEntry,
  offDateEntry,
  peerRowOf,
  recentClientOption,
  restingChairs,
  rowMarks,
  rowName,
  rowStateNote,
  staffDayWordsOf,
  visitEditorWords,
  whenWords,
} from './staff-day.presenter';
import { searchHits } from './staff-search.presenter';
import type { SearchHitVm } from './staff-search.vm';

export { AgendaRow, type DayRowVm } from './staff-day.vm';

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
 * rest — the date popover, a toolbar picker. Internal.
 */
const DaySurface = {
  Date: 'DATE',
  Picker: 'PICKER',
} as const;
type DaySurface = Tag<typeof DaySurface>;

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
 *
 * Since OR-4 every save reads it off its own plan
 * (`StaffEditPlanSystem.savePlan`, `reversible` — the same rule on the
 * same root); this is that rule on its own, as the page's specs pin it.
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
      leg.durationMinutes,
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
          CouponValue.sliceOf(discount),
        ]),
      )
      .sort(),
    vouchers: row.vouchers.map((voucher) => voucher.code),
    tip: row.tipCents,
  });
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
 * Which door the ＋ menu opened — a BOOKING (the visit sheet) or a BLOCK
 * (the block sheet). Passed to `openCreate`, never stored.
 */
export const CreateIntent = {
  Booking: 'BOOKING',
  Block: 'BLOCK',
} as const;
export type CreateIntent = (typeof CreateIntent)[keyof typeof CreateIntent];

/** Where an entry of the run begins on the shop's wall clock — a visit's chair start, a hole's start. */
function startMinuteOf(entry: RunEntryVm): MinuteOfDay {
  return entry.agendaRow === AgendaRow.Visit
    ? entry.startMinute
    : entry.startMinutes;
}

/**
 * What a sheet's frame is drawn ABOUT (`frameDayFor`, OR-3): the visit it
 * edits — `null` for one not booked yet, which excludes nobody — and the
 * chair its VM already draws, `null` for a row on no lane.
 */
interface FrameSubject {
  readonly appointmentId: AppointmentId | null;
  readonly chair: BarberId | null;
}

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
 * once the cancel has landed (`confirmCancel`), never the call's. The
 * INTENT only: the store names each act (`operationId`, WS-4.1).
 */
function transitionOf(
  appointmentId: AppointmentId,
  toBookingStatus: BookingStatus,
  cancellationReason: CancellationReason | null,
  seatId: SeatId | null,
): BookingCall.TransitionIntent {
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
  const start = MinuteOfDay.of(startMinute);
  const end = EndMinute.of(endMinute);
  if (!start.ok || !end.ok || end.value <= start.value) return null;
  return MinuteRange.of(start.value, end.value);
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
    NgTemplateOutlet,
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
  /** `translate`, as a presenter's words struct takes it. */
  private readonly say: StaffTranslate = (key, params) =>
    this.transloco.translate<string>(key, params);
  /**
   * The day's words, rebuilt when the table lands (`copyTable`, review r4):
   * every `computed` that words itself reads them through here, never through
   * `translate()`, which would hand the key back and never say when the real
   * word arrived.
   */
  private readonly dayWords = computed(() => {
    this.copyTable();
    return staffDayWordsOf(this.say, this.copyOf('staff.visit.minutes'));
  });
  /** The chrome's words, rebuilt when the table lands (`copyTable`). */
  private readonly chromeWords = computed(() => {
    this.copyTable();
    return staffChromeWordsOf(this.say);
  });
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
   * The catalogue, as a presenter reads it: each lookup reads the catalogue's
   * live signals when it is ASKED, so the `computed` calling the presenter
   * follows a late catalogue on its own.
   */
  private readonly catalogNames: StaffCatalogNames = {
    findService: (id) => this.catalog.findService(id),
    text: (localized) => this.content.text(localized),
  };

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

  /**
   * WHAT EVERY ROW IS WORDED FROM, read once per change: the tick, the shop's
   * clock, the words and the companions' names. The catalogue lookups read
   * its live signals when asked, so the `computed` building rows follows a
   * late catalogue on its own. Rows rebuild on every tick, as they always
   * have; `id` keeps each one's `@for` identity.
   */
  private readonly rowContext = computed<DayRowContext>(() => ({
    nowUtcMs: this.nowUtcMs(),
    shopNow: this.store.shopNow(),
    zone: this.store.zone(),
    locale: this.content.locale(),
    lang: this.transloco.getActiveLang(),
    companionNames: this.companionNames(),
    words: this.dayWords(),
    names: {
      ...this.catalogNames,
      barberName: (id) => this.barberNameOf(id),
      barberAvatarSrc: (id) => this.barberAvatarOf(id),
      toneOf: (id) => this.toneOf(id),
    },
  }));

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

  // ── Search ──────────────────────────────────────────────────────────

  /**
   * Results for the current term, newest-relevant first.
   *
   * Matched in memory against a window the store loaded once — Firestore
   * cannot substring-match, and the fields a shop actually searches by
   * (name, phone, email, note, service) are four different shapes, one of
   * them nested inside the `seats` array.
   */
  protected readonly searchResults = computed<readonly SearchHitVm[]>(() =>
    searchHits({
      term: this.store.term(),
      pool: this.store.pool(),
      // Each visit is judged on ITS shop's wall clock (the physical chair
      // invariant, Law 7.2): one `ShopNow` per zone per tick, read at the
      // store's edge (`shopNowAt`, pass D D-6.2).
      shopNowAt: this.store.shopNowAt(),
      names: this.catalogNames,
      zoneKnown: this.store.zone() !== null,
      locale: this.content.locale(),
    }),
  );

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
    if (scope === null) return this.chromeWords().scopeAll;
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
    () => shopOptionsOf(this.catalog.locations(), this.catalogNames),
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
    return serviceOptionsOf(this.catalog.serviceVms(), barberId, {
      ...this.catalogNames,
      price: (money) => this.content.price(money),
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
        ...chairColumnHead(
          lane.barberId,
          this.barberNameOf(lane.barberId),
          // Barber columns all sit on the anchor day, so they are "today"
          // together — which is what tells the grid whether to draw the
          // now-line at all.
          this.store.dayKey() === today,
          this.scopeOptions().find((option) => option.id === lane.barberId)
            ?.avatarSrc ?? null,
        ),
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
        ...dateColumnHead(
          cell.dayKey,
          cell.dayKey === today,
          this.content.locale(),
        ),
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
    // The day the barber is AT WORK, which is what the shading is answering:
    // it says only "not working"; a block says "working, but taken".
    return RosterSystem.atWork(lanes).map((window) => ({
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
  protected readonly zoneLabel = computed(() =>
    zoneLabelOf(this.nowUtcMs(), this.store.zone()),
  );

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
      const words = this.dayWords();

      // In the day view a column IS a barber, so the chip names the fact rather
      // than the person — the column head above it is already the name. The
      // shading says "nothing can happen here"; this says WHY, which shading
      // alone cannot, and which is the only form a screen reader can read.
      if (this.store.view() === StaffView.Day) {
        const cell = this.store
          .dayCells()
          .find((entry) => entry.dayKey === this.store.dayKey());
        for (const lane of cell?.lanes ?? []) {
          // A FAILED lane is not off (OR-2): its health row says so.
          if (RosterSystem.offAllDay(lane)) {
            out[lane.barberId] = [
              offChairEntry(
                lane.barberId,
                this.barberNameOf(lane.barberId),
                this.toneOf(lane.barberId),
                words,
              ),
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
          .filter((lane) => RosterSystem.offAllDay(lane))
          .map((lane) =>
            offDateEntry(
              lane.barberId,
              this.barberNameOf(lane.barberId),
              this.toneOf(lane.barberId),
              words,
            ),
          );
        if (off.length === 0) continue;
        if (off.length <= ALL_DAY_CHIP_CAP) {
          out[cell.dayKey] = off;
          continue;
        }
        // Three named, then «+N» for the rest — never fewer names as more
        // chairs are off (an off-by-one found in review, 2026-09-23).
        const rest = off.length - ALL_DAY_CHIP_CAP;
        out[cell.dayKey] = [
          ...off.slice(0, ALL_DAY_CHIP_CAP),
          allDayMoreEntry(rest, words),
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
    const words = this.dayWords();
    const context = this.rowContext();
    const visits = lane.appointments.map((appointment) =>
      gridVisitEvent(
        dayRowVm(appointment, lane.barberId, context),
        attribute,
        words,
      ),
    );
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
    const words = this.dayWords();
    return lane.blocks.map((interval) =>
      gridBlockEvent(
        interval,
        {
          barberId: lane.barberId,
          barberName: this.barberNameOf(lane.barberId),
          localDate,
          shopNow,
          attribute,
        },
        words,
      ),
    );
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

  private barberNameOf(barberId: BarberId): string {
    const barber = this.catalog
      .barbers()
      .find((entry) => entry.id === barberId);
    return barber ? this.content.text(barber.name) : barberId;
  }

  /** The pill's words for what is on screen (`periodLabelOf`). */
  protected readonly periodLabel = computed(() =>
    periodLabelOf(this.store.visibleDays(), this.content.locale()),
  );

  /**
   * The scroller's accessible name — which period the region holds, so a
   * keyboard or a switch control landing on 3000px of two-axis scroll
   * knows what it has reached.
   */
  protected readonly regionLabel = computed(() =>
    this.chromeWords().gridRegion(this.periodLabel()),
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
    const context = this.rowContext();
    const shopNow = context.shopNow;
    // The lanes are the shown day's (`workingLanes`).
    const localDate = this.store.dayKey();

    return this.store.workingLanes().map((lane) => {
      const vm = vmById.get(lane.barberId);

      const visits = lane.appointments.map((appointment) =>
        dayRowVm(appointment, lane.barberId, context),
      );
      const barberName = vm ? this.content.text(vm.name) : lane.barberId;
      const gaps: GapRowVm[] = lane.gaps.map((gap) =>
        gapRowVm(
          gap,
          {
            barberId: lane.barberId,
            barberName,
            barberAvatarSrc: vm?.avatarSrc ?? null,
            barberTone: this.toneOf(lane.barberId),
          },
          localDate,
          context,
        ),
      );

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
      // (`VisitListSystem.hasStarted`).
      const next =
        shopNow === null
          ? null
          : VisitListSystem.firstOpenInChair(
              visits,
              (row) => ({
                bookingStatus: row.bookingStatus,
                start: WallTime.of(row.localDate, row.startMinute),
              }),
              shopNow,
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
    // What every card is worded from: the switches, the table, and the TICK —
    // the relative time is true right now, or it is nothing.
    const card: AgendaCardInput = {
      flags: this.agendaFlags(),
      words: this.dayWords(),
      nowUtcMs: this.nowUtcMs(),
      lang: this.transloco.getActiveLang(),
    };
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
        timeLabel: wallClockLabel(
          localDate,
          startMinutes,
          this.content.locale(),
        ),
        startMinutes,
        // The heading is past once the shop's clock has reached it — its
        // minute begun (`VisitListSystem.hasStarted`, DEP-4).
        past:
          shopNow !== null &&
          VisitListSystem.hasStarted(
            WallTime.of(localDate, startMinutes),
            shopNow,
          ),
        // Visits before gaps at the same minute — what is booked outranks
        // what is merely available, and a stable order stops cards jumping
        // as the store ticks.
        items: [...group]
          .sort((a, b) => {
            if (a.agendaRow !== b.agendaRow) {
              return a.agendaRow === AgendaRow.Visit ? -1 : 1;
            }
            return a.agendaRow === AgendaRow.Visit &&
              b.agendaRow === AgendaRow.Visit
              ? a.barberName.localeCompare(b.barberName)
              : 0;
          })
          .map((entry): AgendaItemVm =>
            entry.agendaRow === AgendaRow.Visit
              ? { ...entry, card: agendaCardVm(entry, card) }
              : entry,
          ),
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
  private readonly weekCalendar = computed(() =>
    weekCalendarOf(this.store.todayKey(), this.content.locale()),
  );

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
  /** The switches as they stand, the struct a presenter takes. */
  private agendaFlags(): AgendaFlags {
    return Object.fromEntries(
      AGENDA_FIELDS.map((id) => [id, this.fields.isOn(id)]),
    ) as AgendaFlags;
  }
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
    return daySummaryWords(freeMinutes, this.dayWords());
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
        seats.push(...Seat.ofChair(appointment.seats, lane.barberId));
      }
    }
    // Strict: nothing recorded, or a mixed-currency day — a data error, not
    // a feature — is no figure (`BillingSystem.recordedTipsTotal`).
    const total = BillingSystem.recordedTipsTotal(seats);
    return total === null
      ? null
      : dayTipsWords(total, this.transloco.getActiveLang(), this.dayWords());
  });

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
  protected readonly resting = computed(() =>
    restingChairs(
      this.store.offToday(),
      this.catalog.barberVms(),
      this.catalogNames,
      (id) => this.toneOf(id),
    ),
  );

  /**
   * THE DAY'S HEALTH (OR-2) — one all-day row per chair whose day the sheet
   * could not read in full: a chair whose read FAILED (it draws no gap and
   * is not listed as off — `StaffDayStore.offToday`), or one that holds
   * visits the read-time guard dropped. On a schedule a missing booking is
   * the most plausible lie, so it is never silent: the row sits in the
   * all-day strip, above the run and above the calendar grids, worded by
   * `dayHealthRowsOf` (Law 10). The shown day's lanes, the chairs in scope.
   */
  protected readonly dayHealth = computed<readonly DayHealthRowVm[]>(() => {
    // Read for its dependency: the rows re-word on a change of language.
    const lang = this.content.locale();
    const lanes = this.store.lanes();
    const chairs = new Map<BarberId, DayHealthChair>();
    for (const lane of lanes) {
      chairs.set(lane.barberId, {
        name: this.barberNameOf(lane.barberId),
        tone: this.toneOf(lane.barberId),
      });
    }
    return dayHealthRowsOf({
      lanes,
      chairs,
      words: dayHealthWordsOf(
        (key, params) => this.transloco.translate<string>(key, params),
        lang,
      ),
    });
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

  /** A row's relative time now (`whenWords`), on the page's clock and table. */
  protected whenLabel(entry: DayRowVm): string {
    return whenWords(
      entry,
      this.nowUtcMs(),
      this.transloco.getActiveLang(),
      this.dayWords(),
    );
  }

  /** The exception word of a status (`exceptionWord`). */
  protected statusWord(status: BookingStatus): string | null {
    return exceptionWord(status, this.dayWords());
  }

  /** The DOM's lowercase word for a status (`data-status`) — the shared table. */
  protected readonly statusWords = bookingStatusWords;

  /** The row's accessible name (`rowName`). */
  protected rowLabel(entry: DayRowVm): string {
    return rowName(entry, this.dayWords());
  }

  /** What the row's name says of its state (`rowStateNote`). */
  protected statusNote(entry: DayRowVm): string | null {
    return rowStateNote(entry, this.dayWords());
  }

  /** The marks on a row's foot (`rowMarks`), under the switches as they stand. */
  protected rowIcons(entry: DayRowVm): readonly UiIconName[] {
    return rowMarks(entry, this.agendaFlags());
  }

  /** Is there anything for a row's foot to hold (`footShown`)? */
  protected hasFoot(entry: DayRowVm): boolean {
    return footShown(entry, this.agendaFlags());
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

  /** A seat's catalogue minutes for a chair (`chairMinutesOf`), on the live catalogue. */
  protected chairMinutesOf(
    seat: Seat,
    barberId: BarberId,
  ): DurationMinutes | null {
    return chairMinutesOf(seat, barberId, this.catalogNames);
  }

  /** The barber's headshot, or nothing if HR never uploaded one. */
  private barberAvatarOf(barberId: BarberId): string | null {
    return (
      this.catalog.barberVms().find((vm) => vm.id === barberId)?.avatarSrc ??
      null
    );
  }

  /**
   * Perform a verb. Cancelling opens the reason sheet rather than firing —
   * a destructive act on someone's booking asks why first.
   */
  protected async act(row: DayRowVm, to: RowVerb): Promise<void> {
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
      this.cancelSeatIds.set(
        AppointmentLifecycleSystem.transitionSeats(
          BookingStatus.Cancelled,
          row,
        ),
      );
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
      const seatIds = AppointmentLifecycleSystem.transitionSeats(to, row);
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

  /**
   * The refused call's id beside the toast's sentence (audit-hardening
   * WS-4.5), or `null`: set with every refusal `notice` words, cleared with
   * every other notice — a receipt or a closed toast carries no reference.
   */
  protected readonly noticeReference = signal<ClientOperationId | null>(null);

  /**
   * The reference line the toast prints under a refusal: the id and its
   * words (`operationReferenceWords`), or `null` — no refusal on show, an
   * undo on offer in its place, or a failure that carries no id.
   */
  protected readonly noticeReferenceLine = computed(() => {
    const id = this.noticeReference();
    if (this.undo() !== null || this.notice() === null || id === null)
      return null;
    const words = operationReferenceWords(id, (key, params) =>
      this.transloco.translate<string>(key, params),
    );
    return words === null ? null : { value: id, ...words };
  });

  /** A notice that is not a refusal (a receipt, or none): no reference. */
  private setNotice(message: string | null): void {
    this.noticeReference.set(null);
    this.notice.set(message);
  }

  private refuse(
    error: PipelineError | null,
    fallbackKey = `errors.${BookingErrorCode.CallFailed}`,
  ): void {
    this.undo.set(null);
    this.notice.set(
      error ? this.describeError(error) : this.transloco.translate(fallbackKey),
    );
    this.noticeReference.set(error?.operationId ?? null);
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

  /**
   * The day and the chair the CREATE sheet's draft is on (OR-3) — `null`
   * while it has said none. Set from the editor's `dayChanged` and
   * `chairChanged`, released on close with the store's probe.
   */
  private readonly createDraftDay = signal<LocalDate | null>(null);
  private readonly createDraftChair = signal<BarberId | null>(null);

  /** Bumped when a save lands, so the sheet can rebaseline. See `saveFromEditor`. */
  protected readonly visitSavedMark = signal(0);

  /**
   * What a sheet's frame draws AROUND the block — for the DRAFTED day and
   * chair (OR-3: one input is drawn, narrated and judged — the editor's
   * verdict reads this same day). `null` while the draft sits on the shown
   * day in the subject's own chair: the sheet's VM already draws that one.
   *
   * Kept out of the editor VMs on purpose: a VM seeds the editor's draft and
   * is what `dirty` measures against, so it must not move when the draft
   * does. This does move — that is its entire job — and nothing here is ever
   * seeded or compared.
   *
   * The probe's cell holds APPOINTMENTS, not agenda rows — `dayRowVm` runs for
   * the day on screen and nothing builds rows for a day nobody is looking
   * at. The frame needs three fields per neighbour, so it takes them off the
   * documents rather than making the whole agenda run twice. What occupies
   * the chair is what the server's overlap refusal reads — the chair's seats
   * of every other visit whose ROOT is live (`BusySystem.chairOccupants`,
   * DEP-2). While the probe has not answered, the lane is absent and the
   * frame draws nobody beside the block: silent, never wrong.
   */
  private frameDayFor(
    subject: FrameSubject,
    draftDay: LocalDate | null,
    draftChair: BarberId | null,
  ): VisitEditorFrameDay | null {
    const shownDay = this.store.dayKey();
    const day = draftDay ?? shownDay;
    // THE DRAFT'S CHAIR, not the subject's (owner, 2026-09-09): switching
    // the barber in the sheet must show that barber's day — his bookings,
    // his hours — the same way stepping the day shows another day.
    const barberId = draftChair ?? subject.chair;
    if (day === shownDay && barberId === subject.chair) return null;
    const cell = day === null ? null : this.store.cellFor(day);
    const lane = cell?.lanes.find((entry) => entry.barberId === barberId);
    // No chair (a row on no lane) has nobody beside it.
    const neighbours =
      barberId === null
        ? []
        : occupantNeighbours(
            lane?.appointments ?? [],
            barberId,
            subject.appointmentId,
            this.toneOf(barberId),
            this.dayWords(),
          );
    const roster = IntervalSetSystem.hull(lane?.rostered ?? []);
    return {
      neighbours,
      rosterStartMinute: roster?.startMinutes ?? MIDNIGHT,
      rosterEndMinute: roster?.endMinutes ?? CLOSING,
      // ⚠ The DRAFTED day against today: the `now` line was staying lit on
      // a frame stepped onto tomorrow.
      nowMinute: day === this.store.todayKey() ? this.nowMinute() : null,
    };
  }

  /**
   * The visit sheet's frame day ({@link frameDayFor}). On the anchor day it
   * resolves the same lane `visitEditorVm` already used, so the ordinary
   * sheet is unchanged; only a stepped pill or a switched chair reaches the
   * probe's cell.
   */
  protected readonly visitFrameDay = computed<VisitEditorFrameDay | null>(
    () => {
      const row = this.visitSheetRow();
      if (row === null) return null;
      const lane = this.lanes().find((entry) =>
        entry.entries.some(
          (e) => e.agendaRow === AgendaRow.Visit && e.id === row.id,
        ),
      );
      return this.frameDayFor(
        { appointmentId: row.appointmentId, chair: lane?.barberId ?? null },
        this.visitDraftDay(),
        this.visitDraftChair(),
      );
    },
  );

  /**
   * The create sheet's frame day ({@link frameDayFor}, OR-3): its frame
   * follows its DRAFT — re-dated to tomorrow, it draws tomorrow's
   * neighbours and roster; before, it always drew the anchor day. A visit
   * not booked yet excludes nobody from its chair.
   */
  protected readonly createFrameDay = computed<VisitEditorFrameDay | null>(
    () => {
      const create = this.createVisit();
      if (create === null) return null;
      return this.frameDayFor(
        { appointmentId: null, chair: create.barberId },
        this.createDraftDay(),
        this.createDraftChair(),
      );
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
   * draft — services picked, people seated — survives the switch; the frame
   * follows the chair on whatever day the draft is on (`createFrameDay`).
   */
  protected onCreateChairChanged(barberId: BarberId): void {
    this.createDraftChair.set(barberId);
    this.createVisit.update((create) =>
      create === null || create.barberId === barberId
        ? create
        : { ...create, barberId },
    );
  }

  /**
   * The create sheet's drafted day (OR-3) — kept live through the store's
   * probe, exactly as the visit sheet's `onVisitDayChanged` does, so its
   * frame draws that day's chair.
   */
  protected onCreateDayChanged(dayKey: LocalDate): void {
    this.createDraftDay.set(dayKey);
    this.store.probeDay(dayKey);
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
    const neighbours = occupyingRows(
      lane,
      storeLane?.appointments ?? [],
      row.appointmentId,
    );

    const roster = IntervalSetSystem.hull(storeLane?.rostered ?? []);
    const editorWords = visitEditorWords(row, this.dayWords());

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
        .map(peerRowOf),
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
      dayLabel: formatDayPill(dayKey, this.transloco.getActiveLang()),
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
      clientMeta: editorWords.clientMeta,
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
      statusLabel: editorWords.statusLabel,
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
      primaryVerb: editorWords.primaryVerb,
      overflowVerbs: editorWords.overflowVerbs,
      // Busy while the store holds the visit, or while a save of it is
      // under way here — a note or a tip alone never touches the store's
      // pending set, and «Запази» must turn its ring for those too.
      acting:
        this.store.isPending(row.appointmentId) ||
        this.savingVisitId() === row.appointmentId,
    };
  });

  protected openVisitSheet(row: DayRowVm): void {
    this.presentOnly();
    this.visitSheetId.set(row.id);
    this.store.probeNote(row.appointmentId);
    this.store.probePhotos(row.appointmentId);
    // The client's own coupons, for the discount row — nobody's for a
    // walk-in, which reads as none — and the grants this visit's SAVED bill
    // already spent (OR-13): burned at the save, they still show on it.
    this.store.probeGrants(
      row.ownerCustomerId,
      row.discounts.flatMap((discount) =>
        discount.grantId === null ? [] : [discount.grantId],
      ),
    );
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
  protected readonly discardActions = computed<readonly UiAlertAction[]>(() =>
    discardActionsOf(this.chromeWords()),
  );

  protected onDiscardPick(id: string): void {
    if (id === DiscardAnswer.Discard) this.confirmDiscard();
    else this.discardPending.set(null);
  }

  /** The zone notice's one way out. */
  protected readonly zoneActions = computed<readonly UiAlertAction[]>(() =>
    zoneActionsOf(this.chromeWords()),
  );

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
          value: CouponValue.sliceOf(coupon),
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
   * and the way back is this save's own write (the store's `saveVisit`,
   * OR-4) run from the LIVE row towards that snapshot — a seat the save
   * added is removed, one it removed is re-added with its old terms, the
   * block moves home, the bill, the tip and the note go back. This page
   * keeps only what the outcome means on screen: the saved mark, the
   * toast, the receipt's «Отмени» and the stale reload.
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
     * WHAT THE SIDE FIELDS WERE DRAWN FROM (round 5): the save writes only
     * the ones the barber CHANGED from it — never one they left alone,
     * however long the sheet has been open (`VisitSidesSystem.writesOf`,
     * in the plan). The sheet follows the stored note and tip while they
     * are untouched, so a colleague's tip recorded after it opened is
     * shown, not written over.
     * A commit that does not say what it drew (`drawn: null`) is measured
     * against what is stored now.
     */
    const drawn: VisitSides = commit.drawn ?? {
      note: this.store.teamNote(),
      tipCents: row?.tipCents ?? null,
    };
    const command = this.saveCommandOf(
      appointmentId,
      commit,
      row,
      drawn,
      before,
      null,
    );
    /*
     * What the way back has to work with, read off the save's own plan
     * (`StaffEditPlanSystem.savePlan`, OR-4 — the store's write runs the
     * same plan over the same command): the side fields it writes, whether
     * it has a way back at all, and whether it could change the row's
     * shape — a note alone cannot, and its undo need not wait for the
     * listener.
     */
    const plan = StaffEditPlanSystem.savePlan(command);
    const landed = await this.store.saveVisit(command);
    /*
     * ⚠ ONLY ON SUCCESS. The mark tells the sheet the server has spoken, and
     * the sheet then takes the server's own encoding of the time as its
     * baseline — which is the only way the save button can ever go away,
     * because a `resize` comes back as a changed SEAT DURATION while the
     * draft holds an override on an unchanged leg. Two encodings of one
     * visit; the stored one wins.
     */
    if (VisitEditWrite.batchLanded(landed)) {
      this.visitSavedMark.update((mark) => mark + 1);
    }
    // The sheet stays, the toast says why (owner, 2026-09-17) — and a
    // save that lands takes a stale refusal down with it.
    if (!VisitEditWrite.landed(landed)) {
      const error =
        landed.visitEditWriteOutcome === VisitEditWriteOutcome.Stale
          ? sidesMovedError()
          : this.store.errorFor(appointmentId);
      this.refuse(error);
      // SOMEBODY ELSE SAVED IT FIRST: the toast says so in one line, and
      // the sheet reloads the visit as it now stands — the draft drawn
      // from the older screen is never written over theirs.
      if (!VisitEditWrite.batchLanded(landed) && isStaleRefusal(error)) {
        void this.reloadStale(appointmentId, row, error);
      }
      return;
    }
    if (before !== null && row !== null && plan.reversible) {
      this.setNotice(null);
      this.offerSaveUndo(
        appointmentId,
        row,
        before,
        plan.writes,
        plan.shapeNeutral,
        { note: commit.note, tipCents: commit.tipCents },
      );
      return;
    }
    /*
     * THE RECEIPT WITHOUT A WAY BACK: a seat added after the cut is worked
     * the moment it is written and the server keeps history, so «Отмени»
     * would only ever be refused. The toast still says the save landed.
     */
    this.undo.set(null);
    this.setNotice(this.transloco.translate('staff.day.undo.saved'));
  }

  /**
   * ONE WRITE OF THE SHEET as the store's `saveVisit` takes it (OR-4) — a
   * save, or its undo: the target, the row it starts from AS IS (Law 3),
   * what the side fields were drawn from (the draft's for a save, what the
   * save wrote for its undo), the snapshot a save's receipt goes back to
   * (`null` for the undo itself), and the side fields the write carries
   * (`null` for a save — the plan reads them off its commit — the save's
   * own for its undo). The order of the writes, the stale guard and the
   * batch's claim are `saveVisitEdit`'s (`@core/pipelines`).
   *
   * Beside them, what this device hears NOW — the note's own listener,
   * which may not answer (`undefined`), and the row's tip, unheard without
   * a row; a field this device does not hear is not judged — and what this
   * page alone holds: every guest label the VISIT holds on any loaded day
   * (`visitGuestLabels`) and the catalogue's walk-in words. Built when the
   * write goes out, so an undo reads the visit as it then stands.
   */
  private saveCommandOf(
    appointmentId: AppointmentId,
    commit: VisitEditorCommit,
    row: DayRowVm | null,
    drawn: VisitSides,
    before: VisitEditorCommit | null,
    writes: SideWrites | null,
  ): SaveVisitEditCommand {
    const liveNote = this.store.teamNoteOf(appointmentId);
    return {
      appointmentId,
      commit,
      row,
      drawn,
      live: {
        note: liveNote ?? null,
        noteHeard: liveNote !== undefined,
        tipCents: row === null ? null : row.tipCents,
        tipHeard: row !== null,
      },
      guestLabels: row === null ? [] : this.visitGuestLabels(row.appointmentId),
      words: this.walkInWords(),
      before,
      writes,
    };
  }

  /**
   * THE BATCH from a row to a target — the save's arithmetic, and the
   * undo's, since both are "make the stored visit say this"
   * (`StaffEditPlanSystem.commandsFor`, pass D D-10.1; every command is
   * decided by the server in one fold — see `saveFromEditor`). The row
   * passes AS IS (Law 3). This page adds only what it alone holds: every
   * guest label the VISIT holds on any loaded day — a stranger joining
   * this chair is numbered past the other chairs' walk-ins too
   * (`visitGuestLabels`) — and the catalogue's walk-in words, exactly as a
   * write hands them to its plan (`saveCommandOf`).
   *
   * Since OR-4 the page never sends this itself: a write's batch is planned
   * inside the store's `saveVisit` (`StaffEditPlanSystem.savePlan`). It
   * stays as the page's read of that arithmetic, which the save and undo
   * specs pin through the page.
   */
  protected commandsFor(
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
   * write from there towards the snapshot (the store's `saveVisit`, with
   * the side fields the save wrote), then asks the sheet on that visit to
   * re-seed once the server's row agrees. Edits typed into the
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
    /** The side fields the save wrote — what its undo writes back. */
    writes: SideWrites,
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
          this.store.saveVisit(
            this.saveCommandOf(
              appointmentId,
              before,
              find() ?? rowBefore,
              wrote,
              null,
              writes,
            ),
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
        if (!VisitEditWrite.landed(landed)) {
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
          this.noticeReference.set(error?.operationId ?? null);
          // Somebody else saved the visit after this save: the undo is not
          // written over them, and the sheet shows what they left.
          if (!VisitEditWrite.batchLanded(landed) && isStaleRefusal(error)) {
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

    for (const cell of this.store.dayCells()) {
      for (const lane of cell.lanes) {
        const appointment = lane.appointments.find(
          (entry) => entry.id === appointmentId,
        );
        if (appointment === undefined) continue;
        const here = Seat.ofChair(appointment.seats, lane.barberId).map(
          (seat) => seat.seatId,
        );
        if (lane.barberId === barberId || holds(here)) {
          return dayRowVm(appointment, lane.barberId, this.rowContext());
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
      ...photo,
      barberName:
        this.barberOptions().find((chair) => chair.id === photo.barberId)
          ?.label ?? null,
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
  private readonly customerSearch = inject(CUSTOMER_SEARCH_PORTS);

  /** The last create's nonce — counted, never read off the clock (UR-11). */
  private createSeq = 0;

  protected readonly createVisit = signal<{
    readonly barberId: BarberId;
    /**
     * Where the draft starts — a minute of the shop day, never the closing
     * midnight (OR-1): what the frame draws is what the server accepts.
     */
    readonly startMinute: MinuteOfDay;
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
    const roster = IntervalSetSystem.hull(storeLane?.rostered ?? []);
    // What occupies the chair — the server's rule (DEP-2).
    const neighbours = occupyingRows(lane, storeLane?.appointments ?? [], null);
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
      dayLabel: formatDayPill(dayKey, this.transloco.getActiveLang()),
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
      statusLabel: this.dayWords().newVisitTitle,
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

  /**
   * Where a walk-in starts — the next tick, inside the shop day
   * (`VisitDraftSystem.walkInStart`, OR-1): from 23:26 on, the latest half
   * hour that still ends by midnight (23:30–24:00), so the seed the frame
   * draws is one the server accepts (DEP-F1).
   */
  private nowSnapped(): MinuteOfDay {
    return VisitDraftSystem.walkInStart(
      this.nowMinute(),
      VisitDraftSystem.DEFAULT_SPAN_MINUTES,
    );
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
    // The probe is the sheet's own subscription (OR-3) — a closed sheet must
    // not keep a listener open on a day nothing is looking at.
    this.createDraftDay.set(null);
    this.createDraftChair.set(null);
    this.store.probeDay(null);
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
    // A stored visit starts on its day's clock — read back off the axis.
    const start = MinuteOfDay.of(vm.startMinute);
    if (!start.ok) return;
    this.closeVisitSheet();
    this.presentOnly();
    this.visitClientOptions.set([]);
    // The finished visit's own start and span (2026-09-18): the day is the
    // desk's to pick, the hour is what the client already comes at.
    this.createVisit.set({
      barberId: chair,
      startMinute: start.value,
      minutes: VisitDraftSystem.floorSpan(
        TrackMinute.span(vm.startMinute, vm.endMinute),
      ),
      nonce: ++this.createSeq,
      legs: VisitDraftSystem.rebookLegs(vm.legs, (leg, index) =>
        // A fresh draft seat — a `SeatId` by construction (`draft-…`).
        SeatId.of(
          `draft-${leg.serviceId}-${index}-${this.clock.nowUtcMs().toString(36)}`,
        ),
      ),
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
            Seat.isCompanion(seat)
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
    const words = this.dayWords();
    const nowUtcMs = this.store.nowUtcMs();
    const shopNowAt = this.store.shopNowAt();
    const past = VisitListSystem.begunNewestFirst(
      this.store.window(),
      shopNowAt,
      nowUtcMs,
    );
    const recent: VisitEditorClientOption[] = ClientQuerySystem.recentAccounts(
      past,
      RECENT_CLIENTS_CAP,
    ).map(({ userId, visit }) =>
      recentClientOption(userId, visit, {
        words,
        zoneKnown: this.store.zone() !== null,
        locale: this.content.locale(),
      }),
    );
    /*
     * THE BOOK (2026-09-18): every account in the loaded days, past and to
     * come — the omnibox ranks these on the keystroke, before the index
     * answers. Newest contact first, so a changed number is the one read
     * (`bookAccounts` orders them: each named account once, the booker's).
     */
    const book: VisitEditorClientOption[] = ClientQuerySystem.bookAccounts(
      this.store.window(),
    ).map(({ userId, visit, contactName }) =>
      bookClientOption(userId, visit, contactName),
    );
    this.visitClientBook.set(book);
    this.visitClientSections.set([
      {
        id: VisitEditorClientSectionId.Recent,
        title: words.recentClients,
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
    const parsed = ClientQuerySystem.parse(query);
    // By the shop's own dial code: «088…» is asked as «359 88…» too — the
    // query's own default when the country has none.
    const code = PhoneSystem.callingCodeOr(
      this.deployment.defaultCountry,
      ClientQuerySystem.DEFAULT_CALLING_CODE,
    );
    const keys = ClientQuerySystem.lookupKeys(parsed, code);
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
      keys.map(async (key) => {
        // The index's own form of the key; one it could never match is
        // asked nothing (no account or record holds an empty prefix).
        const prefix = SearchFieldsSystem.normalizeQuery(key);
        if (prefix.length === 0) return null;
        // Both indexes at once (OR-26): the accounts, and the shop's client
        // records — where a walk-in the desk entered lives.
        const [accounts, records] = await Promise.all([
          this.userSearch.searchUsers(prefix, CLIENT_SEARCH_LIMIT),
          this.customerSearch.searchCustomers(prefix, CLIENT_SEARCH_LIMIT),
        ]);
        return { accounts, records };
      }),
    );
    // A newer query owns the list now.
    if (seq !== this.clientSearchSeq) return;
    const options = clientSearchOptions(answers);
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
    if (done) this.closeCreateSheet();
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
      const roster = IntervalSetSystem.hull(rostered);
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
        neighbours: occupyingRows(lane, storeLane?.appointments ?? [], null),
        ...windows(storeLane?.rostered ?? []),
      };
    }
    const cell = this.store.cellFor(frameDay);
    const draftLane = cell?.lanes.find((entry) => entry.barberId === barberId);
    return {
      barberId,
      neighbours: occupantNeighbours(
        draftLane?.appointments ?? [],
        barberId,
        null,
        this.toneOf(barberId),
        this.dayWords(),
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
    // A block starts on its day's clock — read back off the axis.
    const start = MinuteOfDay.of(range.startMinute);
    if (!start.ok) return;
    this.closeBlockSheet();
    this.presentOnly();
    this.visitClientOptions.set([]);
    this.createVisit.set({
      barberId: range.barberId,
      startMinute: start.value,
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
    return lane !== undefined && RosterSystem.rosteredNowhere(lane);
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
    const plan = ScheduleExceptionSystem.blockSavePlan({
      editing: edit.blockId !== null,
      opened: edit,
      openedRange: minuteRangeOf(edit.startMinute, edit.endMinute),
      shownDay,
      saved: commit,
      savedRange: minuteRangeOf(commit.startMinute, commit.endMinute),
      homeOf: (barberId) => {
        const barber = this.catalog
          .barbers()
          .find((entry) => entry.id === barberId);
        return barber === undefined ? null : LocationScopeSystem.homeOf(barber);
      },
    });
    if (plan.lift !== null) {
      const { barberId, range, localDate } = plan.lift;
      const lifted = await this.store.clearBlock(barberId, range, localDate);
      if (!lifted) return;
    }
    if (plan.writes === null) return;
    for (const write of plan.writes) {
      const { barberId, locationId, ranges } = write;
      const done =
        write.localDate !== null
          ? await this.store.blockTime(
              barberId,
              locationId,
              ranges,
              write.localDate,
            )
          : await this.store.blockSeries(
              barberId,
              locationId,
              ranges,
              write.days,
            );
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
    const wholeDay = ScheduleExceptionSystem.liftsWholeDay(
      edit.allDay,
      this.offOn(barberId, dayKey),
    );
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

  /**
   * ONE transient surface at a time.
   *
   * The FAB, the date popover and the view/scope pickers
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
    viewChoicesOf(this.views, this.chromeWords()),
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
    viewSegmentsOf(this.views, this.chromeWords()),
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
  protected readonly scopeChoices = computed<readonly UiChoiceOption[]>(() =>
    scopeChoicesOf(this.scopeOptions(), this.chromeWords()),
  );

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
   *
   * Asked by the APPOINTMENT (`entry.appointmentId`), never the row's own
   * `appointment#chair` key: a refusal is the aggregate's, which is how the
   * store files it (owner ruling 2026-09-03, `DayRowVm.id`) — so a party's
   * refusal reads in each of its chairs' rows.
   */
  protected rowError(appointmentId: AppointmentId): string | null {
    const error = this.store.errorFor(appointmentId);
    return error ? this.describeError(error) : null;
  }

  /** The cancel sheet's own error, which has no row to live in. */
  protected readonly cancelError = computed(() => {
    const id = this.cancelId();
    return id === null ? null : this.rowError(id);
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
    return refusalSentence(error, this.say, (code, params) =>
      translateCodedError(this.transloco, { ...params, errorCode: code }),
    );
  }
}
