import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  ViewEncapsulation,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
  viewChild,
  ElementRef,
} from '@angular/core';
import { TranslocoDirective, TranslocoService } from '@jsverse/transloco';
import {
  BarberId,
  LocalDate,
  MinuteOfDay,
  type Result,
  TrackMinute,
  Weekday,
} from '@core/primitives';
import { type SchedulingError } from '@core/errors';
import {
  GridEvent as GridEventTag,
  MonthlyAnchor,
  RecurrenceEnd,
  RecurrenceFrequency,
  RecurrencePattern,
  RecurrenceRule,
  RepeatPreset,
  type ShopNow,
  WeekOfMonth,
} from '@core/components';
import {
  GridLayoutSystem,
  RecurrenceSystem,
  VisitDraftSystem,
} from '@core/systems';
import { pluralForm, translateCodedError } from '@creativo/infrastructure/i18n';
import {
  ClockClosing,
  formatClock,
  formatWallClock,
  formatWeekdayLabels,
} from '@creativo/ui/wall-clock';
import {
  UiChoiceMenu,
  type UiChoiceOption,
  UiAvatar,
  UiButton,
  UiIcon,
  UiSwitch,
  UiTimeField,
  UiUnitField,
  UiWeekdayPicker,
} from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiInteractiveDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UiListGroup,
  UiListRow,
  UiMenuTrigger,
  UiSheetActionBar,
  UiSheetHeadline,
} from '@creativo/ui/patterns';
import {
  StaffDayPill,
  formatDayPill,
  formatDayPillRange,
} from '../day-pill/staff-day-pill';
import { injectFrameFullscreen } from '../shared/frame-fullscreen';
import { SwipeToDeleteDirective } from '../swipe-to-delete/swipe-to-delete.directive';
import { StaffTimeline } from '../timeline/staff-timeline';
import { trackMinuteOf } from '../time-grid/minute-run';
import {
  MONDAY_TO_FRIDAY,
  RECURRENCE_END_WORD,
  RECURRENCE_FREQUENCY_WORD,
  REPEAT_PRESETS,
  REPEAT_PRESET_WORD,
  WEEKDAY_WORD,
  presetOf,
  ruleForCustom,
  ruleForEndKind,
  ruleForFrequency,
  ruleForPreset,
  ruleForStart,
  withCount,
  withInterval,
  withMonthly,
  withUntil,
  withWeekdays,
} from './block-repeat';
import {
  type GridColumn,
  type GridCommit,
  type GridDraft,
  type GridDragCopy,
  type GridEvent,
  type GridWindow,
  StaffTimeGrid,
} from '../time-grid/staff-time-grid';

/* ────────────────────────────────────────────────────────────────────────
 * THE BLOCK EDITOR — the visit sheet's grammar, for time a barber takes
 * OUT of the day (owner review 2026-09-08: one sheet, five natures).
 *
 * THE SAME LADDER, IN THE SAME ORDER (owner, 2026-09-09: "the block sheet
 * should have similar ordering"): the chairs first — several at once, a
 * lunch is the whole shop's — then the typed pair with «Цял ден» and the
 * repeat, then the frame with the block drawn over each chosen chair's
 * real day and its collisions named in red under the picture, the effect
 * line, and the exits. No state strip: the bar names the sheet, the pair
 * says the range. What it is not is the appointment editor with a kind
 * switch bolted on: a block has no legs, no client, no money.
 *
 * It writes a `ScheduleException` — the day's blocks accumulate as ranges
 * (`putRange`), a whole day is `time_off` — through the dashboard, which
 * owns the store. A REPEAT is a `RecurrenceRule` (2026-09-24: "like Apple
 * Calendar, MS Calendar, Google Calendar — which days it occurs, from, to"),
 * edited on its own page; the sheet hands over the DAYS its series selects
 * and the dashboard writes each. The document is per barber-day, so a
 * series is that many documents, and a day lifted later lifts that day
 * alone. This component drafts and draws; it never writes.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * One chair's real day, for the frame: what the block would sit on. Its
 * minutes are the shop day's (a seat's start and end, the roster hull), on
 * the frame's anchored axis.
 */
export interface BlockEditorLane {
  readonly barberId: BarberId;
  readonly neighbours: readonly {
    readonly name: string;
    readonly startMinute: TrackMinute;
    readonly endMinute: TrackMinute;
    readonly tone: number;
  }[];
  readonly rosterStartMinute: TrackMinute;
  readonly rosterEndMinute: TrackMinute;
}

export interface BlockEditorVm {
  /**
   * `null` while creating; otherwise the grid's own block id
   * (`block:<chair>:<day>:<minute>`, or `day:<chair>` for a day off) — an
   * opaque UI key (D-3), what the draft reseeds on, never a stored id.
   */
  readonly blockId: string | null;
  /** The chairs the draft starts with — one, for a saved block. */
  readonly barberIds: readonly BarberId[];
  /** The day the sheet was opened on; the draft may step off it. */
  readonly dayKey: LocalDate;
  /**
   * "Now" on the shop's clock (`StaffDayStore.shopNow`), or `null` before
   * the zone is known — today's day for the calendars, and the now-line
   * whenever the frame draws today.
   */
  readonly now: ShopNow | null;
  readonly allDay: boolean;
  /**
   * Minutes from midnight, shop time, on the frame's anchored axis (a
   * stored block's range, a tapped stretch, the noon default).
   */
  readonly startMinute: TrackMinute;
  readonly endMinute: TrackMinute;
  /** Every chair of the shop, for the DRAFT's day — the frame draws the chosen ones. */
  readonly lanes: readonly BlockEditorLane[];
  /** Whether the whole day is already off — the lift then lifts the day. */
  readonly dayIsOff: boolean;
  /**
   * The day-wide lift is ARMED: the first tap asked, the second deletes.
   * Lifting a day takes every block with it, so it does not happen on the
   * tap that asked for it; one range lifts on one tap.
   */
  readonly liftArmed: boolean;
  readonly acting: boolean;
}

