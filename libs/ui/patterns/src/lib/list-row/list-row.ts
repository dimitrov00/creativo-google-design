import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  booleanAttribute,
  input,
} from '@angular/core';

/**
 * Row heights ride the control-size ladder (≙ .controlSize naming). On a
 * STACKED label (`uiAlignment="leading"`) the size also picks the block
 * padding: `large` is the settings row (16 round a 44 disc), `regular` the
 * picker row (12 round a 36 disc, ≈60 tall) — a list read down, a person
 * a row, fits seven where the settings row fits five.
 */
export type UiListRowSize = 'regular' | 'large';
export type UiListRowVariant = 'plain' | 'neutral' | 'prominent';

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
 * ≙ SwiftUI `ButtonRole` on a row — the same name and value `uiButton`
 * takes (`Button(role: .destructive)` inside a `List`). The row reads in
 * the destructive INK, never a fill: a red row is a row that reads red,
 * not a button pretending to be one. A row that has become its own
 * confirm (the block sheet's arm) stamps `data-armed` itself and weighs
 * more, so the second tap reads as the decision it is.
 */
export type UiListRowRole = 'destructive';

/**
 * ≙ the `.foregroundStyle` of a List row's value. `secondary` (default) is
 * a detail — LabeledContent's grey. `primary` is a FIGURE the row exists
 * to show — a price charged, a cost the balance covers, a signed amount —
 * and keeps the label's ink. Either way a trailing element that asks for
 * its own style (`uiForegroundStyle="secondary"`, a struck amount) keeps
 * it, and a control in the slot owns its ink.
 */
export type UiListRowTrailingProminence = 'secondary' | 'primary';

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
 *
 * `neutral` is the middle rung: the same segment fill and standalone
 * radius a row gets inside a `ui-list-group`, applied to a row that
 * stands ALONE. It exists for the second standalone row in a stack — the
 * one that must read as a real destination without becoming a second
 * primary. Two adjacent `prominent` rows are two competing primaries and
 * the eye picks neither.
 *
 * There was briefly a `tinted` rung here — an accent wash — and it was
 * removed rather than kept. In this system an accent wash on a row
 * already MEANS something: `[data-selected]` paints the identical fill
 * from the identical alpha rung. A permanently-tinted row is therefore a
 * permanently selected-looking row, and the first real picker built on
 * `uiSelected` would have rendered its selection indistinguishable from
 * it. Emphasis that borrows a state's signal is not emphasis; it is
 * ambiguity.
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
    '[attr.data-role]': 'uiRole()',
    '[attr.data-trailing-prominence]':
      "uiTrailingProminence() === 'primary' ? 'primary' : null",
    '[attr.data-label-wraps]': "uiLabelWraps() ? '' : null",
    '[attr.data-trailing-wraps]': "uiTrailingWraps() ? '' : null",
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
  /** The destructive exit's ink (the leading glyph inherits it). */
  readonly uiRole = input<UiListRowRole | null>(null);
  /** The trailing value's ink: a detail (secondary) or the row's figure (primary). */
  readonly uiTrailingProminence =
    input<UiListRowTrailingProminence>('secondary');
  /**
   * ≙ `.lineLimit(nil)` on the label: its words wrap onto more lines
   * instead of ending in an ellipsis — a reward's name beside its cost on a
   * 330 phone, a ledger line that names a medal. Pair with
   * `uiAlignment="leading"` so the accessories ride the first line.
   */
  readonly uiLabelWraps = input(false, { transform: booleanAttribute });
  /**
   * ≙ LabeledContent's VALUE in a Form: a long value gives way, the label
   * never. For a VALUE ROW — a one-word label beside the long part
   * («Приложени» · «Безплатно подстригване (17,50 €)») — where the default
   * (the label ellipsizes, the trailing run never shrinks) cut the label to
   * «Пр…». The trailing run shrinks to three fifths of the row; its words
   * wrap at the trailing edge, two lines at most, then an ellipsis; a glyph
   * in it (the disclosure, the chevron) never shrinks. Short values never
   * reach the cap.
   */
  readonly uiTrailingWraps = input(false, { transform: booleanAttribute });
}
