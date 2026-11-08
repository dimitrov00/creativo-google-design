import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import {
  UiButton,
  UiDateField,
  type UiDateFieldParts,
  UiModalSheet,
  UiStack,
} from '@creativo/ui/controls';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { UiSheetActionBar, UiSheetHeadline } from '@creativo/ui/patterns';
import type { AnalyticsRangeVm } from '../analytics.vm';

let sequence = 0;

/**
 * THE CUSTOM-RANGE SHEET (staff-analytics-v2, «Sections in order» 3, PR 4b):
 * a modal sheet with two date fields — from, to — and «Приложи» in the
 * sheet's action row. It decides nothing: the store runs
 * `AnalyticsPeriod.of(Custom, from, to)` and `isWithinRange` over the
 * fields and this sheet prints the presenter's wording of that verdict
 * (`vm.refusal`), with «Приложи» disabled on any refusal. The exit is the
 * house two-phase close: ✕, the scrim, Escape and an applied range start it,
 * `closeFinished` ends it and tells the owner.
 */
@Component({
  selector: 'lib-analytics-range-sheet',
  imports: [
    UiButton,
    UiDateField,
    UiForegroundStyleDirective,
    UiModalSheet,
    UiSheetActionBar,
    UiSheetHeadline,
    UiStack,
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
