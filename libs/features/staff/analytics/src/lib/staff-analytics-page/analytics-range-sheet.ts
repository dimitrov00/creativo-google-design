import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { LocalDate } from '@core/primitives';
import {
  UiButton,
  type UiDateFieldParts,
  UiIcon,
  UiModalSheet,
  UiMonthPicker,
} from '@creativo/ui/controls';
import {
  UiForegroundStyleDirective,
  UiInteractiveDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UiListGroup,
  UiListRow,
  UiSheetActionBar,
  UiSheetHeadline,
} from '@creativo/ui/patterns';
import { partsToLocalDate } from '../analytics.presenter';
import type { AnalyticsRangeVm } from '../analytics.vm';

let sequence = 0;

/** Which row's calendar is unfolded. */
type RangeEnd = 'from' | 'to';

/**
 * THE CUSTOM PERIOD SHEET (staff-analytics-v3, «The custom period sheet»;
 * Revolut's «Select custom period»): a modal sheet with two collapsible
 * rows, «От» and «До», each showing its date; tapping one unfolds an inline
 * month calendar (`ui-month-picker`, from the reach's first day) under it,
 * one open at a time — picking «От» moves on to «До». «Приложи» in the
 * sheet's action row applies the range. It decides nothing: the store runs
 * `AnalyticsPeriod.of(Custom, from, to)` and `isWithinRange` over the two
 * days and this sheet prints the presenter's wording of that verdict
 * (`vm.refusal`), with «Приложи» off on any refusal. The exit is the house
 * two-phase close.
 */
@Component({
  selector: 'lib-analytics-range-sheet',
  imports: [
    UiButton,
    UiForegroundStyleDirective,
    UiIcon,
    UiInteractiveDirective,
    UiListGroup,
    UiListRow,
    UiModalSheet,
    UiMonthPicker,
    UiSheetActionBar,
    UiSheetHeadline,
    UiTextDirective,
  ],
  templateUrl: './analytics-range-sheet.html',
  styleUrl: './analytics-range-sheet.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsRangeSheet {
  readonly vm = input.required<AnalyticsRangeVm>();
  readonly open = input(false);
  readonly from = input<UiDateFieldParts | null>(null);
  readonly to = input<UiDateFieldParts | null>(null);
  /** Each row's date in words («1.11.2026»); `null` shows «Избери». */
  readonly fromText = input<string | null>(null);
  readonly toText = input<string | null>(null);
  readonly fromChange = output<UiDateFieldParts | null>();
  readonly toChange = output<UiDateFieldParts | null>();
  /** «Приложи» — the owner picks the range; the sheet then closes itself. */
  readonly applied = output<void>();
  /** The exit finished. */
  readonly closed = output<void>();

  protected readonly titleId = `analytics-range-sheet-${++sequence}-title`;
  protected readonly closing = signal(false);
  protected readonly presented = computed(() => this.open() && !this.closing());

  /** The row whose calendar is unfolded — «От» when the sheet opens. */
  protected readonly unfolded = signal<RangeEnd | null>('from');
  protected readonly fromDate = computed(() => partsToLocalDate(this.from()));
  protected readonly toDate = computed(() => partsToLocalDate(this.to()));

  constructor() {
    // Each opening starts on «От».
    effect(() => {
      if (this.open()) this.unfolded.set('from');
    });
  }

  protected toggle(end: RangeEnd): void {
    this.unfolded.update((open) => (open === end ? null : end));
  }

  protected pick(end: RangeEnd, day: LocalDate): void {
    const parts = LocalDate.parts(day);
    if (end === 'from') {
      this.fromChange.emit(parts);
      this.unfolded.set('to');
    } else {
      this.toChange.emit(parts);
      this.unfolded.set(null);
    }
  }

  protected apply(): void {
    if (!this.vm().applyEnabled) return;
    this.applied.emit();
    this.requestClose();
  }

  protected requestClose(): void {
    if (!this.presented()) return;
    this.closing.set(true);
  }

  protected finishClose(): void {
    if (!this.closing()) return;
    this.closing.set(false);
    this.closed.emit();
  }
}
