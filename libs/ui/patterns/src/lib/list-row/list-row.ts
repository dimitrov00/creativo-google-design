import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';

/** Row heights ride the control-size ladder (≙ .controlSize naming). */
export type UiListRowSize = 'regular' | 'large';
export type UiListRowVariant = 'plain' | 'prominent';

/**
 * Cross-axis placement of the accessories ≙ SwiftUI
 * `HStack(alignment:)` on a row — same `leading`/`center` vocabulary
 * `ui-stack` uses, read against the row's cross axis.
 *
 * `center` (default) is right for the one-line rows that are most of a
 * list. Reach for `leading` when the label stacks — a title over a
 * progress bar, a name over a detail line — because a centred glyph then
 * floats between the two lines instead of sitting with the title it
 * belongs to.
 */
export type UiListRowAlignment = 'leading' | 'center';

/**
 * List row — the leading-glyph / label / trailing-detail shape of a
 * SwiftUI `List` row (HStack with a LabeledContent-style trailing detail).
 * One recipe for navigation menus, performer/person rows and the booking
 * apps' account/settings surfaces.
 *
 * Markup contract (attribute-marked slots like ui-section-header; every
 * slot is optional, default projection is the label/identity content):
 * ```html
 * <a uiListRow routerLink="…" [uiInteractive]="true">
 *   <span uiLeading>…glyph/avatar…</span>
 *   Label
 *   <span uiTrailing>Detail</span>
 * </a>
 * ```
 * Prefer the `a[uiListRow]`/`button[uiListRow]` forms for navigable or
 * actionable rows (free native semantics, zero ARIA hand-rolling); the
 * `ui-list-row` element form is for static rows. `uiInteractive` stamps
 * `data-interactive`, reusing the ONE sanctioned hover/press grammar from
 * libs/ui/modifiers (state layer, press scale, focus ring) — rows never
 * invent their own hover treatment.
 *
 * `uiVariant` follows the DS button vocabulary (SwiftUI parity: a
 * tinted/prominent list row, `.listRowBackground(Color.accentColor)`):
 * `plain` (default) is the transparent row; `prominent` fills the row
 * with `--sys-color-primary` and flips label AND glyph ink to
 * `--sys-color-on-primary` — the "primary CTA that reads as a list row"
 * shape. The state-layer hover grammar composes on the filled surface
 * for free (currentColor = on-primary, exactly how uiButton prominent
 * hovers).
 */
@Component({
  // `li[uiListRow]` — semantic-list rows (schedules, menus that must stay
  // real <ul>/<li> for AT counts) take the same recipe without wrappers.
  selector: 'ui-list-row, a[uiListRow], button[uiListRow], li[uiListRow]',
  template: `
    <ng-content select="[uiLeading]" />
    <span class="ui-list-row__label"><ng-content /></span>
    <ng-content select="[uiTrailing]" />
  `,
  styleUrl: './list-row.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-list-row',
    '[attr.data-size]': 'uiSize()',
    '[attr.data-alignment]': 'uiAlignment()',
    '[attr.data-variant]': 'uiVariant()',
    '[attr.data-interactive]': "uiInteractive() ? '' : null",
    '[attr.data-selected]': "uiSelected() ? '' : null",
  },
})
export class UiListRow {
  readonly uiSize = input<UiListRowSize>('large');
  readonly uiAlignment = input<UiListRowAlignment>('center');
  readonly uiVariant = input<UiListRowVariant>('plain');
  readonly uiInteractive = input(false);
  /** SwiftUI List selection — the accent segment tint (a schedule's
   *  "today" row, a picked option). Visual only: rows that need AT to hear
   *  the state carry their own SR text or aria on the host element. */
  readonly uiSelected = input(false);
}
