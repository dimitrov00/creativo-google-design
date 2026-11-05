import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
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
 * Luma's filters). A switch acts at once; «Покажи всички» rides the sheet's
 * bar only while something is hidden, as the card fields' reset does.
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

  protected readonly rows = computed(() => {
    this.copyTable();
    const words = staffSearchWordsOf((key, params) =>
      this.transloco.translate<string>(key, params),
    );
    return statusFilterRowsVm({
      statuses: SCHEDULE_STATUSES,
      hidden: this.filter.hidden(),
      statusWord: words.statusWord,
    });
  });
}
