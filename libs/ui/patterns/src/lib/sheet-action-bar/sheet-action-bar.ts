import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';

/**
 * Sheet action bar — the bottom action row docked to a sheet's bottom
 * edge (booking bar, call/directions toolbar). The row is
 * CHROMELESS: no material, no fill, no hairline — the projected controls
 * carry their own surfaces (prominent fill, bordered ring) and float
 * directly over the scrolling content. SwiftUI parity:
 * `.safeAreaInset(edge: .bottom) { HStack { … } }` — bottom actions
 * floating over content with no bar chrome; pairs with UiButton's
 * `uiSpread` sheet-CTA geometry.
 *
 * ### Slot contract (content-driven, order-based)
 * Project plain controls — no wrapper elements:
 * - **Primary → trailing (thumb side).** The child that reads as the
 *   sheet's primary CTA docks to the trailing edge. Detection, in order of
 *   preference: the `uiSpread` sheet-CTA geometry (`data-spread`), the
 *   prominent button variant (`data-variant="prominent"`), or an explicit
 *   `uiPrimary` marker attribute for non-button/non-DS primaries. A
 *   `uiSpread` primary additionally flexes into all leftover row space,
 *   so its trailing edge always lands on the bar's trailing gutter — a
 *   lone CTA becomes the full-width booking row.
 * - **Everything else → leading.** Secondary actions cluster on the
 *   leading side in projection order and hold their intrinsic box; the
 *   primary is the flexible/ellipsizing one.
 *
 * Owns the skeleton, full-width positioning, safe-area anchoring and
 * the reveal transition; consumers keep only per-control extras local.
 * The bar publishes `--ui-sheet-action-bar-clearance` (on `:root`) so
 * sheet bodies derive their bottom padding from it instead of hardcoding
 * a clearance, and consumes the sheet's shared `--ui-sheet-inset` for its
 * inline content gutter (token fallback when the host sheet defines none).
 *
 * Reveal is presentation-only here — the OWNER decides visibility. The
 * landing sheets keep the bar always-on (`[uiVisible]="true"`) so it rides
 * the sheet's own entrance/exit; a scroll-driven reveal remains possible.
 * An owner that hides the bar WHILE its sheet is interactive must also
 * disable projected controls' tabbing
 * (`[attr.tabindex]="visible ? null : -1"`), since projected content is
 * outside this component's reach; owners whose closed sheet is
 * `visibility: hidden` (the landing sheets' closed-state contract) need no
 * gating for the closed state.
 *
 * ```html
 * <ui-sheet-action-bar [uiVisible]="true">
 *   <a uiButton uiVariant="bordered" …>…</a>          <!-- leading -->
 *   <a uiButton uiVariant="prominent" [uiSpread]="true" …>…</a> <!-- trailing -->
 * </ui-sheet-action-bar>
 * ```
 */
@Component({
  selector: 'ui-sheet-action-bar',
  template: `<ng-content />`,
  styleUrl: './sheet-action-bar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-sheet-action-bar',
    '[attr.data-visible]': "uiVisible() ? '' : null",
    '[attr.aria-hidden]': "uiVisible() ? null : 'true'",
  },
})
export class UiSheetActionBar {
  readonly uiVisible = input(false);
}
