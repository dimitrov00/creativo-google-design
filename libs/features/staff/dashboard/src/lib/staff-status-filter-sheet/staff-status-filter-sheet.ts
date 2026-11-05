import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import type { BookingStatus } from '@core/primitives';
import { TranslocoService } from '@jsverse/transloco';
import {
  UiButton,
  UiIcon,
  UiModalSheet,
  UiSwitch,
} from '@creativo/ui/controls';
import { UiStack } from '@creativo/ui/layout';
import {
  UiForegroundStyleDirective,
  UiTextDirective,
} from '@creativo/ui/modifiers';
import {
  UiListGroup,
  UiListRow,
  UiSheetActionBar,
  UiSheetHeadline,
} from '@creativo/ui/patterns';
import {
  SCHEDULE_STATUSES,
  ScheduleStatusFilter,
} from '../schedule-status-filter';
import { statusFilterRowsVm } from '../staff-dashboard/schedule-status-filter.presenter';
import { staffSearchWordsOf } from '../staff-dashboard/staff-search.words';

/**
 * THE SCHEDULE'S STATUS FILTER (owner, 2026-11-05) — which booking states
 * the schedule draws, in every view: a row per state with the calendar's
 * own mark for it and a switch (≙ the «Status» show-list of Cursor's and
 * Luma's filters), and blocked time in a group of its own.
 *
 * The switches edit a DRAFT (owner, 2026-11-05: "apply and reset"): the
 * bar's «Приложи» takes it to the schedule and closes, ✕ leaves the
 * schedule as it was, and «Нулирай» sets the draft back to everything
 * drawn — Zocdoc's «Clear all» · «Show results», Insight Timer's switches
 * over the same pair.
 */
@Component({
  selector: 'lib-staff-status-filter-sheet',
  imports: [
    UiButton,
    UiForegroundStyleDirective,
    UiIcon,
    UiListGroup,
    UiListRow,
    UiModalSheet,
    UiSheetActionBar,
    UiSheetHeadline,
    UiStack,
    UiSwitch,
    UiTextDirective,
  ],
  templateUrl: './staff-status-filter-sheet.html',
  styleUrl: './staff-status-filter-sheet.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StaffStatusFilterSheet {
  /** The sheet asked to go (✕, Escape, the scrim). */
  readonly closed = output<void>();

  protected readonly filter = inject(ScheduleStatusFilter);
  private readonly transloco = inject(TranslocoService);

  private readonly copyTable = toSignal(this.transloco.selectTranslation());
  protected readonly t = (key: string): string => {
    this.copyTable();
    return this.transloco.translate<string>(key);
  };

  // ── The draft, seeded from what the schedule draws now ──────────────
  private readonly hidden = signal<readonly BookingStatus[]>(
    this.filter.hidden(),
  );
  protected readonly blocksHidden = signal(!this.filter.blocksShown());

  protected readonly rows = computed(() => {
    this.copyTable();
    const words = staffSearchWordsOf((key, params) =>
      this.transloco.translate<string>(key, params),
    );
    return statusFilterRowsVm({
      statuses: SCHEDULE_STATUSES,
      hidden: this.hidden(),
      statusWord: words.statusWord,
    });
  });

  /** Something in the draft is hidden — «Нулирай» has work to do. */
  protected readonly resettable = computed(
    () => this.hidden().length > 0 || this.blocksHidden(),
  );

  protected toggle(status: BookingStatus): void {
    this.hidden.update((held) =>
      held.includes(status)
        ? held.filter((state) => state !== status)
        : [...held, status],
    );
  }

  protected reset(): void {
    this.hidden.set([]);
    this.blocksHidden.set(false);
  }

  protected apply(): void {
    this.filter.apply(this.hidden(), this.blocksHidden());
    this.closed.emit();
  }
}
