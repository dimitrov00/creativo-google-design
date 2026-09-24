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
 * ### `uiAnchor` — where the bar finds its bottom edge
 * `overlay` (default) is the bar as the SHEET's own overlay: absolutely
 * positioned on the sheet surface, projected through the sheet's
 * `[sheet-overlay]` slot so it sits OUTSIDE the scrolling body.
 *
 * `scroll` is for a bar that is rendered INSIDE the scrolling body — the
 * last child of a component the sheet projects — and cannot reach the
 * overlay slot. It pins with `position: sticky` at the scroller's bottom
 * edge instead, exactly as `ui-page-action-bar` pins to a page. ⚠ Never
 * leave such a bar on `overlay`: an absolutely positioned box inside an
 * overflow scroller, with its containing block outside it, is the one
 * arrangement iOS Safari is known to scroll along with the content on a
 * real finger (owner, 2026-09-09: "the bottom action toolbar at some
 * pages is not fixed but it scrolls"). Sticky rides the scrolling tree
 * itself and cannot. The body owes no clearance padding to a sticky bar —
 * it takes its own row at the end of the content.
 *
 * ```html
 * <ui-sheet-action-bar [uiVisible]="true">
 *   <a uiButton uiButtonStyle="bordered" …>…</a>          <!-- leading -->
 *   <a uiButton uiButtonStyle="borderedProminent" [uiSpread]="true" …>…</a> <!-- trailing -->
 * </ui-sheet-action-bar>
 * ```
 */

/** How the bar finds its bottom edge. See the component doc. */
export type UiSheetActionBarAnchor = 'overlay' | 'scroll';

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
    '[attr.data-anchor]': "uiAnchor() === 'overlay' ? null : uiAnchor()",
  },
})
export class UiSheetActionBar {
  readonly uiVisible = input(false);
  readonly uiAnchor = input<UiSheetActionBarAnchor>('overlay');
}
