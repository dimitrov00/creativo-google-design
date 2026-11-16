import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { LocalDate } from '@core/primitives';
import {
  UiButton,
  type UiDateFieldParts,
  UiDateRow,
  UiModalSheet,
} from '@creativo/ui/controls';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UiListGroup,
  UiSheetActionBar,
  UiSheetHeadline,
} from '@creativo/ui/patterns';
import { partsToLocalDate } from '../analytics.presenter';
import type { AnalyticsRangeVm } from '../analytics.vm';

let sequence = 0;

/** Which end of the period a pick is for. */
type RangeEnd = 'from' | 'to';

/**
 * THE CUSTOM PERIOD SHEET (staff-analytics-v3, «The custom period sheet»;
 * Revolut's «Select custom period»): a modal sheet with two collapsible
 * rows, «От» and «До» (`ui-date-row`, the app's one date row): each day in
 * a capsule that pops the month, from the reach's first day. «Приложи» in the
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
    UiDateRow,
    UiForegroundStyleDirective,
    UiListGroup,
    UiModalSheet,
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
  readonly fromChange = output<UiDateFieldParts | null>();
  readonly toChange = output<UiDateFieldParts | null>();
  /** «Приложи» — the owner picks the range; the sheet then closes itself. */
  readonly applied = output<void>();
  /** The exit finished. */
  readonly closed = output<void>();

  protected readonly titleId = `analytics-range-sheet-${++sequence}-title`;
  protected readonly closing = signal(false);
  protected readonly presented = computed(() => this.open() && !this.closing());

  protected readonly fromDate = computed(() => partsToLocalDate(this.from()));
  protected readonly toDate = computed(() => partsToLocalDate(this.to()));

  protected pick(end: RangeEnd, day: LocalDate): void {
    const parts = LocalDate.parts(day);
    if (end === 'from') this.fromChange.emit(parts);
    else this.toChange.emit(parts);
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
