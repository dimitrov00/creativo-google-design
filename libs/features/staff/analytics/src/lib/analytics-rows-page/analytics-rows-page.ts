import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import {
  UI_SHEET_HEADLINE,
  UiListGroup,
  UiIcon,
  UiListRow,
  UiModalSheet,
  UiStack,
  UiAvatar,
} from '@creativo/ui/controls';
import {
  UiForegroundStyleDirective,
  UiInteractiveDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  VisitList,
  VisitListStyle,
  VisitPerspective,
} from '@creativo/features/shared/visits';
import type { BarberId, LocalDate } from '@core/primitives';
import { type AnalyticsDrillVm, DrillRows } from '../analytics.vm';

/**
 * THE DRILL-DOWN (`docs/designs/staff-analytics.md`, The screen · Drill-down)
 * — the rows a figure is made of, on the app's pushed-page shell
 * (`ui-modal-sheet`, its large title collapsing into the bar), and a footer
 * equal to the figure: seats through the shared visits list
 * (`lib-visit-list`), days with their parts, or — in shop scope — one row
 * per barber, which opens that barber's report. Mounted inside a `@defer`
 * block by the page: nothing here loads until a figure is opened.
 */
@Component({
  selector: 'lib-analytics-rows-page',
  imports: [
    UI_SHEET_HEADLINE,
    UiAvatar,
    UiForegroundStyleDirective,
    UiInteractiveDirective,
    UiListGroup,
    UiIcon,
    UiListRow,
    UiModalSheet,
    UiStack,
    UiTextDirective,
    VisitList,
  ],
  templateUrl: './analytics-rows-page.html',
  styleUrl: './analytics-rows-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsRowsPage {
  /** The page's rows; `null` closes it. */
  readonly vm = input.required<AnalyticsDrillVm | null>();
  /** The page was dismissed and its exit has played. */
  readonly closed = output<void>();
  /** A barber's row of a shop drill-down: open that barber's report. */
  readonly openBarber = output<BarberId>();
  /** A year's month row: the month to open (PR 4b). */
  readonly openMonth = output<LocalDate>();

  protected readonly DrillRows = DrillRows;
  protected readonly VisitPerspective = VisitPerspective;
  protected readonly VisitListStyle = VisitListStyle;
  protected readonly titleId = 'analytics-rows-title';

  protected readonly closing = signal(false);
  /** The last page shown — kept through the exit, so the sheet does not empty as it leaves. */
  private lastVm: AnalyticsDrillVm | null = null;
  protected readonly shown = computed(() => {
    const vm = this.vm();
    if (vm !== null) this.lastVm = vm;
    return vm ?? this.lastVm;
  });
  protected readonly open = computed(
    () => this.vm() !== null && !this.closing(),
  );

  protected requestClose(): void {
    if (this.vm() === null) return;
    this.closing.set(true);
  }

  protected finishClose(): void {
    if (!this.closing()) return;
    this.closing.set(false);
    this.closed.emit();
  }

  protected pickBarber(barberId: BarberId): void {
    this.openBarber.emit(barberId);
    this.requestClose();
  }
}
