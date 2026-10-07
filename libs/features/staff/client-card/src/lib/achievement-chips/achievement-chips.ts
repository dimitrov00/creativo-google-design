import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { UiChip, UiFlow } from '@creativo/ui/controls';
import type { AchievementChipVm } from '../client-pages.vm';
import { regularSheetWidth } from '../sheet-width';

/**
 * THE CATEGORY BAND of «Постижения» (client-card-revision-3 §2.3.2 AC,
 * §3.9) — the chips that FILTER what stands under them: «Всички», the
 * catalogue's categories in their order, «Сезони» when a season or an
 * event exists. Toggles, not a segmented control (a segmented control is a
 * view toggle, house ruling) and not pills (the month pills navigate).
 *
 * The band wraps IN FLOW (DV-A): two rows at 390, three at 330, one from
 * 600, never pinned and never a horizontal rail. In the ≥ 761 dialog the
 * chips stand a `tight` step apart instead of a `compact` one: its 528 pt
 * column held six of the seven and orphaned «Сезони» on a row of its own
 * (review 3, round 2), and one row of seven at 4 apart reads as the
 * toolbar it is; a reader's larger text still wraps it. It prints no count on a
 * chip at any width — the section heads carry it, and a secondary count on
 * the chosen chip would read 3.27:1 — so the count is HEARD: each chip is
 * named with it («Етапи, 3 от 5 спечелени»).
 *
 * The host takes the sheet's own clearance as its scroll margin, so a page
 * opened on a chip, or scrolled to the band by «Покажи всички N», lands
 * with the band under the bar and clear of its fade. It declares no colour,
 * no `position` and no cover: the chips are the DS's, as they are.
 *
 * The chosen chip is the STORE's state (`store.medalsChip()`): the page
 * hands it in and the band only says which chip was tapped (`picked`); it
 * never decides.
 */
@Component({
  selector: 'lib-achievement-chips',
  imports: [UiChip, UiFlow],
  template: `
    <ui-flow
      role="toolbar"
      [uiSpacing]="spacing()"
      uiAlignment="leading"
      [attr.aria-label]="label()"
    >
      @for (chip of chips(); track chip.id) {
        <button
          type="button"
          uiChip
          uiControlSize="small"
          [uiSelected]="chip.id === selectedId()"
          [id]="idPrefix() + '-' + chip.id"
          [attr.aria-label]="chip.accessibleName"
          [attr.data-chip]="chip.id"
          [attr.data-testid]="testIdPrefix() + '-' + chip.id"
          (click)="picked.emit(chip.id)"
        >
          {{ chip.label }}
        </button>
      }
    </ui-flow>
  `,
  styleUrl: './achievement-chips.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'achievement-chips' },
})
export class AchievementChips {
  /** The chips in the page's order; `null` while the page has none to offer (nothing is drawn). */
  readonly chips = input.required<readonly AchievementChipVm[]>();
  /** The chip in force: `all`, a category's id or `seasons` (the store's). */
  readonly selectedId = input.required<string>();
  /** The toolbar's name («Категории»). */
  readonly label = input<string | null>(null);
  /** Every chip's `id` is `{idPrefix}-{chip.id}`: what the region under the band is labelled by. */
  readonly idPrefix = input('achievements-chip');
  /** Every chip's `data-testid` is `{testIdPrefix}-{chip.id}`. */
  readonly testIdPrefix = input('achievements-chip');
  /** A tap on a chip: its id, the chosen one included (the store makes nothing of it). */
  readonly picked = output<string>();

  /** Whether the sheet is the ≥ 761 dialog, followed as the width changes. */
  private readonly regular = regularSheetWidth();

  /** The step between the chips: `compact` on a phone, `tight` in the dialog, where one row holds all seven. */
  protected readonly spacing = computed(() =>
    this.regular() ? 'tight' : 'compact',
  );
}