export interface BlockEditorBarberOption {
  /** The catalogue chair's id (`BarberVm.id`). */
  readonly id: BarberId;
  readonly label: string;
  readonly tone: number;
  readonly avatarSrc: string | null;
}

/** A block's range, handed over when it becomes a visit. */
export interface BlockEditorRange {
  readonly barberId: BarberId;
  readonly dayKey: LocalDate;
  readonly startMinute: TrackMinute;
  readonly endMinute: TrackMinute;
}

export interface BlockEditorCommit {
  readonly barberIds: readonly BarberId[];
  /** The day the frame drew — the series' start. */
  readonly dayKey: LocalDate;
  /**
   * EVERY day the block is written on, in order: the one day, or the
   * series' — expanded here, by the same `RecurrenceSeries` the sheet
   * counted, so the write and the sentence cannot disagree.
   */
  readonly days: readonly LocalDate[];
  readonly allDay: boolean;
  readonly startMinute: TrackMinute;
  readonly endMinute: TrackMinute;
}

interface BlockDraft {
  readonly barberIds: readonly BarberId[];
  readonly dayKey: LocalDate;
  readonly allDay: boolean;
  readonly startMinute: TrackMinute;
  readonly endMinute: TrackMinute;
  /** `null` — the block happens once. */
  readonly repeat: RecurrenceRule | null;
}

/** The day's opening midnight on the frame's axis — where an all-day block starts. */
const DAY_START = trackMinuteOf(0);
/** The day's closing midnight on the frame's axis — where an all-day block ends. */
const DAY_END = trackMinuteOf(24 * 60);

const FREQUENCIES: readonly RecurrenceFrequency[] = [
  RecurrenceFrequency.Daily,
  RecurrenceFrequency.Weekly,
  RecurrenceFrequency.Monthly,
  RecurrenceFrequency.Yearly,
];

const PRESET_LABEL = {
  [RepeatPreset.Never]: 'staff.block.repeatNever',
  [RepeatPreset.Daily]: 'staff.block.repeatDaily',
  [RepeatPreset.Weekdays]: 'staff.block.repeatWeekdays',
  [RepeatPreset.Weekly]: 'staff.block.repeatWeekly',
  [RepeatPreset.Monthly]: 'staff.block.repeatMonthly',
  [RepeatPreset.Yearly]: 'staff.block.repeatYearly',
} as const satisfies Record<RepeatPreset, string>;

/** The page's own row after the shortcuts — «Персонализирано». */
const CUSTOM_REPEAT = 'CUSTOM';
type RepeatRowId = RepeatPreset | typeof CUSTOM_REPEAT;

/** The two ways a series ends, in the menu's order. */
const END_KINDS: readonly RecurrenceEnd[] = [
  RecurrenceEnd.Until,
  RecurrenceEnd.Count,
];

/** One row of the repeat page's shortcut list. */
interface RepeatRow {
  readonly id: RepeatRowId;
  /** `staff-block-repeat-<word>` — the row's lowercase name in the DOM. */
  readonly testId: string;
  readonly label: string;
  /** What the shortcut means from THIS start — «в четвъртък», «на 24-то число». */
  readonly detail: string | null;
  readonly checked: boolean;
}

/**
 * Past this many chairs the picture turns on its side (owner, 2026-09-09).
 * The grid's own narrow cap: two chairs side by side carry a name and a
 * time on a phone, three carry neither.
 */
const TIMELINE_FROM_CHAIRS = 2;

/** A minute of the frame's axis on the 24-hour face — the typed pair's and the readout's. */
function clockLabel(minute: TrackMinute): string {
  return formatClock(minute, ClockClosing.Wrap);
}

/**
 * A typed clock (`ui-time-field`'s `HH:mm`) as the minute it names — read
 * once at the field's edge (`MinuteOfDay.parseClock`); `null` for text
 * that names no minute of the day, and the field keeps its value.
 */
function parseClock(value: string): MinuteOfDay | null {
  const minute = MinuteOfDay.parseClock(value);
  return minute.ok ? minute.value : null;
}

/** A monthly reading's stable id, for the menu that picks it. */
function monthlyId(day: RecurrencePattern.Monthly): string {
  return day.monthlyAnchor === MonthlyAnchor.Date
    ? `date-${day.monthlyDate}`
    : `${WEEKDAY_WORD[day.monthlyWeekday]}-${day.monthlyWeek}`;
}

/** A monthly rule's own reading of its day, as the pattern the menu offers. */
function monthlyOf(rule: RecurrencePattern.Monthly): RecurrencePattern.Monthly {
  return rule.monthlyAnchor === MonthlyAnchor.Date
    ? RecurrencePattern.monthlyByDate(rule.monthlyDate)
    : RecurrencePattern.monthlyByWeekday(rule.monthlyWeek, rule.monthlyWeekday);
}

/** First letter up, for a phrase that stands alone as a menu row. */
function capitalised(phrase: string, locale: string): string {
  return phrase.charAt(0).toLocaleUpperCase(locale) + phrase.slice(1);
}

/** 2026-08-03, a Monday: ISO n lands on the (n − 1)-th day after it. */
const A_MONDAY = LocalDate.fromEpochDay(LocalDate.epochDayOf(2026, 8, 3));

/** A named weekday in the locale — `short` for the circles and lists, `long` for a sentence. */
function weekdayName(
  weekday: Weekday,
  locale: string,
  style: 'short' | 'long',
): string {
  return style === 'short'
    ? (formatWeekdayLabels(locale)[weekday - 1] ?? '')
    : formatWallClock(LocalDate.addDays(A_MONDAY, weekday - 1), null, locale, {
        weekday: 'long',
      });
}

