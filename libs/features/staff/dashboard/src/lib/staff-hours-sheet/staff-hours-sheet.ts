import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { switchMap } from 'rxjs';
import { MinuteRange } from '@core/components';
import {
  type BarberId,
  type LocalDate,
  type LocationId,
  MinuteOfDay,
  type Weekday,
} from '@core/primitives';
import { type RosterWeek, RosterWeekSystem } from '@core/systems';
import { translateCodedError } from '@creativo/infrastructure/i18n';
import {
  UiButton,
  UiChoiceMenu,
  type UiChoiceOption,
  UiIcon,
  UiModalSheet,
  UiSwitch,
  UiTimeField,
  UiWeekdayPicker,
} from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UiListGroup,
  UiListRow,
  UiMenuTrigger,
  UiSectionHeader,
  UiSheetActionBar,
  UiSheetHeadline,
} from '@creativo/ui/patterns';
import { StaffDayPill } from '../day-pill/staff-day-pill';
import { StaffDayStore } from '../staff-day.store';
import { WEEKDAY_WORD } from '../block-editor/block-repeat';
import { hoursClock, hoursWeekVm } from './staff-hours.presenter';
import type { HoursWords } from './staff-hours.vm';

/** A chair the sheet can open on. */
export type HoursChair = { readonly id: BarberId; readonly label: string };

/** Which list of a day's page a time edit lands in. */
type DayList = 'shifts' | 'breaks';

/**
 * THE WEEKLY HOURS (owner, 2026-11-06: "weekly hours editor with
 * «＋ Почивка»" — Timely, 7shifts, Turo, Swarm): a chair's week, one row
 * per weekday — its shifts, or «Почивен», and its breaks under them. A row
 * pushes the weekday's page (Turo's «Edit Sunday hours»): «Работи», the
 * shifts with «＋ Добави часове», the breaks with «＋ Почивка», and «Приложи
 * и за» to copy the day onto others. Nothing is written until «Запази»:
 * the whole week, from «В сила от» on, as ONE roster write
 * (`setRosterWeek`) — earlier weeks stay as they were worked. The week is
 * the system's (`RosterWeekSystem`); the sheet holds a draft of it.
 */
