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
// The domain's recurrence, through the application layer's facade — a
// feature never reaches past it (`type:feature` → `type:application`).
import {
  CalendarDay,
  type DomainError,
  type MonthlyDay,
  type RecurrenceFrequency,
  RecurrenceRule,
  RecurrenceSeries,
  type Weekday,
  isoOf,
  weekdayFromIso,
} from '@creativo/application/booking';
import {
  pluralForm,
  translateDomainError,
} from '@creativo/infrastructure/i18n';
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
import { FrameFullscreen } from '../shared/frame-fullscreen';
import { SwipeToDeleteDirective } from '../swipe-to-delete/swipe-to-delete.directive';
import { StaffTimeline } from '../timeline/staff-timeline';
import { STAFF_ZONE, addDays } from '../staff-day.store';
import {
  MONDAY_TO_FRIDAY,
  REPEAT_PRESETS,
  type RepeatPreset,
  presetOf,
  ruleForCustom,
  ruleForEndKind,
  ruleForFrequency,
  ruleForPreset,
  ruleForStart,
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

/** One chair's real day, for the frame: what the block would sit on. */
export interface BlockEditorLane {
  readonly barberId: string;
  readonly neighbours: readonly {
    readonly name: string;
    readonly startMinute: number;
    readonly endMinute: number;
    readonly tone: number;
  }[];
  readonly rosterStartMinute: number;
  readonly rosterEndMinute: number;
}

export interface BlockEditorVm {
  /** `null` while creating; otherwise the grid's own block id. */
  readonly blockId: string | null;
  /** The chairs the draft starts with — one, for a saved block. */
  readonly barberIds: readonly string[];
  /** The day the sheet was opened on, `YYYY-MM-DD`; the draft may step off it. */
  readonly dayKey: string;
  readonly todayKey: string;
  readonly allDay: boolean;
  /** Minutes from midnight, shop time. */
  readonly startMinute: number;
  readonly endMinute: number;
  /** Every chair of the shop, for the DRAFT's day — the frame draws the chosen ones. */
  readonly lanes: readonly BlockEditorLane[];
  readonly nowMinute: number | null;
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
  readonly id: string;
  readonly label: string;
  readonly tone: number;
  readonly avatarSrc: string | null;
}

/** A block's range, handed over when it becomes a visit. */
export interface BlockEditorRange {
  readonly barberId: string;
  readonly dayKey: string;
  readonly startMinute: number;
  readonly endMinute: number;
}

export interface BlockEditorCommit {
  readonly barberIds: readonly string[];
  /** The day the frame drew — the series' start. */
  readonly dayKey: string;
  /**
   * EVERY day the block is written on, in order: the one day, or the
   * series' — expanded here, by the same `RecurrenceSeries` the sheet
   * counted, so the write and the sentence cannot disagree.
   */
  readonly days: readonly string[];
  readonly allDay: boolean;
  readonly startMinute: number;
  readonly endMinute: number;
}

interface BlockDraft {
  readonly barberIds: readonly string[];
  readonly dayKey: string;
  readonly allDay: boolean;
  readonly startMinute: number;
  readonly endMinute: number;
  /** `null` — the block happens once. */
  readonly repeat: RecurrenceRule | null;
}

const DAY_MINUTES = 24 * 60;
const GRAIN_MINUTES = 5;

const FREQUENCIES: readonly RecurrenceFrequency[] = [
  'daily',
  'weekly',
  'monthly',
  'yearly',
];

const PRESET_LABEL: Readonly<Record<RepeatPreset, string>> = {
  never: 'staff.block.repeatNever',
  daily: 'staff.block.repeatDaily',
  weekdays: 'staff.block.repeatWeekdays',
  weekly: 'staff.block.repeatWeekly',
  monthly: 'staff.block.repeatMonthly',
  yearly: 'staff.block.repeatYearly',
};

/** One row of the repeat page's shortcut list. */
interface RepeatRow {
  readonly id: RepeatPreset | 'custom';
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
function clockLabel(minute: number): string {
  const hours = Math.floor(minute / 60) % 24;
  const minutes = minute % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  return minute >= 0 && minute < DAY_MINUTES ? minute : null;
}

function snap(minute: number): number {
  return Math.round(minute / GRAIN_MINUTES) * GRAIN_MINUTES;
}

/** A draft day key as the domain's day, in the shop's zone. */
function dayOf(dayKey: string): CalendarDay | null {
  const day = CalendarDay.create(dayKey, STAFF_ZONE);
  return day.isSuccess() ? day.value : null;
}

/** A monthly reading's stable id, for the menu that picks it. */
function monthlyId(day: MonthlyDay): string {
  return day.by === 'date' ? `date-${day.date}` : `${day.weekday}-${day.week}`;
}

/** First letter up, for a phrase that stands alone as a menu row. */
function capitalised(phrase: string, locale: string): string {
  return phrase.charAt(0).toLocaleUpperCase(locale) + phrase.slice(1);
}

/** A named weekday in the locale — `short` for the circles and lists, `long` for a sentence. */
function weekdayName(
  weekday: Weekday,
  locale: string,
  style: 'short' | 'long',
): string {
  // 2026-08-03 is a Monday; ISO n lands on the n-th day from it.
  return new Intl.DateTimeFormat(locale, {
    weekday: style,
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2026, 7, 2 + isoOf(weekday))));
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
  // The visit editor's stylesheet, shared on purpose: the header, the frame
  // box, the pills and the dock are the same objects here, and a second
  // copy is how two sheets start drifting apart.
  styleUrl: '../visit-editor/staff-visit-editor.css',
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
  readonly dayChanged = output<string>();

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
    this.uiBarbers().filter((barber) =>
      this.draft().barberIds.includes(barber.id),
    ),
  );

  /** The chairs still to be added — what «Добави бръснар» offers, as THE choice menu's rows. */
  protected readonly chairChoices = computed<readonly UiChoiceOption[]>(() =>
    this.uiBarbers()
      .filter((barber) => !this.draft().barberIds.includes(barber.id))
      .map((barber) => ({
        id: barber.id,
        label: barber.label,
        avatarSrc: barber.avatarSrc,
        testId: `staff-block-barber-pick-${barber.id}`,
      })),
  );

  protected addBarber(barberId: string): void {
    this.chairMenu.set(false);
    this.draft.update((current) =>
      current.barberIds.includes(barberId)
        ? current
        : { ...current, barberIds: [...current.barberIds, barberId] },
    );
  }

  /** Off — and never nobody: the last chair's row does not offer this. */
  protected removeBarber(barberId: string): void {
    this.draft.update((current) =>
      current.barberIds.length === 1
        ? current
        : {
            ...current,
            barberIds: current.barberIds.filter((id) => id !== barberId),
          },
    );
  }

  private laneOf(barberId: string): BlockEditorLane | null {
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
    this.draft.update((current) => {
      const start = snap(minute);
      const end = Math.max(start + GRAIN_MINUTES, current.endMinute);
      return { ...current, startMinute: start, endMinute: end };
    });
  }

  protected commitEnd(value: string): void {
    const minute = parseClock(value);
    if (minute === null) return;
    this.draft.update((current) => {
      const end = snap(minute);
      const start = Math.min(current.startMinute, end - GRAIN_MINUTES);
      return { ...current, startMinute: Math.max(0, start), endMinute: end };
    });
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
  private readonly page = signal<'repeat' | null>(null);
  protected readonly currentPage = this.page.asReadonly();
  /** PUBLIC: the sheet shell draws the way back in its header bar. */
  readonly depth = computed(() => (this.page() === null ? 0 : 1));
  /** PUBLIC: the pushed page's own name for the bar; `null` at the root. */
  readonly pageTitle = computed(() =>
    this.page() === 'repeat' ? this.rawCopy('staff.block.repeat') : null,
  );

  protected openRepeatPage(): void {
    this.customOpen.set(false);
    this.page.set('repeat');
    this.focusLater('[data-testid="staff-block-page"]');
  }

  /** PUBLIC: back to the ladder — the bar's `‹`, and the page dock's ✓. */
  pop(): void {
    // A figure typed and refused does not outlive its field; the draft
    // still holds the last rule that made sense.
    this.typedError.set(null);
    this.customOpen.set(false);
    this.page.set(null);
    this.focusLater('[data-testid="staff-block-repeat"]');
  }

  /* ── The repeat ────────────────────────────────────────────────── */

  /** The series' start as the domain's day — the frame's day, in the shop's zone. */
  protected readonly startDay = computed(() => dayOf(this.draft().dayKey));

  /** The days the draft would write, or the domain's refusal; `null` when nothing repeats. */
  private readonly series = computed(() => {
    const rule = this.draft().repeat;
    const start = this.startDay();
    return rule === null || start === null
      ? null
      : RecurrenceSeries.create(start, rule);
  });

  /**
   * A figure typed on the page that no rule can hold — 0 weeks, 500 times.
   * Never clamped (the typed-figure ruling): refused in the domain's words,
   * and «Запази» waits until it is fixed or the page is left.
   */
  private readonly typedError = signal<DomainError | null>(null);

  /** What is wrong with the repeat, in words — the typed refusal first, then the series'. */
  protected readonly repeatError = computed<string | null>(() => {
    const typed = this.typedError();
    if (typed !== null) return translateDomainError(this.transloco, typed);
    const series = this.series();
    return series !== null && series.isFailure()
      ? translateDomainError(this.transloco, series.error)
      : null;
  });

  /** Every day the block is written on — the one day, or the series'. */
  private readonly writeDays = computed<readonly string[]>(() => {
    const series = this.series();
    if (series === null) return [this.draft().dayKey];
    return series.isSuccess() ? series.value.keys() : [];
  });

  /** The series' days, for the dots on its end's calendar. */
  protected readonly seriesDays = computed<readonly string[]>(() => {
    const series = this.series();
    return series !== null && series.isSuccess() ? series.value.keys() : [];
  });

  protected readonly saveable = computed(
    () => this.typedError() === null && this.writeDays().length > 0,
  );

  /** The shortcut the rule IS, read back off it — `null` for a rule of the user's own. */
  private readonly preset = computed(() => {
    const start = this.startDay();
    return start === null ? null : presetOf(this.draft().repeat, start);
  });

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
        label: this.rawCopy(PRESET_LABEL[id]),
        detail: start === null ? null : this.presetDetail(id, start),
        checked: id === checked,
      })),
      {
        id: 'custom' as const,
        label: this.rawCopy('staff.block.repeatCustom'),
        detail: null,
        checked: custom,
      },
    ];
  });

  protected pickRepeat(id: RepeatPreset | 'custom'): void {
    const start = this.startDay();
    if (start === null) return;
    this.typedError.set(null);
    this.customOpen.set(id === 'custom');
    this.setRule(
      id === 'custom'
        ? ruleForCustom(start, this.draft().repeat)
        : ruleForPreset(id, start, this.draft().repeat),
    );
  }

  private setRule(rule: RecurrenceRule | null): void {
    this.draft.update((current) =>
      current.repeat === rule || (rule !== null && rule.equals(current.repeat))
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
        label: this.rawCopy(`staff.block.repeatFrequencies.${frequency}`),
        testId: `staff-block-repeat-frequency-${frequency}`,
      })),
  );

  protected setFrequency(id: string): void {
    this.frequencyMenu.set(false);
    const rule = this.draft().repeat;
    const start = this.startDay();
    const frequency = FREQUENCIES.find((entry) => entry === id);
    if (rule === null || start === null || frequency === undefined) return;
    this.typedError.set(null);
    this.setRule(ruleForFrequency(rule, frequency, start));
  }

  /** «седмици» after «2» — the interval field's unit, in the rule's own period. */
  protected intervalUnit(rule: RecurrenceRule): string {
    return this.rawCopy(
      `staff.block.repeatUnit.${rule.frequency}.${this.pluralOf(rule.interval)}`,
    );
  }

  protected commitInterval(value: string): void {
    const rule = this.draft().repeat;
    if (rule === null) return;
    this.typed(rule.with({ interval: Number(value) }));
  }

  /** The weekly rule's days as ISO numbers, for the picker. */
  protected readonly weekdayIsos = computed<readonly number[]>(() => {
    const pattern = this.draft().repeat?.pattern;
    return pattern?.frequency === 'weekly' ? pattern.weekdays.map(isoOf) : [];
  });

  protected setWeekdays(isos: readonly number[]): void {
    const rule = this.draft().repeat;
    if (rule === null || rule.frequency !== 'weekly') return;
    const next = rule.with({
      pattern: { frequency: 'weekly', weekdays: isos.map(weekdayFromIso) },
    });
    if (next.isSuccess()) this.setRule(next.value);
  }

  protected readonly monthlyMenu = signal(false);

  /**
   * The monthly readings the start offers — Google's own list: the date,
   * its week, the last one — plus the rule's own, should it be none of
   * them (a start moved under a shaped rule).
   */
  private readonly monthlyDays = computed<readonly MonthlyDay[]>(() => {
    const start = this.startDay();
    const pattern = this.draft().repeat?.pattern;
    if (start === null || pattern?.frequency !== 'monthly') return [];
    const offered = RecurrenceRule.monthlyDaysFor(start);
    return offered.some((day) => monthlyId(day) === monthlyId(pattern.day))
      ? offered
      : [...offered, pattern.day];
  });

  protected readonly monthlyOptions = computed<readonly UiChoiceOption[]>(() =>
    this.monthlyDays().map((day) => ({
      id: monthlyId(day),
      label: capitalised(this.monthlyPhrase(day), this.locale()),
      testId: `staff-block-repeat-month-day-${monthlyId(day)}`,
    })),
  );

  protected readonly monthlySelectedId = computed(() => {
    const pattern = this.draft().repeat?.pattern;
    return pattern?.frequency === 'monthly' ? monthlyId(pattern.day) : null;
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
    const next = rule.with({ pattern: { frequency: 'monthly', day } });
    if (next.isSuccess()) this.setRule(next.value);
  }

  /* How it ends. */

  protected readonly endMenu = signal(false);
  protected readonly untilOpen = signal(false);

  protected readonly endOptions = computed<readonly UiChoiceOption[]>(() => [
    {
      id: 'until',
      label: this.rawCopy('staff.block.repeatEndOn'),
      testId: 'staff-block-repeat-end-until',
    },
    {
      id: 'count',
      label: this.rawCopy('staff.block.repeatEndAfter'),
      testId: 'staff-block-repeat-end-count',
    },
  ]);

  protected readonly endKindLabel = computed(
    () =>
      this.endOptions().find(
        (option) => option.id === this.draft().repeat?.end.kind,
      )?.label ?? '',
  );

  protected setEndKind(id: string): void {
    this.endMenu.set(false);
    const rule = this.draft().repeat;
    const start = this.startDay();
    if (rule === null || start === null) return;
    if (id !== 'until' && id !== 'count') return;
    this.typedError.set(null);
    this.setRule(ruleForEndKind(rule, id, start));
  }

  protected readonly untilKey = computed(() => {
    const end = this.draft().repeat?.end;
    return end?.kind === 'until' ? end.day.key() : null;
  });

  protected setUntil(dayKey: string): void {
    this.untilOpen.set(false);
    const rule = this.draft().repeat;
    const day = dayOf(dayKey);
    if (rule === null || day === null) return;
    this.typed(rule.with({ end: { kind: 'until', day } }));
  }

  protected readonly countFigure = computed(() => {
    const end = this.draft().repeat?.end;
    return end?.kind === 'count' ? String(end.count) : '';
  });

  protected readonly countUnit = computed(() => {
    const end = this.draft().repeat?.end;
    const count = end?.kind === 'count' ? end.count : 0;
    return this.rawCopy(`staff.block.repeatTimesUnit.${this.pluralOf(count)}`);
  });

  protected commitCount(value: string): void {
    const rule = this.draft().repeat;
    if (rule === null) return;
    this.typed(rule.with({ end: { kind: 'count', count: Number(value) } }));
  }

  /** A typed change: taken when the domain holds it, said when it refuses. */
  private typed(next: ReturnType<RecurrenceRule['with']>): void {
    if (next.isFailure()) {
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
    if (series === null || series.isFailure()) return null;
    const { count, first, last } = series.value;
    const locale = this.locale();
    return [
      this.daysPhrase(rule),
      this.transloco.translate(
        `staff.block.repeatTimes.${this.pluralOf(count)}`,
        { count },
      ),
      count === 1
        ? formatDayPill(first.key(), locale)
        : formatDayPillRange(first.key(), last.key(), locale),
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
      `staff.block.repeatEvery.${rule.frequency}.${this.pluralOf(rule.interval)}`,
      { count: rule.interval },
    );
  }

  /** Which days of the period — `null` for every day. */
  private daysPhrase(rule: RecurrenceRule): string | null {
    const locale = this.locale();
    const pattern = rule.pattern;
    switch (pattern.frequency) {
      case 'daily':
        return null;
      case 'weekly': {
        const days = pattern.weekdays;
        if (
          days.length === MONDAY_TO_FRIDAY.length &&
          days.every((day, index) => day === MONDAY_TO_FRIDAY[index])
        ) {
          return `${weekdayName('monday', locale, 'short')} – ${weekdayName('friday', locale, 'short')}`;
        }
        const only = days.length === 1 ? days[0] : undefined;
        if (only !== undefined) {
          return this.rawCopy(`staff.block.repeatOnWeekday.${only}`);
        }
        return new Intl.ListFormat(locale, {
          style: 'long',
          type: 'conjunction',
        }).format(days.map((day) => weekdayName(day, locale, 'short')));
      }
      case 'monthly':
        return this.monthlyPhrase(pattern.day);
      case 'yearly':
        return this.transloco.translate('staff.block.repeatOnDayOfYear', {
          // A leap year, so 29 February has a date to be written as.
          date: new Intl.DateTimeFormat(locale, {
            day: 'numeric',
            month: 'long',
            timeZone: 'UTC',
          }).format(new Date(Date.UTC(2000, pattern.month - 1, pattern.date))),
        });
    }
  }

  /** «на 24-то число», «в последния четвъртък», «във втората сряда». */
  private monthlyPhrase(day: MonthlyDay): string {
    if (day.by === 'date') {
      return this.transloco.translate('staff.block.repeatOnDate', {
        date: this.ordinal(day.date),
      });
    }
    // Bulgarian agrees the ordinal with the weekday's gender («първия
    // четвъртък», «първата сряда»), so the table is per gender and the
    // gender is the locale's own fact about each day.
    const gender =
      this.rawCopy(`staff.block.repeatWeekdayGender.${day.weekday}`) ===
      'feminine'
        ? 'feminine'
        : 'masculine';
    return this.transloco.translate(
      `staff.block.repeatOnNth.${gender}.${day.week === -1 ? 'last' : day.week}`,
      { weekday: weekdayName(day.weekday, this.locale(), 'long') },
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
  private presetDetail(id: RepeatPreset, start: CalendarDay): string | null {
    if (id === 'never' || id === 'daily') return null;
    const rule = ruleForPreset(id, start, null);
    return rule === null ? null : this.daysPhrase(rule);
  }

  /* ── The frame ─────────────────────────────────────────────────── */

  protected readonly dayOpen = signal(false);
  protected readonly locale = computed(() => this.transloco.getActiveLang());

  protected stepDay(offset: number): void {
    this.pickDay(addDays(this.draft().dayKey, offset));
  }

  protected pickDay(dayKey: string): void {
    this.dayOpen.set(false);
    if (dayKey === this.draft().dayKey) return;
    const from = dayOf(this.draft().dayKey);
    const to = dayOf(dayKey);
    this.draft.update((current) => ({
      ...current,
      dayKey,
      // The series starts where the frame is: its start's own weekday or
      // date follows along, and an end the new start overtook moves on.
      repeat:
        current.repeat !== null && from !== null && to !== null
          ? ruleForStart(current.repeat, from, to)
          : current.repeat,
    }));
    this.dayChanged.emit(dayKey);
  }

  protected readonly frameWindow = computed<GridWindow>(() => ({
    startMinute: 0,
    endMinute: DAY_MINUTES,
  }));

  /** Rows and hours across, once the chairs outnumber the grid's columns. */
  private readonly frameGrid = viewChild(StaffTimeGrid);
  private readonly frameTimeline = viewChild(StaffTimeline);

  /** Full screen for the frame — shared with the block sheet. */
  private readonly frameSection =
    viewChild<ElementRef<HTMLElement>>('frameSection');

  protected readonly fullscreen = new FrameFullscreen({
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
  protected readonly frameRosterStart = computed(() => {
    const starts = this.chosenBarbers()
      .map((barber) => this.laneOf(barber.id)?.rosterStartMinute)
      .filter((value): value is number => value !== undefined);
    return starts.length ? Math.min(...starts) : 0;
  });

  /** ONE COLUMN PER CHOSEN CHAIR: the block drawn over each real day. */
  protected readonly frameColumns = computed<readonly GridColumn[]>(() => {
    const vm = this.vm();
    const draft = this.draft();
    const label = this.rawCopy('staff.block.title');
    const allDayLabel = this.rawCopy('staff.block.allDay');
    return this.chosenBarbers().map((barber) => {
      const lane = this.laneOf(barber.id);
      const rosterStart = lane?.rosterStartMinute ?? 0;
      const rosterEnd = lane?.rosterEndMinute ?? 0;
      // ALL DAY IS THE WHOLE ROW (owner, 2026-09-09: "all-day blockers
      // should span full width for the barber row"). It used to cover the
      // roster, which read as a timed block that happened to fit the shift;
      // the whole axis says what the switch says.
      const block: GridEvent = {
        id: 'draft-block',
        kind: 'block',
        barberTone: null,
        startMinute: draft.allDay ? 0 : draft.startMinute,
        endMinute: draft.allDay ? DAY_MINUTES : draft.endMinute,
        title: label,
        detail: null,
        attribution: null,
        status: null,
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
          kind: 'visit',
          barberTone: neighbour.tone,
          startMinute: neighbour.startMinute,
          endMinute: neighbour.endMinute,
          title: neighbour.name,
          detail: null,
          attribution: null,
          status: null,
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
        isToday: vm.nowMinute !== null,
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
    return this.chosenBarbers().flatMap((barber) =>
      (this.laneOf(barber.id)?.neighbours ?? [])
        .filter(
          (visit) =>
            draft.allDay ||
            (visit.startMinute < draft.endMinute &&
              visit.endMinute > draft.startMinute),
        )
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

  private range(): BlockEditorRange {
    const draft = this.draft();
    return {
      barberId: draft.barberIds[0] ?? '',
      dayKey: draft.dayKey,
      startMinute: draft.startMinute,
      endMinute: draft.endMinute,
    };
  }

  protected convert(): void {
    this.converted.emit(this.range());
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

  protected readonly snapMinutes = GRAIN_MINUTES;

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
    (a.repeat === null ? b.repeat === null : a.repeat.equals(b.repeat))
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
