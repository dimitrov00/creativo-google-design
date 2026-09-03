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
  untracked,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import {
  Appointment,
  type AppointmentStatusKind,
  CancellationReasonKind,
  LocalTimeRange,
  type Money,
  OFFERED_CANCELLATION_REASONS,
  type Seat,
  canTransition,
  formatMoney,
} from '@creativo/application/booking';
import { AGENDA_FIELDS, AgendaFields } from '../agenda-fields';
import {
  StaffVisitEditor,
  type VisitEditorBarberOption,
  type VisitEditorCommit,
  type VisitEditorLeg,
  type VisitEditorVerb,
  type VisitEditorVm,
} from '../visit-editor/staff-visit-editor';
import { assignBarberTones } from '../barber-tone';
import {
  CatalogContentService,
  CatalogPresenter,
} from '@creativo/features/shared/catalog';
import {
  pluralForm,
  relativeTime,
  translateDomainError,
} from '@creativo/infrastructure/i18n';
import {
  UiAvatar,
  UiBadge,
  UiBadgeTone,
  UiButton,
  UiChip,
  UiIcon,
  type UiIconName,
  UiModalSheet,
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
  UiCalendarGrid,
  UiListGroup,
  UiListRow,
  UiMenu,
  UiMenuItem,
  UiMenuTrigger,
  UiPageActionBar,
  UiSheetActionBar,
} from '@creativo/ui/patterns';
import {
  StaffDayStore,
  addDays,
  startOfWeek,
  type BarberDayLane,
  type StaffView,
} from '../staff-day.store';
import {
  type GridColumn,
  type GridEvent,
  type OpenWindow,
  StaffTimeGrid,
} from '../time-grid/staff-time-grid';

/**
 * What a row can DO. `arrived` is not an `AppointmentStatusKind` on purpose:
 * arriving is a stamp beside the status, never an edge in the lifecycle graph
 * (see `Appointment.arrivedAt`).
 */
type RowVerb = AppointmentStatusKind | 'arrived';

/** One row of a barber's lane, precomputed — the sheet re-renders live. */
interface DayRowVm {
  readonly kind: 'visit';
  readonly id: string;
  /**
   * THIS lane's seat. A row is one barber's share of a party, so resolving it
   * must name the seat — the root can hold one answer and a party has several.
   */
  readonly seatId: string;
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
  readonly startMs: number;
  /** The seat's end instant — what the proportional grid sizes a block from. */
  readonly endMs: number;
  readonly startLabel: string;
  readonly endLabel: string;
  /**
   * How long the seat runs, in minutes.
   *
   * The subtitle used to print the clock a SECOND time — "12:30" led the row
   * and "12:30–13:00" repeated underneath it — which is the redundancy that
   * pushed the client's name onto two lines and made every row a different
   * height. Duration is the fact the repeat was hiding.
   */
  readonly durationMinutes: number;
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
  readonly barberName: string;
  readonly barberAvatarSrc: string | null;
  /** Which of the five identity tones this chair wears — see `barber-tone`. */
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
  readonly email: string | null;
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
   * THIS lane's seats, one entry each — the editor's service rows.
   *
   * `serviceLabel` joins them with `+` for the agenda card, which is the right
   * shape for a line the eye skims and the wrong one for a list you edit: a
   * leg carries its own duration, its own price and its own barber, and the
   * join throws all three away. Built here rather than in the editor because
   * `toRow` is already holding the seats and the catalog.
   */
  readonly legs: readonly VisitEditorLeg[];
  readonly status: AppointmentStatusKind;
  /** Whether the party has walked in — the gate for offering "Done". */
  readonly arrived: boolean;
  /** The ONE verb this row leads with, or `null` on a settled row. */
  readonly primary: RowVerb | null;
  /** Everything else `canTransition` allows — the overflow menu. */
  readonly overflow: readonly AppointmentStatusKind[];
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
  readonly key: string;
  readonly timeLabel: string;
  readonly startMs: number;
  /** `true` once the clock has passed this heading. */
  readonly past: boolean;
  readonly items: readonly RunEntryVm[];
}

/** A sellable hole. Same row grammar, no segment fill (§4.4). */
interface GapRowVm {
  readonly kind: 'gap';
  readonly id: string;
  readonly startLabel: string;
  readonly endLabel: string;
  readonly minutes: number;
  readonly startMs: number;
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

interface LaneVm {
  readonly barberId: string;
  readonly barberName: string;
  readonly avatarSrc: string | null;
  /** Visits and gaps interleaved in clock order — the COMPLETE run. */
  readonly entries: readonly RunEntryVm[];
  /** "09:00–18:00 · 6 cuts". Counts only — never a percentage (§8). */
  readonly extentLabel: string | null;
  readonly visitCount: number;
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
const STATUS_ICONS: Partial<Record<AppointmentStatusKind, UiIconName>> = {
  completed: 'checklist.done',
  no_show: 'visit.noShow',
};

/**
 * Status is FORM, never hue — the grid's ruling, now honoured here too.
 *
 * These badges were accent / success-green / destructive-red / warning-amber,
 * which is exactly the arrangement `staff-time-grid.css` quotes HIG at length
 * to forbid: a pale green beside a pale amber is the pair red-green colour
 * blindness cannot separate, and "the cut happened" versus "they never came"
 * is not a distinction to hang on a hue. Success and warning are system
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
const STATUS_TONES: Record<AppointmentStatusKind, UiBadgeTone> = {
  pending: 'warning',
  confirmed: 'neutral',
  completed: 'neutral',
  cancelled: 'destructive',
  no_show: 'destructive',
};

/**
 * Epoch ms → minutes from midnight in SHOP time.
 *
 * Deliberately formatted through `Intl` rather than read off a `Date`: the
 * browser's own zone is whatever the laptop is set to, and a receptionist on
 * a machine left in UTC would otherwise see every block two hours out.
 */
/**
 * Epoch ms → `"13:00"` in SHOP time — the same `Intl` projection and the same
 * reason as `shopMinuteOfDay` below: a laptop left in UTC must not put a
 * barber's lunch two hours out.
 */
function shopClock(ms: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Sofia',
  }).format(new Date(ms));
}

function shopMinuteOfDay(ms: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Sofia',
  }).formatToParts(new Date(ms));
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

/**
 * "HH:MM" → minutes from midnight, or `null` if it is not a clock.
 *
 * The counterpart to `shopMinuteOfDay` for the OTHER side of a comparison:
 * an `<input type="time">` value is already shop wall-clock, so putting both
 * sides in minutes of day is what keeps zone arithmetic out of the overlap
 * test entirely.
 */
/** A beat of air above the anchored marker, so it does not hug the toolbar. */
const CLEARANCE = 12;
/** How many frames the anchor may spend chasing a still-settling layout. */
const ANCHOR_FRAMES = 24;
/** Close enough, in px — sub-pixel layout must not keep the loop alive. */
const ANCHOR_TOLERANCE = 2;

/** Settled, whatever became of it — a cancelled seat is never "in the chair". */
function isTerminalStatus(status: AppointmentStatusKind): boolean {
  return (
    status === 'completed' || status === 'cancelled' || status === 'no_show'
  );
}