@Component({
  selector: 'lib-staff-hours-sheet',
  imports: [
    StaffDayPill,
    UiButton,
    UiChoiceMenu,
    UiForegroundStyleDirective,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiMenuTrigger,
    UiModalSheet,
    UiSectionHeader,
    UiSheetActionBar,
    UiSheetHeadline,
    UiStack,
    UiSwitch,
    UiTextDirective,
    UiTimeField,
    UiWeekdayPicker,
  ],
  templateUrl: './staff-hours-sheet.html',
  // The visit sheet's rows, pills and pages — the block sheet's own list.
  styleUrls: [
    '../visit-editor/staff-visit-editor.css',
    '../visit-editor/staff-visit-editor.sections.css',
    '../visit-editor/staff-visit-editor.rows.css',
    './staff-hours-sheet.css',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { class: 'staff-visit staff-hours' },
})
export class StaffHoursSheet {
  /** The chairs the sheet may show — the schedule's own. */
  readonly uiChairs = input.required<readonly HoursChair[]>();
  /** The chair it opens on. */
  readonly uiChairId = input.required<BarberId>();
  /** The shop's today — the earliest day a week may start. */
  readonly uiToday = input.required<LocalDate>();
  readonly uiLocale = input('bg');
  /** Where a chair's new shift is worked — its home shop. */
  readonly uiHomeOf =
    input.required<(barberId: BarberId) => LocationId | null>();
  /** ✕, Escape, the scrim — or a save that landed. */
  readonly closed = output<void>();
  /** A save landed — the page says so. */
  readonly saved = output<void>();

  protected readonly store = inject(StaffDayStore);
  private readonly transloco = inject(TranslocoService);
  private readonly copyTable = toSignal(this.transloco.selectTranslation());
  protected readonly t = (key: string, params?: object): string => {
    this.copyTable();
    return this.transloco.translate<string>(key, params);
  };

  protected readonly chairId = linkedSignal(() => this.uiChairId());
  protected readonly fromDay = linkedSignal<LocalDate>(() => this.uiToday());
  protected readonly fromOpen = signal(false);
  protected readonly chairMenu = signal(false);

  private readonly roster = toSignal(
    toObservable(this.chairId).pipe(
      switchMap((barberId) => this.store.rosterOf(barberId)),
    ),
  );
  /** The week the roster holds from «В сила от» — what a draft is measured against. */
  private readonly stored = computed<RosterWeek>(() => {
    const roster = this.roster();
    return RosterWeekSystem.weekOn(
      roster?.ok ? (roster.value?.versions ?? []) : [],
      this.fromDay(),
    );
  });
  /** The draft — reseeded whenever another chair or day is read. */
  protected readonly week = linkedSignal<RosterWeek>(() => this.stored());
  protected readonly dirty = computed(() => this.week() !== this.stored());

  private readonly words = computed<HoursWords>(() => {
    this.copyTable();
    return {
      weekday: (weekday) => this.weekdayName(weekday),
      off: this.t('staff.hours.off'),
      breakLine: (ranges) => this.t('staff.hours.breakLine', { ranges }),
    };
  });
  protected readonly days = computed(() =>
    hoursWeekVm(this.week(), this.words()),
  );
  protected readonly chairLabel = computed(
    () =>
      this.uiChairs().find((chair) => chair.id === this.chairId())?.label ?? '',
  );
  protected readonly chairOptions = computed<readonly UiChoiceOption[]>(() =>
    this.uiChairs().map((chair) => ({
      id: chair.id,
      label: chair.label,
      testId: `staff-hours-chair-${chair.id}`,
    })),
  );
  protected readonly weekError = computed(() => {
    const judged = RosterWeekSystem.validate(this.week());
    return judged.ok ? null : translateCodedError(this.transloco, judged.error);
  });

  /* ── The weekday's page ──────────────────────────────────────────── */

  /** The page's two lists, in order: the shifts, then the breaks inside them. */
  protected readonly lists: readonly DayList[] = ['shifts', 'breaks'];
  protected readonly openDay = signal<Weekday | null>(null);
  protected readonly shifts = signal<readonly MinuteRange[]>([]);
  protected readonly breaks = signal<readonly MinuteRange[]>([]);
  protected readonly copyTo = signal<readonly Weekday[]>([]);

  protected readonly dayTitle = computed(() => {
    const day = this.openDay();
    return day === null ? null : this.weekdayName(day);
  });
  /** The week with the page's day in it — what «Готово» keeps. */
  private readonly dayWeek = computed<RosterWeek | null>(() => {
    const day = this.openDay();
    const home = this.home();
    return day === null || home === null
      ? null
      : RosterWeekSystem.withDay(
          this.week(),
          day,
          this.shifts(),
          this.breaks(),
          home,
        );
  });
  protected readonly dayError = computed(() => {
    const week = this.dayWeek();
    const judged = week === null ? null : RosterWeekSystem.validate(week);
    return judged === null || judged.ok
      ? null
      : translateCodedError(this.transloco, judged.error);
  });

  protected openWeekday(weekday: Weekday): void {
    const day = RosterWeekSystem.dayOf(this.week(), weekday);
    this.shifts.set(
      day.shifts.map((shift) =>
        MinuteRange.of(shift.startMinutes, shift.endMinutes),
      ),
    );
    this.breaks.set(day.breaks);
    this.copyTo.set([weekday]);
    this.openDay.set(weekday);
  }

  /** ‹ or «Готово»: the day kept in the draft, and copied where asked. */
  protected done(): void {
    const day = this.openDay();
    const week = this.dayWeek();
    if (day === null || week === null || this.dayError() !== null) return;
    this.week.set(RosterWeekSystem.copyDay(week, day, this.copyTo()));
    this.openDay.set(null);
  }

  protected setWorking(on: boolean): void {
    const first = RosterWeekSystem.nextShift([]);
    this.shifts.set(on && first !== null ? [first] : []);
    if (!on) this.breaks.set([]);
  }

  protected add(list: DayList): void {
    const next =
      list === 'shifts'
        ? RosterWeekSystem.nextShift(this.shifts())
        : RosterWeekSystem.nextBreak(this.breaks());
    if (next !== null) this.listOf(list).update((ranges) => [...ranges, next]);
  }

  protected remove(list: DayList, index: number): void {
    this.listOf(list).update((ranges) => ranges.filter((_, i) => i !== index));
  }

  protected setStart(list: DayList, index: number, clock: string): void {
    const start = MinuteOfDay.parseClock(clock);
    if (!start.ok) return;
    this.listOf(list).update((ranges) =>
      ranges.map((range, i) =>
        i === index ? MinuteRange.of(start.value, range.endMinutes) : range,
      ),
    );
  }

  protected setEnd(list: DayList, index: number, clock: string): void {
    const end = RosterWeekSystem.endOf(clock);
    if (end === null) return;
    this.listOf(list).update((ranges) =>
      ranges.map((range, i) =>
        i === index ? MinuteRange.of(range.startMinutes, end) : range,
      ),
    );
  }

  protected readonly clock = hoursClock;

  /* ── The save ────────────────────────────────────────────────────── */

  protected pickChair(id: string): void {
    this.chairMenu.set(false);
    const chair = this.uiChairs().find((entry) => entry.id === id);
    if (chair !== undefined) this.chairId.set(chair.id);
  }

  protected pickFrom(day: LocalDate): void {
    this.fromOpen.set(false);
    this.fromDay.set(day);
  }

  protected async save(): Promise<void> {
    const locationId = this.home();
    if (!this.dirty() || this.weekError() !== null || locationId === null) {
      return;
    }
    const saved = await this.store.setRosterWeek({
      barberId: this.chairId(),
      locationId,
      fromLocalDate: this.fromDay(),
      ...this.week(),
    });
    if (saved) {
      this.saved.emit();
      this.closed.emit();
    }
  }

  /** The chair's home shop — where a new shift is worked and whose clock says «today»; `null` with no shop at all. */
  protected readonly home = computed<LocationId | null>(() =>
    this.uiHomeOf()(this.chairId()),
  );

  private listOf(list: DayList) {
    return list === 'shifts' ? this.shifts : this.breaks;
  }

  private weekdayName(weekday: Weekday): string {
    return this.t(`staff.hours.weekday.${WEEKDAY_WORD[weekday]}`);
  }
}
