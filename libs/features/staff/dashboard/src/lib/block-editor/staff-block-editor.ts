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
  UiChoiceMenu,
  type UiChoiceOption,
  UiAvatar,
  UiButton,
  UiIcon,
  UiSwitch,
  UiTimeField,
} from '@creativo/ui/controls';
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
} from '@creativo/ui/patterns';
import { StaffDayPill } from '../day-pill/staff-day-pill';
import { FrameFullscreen } from '../shared/frame-fullscreen';
import { SwipeToDeleteDirective } from '../swipe-to-delete/swipe-to-delete.directive';
import { StaffTimeline } from '../timeline/staff-timeline';
import { addDays } from '../staff-day.store';
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
 * owns the store. A REPEAT is written day by day (`expandRepeat`): the
 * document is per barber-day, so a series is that many documents, and a
 * day lifted later lifts that day alone. This component drafts and draws;
 * it never writes.
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

export type BlockRepeatKind = 'daily' | 'weekdays' | 'weekly';

/** A series: the same block on every day of the kind, up to and including `untilDayKey`. */
export interface BlockRepeat {
  readonly kind: BlockRepeatKind;
  readonly untilDayKey: string;
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
  readonly dayKey: string;
  readonly allDay: boolean;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly repeat: BlockRepeat | null;
}

interface BlockDraft {
  readonly barberIds: readonly string[];
  readonly dayKey: string;
  readonly allDay: boolean;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly repeat: BlockRepeat | null;
}

const DAY_MINUTES = 24 * 60;
const GRAIN_MINUTES = 5;
/** How far a series reaches by default — four weeks of lunches. */
const REPEAT_DEFAULT_DAYS = 28;

/**
 * Past this many chairs the picture turns on its side (owner, 2026-09-09).
 * The grid's own narrow cap: two chairs side by side carry a name and a
 * time on a phone, three carry neither.
 */
const TIMELINE_FROM_CHAIRS = 2;
/** The most days one series may write — a guard, not a feature. */
const REPEAT_CAP = 400;

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

function isWeekend(dayKey: string): boolean {
  const [year, month, day] = dayKey.split('-').map(Number);
  const weekday = new Date(
    Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1),
  ).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/**
 * The days a series is written on — the first day and every following one
 * of its kind, up to and including the end. Pure, so the write and the
 * sheet's own count agree by construction.
 */
export function expandRepeat(
  dayKey: string,
  repeat: BlockRepeat | null,
): readonly string[] {
  if (repeat === null) return [dayKey];
  const step = repeat.kind === 'weekly' ? 7 : 1;
  const days: string[] = [];
  for (
    let day = dayKey, guard = 0;
    day <= repeat.untilDayKey && guard < REPEAT_CAP;
    day = addDays(day, step), guard += 1
  ) {
    if (repeat.kind === 'weekdays' && isWeekend(day)) continue;
    days.push(day);
  }
  return days;
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
    UiForegroundStyleDirective,
    UiInteractiveDirective,
    UiTextDirective,
    UiListGroup,
    UiListRow,
    UiMenuTrigger,
    UiSheetActionBar,
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
    () =>
      this.vm().blockId === null ||
      JSON.stringify(this.draft()) !== JSON.stringify(this.seed()),
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

  /* ── The repeat ────────────────────────────────────────────────── */

  protected readonly repeatMenu = signal(false);
  protected readonly untilOpen = signal(false);

  protected readonly repeatOptions = computed<readonly UiChoiceOption[]>(() => [
    {
      id: 'none',
      label: this.rawCopy('staff.block.repeatNone'),
      testId: 'staff-block-repeat-none',
    },
    {
      id: 'daily',
      label: this.rawCopy('staff.block.repeatDaily'),
      testId: 'staff-block-repeat-daily',
    },
    {
      id: 'weekdays',
      label: this.rawCopy('staff.block.repeatWeekdays'),
      testId: 'staff-block-repeat-weekdays',
    },
    {
      id: 'weekly',
      label: this.rawCopy('staff.block.repeatWeekly'),
      testId: 'staff-block-repeat-weekly',
    },
  ]);

  protected readonly repeatId = computed(
    () => this.draft().repeat?.kind ?? 'none',
  );

  protected readonly repeatLabel = computed(
    () =>
      this.repeatOptions().find((option) => option.id === this.repeatId())
        ?.label ?? '',
  );

  /** How many days the series would write — said on the sheet, so the size of the act is known before «Запази». */
  protected readonly repeatDays = computed(
    () => expandRepeat(this.draft().dayKey, this.draft().repeat).length,
  );

  protected setRepeat(id: string): void {
    this.repeatMenu.set(false);
    this.draft.update((current) => {
      if (id === 'none') return { ...current, repeat: null };
      const kind = id as BlockRepeatKind;
      return {
        ...current,
        repeat: {
          kind,
          untilDayKey:
            current.repeat?.untilDayKey ??
            addDays(current.dayKey, REPEAT_DEFAULT_DAYS),
        },
      };
    });
  }

  protected setUntil(dayKey: string): void {
    this.untilOpen.set(false);
    this.draft.update((current) =>
      current.repeat === null
        ? current
        : {
            ...current,
            repeat: {
              ...current.repeat,
              untilDayKey: dayKey < current.dayKey ? current.dayKey : dayKey,
            },
          },
    );
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
    this.draft.update((current) => ({
      ...current,
      dayKey,
      // A series that ended before its own first day is no series.
      repeat:
        current.repeat !== null && current.repeat.untilDayKey < dayKey
          ? {
              ...current.repeat,
              untilDayKey: addDays(dayKey, REPEAT_DEFAULT_DAYS),
            }
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
    const draft = this.draft();
    this.committed.emit({
      barberIds: draft.barberIds,
      dayKey: draft.dayKey,
      allDay: draft.allDay,
      startMinute: draft.startMinute,
      endMinute: draft.endMinute,
      repeat: draft.repeat,
    });
  }

  protected readonly snapMinutes = GRAIN_MINUTES;

  private rawCopy(key: string): string {
    const table = this.transloco.getTranslation(this.transloco.getActiveLang());
    const raw = (table as Record<string, unknown> | undefined)?.[key];
    return typeof raw === 'string' ? raw : this.transloco.translate(key);
  }
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