function minuteOfClock(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** One field that matched, split so the matching run can be marked. */
interface MatchVm {
  readonly label: string;
  readonly parts: readonly { readonly text: string; readonly hit: boolean }[];
}

/** One appointment the search found. */
interface SearchHitVm {
  readonly id: string;
  readonly dayKey: string;
  readonly whenLabel: string;
  /** The party's start, for ordering the two halves outward from now. */
  readonly whenMs: number;
  readonly past: boolean;
  readonly status: AppointmentStatusKind;
  readonly titleParts: readonly {
    readonly text: string;
    readonly hit: boolean;
  }[];
  readonly matches: readonly MatchVm[];
}

/** Does this field hold the term — by text, or by bare digits for a phone? */
function matches(
  field: { label: string; value: string },
  term: string,
  digits: string,
  byDigits: boolean,
): boolean {
  if (field.value.toLocaleLowerCase('bg').includes(term)) return true;
  return (
    byDigits &&
    field.label === 'phone' &&
    field.value.replace(/\D/g, '').includes(digits)
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

/** The whole product is Europe/Sofia-only for now (blueprint §7.1). */
const SHOP_ZONE = 'Europe/Sofia';

/**
 * A day key plus minutes-from-midnight → the instant, in shop time.
 *
 * The inverse of `shopMinuteOfDay`, and the boundary the editor deliberately
 * does not cross: it works in minutes because it knows the day only as a key,
 * and inventing a zone there would be wrong in every shop but this one.
 *
 * `'later'` on a DST gap: a spring-forward morning has no 02:30, and a staff
 * member dragging a block through it means the next real minute — not a
 * refusal they cannot act on. It cannot fail for a well-formed key, but the
 * `Result` is unwrapped honestly rather than asserted away.
 */
function shopInstantIso(dayKey: string, minuteOfDay: number): string | null {
  const [year, month, day] = dayKey.split('-').map(Number);
  if (!year || !month || !day) return null;
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;

  // Two passes, because a wall-clock time does not name an instant until the
  // zone's offset for THAT instant is known, and the offset depends on the
  // instant. Guess as if Sofia were UTC, measure how far the guess actually
  // lands from the wall clock we wanted, correct by that much, and measure
  // again — the second pass is what makes the two DST days right.
  //
  // ⚠ `ZonedDateTime` would do this in one line, but it lives in
  // `@creativo/domain/kernel` and this is a `type:feature` library: the
  // boundary rule forbids the import, and `Intl` is what the file's own
  // `shopMinuteOfDay` already uses for the inverse.
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  for (let pass = 0; pass < 2; pass++) {
    guess = wanted - (shopWallClockUtc(guess) - guess);
  }
  return new Date(guess).toISOString();
}

/** What `at` reads as on the shop's wall clock, expressed as a UTC stamp. */
function shopWallClockUtc(at: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: SHOP_ZONE,
  }).formatToParts(new Date(at));
  const value = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  return Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour') % 24,
    value('minute'),
    value('second'),
  );
}

/** The verbs the sheet OFFERS, in the order a shop reaches for them. */
const OFFERED: readonly AppointmentStatusKind[] = [
  'confirmed',
  'completed',
  'no_show',
  'cancelled',
];

/**
 * Which verb a row LEADS with, given the clock.
 *
 * The sheet used to render every legal transition as an equal-weight sibling,
 * so a confirmed 18:00 booking offered Complete, No-show and Cancel at 10:00
 * — three verbs that are all wrong, one of them terminal, all adjacent to the
 * thumb. `canTransition` says what is LEGAL; only the clock says what is
 * likely. Nothing here widens the graph: the primary is always drawn from the
 * legal set, and everything legal stays reachable through the overflow.
 */
function primaryVerb(
  status: AppointmentStatusKind,
  legal: readonly AppointmentStatusKind[],
  arrived: boolean,
): RowVerb | null {
  // A shop that vets its bookings (`autoConfirm: false`) accepts them first.
  // With the ruling's default this arm is simply never reached.
  if (status === 'pending' && legal.includes('confirmed')) return 'confirmed';
  // Then the desk's act: this person is here. Not a status change — a stamp.
  if (!arrived && (status === 'pending' || status === 'confirmed')) {
    return 'arrived';
  }
  // ARRIVAL, not the clock, gates finishing. The old rule offered "Done" the
  // instant a booking's start time passed, whether or not anyone had walked
  // in; now the row only offers it once the shop has said they did — which is
  // also what makes the barber's one-handed tap mean something.
  if (arrived && legal.includes('completed')) return 'completed';
  // A no-show is the one settled state that can be walked back, and the row
  // is where the mis-tap happened — so the correction leads there rather than
  // hiding behind the sheet. `confirmed` is the graph's word for it; the
  // LABEL says what it means (see `verbKey`).
  if (status === 'no_show' && legal.includes('confirmed')) return 'confirmed';
  return null;
}

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
    StaffTimeGrid,
    StaffVisitEditor,
    TranslocoDirective,
    UiAvatar,
    UiBadge,
    UiButton,
    UiCalendarGrid,
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
    UiSpacer,
    UiStack,
    UiSwitch,
    UiTextDirective,
    UiTextField,
    UiToolbar,
    UiVisuallyHiddenDirective,
    UiWeightDirective,
  ],
  providers: [StaffDayStore],
  templateUrl: './staff-dashboard.html',
  styleUrl: './staff-dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'lib-staff-dashboard',
    'data-testid': 'staff-day-page',
  },
})
export class StaffDashboard {
  private readonly transloco = inject(TranslocoService);
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
   * `primaryVerb()` returns null once a visit settles and `overflow` empties
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
  private readonly anchoredDay = signal<string | null>(null);

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
   */
  private watchToolbar(framesLeft: number): void {
    if (framesLeft <= 0) return;
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
    if (framesLeft <= 0) return;
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

  private restoreFocusToRow(appointmentId: string): void {
    afterNextRender(
      () => {
        const row = this.host.nativeElement.querySelector<HTMLElement>(
          `[data-appointment-id="${CSS.escape(appointmentId)}"]`,
        );
        if (!row || row.contains(document.activeElement)) return;
        row.focus();
      },
      { injector: this.injector },
    );
  }

  protected readonly catalog = inject(CatalogContentService);
  protected readonly content = inject(CatalogPresenter);
  protected readonly store = inject(StaffDayStore);

  /**
   * `?day=YYYY-MM-DD`, bound from the route. Absent means today — a link that
   * pinned today would be wrong by morning.
   */
  readonly day = input<string | null>(null);

  constructor() {
    // The URL is an INPUT here and an OUTPUT of the store, so the echo of the
    // store's own write must not be mistaken for the user asking for a day —
    // that bounced every chevron press straight back to today. Comparing
    // against what the store last published leaves only genuine external
    // changes: the first load, and the back button.
    effect(() => {
      const requested = this.day();
      // `published` is read UNTRACKED: it changes as a RESULT of goToDay, so
      // tracking it re-fires this effect with a stale `day()` and undoes the
      // navigation that just happened. Only `day()` may wake this.
      if (requested !== untracked(() => this.store.published())) {
        this.store.goToDay(requested);
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
   * The page's clock — the STORE's, which goes through the injected `CLOCK`
   * port. This component used to own a second one seeded from `Date.now()`,
   * so the gaps and the verb gates were reading different times.
   */
  protected readonly nowMs = this.store.nowMs;

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
    if (term.length < 2) return [];
    const nowMs = this.nowMs();

    // Digits-only alias, so "887778899" finds "+359 88 777 8899". A person
    // searching by phone types the number off a screen or a card, never with
    // the formatter's spaces in it.
    const digits = term.replace(/\D/g, '');
    const byDigits = digits.length >= 4;

    const hits: SearchHitVm[] = [];
    for (const appointment of this.store.pool()) {
      const fields = this.searchableFields(appointment);
      const matched = fields.filter((field) =>
        matches(field, term, digits, byDigits),
      );
      if (matched.length === 0) continue;

      const startMs = appointment.timeSlot.start.toMillis();
      // The client is the title, highlighted when it is what matched. Every
      // OTHER matched field lists beneath — so a phone search shows the
      // number it hit, and a name search does not print the name twice.
      const titleField = fields[0];
      hits.push({
        id: appointment.id.value,
        dayKey: this.dayKeyOf(startMs),
        whenLabel: this.searchWhenLabel(startMs),
        whenMs: startMs,
        // ONE definition of past, shared with the grid (see `eventsFor`): a
        // visit is past once it has ENDED. This read `startMs < nowMs`, so a
        // cut that began ten minutes ago and is still in the chair sorted into
        // history here and rendered live there — the same appointment, two
        // answers, on two surfaces a person moves between. Whatever is
        // happening right now belongs with what is coming.
        past: appointment.timeSlot.end.toMillis() <= nowMs,
        status: appointment.status.kind,
        titleParts: titleField
          ? splitOnTerm(titleField.value, term)
          : [{ text: '', hit: false }],
        matches: matched
          .filter((field) => field !== titleField)
          .map((field) => ({
            label: field.label,
            parts: splitOnTerm(
              field.value,
              // Highlight the run that actually matched: the digits form when
              // that is what hit, the typed term otherwise.
              byDigits && field.label === 'phone' ? digits : term,
              byDigits && field.label === 'phone',
            ),
          })),
      });
    }

    // Soonest first among the future; most recent first among the past —
    // the two things a person searching a book is actually looking for.
    return hits.sort((a, b) => {
      if (a.past !== b.past) return a.past ? 1 : -1;
      return a.past ? b.whenMs - a.whenMs : a.whenMs - b.whenMs;
    });
  });

  /** Every field a search is allowed to look at, in display priority. */
  private searchableFields(
    appointment: Appointment,
  ): readonly { label: string; value: string }[] {
    const out: { label: string; value: string }[] = [];
    const contact = appointment.contact;
    if (contact?.name) out.push({ label: 'client', value: contact.name });
    for (const seat of appointment.seats) {
      if (seat.subject.kind === 'anonymous') {
        out.push({ label: 'client', value: seat.subject.label.value });
      }
      const service = this.catalog
        .services()
        .find((entry) => entry.id.value === seat.serviceId.value);
      if (service) {
        out.push({ label: 'service', value: this.content.text(service.name) });
      }
    }
    if (contact?.phone) {
      out.push({ label: 'phone', value: contact.phone.formatInternational() });
    }
    if (contact?.email) {
      out.push({ label: 'email', value: contact.email.value });
    }
    if (contact?.note) out.push({ label: 'note', value: contact.note });
    return out;
  }

  private dayKeyOf(ms: number): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'Europe/Sofia',
    }).format(new Date(ms));
    return parts;
  }