@Component({
  selector: 'lib-staff-block-editor',
  imports: [
    TranslocoDirective,
    UiAvatar,
    UiButton,
    UiChoiceMenu,
    UiIcon,
    UiSwitch,
    UiTimeField,
    UiUnitField,
    UiWeekdayPicker,
    UiStack,
    UiForegroundStyleDirective,
    UiInteractiveDirective,
    UiTextDirective,
    UiListGroup,
    UiListRow,
    UiMenuTrigger,
    UiSheetActionBar,
    UiSheetHeadline,
    StaffDayPill,
    StaffTimeGrid,
    StaffTimeline,
    SwipeToDeleteDirective,
  ],
  templateUrl: './staff-block-editor.html',
  // The visit editor's stylesheets, shared on purpose: the header, the frame
  // box, the pills and the dock are the same objects here, and a second
  // copy is how two sheets start drifting apart. The visit editor's list
  // minus its last (visit-only) sheet, in the same order: a prefix is what
  // keeps the shared sheets landing in one order whichever sheet opens first.
  styleUrls: [
    '../visit-editor/staff-visit-editor.css',
    '../visit-editor/staff-visit-editor.sections.css',
    '../visit-editor/staff-visit-editor.rows.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'staff-visit',
    '[attr.data-dirty]': "dirty() ? '' : null",
  },
})
export class StaffBlockEditor {
  private readonly injector = inject(Injector);
  private readonly transloco = inject(TranslocoService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly vm = input.required<BlockEditorVm>();
  readonly uiBarbers = input<readonly BlockEditorBarberOption[]>([]);

  readonly committed = output<BlockEditorCommit>();
  /** Lift THIS block (or the day, when the day is off). */
  readonly lifted = output<void>();
  /** «Превърни в час» on a saved block: lift it and book the range. */
  readonly converted = output<BlockEditorRange>();
  /** The day the DRAFT is on, whenever the frame steps — the owner draws that day. */
  readonly dayChanged = output<LocalDate>();

  constructor() {
    afterNextRender(
      () => {
        this.dragCopy.set({
          handleStart: this.rawCopy('staff.block.handleStart'),
          handleEnd: this.rawCopy('staff.block.handleEnd'),
          blockRole: this.rawCopy('staff.block.role'),
          minutes: this.rawCopy('staff.visit.minutes'),
          overlap: this.rawCopy('staff.visit.overlapShort'),
          outside: this.rawCopy('staff.visit.outsideShort'),
          tooShort: this.rawCopy('staff.visit.tooShort'),
          backTo: this.rawCopy('staff.visit.backTo'),
        });
      },
      { injector: this.injector },
    );
  }

  /* ── The draft ─────────────────────────────────────────────────── */

  protected readonly draft = linkedSignal<string, BlockDraft>({
    // Keyed on the SUBJECT, never on the frame's day or its lanes: those
    // move with the draft and must not reseed it.
    source: () =>
      `${this.vm().blockId ?? 'new'}#${this.vm().barberIds.join('+')}`,
    computation: (key, previous) =>
      previous !== undefined && previous.source === key
        ? previous.value
        : seed(untracked(() => this.vm())),
  });

  private readonly seed = computed(() => seed(this.vm()));

  protected readonly dirty = computed(
    () => this.vm().blockId === null || !sameDraft(this.draft(), this.seed()),
  );

  /* ── The chairs ────────────────────────────────────────────────── */

  protected readonly chairMenu = signal(false);

  /** The chosen chairs, in roster order. */
  protected readonly chosenBarbers = computed(() =>
    this.uiBarbers().filter((barber) => this.chosen(barber.id)),
  );

  /** Is this chair one of the draft's? */
  private chosen(barberId: BarberId): boolean {
    return this.draft().barberIds.some((id) => id === barberId);
  }

  /** The chairs still to be added — what «Добави бръснар» offers, as THE choice menu's rows. */
  protected readonly chairChoices = computed<readonly UiChoiceOption[]>(() =>
    this.uiBarbers()
      .filter((barber) => !this.chosen(barber.id))
      .map((barber) => ({
        id: barber.id,
        label: barber.label,
        avatarSrc: barber.avatarSrc,
        testId: `staff-block-barber-pick-${barber.id}`,
      })),
  );

  /**
   * A chair picked from the menu. The menu hands its option id back as a
   * string; every option was built from a catalogue chair's id
   * (`chairChoices`), so it IS one — `BarberId.of`, by construction (D-4).
   */
  protected addBarber(optionId: string): void {
    this.chairMenu.set(false);
    const barberId = BarberId.of(optionId);
    this.draft.update((current) =>
      current.barberIds.includes(barberId)
        ? current
        : { ...current, barberIds: [...current.barberIds, barberId] },
    );
  }

  /** Off — and never nobody: the last chair's row does not offer this. */
  protected removeBarber(barberId: BarberId): void {
    this.draft.update((current) =>
      current.barberIds.length === 1
        ? current
        : {
            ...current,
            barberIds: current.barberIds.filter((id) => id !== barberId),
          },
    );
  }

  private laneOf(barberId: BarberId): BlockEditorLane | null {
    return this.vm().lanes.find((lane) => lane.barberId === barberId) ?? null;
  }

  /* ── The typed pair ────────────────────────────────────────────── */

  protected readonly startLabel = computed(() =>
    clockLabel(this.draft().startMinute),
  );
  protected readonly endLabel = computed(() =>
    clockLabel(this.draft().endMinute),
  );
  protected readonly minutes = computed(
    () => this.draft().endMinute - this.draft().startMinute,
  );

  protected setAllDay(on: boolean): void {
    this.draft.update((current) => ({ ...current, allDay: on }));
  }

  protected commitStart(value: string): void {
    const minute = parseClock(value);
    if (minute === null) return;
    // Snapped to the grain, the end pushed out to keep one grain of block
    // (`VisitDraftSystem.typedStart`).
    this.draft.update((current) => ({
      ...current,
      ...VisitDraftSystem.typedStart(current, minute),
    }));
  }

  protected commitEnd(value: string): void {
    const minute = parseClock(value);
    if (minute === null) return;
    // Snapped to the grain, the start pulled back to keep one grain of
    // block, never before midnight (`VisitDraftSystem.typedEnd`).
    this.draft.update((current) => ({
      ...current,
      ...VisitDraftSystem.typedEnd(current, minute),
    }));
  }

  /* ── The page ──────────────────────────────────────────────────── */

  /**
   * ONE PAGE, DEPTH ONE — the visit sheet's grammar (see its docblock): a
   * row that owns SEVERAL values travels (›). The repeat grew from one
   * choice into a rule — how often, on which days, until when — so it left
   * the ladder's menu for a page inside THIS sheet: one scrim, one focus
   * trap, one «Запази». The shell draws `‹` from `depth()` and names the
   * bar from `pageTitle()`, exactly as it does for the visit sheet.
   */
  private readonly repeatPage = signal(false);
  /** The repeat page is pushed — the sheet has one page, so a flag says it. */
  protected readonly repeatPageOpen = this.repeatPage.asReadonly();
  /** PUBLIC: the sheet shell draws the way back in its header bar. */
  readonly depth = computed(() => (this.repeatPage() ? 1 : 0));
  /** PUBLIC: the pushed page's own name for the bar; `null` at the root. */
  readonly pageTitle = computed(() =>
    this.repeatPage() ? this.rawCopy('staff.block.repeat') : null,
  );

  protected openRepeatPage(): void {
    this.customOpen.set(false);
    this.repeatPage.set(true);
    this.focusLater('[data-testid="staff-block-page"]');
  }

  /** PUBLIC: back to the ladder — the bar's `‹`, and the page dock's ✓. */
  pop(): void {
    // A figure typed and refused does not outlive its field; the draft
    // still holds the last rule that made sense.
    this.typedError.set(null);
    this.customOpen.set(false);
    this.repeatPage.set(false);
    this.focusLater('[data-testid="staff-block-repeat"]');
  }

  /* ── The repeat ────────────────────────────────────────────────── */

  /** The series' start as the shop day — the frame's day. */
  protected readonly startDay = computed(() => this.draft().dayKey);

  /** The days the draft would write, or the domain's refusal; `null` when nothing repeats. */
  private readonly series = computed(() => {
    const rule = this.draft().repeat;
    return rule === null
      ? null
      : RecurrenceSystem.series(this.startDay(), rule);
  });

  /**
   * A figure typed on the page that no rule can hold — 0 weeks, 500 times.
   * Never clamped (the typed-figure ruling): refused in the domain's words,
   * and «Запази» waits until it is fixed or the page is left.
   */
  private readonly typedError = signal<SchedulingError | null>(null);

  /** What is wrong with the repeat, in words — the typed refusal first, then the series'. */
  protected readonly repeatError = computed<string | null>(() => {
    const typed = this.typedError();
    if (typed !== null) return translateCodedError(this.transloco, typed);
    const series = this.series();
    return series !== null && !series.ok
      ? translateCodedError(this.transloco, series.error)
      : null;
  });

  /** Every day the block is written on — the one day, or the series'. */
  private readonly writeDays = computed<readonly LocalDate[]>(() => {
    const series = this.series();
    if (series === null) return [this.draft().dayKey];
    return series.ok ? series.value.localDates : [];
  });

  /** The series' days, for the dots on its end's calendar. */
  protected readonly seriesDays = computed<readonly LocalDate[]>(() => {
    const series = this.series();
    return series !== null && series.ok ? series.value.localDates : [];
  });

  protected readonly saveable = computed(
    () => this.typedError() === null && this.writeDays().length > 0,
  );

  /** The shortcut the rule IS, read back off it — `null` for a rule of the user's own. */
  private readonly preset = computed(() =>
    presetOf(this.draft().repeat, this.startDay()),
  );

  /**
   * «Персонализирано» shows its controls once tapped, and whenever the rule
   * is no shortcut — a rule built there stays there, checked.
   */
  private readonly customOpen = signal(false);
  protected readonly customShown = computed(
    () =>
      this.customOpen() ||
      (this.draft().repeat !== null && this.preset() === null),
  );

  /** Apple's Repeat list, then «Персонализирано»; the check on the rule's own row. */
  protected readonly repeatRows = computed<readonly RepeatRow[]>(() => {
    const start = this.startDay();
    const custom = this.customShown();
    const checked = custom ? null : this.preset();
    return [
      ...REPEAT_PRESETS.map((id) => ({
        id,
        testId: `staff-block-repeat-${REPEAT_PRESET_WORD[id]}`,
        label: this.rawCopy(PRESET_LABEL[id]),
        detail: this.presetDetail(id, start),
        checked: id === checked,
      })),
      {
        id: CUSTOM_REPEAT,
        testId: 'staff-block-repeat-custom',
        label: this.rawCopy('staff.block.repeatCustom'),
        detail: null,
        checked: custom,
      },
    ];
  });

  protected pickRepeat(id: RepeatRowId): void {
    const start = this.startDay();
    this.typedError.set(null);
    this.customOpen.set(id === CUSTOM_REPEAT);
    this.setRule(
      id === CUSTOM_REPEAT
        ? ruleForCustom(start, this.draft().repeat)
        : ruleForPreset(id, start, this.draft().repeat),
    );
  }

  private setRule(rule: RecurrenceRule | null): void {
    this.draft.update((current) =>
      current.repeat === rule ||
      (rule !== null && RecurrenceRule.equals(rule, current.repeat))
        ? current
        : { ...current, repeat: rule },
    );
  }

  /* The rule's own controls — «Персонализирано». */

  protected readonly frequencyMenu = signal(false);
  protected readonly frequencyOptions = computed<readonly UiChoiceOption[]>(
    () =>
      FREQUENCIES.map((frequency) => ({
        id: frequency,
        label: this.rawCopy(
          `staff.block.repeatFrequencies.${RECURRENCE_FREQUENCY_WORD[frequency]}`,
        ),
        testId: `staff-block-repeat-frequency-${RECURRENCE_FREQUENCY_WORD[frequency]}`,
      })),
  );

  /** The template's dictionary, for the rule's own controls. */
  protected readonly Frequency = RecurrenceFrequency;

  /** The rule's frequency as its `staff.block.repeatFrequencies.<word>` segment. */
  protected frequencyWord(rule: RecurrenceRule): string {
    return RECURRENCE_FREQUENCY_WORD[rule.recurrenceFrequency];
  }

  protected setFrequency(id: string): void {
    this.frequencyMenu.set(false);
    const rule = this.draft().repeat;
    const start = this.startDay();
    const frequency = FREQUENCIES.find((entry) => entry === id);
    if (rule === null || frequency === undefined) return;
    this.typedError.set(null);
    this.setRule(ruleForFrequency(rule, frequency, start));
  }

  /** «седмици» after «2» — the interval field's unit, in the rule's own period. */
  protected intervalUnit(rule: RecurrenceRule): string {
    return this.rawCopy(
      `staff.block.repeatUnit.${this.frequencyWord(rule)}.${this.pluralOf(rule.recurrenceInterval)}`,
    );
  }

  protected commitInterval(value: string): void {
    const rule = this.draft().repeat;
    if (rule === null) return;
    this.typed(withInterval(rule, Number(value)));
  }

  /** The weekly rule's days (ISO, Monday first), for the picker. */
  protected readonly weekdayIsos = computed<readonly Weekday[]>(() => {
    const rule = this.draft().repeat;
    return rule?.recurrenceFrequency === RecurrenceFrequency.Weekly
      ? rule.recurrenceWeekdays
      : [];
  });

  /** The picker's days — its ISO numbers ARE the `Weekday` dictionary's members. */
  protected setWeekdays(weekdays: readonly Weekday[]): void {
    const rule = this.draft().repeat;
    if (
      rule === null ||
      rule.recurrenceFrequency !== RecurrenceFrequency.Weekly
    )
      return;
    const next = withWeekdays(rule, weekdays);
    if (next.ok) this.setRule(next.value);
  }

  protected readonly monthlyMenu = signal(false);

  /**
   * The monthly readings the start offers — Google's own list: the date,
   * its week, the last one — plus the rule's own, should it be none of
   * them (a start moved under a shaped rule).
   */
  private readonly monthlyDays = computed<readonly RecurrencePattern.Monthly[]>(
    () => {
      const start = this.startDay();
      const rule = this.draft().repeat;
      if (rule?.recurrenceFrequency !== RecurrenceFrequency.Monthly) {
        return [];
      }
      const own = monthlyOf(rule);
      const offered = RecurrenceSystem.monthlyDaysFor(start);
      return offered.some((day) => monthlyId(day) === monthlyId(own))
        ? offered
        : [...offered, own];
    },
  );

  protected readonly monthlyOptions = computed<readonly UiChoiceOption[]>(() =>
    this.monthlyDays().map((day) => ({
      id: monthlyId(day),
      label: capitalised(this.monthlyPhrase(day), this.locale()),
      testId: `staff-block-repeat-month-day-${monthlyId(day)}`,
    })),
  );

  protected readonly monthlySelectedId = computed(() => {
    const rule = this.draft().repeat;
    return rule?.recurrenceFrequency === RecurrenceFrequency.Monthly
      ? monthlyId(rule)
      : null;
  });

  protected readonly monthlyLabel = computed(
    () =>
      this.monthlyOptions().find(
        (option) => option.id === this.monthlySelectedId(),
      )?.label ?? '',
  );

  protected setMonthly(id: string): void {
    this.monthlyMenu.set(false);
    const rule = this.draft().repeat;
    const day = this.monthlyDays().find((entry) => monthlyId(entry) === id);
    if (rule === null || day === undefined) return;
    const next = withMonthly(rule, day);
    if (next.ok) this.setRule(next.value);
  }

  /* How it ends. */

  protected readonly endMenu = signal(false);
  protected readonly untilOpen = signal(false);

  protected readonly endOptions = computed<readonly UiChoiceOption[]>(() =>
    END_KINDS.map((kind) => ({
      id: kind,
      label: this.rawCopy(
        kind === RecurrenceEnd.Until
          ? 'staff.block.repeatEndOn'
          : 'staff.block.repeatEndAfter',
      ),
      testId: `staff-block-repeat-end-${RECURRENCE_END_WORD[kind]}`,
    })),
  );

  protected readonly endKindLabel = computed(
    () =>
      this.endOptions().find(
        (option) => option.id === this.draft().repeat?.recurrenceEnd,
      )?.label ?? '',
  );

  protected setEndKind(id: string): void {
    this.endMenu.set(false);
    const rule = this.draft().repeat;
    const start = this.startDay();
    const kind = END_KINDS.find((entry) => entry === id);
    if (rule === null || kind === undefined) return;
    this.typedError.set(null);
    this.setRule(ruleForEndKind(rule, kind, start));
  }

  protected readonly untilKey = computed(() => {
    const rule = this.draft().repeat;
    return rule?.recurrenceEnd === RecurrenceEnd.Until
      ? rule.untilLocalDate
      : null;
  });

  protected setUntil(day: LocalDate): void {
    this.untilOpen.set(false);
    const rule = this.draft().repeat;
    if (rule === null) return;
    this.typed(withUntil(rule, day));
  }

  protected readonly countFigure = computed(() => {
    const rule = this.draft().repeat;
    return rule?.recurrenceEnd === RecurrenceEnd.Count
      ? String(rule.occurrenceCount)
      : '';
  });

  protected readonly countUnit = computed(() => {
    const rule = this.draft().repeat;
    const count =
      rule?.recurrenceEnd === RecurrenceEnd.Count ? rule.occurrenceCount : 0;
    return this.rawCopy(`staff.block.repeatTimesUnit.${this.pluralOf(count)}`);
  });

  protected commitCount(value: string): void {
    const rule = this.draft().repeat;
    if (rule === null) return;
    this.typed(withCount(rule, Number(value)));
  }

  /** A typed change: taken when the domain holds it, said when it refuses. */
  private typed(next: Result<RecurrenceRule, SchedulingError>): void {
    if (!next.ok) {
      this.typedError.set(next.error);
      return;
    }
    this.typedError.set(null);
    this.setRule(next.value);
  }

  /* What the ladder and the page say about it. */

  /** The row's value: the shortcut's own name, or how often in words for a rule of one's own. */
  protected readonly repeatValue = computed(() => {
    const rule = this.draft().repeat;
    const preset = this.preset();
    if (preset !== null) return this.rawCopy(PRESET_LABEL[preset]);
    return rule === null ? '' : this.everyPhrase(rule);
  });

  /**
   * THE SIZE OF THE ACT, before «Запази» — which days, how many, from when
   * to when: «пн, ср и пт · 9 пъти · 28.09 – 21.10». The range starts at
   * the FIRST day written, which is not the frame's day when the rule does
   * not select it. The refusal instead, when there is one.
   */
  protected readonly repeatFacts = computed<string | null>(() => {
    const rule = this.draft().repeat;
    if (rule === null) return null;
    const error = this.repeatError();
    if (error !== null) return error;
    const series = this.series();
    if (series === null || !series.ok) return null;
    const days = series.value.localDates;
    const count = days.length;
    const first = days[0] ?? series.value.startLocalDate;
    const last = days[count - 1] ?? first;
    const locale = this.locale();
    return [
      this.daysPhrase(rule),
      this.transloco.translate(
        `staff.block.repeatTimes.${this.pluralOf(count)}`,
        { count },
      ),
      count === 1
        ? formatDayPill(first, locale)
        : formatDayPillRange(first, last, locale),
    ]
      .filter((part): part is string => part !== null)
      .join(' · ');
  });

  /** The page's closing line: how often, then the facts — Calendar's «Event will occur…». */
  protected readonly repeatSummary = computed<string | null>(() => {
    const rule = this.draft().repeat;
    const facts = this.repeatFacts();
    if (rule === null || facts === null || this.repeatError() !== null) {
      return null;
    }
    return `${this.everyPhrase(rule)} · ${facts}`;
  });

  /** «Повтаряне, Всяка седмица, в четвъртък · 5 пъти · …» — the row, read whole. */
  protected readonly repeatRowName = computed(() =>
    [
      this.rawCopy('staff.block.repeat'),
      this.draft().repeat === null
        ? this.rawCopy('staff.block.repeatNever')
        : this.repeatValue(),
      this.repeatFacts(),
    ]
      .filter((part): part is string => !!part)
      .join(', '),
  );

  /** «Всяка седмица», «На всеки 2 седмици». */
  private everyPhrase(rule: RecurrenceRule): string {
    return this.transloco.translate(
      `staff.block.repeatEvery.${this.frequencyWord(rule)}.${this.pluralOf(rule.recurrenceInterval)}`,
      { count: rule.recurrenceInterval },
    );
  }

  /** Which days of the period — `null` for every day. */
  private daysPhrase(rule: RecurrenceRule): string | null {
    const locale = this.locale();
    switch (rule.recurrenceFrequency) {
      case RecurrenceFrequency.Daily:
        return null;
      case RecurrenceFrequency.Weekly: {
        const days = rule.recurrenceWeekdays;
        if (
          days.length === MONDAY_TO_FRIDAY.length &&
          days.every((day, index) => day === MONDAY_TO_FRIDAY[index])
        ) {
          return `${weekdayName(Weekday.Mon, locale, 'short')} – ${weekdayName(Weekday.Fri, locale, 'short')}`;
        }
        const only = days.length === 1 ? days[0] : undefined;
        if (only !== undefined) {
          return this.rawCopy(
            `staff.block.repeatOnWeekday.${WEEKDAY_WORD[only]}`,
          );
        }
        return new Intl.ListFormat(locale, {
          style: 'long',
          type: 'conjunction',
        }).format(days.map((day) => weekdayName(day, locale, 'short')));
      }
      case RecurrenceFrequency.Monthly:
        return this.monthlyPhrase(rule);
      case RecurrenceFrequency.Yearly:
        return this.transloco.translate('staff.block.repeatOnDayOfYear', {
          // A leap year, so 29 February has a date to be written as.
          date: formatWallClock(
            LocalDate.fromEpochDay(
              LocalDate.epochDayOf(2000, rule.yearlyMonth, rule.yearlyDate),
            ),
            null,
            locale,
            { day: 'numeric', month: 'long' },
          ),
        });
    }
  }

  /** «на 24-то число», «в последния четвъртък», «във втората сряда». */
  private monthlyPhrase(day: RecurrencePattern.Monthly): string {
    if (day.monthlyAnchor === MonthlyAnchor.Date) {
      return this.transloco.translate('staff.block.repeatOnDate', {
        date: this.ordinal(day.monthlyDate),
      });
    }
    // Bulgarian agrees the ordinal with the weekday's gender («първия
    // четвъртък», «първата сряда»), so the table is per gender and the
    // gender is the locale's own fact about each day.
    const gender =
      this.rawCopy(
        `staff.block.repeatWeekdayGender.${WEEKDAY_WORD[day.monthlyWeekday]}`,
      ) === 'feminine'
        ? 'feminine'
        : 'masculine';
    return this.transloco.translate(
      `staff.block.repeatOnNth.${gender}.${day.monthlyWeek === WeekOfMonth.Last ? 'last' : day.monthlyWeek}`,
      { weekday: weekdayName(day.monthlyWeekday, this.locale(), 'long') },
    );
  }

  /**
   * «24-то», «1-во», «7-мо», «24th» — keyed by the last digit (the teens
   * are regular in both languages), falling back to the table's `other`.
   */
  private ordinal(n: number): string {
    const teen = n % 100 >= 11 && n % 100 <= 19;
    const exact = `staff.block.repeatDateOrdinal.${teen ? 'other' : n % 10}`;
    const key = this.hasCopy(exact)
      ? exact
      : 'staff.block.repeatDateOrdinal.other';
    return this.transloco.translate(key, { n });
  }

  /** What a shortcut means from this start, under its name. */
  private presetDetail(id: RepeatPreset, start: LocalDate): string | null {
    if (id === RepeatPreset.Never || id === RepeatPreset.Daily) return null;
    const rule = ruleForPreset(id, start, null);
    return rule === null ? null : this.daysPhrase(rule);
  }

  /* ── The frame ─────────────────────────────────────────────────── */

  protected readonly dayOpen = signal(false);
  protected readonly locale = computed(() => this.transloco.getActiveLang());

  /** Today on the shop's calendar, for the pills' months — `null` before the zone. */
  protected readonly todayKey = computed(
    () => this.vm().now?.localDate ?? null,
  );

  /**
   * The now-line's minute when the frame draws TODAY — the draft's day, on
   * the shop's clock (`ShopNow`); `null` on any other day.
   */
  protected readonly frameNowMinute = computed(() => {
    const now = this.vm().now;
    return now !== null && now.localDate === this.draft().dayKey
      ? now.currentMinute
      : null;
  });

  protected stepDay(offset: number): void {
    this.pickDay(LocalDate.addDays(this.draft().dayKey, offset));
  }

  protected pickDay(day: LocalDate): void {
    this.dayOpen.set(false);
    const from = this.draft().dayKey;
    if (day === from) return;
    this.draft.update((current) => ({
      ...current,
      dayKey: day,
      // The series starts where the frame is: its start's own weekday or
      // date follows along, and an end the new start overtook moves on.
      repeat:
        current.repeat !== null
          ? ruleForStart(current.repeat, from, day)
          : current.repeat,
    }));
    this.dayChanged.emit(day);
  }

  protected readonly frameWindow = computed<GridWindow>(() => ({
    startMinute: DAY_START,
    endMinute: DAY_END,
  }));

  /** Rows and hours across, once the chairs outnumber the grid's columns. */
  private readonly frameGrid = viewChild(StaffTimeGrid);
  private readonly frameTimeline = viewChild(StaffTimeline);

  /** Full screen for the frame — shared with the block sheet. */
  private readonly frameSection =
    viewChild<ElementRef<HTMLElement>>('frameSection');

  protected readonly fullscreen = injectFrameFullscreen({
    surface: () => this.frameSection()?.nativeElement,
    settled: () => {
      this.frameGrid()?.recenter('auto');
      this.frameTimeline()?.recenter('auto');
    },
  });

  protected readonly timelineFramed = computed(
    () => this.chosenBarbers().length > TIMELINE_FROM_CHAIRS,
  );

  /** The earliest roster start among the chosen chairs — where the frame opens. */
  protected readonly frameRosterStart = computed<TrackMinute>(() => {
    const starts = this.chosenBarbers()
      .map((barber) => this.laneOf(barber.id)?.rosterStartMinute)
      .filter((value): value is TrackMinute => value !== undefined);
    // The least of non-negative whole track minutes is one itself (proven).
    return starts.length ? trackMinuteOf(Math.min(...starts)) : DAY_START;
  });

  /** ONE COLUMN PER CHOSEN CHAIR: the block drawn over each real day. */
  protected readonly frameColumns = computed<readonly GridColumn[]>(() => {
    const draft = this.draft();
    const label = this.rawCopy('staff.block.title');
    const allDayLabel = this.rawCopy('staff.block.allDay');
    return this.chosenBarbers().map((barber) => {
      const lane = this.laneOf(barber.id);
      const rosterStart = lane?.rosterStartMinute ?? DAY_START;
      const rosterEnd = lane?.rosterEndMinute ?? DAY_START;
      // ALL DAY IS THE WHOLE ROW (owner, 2026-09-09: "all-day blockers
      // should span full width for the barber row"). It used to cover the
      // roster, which read as a timed block that happened to fit the shift;
      // the whole axis says what the switch says.
      const block: GridEvent = {
        id: 'draft-block',
        gridEvent: GridEventTag.Block,
        barberTone: null,
        startMinute: draft.allDay ? DAY_START : draft.startMinute,
        endMinute: draft.allDay ? DAY_END : draft.endMinute,
        title: label,
        detail: null,
        attribution: null,
        bookingStatus: null,
        terminal: false,
        past: false,
        accessibleName: draft.allDay
          ? `${label}, ${allDayLabel}`
          : `${label}, ${clockLabel(draft.startMinute)}–${clockLabel(draft.endMinute)}`,
        statusIcon: 'booking.blocked',
        partyLabel: null,
      };
      const neighbours = (lane?.neighbours ?? []).map<GridEvent>(
        (neighbour, index) => ({
          id: `neighbour-${barber.id}-${index}`,
          gridEvent: GridEventTag.Visit,
          barberTone: neighbour.tone,
          startMinute: neighbour.startMinute,
          endMinute: neighbour.endMinute,
          title: neighbour.name,
          detail: null,
          attribution: null,
          bookingStatus: null,
          terminal: false,
          past: true,
          accessibleName: neighbour.name,
          statusIcon: null,
          partyLabel: null,
        }),
      );
      return {
        id: barber.id,
        title: barber.label,
        detail: null,
        dayNumber: null,
        isToday: this.frameNowMinute() !== null,
        avatarSrc: barber.avatarSrc,
        events: [...neighbours, block],
        // An empty window is a chair SHUT all day — the frame shades it.
        open:
          rosterEnd > rosterStart
            ? [{ startMinute: rosterStart, endMinute: rosterEnd }]
            : [],
      };
    });
  });

  /**
   * THE VISITS THE BLOCK WOULD SIT ON, across every chosen chair — named
   * under the picture in red, the way the visit sheet names a collision,
   * never moved. The block itself already wears the overlap hatch.
   */
  protected readonly collisions = computed(() => {
    const draft = this.draft();
    // An all-day block is the whole day — the span the frame draws it as.
    const span = draft.allDay
      ? { startMinute: DAY_START, endMinute: DAY_END }
      : draft;
    return this.chosenBarbers().flatMap((barber) =>
      (this.laneOf(barber.id)?.neighbours ?? [])
        .filter((visit) => GridLayoutSystem.spansOverlap(visit, span))
        .map((visit) => ({ ...visit, barber: barber.label })),
    );
  });

  protected readonly collisionNote = computed<string | null>(() => {
    const hits = this.collisions();
    if (hits.length === 0) return null;
    const first = hits[0];
    if (hits.length === 1 && first) {
      return this.transloco.translate('staff.visit.conflict', {
        name: first.name,
        start: clockLabel(first.startMinute),
        end: clockLabel(first.endMinute),
      });
    }
    const names = [...new Set(hits.map((hit) => hit.name))].join(', ');
    return this.transloco.translate('staff.block.collisionsNamed', {
      count: hits.length,
      names,
    });
  });

  protected readonly dragCopy = signal<GridDragCopy>({
    handleStart: '',
    handleEnd: '',
    blockRole: '',
    minutes: '',
    overlap: '',
    outside: '',
    tooShort: '',
    backTo: '',
  });

  protected onFrameDraft(draft: GridDraft): void {
    this.draft.update((current) =>
      current.startMinute === draft.startMinute &&
      current.endMinute === draft.endMinute
        ? current
        : {
            ...current,
            startMinute: draft.startMinute,
            endMinute: draft.endMinute,
          },
    );
  }

  protected onFrameCommit(commit: GridCommit): void {
    this.onFrameDraft(commit);
  }

  /* ── The acts ──────────────────────────────────────────────────── */

  /**
   * The draft's range in its first chair — `null` with no chair, which the
   * sheet never holds: it opens on one chair and its last chair's row
   * offers no removal.
   */
  private range(): BlockEditorRange | null {
    const draft = this.draft();
    const barberId = draft.barberIds[0];
    return barberId === undefined
      ? null
      : {
          barberId,
          dayKey: draft.dayKey,
          startMinute: draft.startMinute,
          endMinute: draft.endMinute,
        };
  }

  protected convert(): void {
    const range = this.range();
    if (range !== null) this.converted.emit(range);
  }

  protected save(): void {
    if (!this.saveable()) return;
    const draft = this.draft();
    this.committed.emit({
      barberIds: draft.barberIds,
      dayKey: draft.dayKey,
      days: this.writeDays(),
      allDay: draft.allDay,
      startMinute: draft.startMinute,
      endMinute: draft.endMinute,
    });
  }

  protected readonly snapMinutes = VisitDraftSystem.GRAIN_MINUTES;

  private rawCopy(key: string): string {
    const table = this.transloco.getTranslation(this.transloco.getActiveLang());
    const raw = (table as Record<string, unknown> | undefined)?.[key];
    return typeof raw === 'string' ? raw : this.transloco.translate(key);
  }

  private hasCopy(key: string): boolean {
    const table = this.transloco.getTranslation(this.transloco.getActiveLang());
    return (
      typeof (table as Record<string, unknown> | undefined)?.[key] === 'string'
    );
  }

  /** CLDR plural category for a count, in the language on screen. */
  private pluralOf(count: number): string {
    return pluralForm(count, this.transloco.getActiveLang());
  }

  private focusLater(selector: string): void {
    afterNextRender(
      () => {
        this.host.nativeElement
          .querySelector<HTMLElement>(selector)
          ?.focus({ preventScroll: true });
      },
      { injector: this.injector },
    );
  }
}

/** Two drafts that would write the same thing — the rule compared as a rule, not as JSON. */
function sameDraft(a: BlockDraft, b: BlockDraft): boolean {
  return (
    a.dayKey === b.dayKey &&
    a.allDay === b.allDay &&
    a.startMinute === b.startMinute &&
    a.endMinute === b.endMinute &&
    a.barberIds.length === b.barberIds.length &&
    a.barberIds.every((id, index) => b.barberIds[index] === id) &&
    (a.repeat === null
      ? b.repeat === null
      : RecurrenceRule.equals(a.repeat, b.repeat))
  );
}

function seed(vm: BlockEditorVm): BlockDraft {
  return {
    barberIds: vm.barberIds,
    dayKey: vm.dayKey,
    allDay: vm.allDay,
    startMinute: vm.startMinute,
    endMinute: vm.endMinute,
    repeat: null,
  };
}
