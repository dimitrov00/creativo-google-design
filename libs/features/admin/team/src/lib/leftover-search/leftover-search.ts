import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoDirective } from '@jsverse/transloco';
import { type BarberId, LocalDate } from '@core/primitives';
import { UiButton } from '@creativo/ui/controls';

/**
 * «ВИЖ ЗАПИСИТЕ» — the visits a last working day leaves behind, found by
 * the schedule's own search (team onboarding D10; owner, 2026-11-16: "just
 * one button to that warning box … this should point us to our powerful
 * search"). The warning counts them; this opens the search on them —
 * `/staff/schedule?searchBarber=…&searchFrom=…`, which the schedule reads
 * once into the search's own filters: this barber, from the day after the
 * last day, the visits that still hold a slot (`SearchQuery.bookingsAhead`).
 * There they are opened, given to another barber, moved or cancelled.
 *
 * The notice's action: its host goes into `ui-notice` as
 * `uiNoticeActions`, a bordered neutral button at the regular size like
 * every notice's. It reads nothing and decides nothing.
 */
@Component({
  selector: 'lib-leftover-search',
  imports: [TranslocoDirective, UiButton],
  template: `
    <ng-container *transloco="let t">
      <button
        type="button"
        uiButton
        uiButtonStyle="bordered"
        uiTint="neutral"
        uiControlSize="regular"
        data-testid="leftover-search"
        (click)="open()"
      >
        {{ t('admin.team.member.leftoverSee') }}
      </button>
    </ng-container>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LeftoverSearch {
  private readonly router = inject(Router);

  /** Whose visits: the barber the search narrows to. */
  readonly uiBarberId = input.required<BarberId>();
  /** The last working day: the search starts on the day after it. */
  readonly uiAfter = input.required<LocalDate>();

  protected open(): void {
    void this.router.navigate(['/staff/schedule'], {
      queryParams: {
        searchBarber: this.uiBarberId(),
        searchFrom: LocalDate.addDays(this.uiAfter(), 1),
      },
    });
  }
}
