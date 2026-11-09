import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import {
  UiAmountField,
  UiButton,
  UiModalSheet,
  UiStack,
} from '@creativo/ui/controls';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { UiSheetActionBar, UiSheetHeadline } from '@creativo/ui/patterns';
import type { AnalyticsGoalSheetVm } from '../analytics.vm';

let sequence = 0;

/**
 * THE GOAL SHEET (staff-analytics-v2 CUJ 6, PR 6): a modal sheet with two
 * amount fields — the range's low and high end, in euro — and «Запази» in
 * the sheet's action row. It decides nothing: the store runs
 * `AnalyticsGoal.rangeOf` over the two sums and this sheet prints the
 * presenter's wording of that verdict (`vm.refusal`), with «Запази» off on
 * any refusal and busy while the callable answers. Unlike the range sheet
 * the save is asynchronous, so the OWNER closes it: `open` falling while
 * the sheet is up starts the house two-phase exit, as ✕, the scrim and
 * Escape do; `closeFinished` ends it and tells the owner.
 */
@Component({
  selector: 'lib-analytics-goal-sheet',
  imports: [
    UiAmountField,
    UiButton,
    UiForegroundStyleDirective,
    UiModalSheet,
    UiSheetActionBar,
    UiSheetHeadline,
    UiStack,
    UiTextDirective,
  ],
  templateUrl: './analytics-goal-sheet.html',
  styleUrl: './analytics-goal-sheet.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsGoalSheet {
  readonly vm = input.required<AnalyticsGoalSheetVm>();
  readonly open = input(false);
  /** The two sums in cents; `null` while empty. */
  readonly low = input<number | null>(null);
  readonly high = input<number | null>(null);
  readonly lowChange = output<number | null>();
  readonly highChange = output<number | null>();
  /** «Запази» — the owner sends the range; the sheet stays until `open` falls. */
  readonly saved = output<void>();
  /** «Премахни целта» — the owner removes the month's goal. */
  readonly removed = output<void>();
  /** The exit finished. */
  readonly closed = output<void>();

  protected readonly titleId = `analytics-goal-sheet-${++sequence}-title`;
  /** The sheet is on screen — up, or on its way out. */
  private readonly shown = signal(false);
  protected readonly closing = signal(false);
  protected readonly presented = computed(
    () => this.shown() && !this.closing(),
  );

  constructor() {
    // `open` rising shows the sheet; falling while it is up starts the exit.
    effect(() => {
      const open = this.open();
      if (open) {
        this.shown.set(true);
        this.closing.set(false);
      } else if (this.shown()) {
        this.closing.set(true);
      }
    });
  }

  protected save(): void {
    if (!this.vm().saveEnabled) return;
    this.saved.emit();
  }

  protected requestClose(): void {
    if (!this.presented()) return;
    this.closing.set(true);
  }

  protected finishClose(): void {
    if (!this.closing()) return;
    this.closing.set(false);
    this.shown.set(false);
    this.closed.emit();
  }
}
