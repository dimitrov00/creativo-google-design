import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { UiButton, UiIcon, UiModalSheet } from '@creativo/ui/controls';
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
  GridTimeScale,
  TIME_SCALES,
  type TimeScaleMinutes,
} from '../grid-time-scale';

/**
 * THE CALENDAR'S TIME SCALE (owner, 2026-11-06, Outlook's «Time scale»):
 * how many minutes one row of the calendar holds — 10 · 15 · 30 мин · 1 ч.
 *
 * A row picks a DRAFT (owner, 2026-11-06: "there should be an apply button
 * at the bottom toolbar"): the ✓ moves, the calendar behind does not, and
 * the bar's «Приложи» takes the scale to the calendar and closes — the
 * filter sheet's own bar. ✕ leaves the calendar as it was.
 */
@Component({
  selector: 'lib-staff-time-scale-sheet',
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
    UiTextDirective,
  ],
  templateUrl: './staff-time-scale-sheet.html',
  styleUrl: './staff-time-scale-sheet.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StaffTimeScaleSheet {
  /** The sheet asked to go (✕, Escape, the scrim, «Приложи»). */
  readonly closed = output<void>();

  private readonly timeScale = inject(GridTimeScale);
  private readonly transloco = inject(TranslocoService);

  private readonly copyTable = toSignal(this.transloco.selectTranslation());
  protected readonly t = (key: string): string => {
    this.copyTable();
    return this.transloco.translate<string>(key);
  };

  protected readonly scales = TIME_SCALES;
  /** The draft, seeded from what the calendar draws now. */
  protected readonly chosen = signal<TimeScaleMinutes>(
    this.timeScale.minutes(),
  );

  protected apply(): void {
    this.timeScale.set(this.chosen());
    this.closed.emit();
  }
}