  private searchWhenLabel(ms: number): string {
    return new Intl.DateTimeFormat(this.content.locale(), {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Europe/Sofia',
    }).format(new Date(ms));
  }

  /** Jump the sheet to the day a hit lives on, and close the search. */
  protected openHit(hit: SearchHitVm): void {
    this.store.goToDay(hit.dayKey);
    this.store.closeSearch();
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

  /** Which month the picker is showing — starts on the shown day's. */
  private readonly _pickerMonth = signal<string | null>(null);

  protected readonly pickerMonth = computed(
    () => this._pickerMonth() ?? this.store.dayKey().slice(0, 7),
  );

  protected readonly pickerMonthLabel = computed(() =>
    this.formatTitled(new Date(`${this.pickerMonth()}-01T00:00:00Z`), {
      month: 'long',
      year: 'numeric',
    }),
  );

  protected shiftPickerMonth(delta: number): void {
    const [year, month] = this.pickerMonth().split('-').map(Number);
    const at = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1 + delta, 1));
    this._pickerMonth.set(at.toISOString().slice(0, 7));
  }

  /** Monday-first weekday key — Bulgaria's week, stated not derived. */
  protected readonly weekdayKey = computed(() => {
    // 2026-08-03 is a Monday; walking seven from it labels the key in order.
    return Array.from({ length: 7 }, (_, i) =>
      abbreviateWeekday(
        new Intl.DateTimeFormat(this.content.locale(), {
          weekday: 'long',
          timeZone: 'UTC',
        }).format(new Date(Date.UTC(2026, 7, 3 + i))),
        this.content.locale(),
      ),
    );
  });

  /** The picker's month as weeks of day cells, `null` padding either end. */
  protected readonly pickerWeeks = computed(() => {
    const [year, month] = this.pickerMonth().split('-').map(Number);
    const first = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, 1));
    const days = new Date(Date.UTC(year ?? 1970, month ?? 1, 0)).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7;

    const cells: ({ day: number; dayKey: string } | null)[] = [
      ...Array.from({ length: lead }, () => null),
      ...Array.from({ length: days }, (_, i) => ({
        day: i + 1,
        dayKey: `${this.pickerMonth()}-${String(i + 1).padStart(2, '0')}`,
      })),
    ];
    while (cells.length % 7 !== 0) cells.push(null);

    const weeks: (typeof cells)[] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  });

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

  protected pickDay(dayKey: string): void {
    this.store.goToDay(dayKey);
    this.datePickerOpen.set(false);
    this._pickerMonth.set(null);

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
    { id: 'agenda', icon: 'calendar.viewAgenda' },
    { id: 'day', icon: 'calendar.viewDay' },
    { id: 'three-day', icon: 'calendar.viewThreeDay' },
    { id: 'week', icon: 'calendar.viewWeek' },
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
  protected readonly openPicker = signal<'view' | 'scope' | null>(null);

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

  protected readonly isGrid = computed(() => this.store.view() !== 'agenda');

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
    const nowMs = this.nowMs();
    const cells = this.store.dayCells();
    const today = this.store.todayKey();

    if (this.store.view() === 'day') {
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
        detail: null,
        dayNumber: null,
        // Barber columns all sit on the anchor day, so they are "today"
        // together — which is what tells the grid whether to draw the
        // now-line at all.
        isToday: this.store.dayKey() === today,
        avatarSrc:
          this.scopeOptions().find((option) => option.id === lane.barberId)
            ?.avatarSrc ?? null,
        events: this.eventsFor(lane, nowMs, false),
        // THIS chair's hours, not the shop's. Two barbers on different
        // shifts is the normal case, and shading both columns to the widest
        // of the two would say the early one is working at 20:00.
        open: this.openWindowsOf([lane]),
      }));
    }

    return cells.map((cell) => ({
      id: cell.dayKey,
      title: this.weekdayLabel(cell.dayKey),
      detail: null,
      dayNumber: Number(cell.dayKey.slice(8, 10)),
      isToday: cell.dayKey === today,
      avatarSrc: null,
      events: cell.lanes
        .filter((lane) => lane.rostered.length > 0 || lane.appointments.length)
        .flatMap((lane) =>
          // Gaps are omitted once chairs are merged into one date column:
          // Ivan's free 14:00 is not the shop's free 14:00, and drawing both
          // as holes in the same column would state something untrue.
          this.eventsFor(lane, nowMs, this.store.scope() === null),
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
   * Merged rather than concatenated: overlapping shifts would otherwise carve
   * a phantom "closed" sliver between two barbers who are both at work, and
   * the runs are computed by walking the list in order.
   */
  private openWindowsOf(
    lanes: readonly BarberDayLane[],
  ): readonly OpenWindow[] {
    const raw = lanes
      // Rostered time AND the time carved out of it — together they are the
      // day the barber is AT WORK, which is what the shading is answering.
      //
      // `rostered` alone is post-carve, so a blocked hour was shaded closed
      // AND drawn as a block on top of it: the same span said twice, in two
      // vocabularies, one of which meant "the shop is shut". Shading now says
      // only "not working"; a block says "working, but taken".
      .flatMap((lane) => [...lane.rostered, ...lane.blocks])
      .map((interval) => ({
        startMinute: shopMinuteOfDay(interval.startMs),
        // Anchored, so a shift that closes at midnight reads 1440 rather than
        // wrapping to 0 and inverting the window.
        endMinute: this.minuteOfDay(interval.endMs, interval.startMs),
      }))
      .filter((window) => window.endMinute > window.startMinute)
      .sort((a, b) => a.startMinute - b.startMinute);

    const merged: OpenWindow[] = [];
    for (const window of raw) {
      const last = merged[merged.length - 1];
      if (last && window.startMinute <= last.endMinute) {
        merged[merged.length - 1] = {
          startMinute: last.startMinute,
          endMinute: Math.max(last.endMinute, window.endMinute),
        };
      } else {
        merged.push(window);
      }
    }
    return merged;
  }

  /** Tapping a block in the grid opens the row it stands for. */
  protected openVisit(appointmentId: string): void {
    const row = this.lanes()
      .flatMap((lane) => lane.entries)
      .find(
        (entry): entry is DayRowVm =>
          entry.kind === 'visit' && entry.id === appointmentId,
      );
    // The visit SHEET, not the row popover this used to open — that surface
    // was removed with the row's overflow, so a tap on a calendar block had
    // quietly become a no-op.
    if (row) this.openVisitSheet(row);
  }

  /**
   * Tapping a hole is the walk-in entry point (plan item C4).
   *
   * The notice stays here even though the FAB's version of it went, and the
   * two cases are not the same: a FAB ADVERTISES creation as the surface's
   * primary act, while a tap into empty space is someone probing for what is
   * there. Answering the probe honestly is information; advertising an act
   * the app cannot perform is a promise it breaks.
   */
  protected openGap(_gapId: string): void {
    this.pendingAction.set('booking');
  }

  /** Which not-yet-built action was asked for — drives the honest notice. */
  protected readonly pendingAction = signal<'booking' | 'waitlist' | null>(
    null,
  );

  /**
   * The zone abbreviation every time on this surface is stated in — "EEST"
   * in summer, "EET" in winter, resolved rather than hardcoded so it stays
   * true across the changeover.
   */
  protected readonly zoneLabel = computed(
    () =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: SHOP_ZONE,
        timeZoneName: 'short',
      })
        .formatToParts(new Date(this.nowMs()))
        .find((part) => part.type === 'timeZoneName')?.value ?? SHOP_ZONE,
  );

  /**
   * What is true of a WHOLE column and has no hour to sit at.
   *
   * Today that is one thing: a barber not rostered. It is real content — a
   * date column showing four chairs must say the fifth is off, or the shop
   * reads an empty column as "free" rather than "away".
   */
  protected readonly allDay = computed<Record<string, readonly string[]>>(
    () => {
      const out: Record<string, string[]> = {};

      // In the day view a column IS a barber, so the chip names the fact rather
      // than the person — the column head above it is already the name. The
      // shading says "nothing can happen here"; this says WHY, which shading
      // alone cannot, and which is the only form a screen reader can read.
      if (this.store.view() === 'day') {
        const cell = this.store
          .dayCells()
          .find((entry) => entry.dayKey === this.store.dayKey());
        for (const lane of cell?.lanes ?? []) {
          if (lane.rostered.length === 0) {
            out[lane.barberId] = [
              this.transloco.translate('staff.day.offBadge'),
            ];
          }
        }
        return out;
      }

      for (const cell of this.store.dayCells()) {
        const off = cell.lanes
          .filter((lane) => lane.rostered.length === 0)
          .map((lane) =>
            this.transloco.translate('staff.day.offChip', {
              name: this.barberNameOf(lane.barberId),
            }),
          );
        if (off.length > 0) out[cell.dayKey] = off;
      }
      return out;
    },
  );

  /**
   * The zone is DISPLAY-ONLY and single-valued today: the product is
   * Europe/Sofia (blueprint §7.1), so there is nothing to switch TO. Saying
   * so plainly beats a picker with one entry pretending otherwise.
   */
  protected explainZone(): void {
    this.zoneNoticeOpen.set(true);
  }

  protected readonly zoneNoticeOpen = signal(false);

  /** The now-line belongs to one column in the date-columned views. */
  protected readonly nowColumnId = computed(() =>
    this.store.view() === 'day' ? null : this.store.todayKey(),
  );

  private eventsFor(
    lane: BarberDayLane,
    nowMs: number,
    attribute: boolean,
  ): readonly GridEvent[] {
    const visits = lane.appointments.flatMap((appointment) => {
      const row = this.toRow(appointment, lane.barberId, nowMs);
      return [
        {
          id: row.id,
          kind: 'visit' as const,
          startMinute: this.minuteOfDay(row.startMs),
          endMinute: this.minuteOfDay(row.endMs, row.startMs),
          title: row.clientLabel,
          detail: row.serviceLabel,
          attribution: attribute ? this.barberNameOf(lane.barberId) : null,
          status: row.status,
          terminal: row.terminal,
          barberTone: this.toneOf(lane.barberId),
          // The hour, not the outcome: whatever became of it, a 10:00 slot is
          // behind us by noon. Same rule the search sheet sorts by.
          past: row.endMs <= nowMs,
          accessibleName: this.blockName(row, lane.barberId),
          statusIcon: STATUS_ICONS[row.status] ?? null,
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
    return [...visits, ...this.blocksFor(lane, nowMs, attribute)];
  }

  /** A lane's breaks and admin hours, as blocks the grid can draw. */
  private blocksFor(
    lane: BarberDayLane,
    nowMs: number,
    attribute: boolean,
  ): readonly GridEvent[] {
    const label = this.transloco.translate('staff.day.blockedLabel');
    return lane.blocks.map((interval) => {
      const from = shopClock(interval.startMs);
      const to = shopClock(interval.endMs);
      return {
        // Stable across a re-render, and unique per lane: a barber's day
        // holds at most one exception document, so start plus chair names
        // this block uniquely without inventing an id the store cannot
        // resolve back to anything.
        id: `block:${lane.barberId}:${interval.startMs}`,
        kind: 'block' as const,
        startMinute: this.minuteOfDay(interval.startMs),
        endMinute: this.minuteOfDay(interval.endMs, interval.startMs),
        title: label,
        detail: null,
        // A carve-out is the opposite of a booking; identity is not its
        // business, and the rail stays neutral (the grid's own ruling).
        barberTone: null,
        attribution: attribute ? this.barberNameOf(lane.barberId) : null,
        status: null,
        terminal: false,
        past: interval.endMs <= nowMs,
        // Says WHAT it is and WHEN — the channel the shading never had.
        accessibleName: `${label}, ${from}–${to}`,
        statusIcon: 'booking.blocked' as const,
      };
    });
  }

  /**
   * Wall-clock minutes from midnight, in SHOP time.
   *
   * `anchorMs` lets an end that crossed midnight keep growing past 1440
   * instead of wrapping to a start-of-day value and inverting the block —
   * a 23:30 cut that ends at 00:15 is 1410 → 1455, not 1410 → 15.
   */
  private minuteOfDay(ms: number, anchorMs?: number): number {
    const minute = shopMinuteOfDay(ms);
    if (anchorMs === undefined) return minute;
    const anchor = shopMinuteOfDay(anchorMs);
    return minute < anchor ? minute + 1440 : minute;
  }

  /**
   * The first working minute across every visible day — where the grid
   * SCROLLS TO on a day with no now-line to anchor on.
   *
   * Not an extent any more: each column carries its own hours (see
   * `openWindowsOf`) and the axis is the whole day regardless. Only the start
   * survives, because only the start answers "where should this open".
   */
  protected readonly rosterExtent = computed(() => {
    const windows = this.store
      .dayCells()
      .flatMap((cell) => cell.lanes)
      .flatMap((lane) => lane.rostered);
    if (windows.length === 0) return { start: null };
    return {
      start: Math.min(...windows.map((w) => shopMinuteOfDay(w.startMs))),
    };
  });

  /** Now, as minutes from midnight — the grid's own axis. */
  protected readonly nowMinute = computed(() => shopMinuteOfDay(this.nowMs()));

  /**
   * The block's story in words — client, service, span, and the state.
   *
   * The visual block drops its service line when it is short and says its
   * state only in form and a glyph; none of that reaches a screen reader, so
   * the whole fact is composed here.
   */
  private blockName(row: DayRowVm, barberId: string): string {
    return [
      row.clientLabel,
      row.serviceLabel,
      `${row.startLabel}–${row.endLabel}`,
      this.barberNameOf(barberId),
      this.transloco.translate(`appointments.status.${row.status}`),
    ].join(', ');
  }

  /**
   * What this lane's seats come to, as one figure.
   *
   * `Money.add` returns a Result because two currencies cannot be summed —
   * a failure means the party is mixed-currency, and the honest answer there
   * is no number at all rather than a wrong one.
   */
  private seatsPrice(seats: readonly Seat[]): string | null {
    const first = seats[0];
    if (!first) return null;
    let total: Money = first.terms.price;
    for (const seat of seats.slice(1)) {
      const sum = total.add(seat.terms.price);
      if (sum.isFailure()) return null;
      total = sum.value;
    }
    return formatMoney(total, this.transloco.getActiveLang());
  }

  private barberNameOf(barberId: string): string {
    const barber = this.catalog
      .barbers()
      .find((entry) => entry.id.value === barberId);
    return barber ? this.content.text(barber.name) : barberId;
  }

  private weekdayLabel(dayKey: string): string {
    return abbreviateWeekday(
      this.formatDay(dayKey, { weekday: 'long' }),
      this.content.locale(),
    );
  }

  private formatDay(dayKey: string, options: Intl.DateTimeFormatOptions) {
    const [year, month, day] = dayKey.split('-').map(Number);
    return this.formatTitled(
      new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)),
      options,
    );
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
  private formatTitled(at: Date, options: Intl.DateTimeFormatOptions): string {
    const locale = this.content.locale();
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' })
      .formatToParts(at)
      .map((part) =>
        part.type === 'month'
          ? part.value.charAt(0).toLocaleUpperCase(locale) + part.value.slice(1)
          : part.value,
      )
      .join('');
  }

  /**
   * "7 август" for a day, "7 – 9 август" for a span inside one month,
   * "30 юли – 5 август" across a boundary.
   *
   * Full month name, no weekday: the label is a heading, and the weekday is
   * already on every column beneath it.
   */
  protected readonly periodLabel = computed(() => {
    const days = this.store.visibleDays();
    const first = days[0] as string;
    if (days.length <= 1) {
      return this.formatDay(first, { day: 'numeric', month: 'long' });
    }
    const last = days[days.length - 1] as string;
    const sameMonth = first.slice(0, 7) === last.slice(0, 7);
    return sameMonth
      ? `${this.formatDay(first, { day: 'numeric' })} – ${this.formatDay(last, { day: 'numeric', month: 'long' })}`
      : `${this.formatDay(first, { day: 'numeric', month: 'long' })} – ${this.formatDay(last, { day: 'numeric', month: 'long' })}`;
  });

  /** "сряда, 5 август" — the header's whole answer. */
  protected readonly dayLabel = computed(() => {
    const [year, month, day] = this.store.dayKey().split('-').map(Number);
    return new Intl.DateTimeFormat(this.content.locale(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)));
  });

  /**
   * Every barber's identity tone, assigned once for the whole catalogue.
   *
   * Keyed off the CATALOGUE rather than the day's lanes on purpose: a
   * barber's colour must not change because they happen to be off on
   * Tuesday, and the calendar views read the same map.
   */
  protected readonly barberTones = computed(() =>
    assignBarberTones(this.catalog.barberVms().map((vm) => vm.id)),
  );

  private toneOf(barberId: string): number {
    return this.barberTones().get(barberId) ?? 0;
  }

  protected readonly lanes = computed<readonly LaneVm[]>(() => {
    const vmById = new Map(
      this.catalog.barberVms().map((vm) => [vm.id, vm] as const),
    );
    const nowMs = this.nowMs();

    return this.store.workingLanes().map((lane) => {
      const vm = vmById.get(lane.barberId);

      const visits = lane.appointments.map((appointment) =>
        this.toRow(appointment, lane.barberId, nowMs),
      );
      const barberName = vm ? this.content.text(vm.name) : lane.barberId;
      const gaps: GapRowVm[] = lane.gaps.map((gap) => ({
        kind: 'gap' as const,
        // The BARBER in the id: two chairs free from 14:00 are two different
        // holes, and a shared key would collapse them in the agenda's track.
        // The START too, since one hole now splits into two at the clock.
        id: `gap-${lane.barberId}-${gap.startMs}`,
        startLabel: this.time(gap.startMs),
        endLabel: this.time(gap.endMs),
        minutes: gap.minutes,
        startMs: gap.startMs,
        past: !gap.sellable,
        sellable: gap.sellable,
        barberName,
        barberAvatarSrc: vm?.avatarSrc ?? null,
        barberTone: this.toneOf(lane.barberId),
      }));

      // One run in clock order. A gap and a visit never share a start, so the
      // sort is total without a tiebreak.
      const clockOrder: RunEntryVm[] = [...visits, ...gaps].sort(
        (a, b) => a.startMs - b.startMs,
      );

      // ── The present tense ──────────────────────────────────────────────
      //
      // The run had none: nothing separated a cut finished at ten from one
      // three hours out, and the screen opened at 09:00 on a day already
      // half over. The chair's next unstarted visit is the row the eye
      // should find first; the NOW hairline is where the day actually is.
      const next = visits.find((row) => !row.terminal && row.startMs > nowMs);
      const entries: RunEntryVm[] = clockOrder.map((entry) =>
        entry.kind === 'visit' && entry.id === next?.id
          ? { ...entry, isNext: true }
          : entry,
      );

      const extent = lane.rostered;
      const extentLabel =
        extent.length > 0
          ? `${this.time(extent[0]?.startMs ?? 0)}–${this.time(
              extent.at(-1)?.endMs ?? 0,
            )}`
          : null;

      return {
        barberId: lane.barberId,
        barberName,
        avatarSrc: vm?.avatarSrc ?? null,
        entries,
        extentLabel,
        visitCount: visits.filter((row) => row.status !== 'cancelled').length,
        rostered: extent.length > 0,
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
    const nowMs = this.nowMs();

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
    const freeTime = this.fields.isOn('freeTime');
    const items = this.lanes()
      .flatMap((lane) => lane.entries)
      .filter((entry) => {
        if (entry.kind !== 'gap') return true;
        // Holes are a SECOND question — off unless someone is asking it.
        if (!freeTime) return false;
        return !(wholeShop && !entry.sellable);
      });

    const byStart = new Map<number, RunEntryVm[]>();
    for (const item of items) {
      // Minute resolution: two seats that begin 20 seconds apart begin at the
      // same time as far as a person reading a schedule is concerned.
      const minute = Math.floor(item.startMs / 60_000) * 60_000;
      const bucket = byStart.get(minute);
      if (bucket) bucket.push(item);
      else byStart.set(minute, [item]);
    }

    return [...byStart.entries()]
      .sort(([a], [b]) => a - b)
      .map(([startMs, group]) => ({
        key: String(startMs),
        timeLabel: this.time(startMs),
        startMs,
        past: startMs < nowMs,
        // Visits before gaps at the same minute — what is booked outranks
        // what is merely available, and a stable order stops cards jumping
        // as the store ticks.
        items: [...group].sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === 'visit' ? -1 : 1;
          return a.kind === 'visit' && b.kind === 'visit'
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
    const at = groups.findIndex((group) => group.startMs >= this.nowMs());
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
   * turns over, and the two formatters are built once for the whole strip
   * instead of once per cell.
   */
  private readonly weekCalendar = computed(() => {
    const today = this.store.todayKey();
    const locale = this.content.locale();
    const asInitial = new Intl.DateTimeFormat(locale, {
      weekday: 'narrow',
      timeZone: 'UTC',
    });
    const asNumber = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      timeZone: 'UTC',
    });
    const first = addDays(startOfWeek(today), -StaffDashboard.WEEKS_BACK * 7);
    const weeks = StaffDashboard.WEEKS_BACK + StaffDashboard.WEEKS_AHEAD + 1;

    return Array.from({ length: weeks }, (_, w) => {
      const weekStart = addDays(first, w * 7);
      return {
        key: weekStart,
        days: Array.from({ length: 7 }, (_, d) => {
          const key = addDays(weekStart, d);
          const at = new Date(`${key}T12:00:00Z`);
          return {
            key,
            // The weekday INITIAL, Apple's own strip: the column position
            // already says which day it is, so the letter is a reminder and
            // not a label.
            initial: asInitial.format(at),
            number: asNumber.format(at),
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
  protected readonly selectedWeek = computed(() =>
    startOfWeek(this.store.dayKey()),
  );

  /**
   * Keep the strip on the shown day's week.
   *
   * Only when the day moves to a DIFFERENT week — tapping a day inside the
   * visible week must not re-scroll under the thumb that just tapped it.
   * `scrollIntoView` on the week element rather than a computed offset: the
   * browser already knows where its own snap points are.
   */
  private readonly strippedWeek = signal<string | null>(null);

  protected readonly followWeek = effect(() => {
    const week = this.selectedWeek();
    if (untracked(() => this.strippedWeek()) === week) return;
    this.strippedWeek.set(week);
    const first = untracked(() => this.weekCalendar())[0]?.key ?? week;
    const index = Math.round(
      (Date.parse(`${week}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) /
        (7 * 86_400_000),
    );
    afterNextRender(() => this.settleOnWeek(index, ANCHOR_FRAMES), {
      injector: this.injector,
    });
  });

  protected readonly nowLabel = computed(() => this.time(this.nowMs()));

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

    let freeMinutes = 0;
    for (const lane of lanes) {
      for (const entry of lane.entries) {
        if (entry.kind === 'gap') freeMinutes += entry.minutes;
      }
    }
    if (freeMinutes === 0) return null;
    return this.transloco.translate('staff.day.daySummaryFree', {
      span: this.span(freeMinutes),
    });
  });

  /**
   * "in 20 minutes" / "tomorrow", for the relative-time field.
   *
   * Reads `nowMs` so it re-renders with the store's clock rather than going
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
  protected whenLabel(entry: DayRowVm): string {
    const lang = this.transloco.getActiveLang();
    if (entry.live) {
      const minutes = Math.max(
        0,
        Math.round((entry.endMs - this.nowMs()) / 60_000),
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
    return relativeTime(entry.startMs, this.nowMs(), lang, 'short');
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
  protected statusWord(status: AppointmentStatusKind): string | null {
    if (status === 'confirmed' || status === 'completed') return null;
    return this.transloco.translate('staff.day.exception.' + status);
  }

  protected statusTone(status: AppointmentStatusKind): UiBadgeTone {
    // eslint-disable-next-line security/detect-object-injection -- closed union.
    return STATUS_TONES[status];
  }

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
    return this.statusWord(entry.status);
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
    if (entry.status === 'cancelled') icons.push('visit.cancelled');
    if (entry.status === 'no_show') icons.push('visit.noShow');
    if (entry.rebooked) icons.push('visit.repeat');
    // The note is a MARK, not a row. Its text was a clamped line in the fact
    // column — the one fact there that could not be read in full, sitting in
    // a column whose whole premise is that everything gets its place. A mark
    // says "there is one" honestly; the sheet says what it is.
    if (this.fields.isOn('note') && entry.hasNote) icons.push('visit.note');
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
      (this.fields.isOn('price') && !!entry.priceLabel) ||
      this.rowIcons(entry).length > 0 ||
      this.fields.isOn('barberAvatar')
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
  private barberAvatarOf(barberId: string): string | null {
    return (
      this.catalog.barberVms().find((vm) => vm.id === barberId)?.avatarSrc ??
      null
    );
  }

  /**
   * The calendar day a millisecond falls on, in SHOP time.
   *
   * `en-CA` because it formats as `YYYY-MM-DD`, which compares as a string —
   * the cheapest correct way to ask "same day?" across a DST boundary.
   */
  private dayOf(millis: number): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: SHOP_ZONE }).format(
      new Date(millis),
    );
  }

  /** Wall-clock, in SHOP time — never the reader's device zone. */
  private time(millis: number): string {
    return new Intl.DateTimeFormat(this.content.locale(), {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: SHOP_ZONE,
    }).format(new Date(millis));
  }

  /**
   * One lane's view of one appointment.
   *
   * Only THIS chair's seats: a two-barber party appears in both lanes, each
   * lane naming its own work.
   */
  private toRow(
    appointment: Appointment,
    barberId: string,
    nowMs: number,
  ): DayRowVm {
    const seats = appointment.seats.filter(
      (seat) => seat.barberId.value === barberId,
    );
    const start = seats[0]?.slot.start ?? appointment.timeSlot.start;
    const end = seats.at(-1)?.slot.end ?? appointment.timeSlot.end;

    const serviceLabel = seats
      .map((seat) => {
        const service = this.catalog.findService(seat.serviceId.value);
        return service
          ? this.content.text({ en: service.name.en, bg: service.name.bg })
          : seat.serviceId.value;
      })
      .join(' + ');

    const contact = appointment.contact;
    const anonymousSeat = seats.find(
      (seat) => seat.subject.kind === 'anonymous',
    );
    const anonymousLabel =
      anonymousSeat?.subject.kind === 'anonymous'
        ? anonymousSeat.subject.label.value
        : undefined;
    const clientLabel: string =
      contact?.name ??
      anonymousLabel ??
      this.transloco.translate('staff.day.unnamedClient');

    const status = appointment.status.kind;
    const startMs = start.toMillis();
    const endMs = end.toMillis();
    const legal = OFFERED.filter((to) => canTransition(appointment.status, to));
    const arrived = appointment.arrivedAt !== null;
    const primary = primaryVerb(status, legal, arrived);
    const seatCount = appointment.seats.length;
    const partyLabel = seatCount > 1 ? `${seats.length} / ${seatCount}` : null;

    return {
      kind: 'visit',
      id: appointment.id.value,
      seatId: seats[0]?.id.value ?? '',
      arrived,
      endMs,
      partySize: seatCount,
      seatsHere: seats.length,
      startMs,
      startLabel: this.time(startMs),
      endLabel: this.time(endMs),
      durationMinutes: Math.max(0, Math.round((endMs - startMs) / 60_000)),
      priceLabel: this.seatsPrice(seats),
      barberName: this.barberNameOf(barberId),
      barberAvatarSrc: this.barberAvatarOf(barberId),
      barberTone: this.toneOf(barberId),
      past: endMs <= nowMs,
      live: startMs <= nowMs && nowMs < endMs && !isTerminalStatus(status),
      // Set by the lane, which is the only scope that can know which visit is
      // FIRST — a row cannot see its siblings.
      isNext: false,
      // The seat's own start day owns the row, so a run past midnight is a
      // LABEL problem, not a lane problem — mark it rather than move it.
      crossesMidnight: this.dayOf(endMs) !== this.dayOf(startMs),
      serviceLabel,
      clientLabel,
      phone: contact?.phone.formatInternational() ?? null,
      phoneHref: contact?.phone.value ?? null,
      email: contact?.email?.value ?? null,
      rebooked: appointment.bookedFrom !== null,
      // The note's EXISTENCE is a row signal; its prose belongs in the sheet.
      hasNote: (contact?.note?.trim().length ?? 0) > 0,
      note: contact?.note?.trim() || null,
      partyLabel,
      legs: seats.map((seat) => {
        const service = this.catalog.findService(seat.serviceId.value);
        const seatBarberId = seat.barberId.value;
        return {
          seatId: seat.id.value,
          serviceLabel: service
            ? this.content.text({ en: service.name.en, bg: service.name.bg })
            : seat.serviceId.value,
          minutes: seat.terms.durationMinutes,
          priceLabel: this.seatsPrice([seat]),
          barberId: seatBarberId,
          barberName: this.barberNameOf(seatBarberId),
          barberTone: this.toneOf(seatBarberId),
        };
      }),
      status,
      primary,
      overflow: legal.filter((verb) => verb !== primary),
      terminal:
        status === 'completed' ||
        status === 'cancelled' ||
        status === 'no_show',
    };
  }

  /**
   * The WORD for a verb. Reopening a no-show is not "confirm" — it is undoing
   * a judgement, and it says so.
   */
  protected verbKey(status: AppointmentStatusKind, verb: RowVerb): string {
    if (verb === 'confirmed' && status === 'no_show') {
      return 'staff.day.act.reopen';
    }
    return 'staff.day.act.' + verb;
  }

  /**
   * Perform a verb. Cancelling opens the reason sheet rather than firing —
   * a destructive act on someone's booking asks why first.
   */
  protected async act(row: DayRowVm, to: RowVerb): Promise<void> {
    this.openMenuId.set(null);
    if (to === 'arrived') {
      await this.store.markArrived(row.id);
      this.restoreFocusToRow(row.id);
      return;
    }
    if (to === 'cancelled') {
      this.cancelId.set(row.id);
      this.cancelSeatId.set(row.partySize > 1 ? row.seatId : null);
      this.cancelReasonCode.set(null);
      this.cancelNote.set('');
      return;
    }
    if (to === 'confirmed' || to === 'completed' || to === 'no_show') {
      await this.store.transition({
        appointmentId: row.id,
        to,
        ...(row.partySize > 1 && to !== 'confirmed'
          ? { seatId: row.seatId }
          : {}),
      });
      this.restoreFocusToRow(row.id);
    }
  }

  /**
   * The visit the sheet is showing, or `null`.
   *
   * Held by ID rather than by value, so the sheet re-reads the row on every
   * store tick: acting from inside it must redraw the verbs it is offering,
   * not go stale against the day it came from.
   */
  protected readonly visitSheetId = signal<string | null>(null);

  protected readonly visitSheetRow = computed<DayRowVm | null>(() => {
    const id = this.visitSheetId();
    if (id === null) return null;
    for (const lane of this.lanes()) {
      for (const entry of lane.entries) {
        if (entry.kind === 'visit' && entry.id === id) return entry;
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

    // The agenda lane holds the neighbours; the STORE lane holds the roster
    // windows. `LaneVm.rostered` is a boolean — "does this chair work today" —
    // and the intervals it is named after live one layer down.
    const lane = this.lanes().find((entry) =>
      entry.entries.some((e) => e.kind === 'visit' && e.id === row.id),
    );
    const neighbours = (lane?.entries ?? [])
      .filter(
        (entry): entry is DayRowVm =>
          entry.kind === 'visit' && entry.id !== row.id,
      )
      .map((entry) => ({
        name: entry.clientLabel,
        startMinute: shopMinuteOfDay(entry.startMs),
        endMinute: shopMinuteOfDay(entry.endMs),
        tone: entry.barberTone,
      }));

    const storeLane = this.store
      .lanes()
      .find((entry) => entry.barberId === lane?.barberId);
    const rostered = (storeLane?.rostered ?? []).map((window) => ({
      start: shopMinuteOfDay(window.startMs),
      end: shopMinuteOfDay(window.endMs),
    }));

    return {
      appointmentId: row.id,
      dayKey: this.store.dayKey(),
      dayLabel: this.dayPillLabel(),
      startMinute: shopMinuteOfDay(row.startMs),
      endMinute: shopMinuteOfDay(row.endMs),
      legs: row.legs,
      clientLabel: row.clientLabel,
      phone: row.phone,
      phoneHref: row.phoneHref,
      // `rebooked` is the one durable fact the shop holds about a person here:
      // a client who came back. Anything richer needs a history read the sheet
      // does not have, so it says the true thing or nothing.
      clientMeta: row.rebooked
        ? this.transloco.translate('staff.visit.clientReturning')
        : null,
      note: row.note,
      priceLabel: row.priceLabel,
      status: row.status,
      statusLabel: this.transloco.translate(
        'appointments.status.' + row.status,
      ),
      chairName: row.barberName,
      chairTone: row.barberTone,
      neighbours,
      rosterStartMinute: rostered.length
        ? Math.min(...rostered.map((w) => w.start))
        : 0,
      rosterEndMinute: rostered.length
        ? Math.max(...rostered.map((w) => w.end))
        : 24 * 60,
      nowMinute: this.store.isToday() ? this.nowMinute() : null,
      // Regime A, carried through unchanged. `canTransition` already decided
      // what is legal and `primaryVerb` already decided what leads; the editor
      // renders that decision rather than re-taking it.
      primaryVerb: row.primary ? this.toEditorVerb(row, row.primary) : null,
      overflowVerbs: row.overflow.map((verb) => this.toEditorVerb(row, verb)),
      acting: this.store.isPending(row.id),
    };
  });

  private toEditorVerb(row: DayRowVm, verb: RowVerb): VisitEditorVerb {
    return {
      kind: verb,
      label: this.transloco.translate(this.verbKey(row.status, verb)),
      // `no_show` is as terminal as a cancellation and just as hard to undo by
      // hand, so it wears the same warning as the act that opens a reason
      // sheet. Only the CANCEL path actually asks a question first.
      destructive: verb === 'cancelled' || verb === 'no_show',
    };
  }

  /** `вт, 26 авг` — the date as the pill wears it. */
  private dayPillLabel(): string {
    const parts = this.store.dayKey().split('-').map(Number);
    const [year = 1970, month = 1, day = 1] = parts;
    return new Intl.DateTimeFormat(this.transloco.getActiveLang(), {
      weekday: 'short',
      day: 'numeric',
      // ⚠ `long`: Bulgarian renders a `short` month NUMERICALLY, so this
      // label promised a month name and printed `ср, 26.08`. It feeds the
      // visit sheet's date pill and nothing else.
      month: 'long',
      // UTC throughout: the key is a wall-clock date with no instant behind
      // it, and letting the host zone interpret it moves the label a day west
      // of Sofia every evening.
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month - 1, day)));
  }

  protected openVisitSheet(row: DayRowVm): void {
    this.presentOnly();
    this.visitSheetId.set(row.id);
  }

  protected closeVisitSheet(): void {
    const id = this.visitSheetId();
    this.visitSheetId.set(null);
    // Back to the row that opened it, or a keyboard user lands on <body>.
    if (id !== null) this.restoreFocusToRow(id);
  }

  /**
   * Act from inside the sheet.
   *
   * Terminal acts close it — the record they described is settled and the
   * sheet would be offering verbs that no longer exist. Everything else
   * keeps it open, so "arrived" then "done" is two taps in one place.
   */
  protected async actFromSheet(row: DayRowVm, to: RowVerb): Promise<void> {
    if (to === 'cancelled' || to === 'no_show') {
      this.visitSheetId.set(null);
    }
    await this.act(row, to);
  }

  /**
   * The editor's `(acted)`, resolved back to the row it belongs to.
   *
   * The editor is handed a flat view model and emits a verb string; it has no
   * `DayRowVm` and must not need one. Resolving the row here keeps the party
   * arithmetic — which seat a terminal act settles — in the one place that
   * already knows it.
   */
  protected async actFromEditor(
    appointmentId: string,
    to: string,
  ): Promise<void> {
    const row = this.visitSheetRow();
    if (row === null || row.id !== appointmentId) return;
    await this.actFromSheet(row, to as RowVerb);
  }

  /**
   * The editor's finished gesture, turned into a server command.
   *
   * The editor speaks in minutes-from-midnight because it knows the day only
   * as a key; the instant is built HERE, where the shop's zone lives. That
   * split is deliberate — an editor that invented a timezone would be wrong in
   * one shop out of every two.
   */
  protected async commitFromEditor(
    appointmentId: string,
    commit: VisitEditorCommit,
  ): Promise<void> {
    const dayKey = this.store.dayKey();
    const minute =
      commit.kind === 'move'
        ? commit.startMinute
        : commit.edge === 'start'
          ? commit.startMinute
          : commit.endMinute;
    const iso = shopInstantIso(dayKey, minute);
    if (iso === null) return;

    await this.store.staffEdit({
      appointmentId,
      command:
        commit.kind === 'move'
          ? { kind: 'move', startIso: iso }
          : { kind: 'resize', edge: commit.edge, atIso: iso },
    });
  }

  protected readonly cancelId = signal<string | null>(null);
  protected readonly cancelSeatId = signal<string | null>(null);
  protected readonly cancelReasonCode = signal<CancellationReasonKind | null>(
    null,
  );
  protected readonly cancelNote = signal('');

  /** The codes a human may pick — the domain's list, not a local copy. */
  protected readonly reasonCodes = OFFERED_CANCELLATION_REASONS;

  /** `other` is the only arm that carries a note, and it requires one. */
  protected readonly cancelReady = computed(() => {
    const code = this.cancelReasonCode();
    if (code === null) return false;
    return code !== 'other' || this.cancelNote().trim().length > 0;
  });

  protected async confirmCancel(): Promise<void> {
    const appointmentId = this.cancelId();
    const reasonCode = this.cancelReasonCode();
    if (!appointmentId || reasonCode === null || !this.cancelReady()) return;
    const seatId = this.cancelSeatId();
    const done = await this.store.transition({
      appointmentId,
      to: 'cancelled',
      reasonCode,
      ...(reasonCode === 'other' ? { note: this.cancelNote().trim() } : {}),
      ...(seatId ? { seatId } : {}),
    });
    if (done) this.cancelId.set(null);
  }

  // ── Blocking time ───────────────────────────────────────────────────

  /** The lane whose absence sheet is open, or `null`. */
  protected readonly blockLaneId = signal<string | null>(null);
  protected readonly blockAllDay = signal(false);
  protected readonly blockFrom = signal('12:00');
  protected readonly blockTo = signal('13:00');

  /**
   * Arms the day-wide lift, because `clearBlock` is not a surgical undo.
   *
   * The port deletes the barber's WHOLE exception document for the date —
   * every block and the all-day absence together — so a manager lifting one
   * 30-minute break also un-books the sick day. It fired from a single
   * unconfirmed tap. Two taps now, with the second one naming what goes.
   */
  protected readonly blockLiftArmed = signal(false);

  protected readonly blockLaneName = computed(() => {
    const id = this.blockLaneId();
    return this.lanes().find((lane) => lane.barberId === id)?.barberName ?? '';
  });

  /**
   * Every chair the sheet can aim at.
   *
   * The shop-wide "block time" action pre-aimed at `lanes()[0]` and the sheet
   * had no way to move it — the code comment promised "the sheet's own picker
   * moves it" and that picker was never built, so Niko tapping the FAB stood
   * Ivan's chair down. This is that picker.
   */
  protected readonly blockLaneOptions = computed(() =>
    this.lanes().map((lane) => ({
      id: lane.barberId,
      name: lane.barberName,
      avatarSrc: lane.avatarSrc,
      tone: this.toneOf(lane.barberId),
    })),
  );

  protected closeBlockSheet(): void {
    this.blockLiftArmed.set(false);
    this.blockLaneId.set(null);
  }

  protected pickBlockLane(barberId: string): void {
    // Re-aiming invalidates a lift that was armed for the previous chair.
    this.blockLiftArmed.set(false);
    this.blockLaneId.set(barberId);
  }

  /**
   * The visits this block would sit on top of.
   *
   * Blocking removes sellable time; it does NOT move or cancel what is
   * already booked inside the range, and the sheet used to say only that
   * nobody gets notified — so a 14:00–18:00 block over a 16:00 cut read as
   * harmless. Naming the stranded visits is the honest minimum until a real
   * "move these" path exists (see the plan's E2).
   *
   * Compared in MINUTES OF DAY on both sides, so no zone arithmetic enters:
   * `shopMinuteOfDay` already answers for the visit, and the block's own
   * bounds are wall-clock strings from a `<input type="time">`.
   */
  protected readonly blockCollisions = computed<readonly DayRowVm[]>(() => {
    const id = this.blockLaneId();
    if (id === null) return [];
    const lane = this.lanes().find((entry) => entry.barberId === id);
    if (!lane) return [];
    // A cancelled or no-showed seat is not stranded by anything.
    const live = lane.entries.filter(
      (entry): entry is DayRowVm => entry.kind === 'visit' && !entry.terminal,
    );
    if (this.blockAllDay()) return live;
    if (!this.blockRangeValid()) return [];
    const from = minuteOfClock(this.blockFrom());
    const to = minuteOfClock(this.blockTo());
    if (from === null || to === null) return [];
    return live.filter(
      (visit) =>
        shopMinuteOfDay(visit.startMs) < to &&
        shopMinuteOfDay(visit.endMs) > from,
    );
  });

  /** The range is only meaningful when it is a range, and only if it holds. */
  protected readonly blockRangeValid = computed(() => {
    if (this.blockAllDay()) return true;
    const range = LocalTimeRange.create(this.blockFrom(), this.blockTo());
    return range.isSuccess();
  });

  protected openBlockSheet(barberId: string): void {
    this.presentOnly();
    this.blockLiftArmed.set(false);
    this.blockLaneId.set(barberId);
    this.blockAllDay.set(false);
    this.blockFrom.set('12:00');
    this.blockTo.set('13:00');
  }

  /**
   * Open the rest day for editing — the same sheet, told the truth.
   *
   * The all-day row is a real event, so it has to be actionable like one; a
   * card-shaped thing at a 44px touch target that does nothing when pressed
   * is a worse lie than the footnote it replaced. `openBlockSheet` is the
   * existing path and needs no second copy — only its all-day switch flipped,
   * because this barber IS already off all day and the sheet should open
   * showing that rather than asking from scratch.
   */
  protected openRestDay(barberId: string): void {
    this.openBlockSheet(barberId);
    this.blockAllDay.set(true);
  }

  protected async confirmBlock(): Promise<void> {
    const barberId = this.blockLaneId();
    if (barberId === null) return;

    // The location the chair actually works from. A block written against a
    // location this barber does not serve blocks nothing, silently.
    const locationId = this.catalog
      .barbers()
      .find((barber) => barber.id.value === barberId)?.locationIds[0]?.value;
    if (!locationId) return;

    let ranges: readonly LocalTimeRange[] = [];
    if (!this.blockAllDay()) {
      const range = LocalTimeRange.create(this.blockFrom(), this.blockTo());
      if (range.isFailure()) return;
      ranges = [range.value];
    }

    const done = await this.store.blockTime(barberId, locationId, ranges);
    if (done) this.blockLaneId.set(null);
  }

  protected async liftBlock(barberId: string): Promise<void> {
    this.presentOnly();
    // First tap ARMS. The write deletes the chair's whole day of exceptions
    // and cannot be undone, so it does not happen on the tap that asked for
    // it — the armed button says what it will take with it.
    if (!this.blockLiftArmed()) {
      this.blockLiftArmed.set(true);
      return;
    }
    const done = await this.store.clearBlock(barberId);
    this.blockLiftArmed.set(false);
    if (done) this.blockLaneId.set(null);
  }

  /** Does this chair have anything to lift? Gates the sheet's lift action. */
  protected laneHasBlock(barberId: string): boolean {
    // The STORE's lane, not the view model's — `LaneVm` is the agenda run's
    // shape and carries no block channel.
    const lane = this.store
      .lanes()
      .find((entry) => entry.barberId === barberId);
    return (lane?.blocks.length ?? 0) > 0;
  }

  /**
   * A block was tapped. It opens the sheet that WROTE it, aimed at that chair
   * — the same surface, so adjusting and lifting live where creating does
   * rather than in a second dialog that would have to duplicate the fields.
   */
  protected openBlock(blockId: string): void {
    // `block:<barberId>:<startMs>` — see `blocksFor`.
    const barberId = blockId.split(':')[1];
    if (barberId) this.blockLaneId.set(barberId);
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
  private presentOnly(keep?: 'date' | 'picker' | 'row'): void {
    if (keep !== 'date') this.datePickerOpen.set(false);
    if (keep !== 'picker') this.openPicker.set(null);
    if (keep !== 'row') this.openMenuId.set(null);
  }

  protected toggleMenu(rowId: string): void {
    const opening = this.openMenuId() !== rowId;
    this.presentOnly(opening ? 'row' : undefined);
    this.openMenuId.set(opening ? rowId : null);
  }

  protected toggleDatePicker(): void {
    const opening = !this.datePickerOpen();
    this.presentOnly(opening ? 'date' : undefined);
    this.datePickerOpen.set(opening);
  }

  protected togglePicker(which: 'view' | 'scope'): void {
    const opening = this.openPicker() !== which;
    this.presentOnly(opening ? 'picker' : undefined);
    this.openPicker.set(opening ? which : null);
  }

  /**
   * The refusal renders IN THE ROW that earned it.
   *
   * A page banner puts the sentence three screens away from the tap that
   * caused it on a forty-row day, which is how staff conclude the button is
   * broken rather than learning what the server actually said.
   */
  protected rowError(appointmentId: string): string | null {
    const error = this.store.errorFor(appointmentId);
    return error ? translateDomainError(this.transloco, error) : null;
  }

  /** The cancel sheet's own error, which has no row to live in. */
  protected readonly cancelError = computed(() => {
    const id = this.cancelId();
    if (id === null) return null;
    const error = this.store.errorFor(id);
    return error ? translateDomainError(this.transloco, error) : null;
  });
}
