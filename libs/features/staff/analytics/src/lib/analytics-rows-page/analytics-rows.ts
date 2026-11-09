import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { BarberId, LocalDate } from '@core/primitives';
import {
  VisitList,
  VisitListStyle,
  VisitPerspective,
  type VisitSectionVm,
} from '@creativo/features/shared/visits';
import {
  UiAvatar,
  UiIcon,
  UiListGroup,
  UiListRow,
  UiStack,
} from '@creativo/ui/controls';
import {
  UiForegroundStyleDirective,
  UiInteractiveDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import { type AnalyticsDrillVm, DrillRows } from '../analytics.vm';

/** How many rows (visits, days, barbers) each page reveals. */
const PAGE = 20;

/**
 * THE ROWS BEHIND A FIGURE — the drill-down's body: the visits by day (a
 * barber's own report), the days, or the barbers (the shop's), then what
 * they add up to. The drill sheet hangs it under its title; the card
 * screen lays it under its chart, as Revolut lays its transactions under
 * the spending graph (owner, 2026-11-09).
 *
 * The rows arrive a page at a time: twelve, then twelve more each time the
 * end of the list comes within reach of the screen (an observed sentinel)
 * — a long range's hundreds of visits never lay out at once. Where the
 * browser has no `IntersectionObserver`, every row is laid out.
 */
@Component({
  selector: 'lib-analytics-rows',
  imports: [
    UiAvatar,
    UiForegroundStyleDirective,
    UiIcon,
    UiInteractiveDirective,
    UiListGroup,
    UiListRow,
    UiStack,
    UiTextDirective,
    VisitList,
  ],
  templateUrl: './analytics-rows.html',
  // The next page waits on this box coming within reach (a zero box is
  // seen too, but a pixel is never in doubt).
  styles: [
    ':host { display: block; } .analytics-rows__sentinel { display: block; block-size: 1px; }',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsRows {
  readonly vm = input.required<AnalyticsDrillVm>();
  /**
   * The footer — what the rows add up to. The drill sheet keeps it; the
   * card screen drops it, its figure already says so above (owner,
   * 2026-11-09).
   */
  readonly showTotal = input(true);
  /** A barber's row of a shop's rows: open that barber's report. */
  readonly openBarber = output<BarberId>();
  /** A year's month row: the month to open. */
  readonly openMonth = output<LocalDate>();

  protected readonly DrillRows = DrillRows;
  protected readonly VisitPerspective = VisitPerspective;
  protected readonly VisitListStyle = VisitListStyle;

  /** How many rows are laid out; a new set of rows starts at one page. */
  private readonly limit = signal(PAGE);

  /**
   * The visits laid out so far, counted by VISIT, not by section: a
   * section is a month, and a long range's months would otherwise lay out
   * hundreds of rows at once. The last section shown is cut where the
   * count runs out.
   */
  protected readonly sections = computed(() => {
    let left = this.limit();
    const out: VisitSectionVm[] = [];
    for (const section of this.vm().sections) {
      if (left <= 0) break;
      out.push(
        section.rows.length <= left
          ? section
          : { ...section, rows: section.rows.slice(0, left) },
      );
      left -= section.rows.length;
    }
    return out;
  });
  protected readonly days = computed(() =>
    this.vm().days.slice(0, this.limit()),
  );
  protected readonly barbers = computed(() =>
    this.vm().barbers.slice(0, this.limit()),
  );
  /** Rows wait past the laid-out ones. */
  protected readonly more = computed(() => {
    const vm = this.vm();
    const limit = this.limit();
    const visits = vm.sections.reduce(
      (count, section) => count + section.rows.length,
      0,
    );
    return (
      visits > limit || vm.days.length > limit || vm.barbers.length > limit
    );
  });

  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');

  /** What the rows are: their kind, their figure and their total. */
  private readonly rowsKey = computed(() => {
    const vm = this.vm();
    return `${vm.drillRows}|${vm.title}|${vm.footerValue}`;
  });

  constructor() {
    // New rows (another figure, another period) start at one page — keyed
    // on what they are, not on each recomputed struct.
    effect(() => {
      this.rowsKey();
      untracked(() => this.limit.set(PAGE));
    });
    // The next page when the list's end comes within reach of the screen —
    // observed afresh after each page, since an observer reports only a
    // change and the end may still be in reach once the page is laid out.
    effect((onCleanup) => {
      this.limit();
      const sentinel = this.sentinel()?.nativeElement;
      if (sentinel === undefined) return;
      if (typeof IntersectionObserver === 'undefined') {
        untracked(() => this.limit.set(Number.MAX_SAFE_INTEGER));
        return;
      }
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            this.limit.update((limit) => limit + PAGE);
          }
        },
        { rootMargin: '600px 0px' },
      );
      observer.observe(sentinel);
      onCleanup(() => observer.disconnect());
    });
  }
}
