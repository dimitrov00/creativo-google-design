import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';

/**
 * How the bar finds its bottom edge. `page` sticks to a scrolling column;
 * `pane` pins to a fixed-size positioned box that never scrolls.
 */
export type UiPageActionBarAnchor = 'page' | 'pane';

/**
 * Page action bar — the bottom action row pinned in the thumb zone of a
 * full-height PAGE (auth/onboarding step screens). The page-level sibling
 * of `ui-sheet-action-bar`: same slot contract, different anchoring — the
 * bar is `position: sticky` at the page's bottom edge, so a tall page lets
 * it ride the scroll.
 *
 * ### The one composition rule: the parent must be a COLUMN
 * Compose the bar as the last child of a flex/grid column carrying
 * `uiFrameMinHeight="100svh"` — a `ui-stack`, or a `main` the page's own
 * CSS makes `display: flex; flex-direction: column`.
 *
 * Sticky does not do the flooring; `margin-block-start: auto` does. A
 * bottom inset only pushes a sticky box back UP when scrolling would carry
 * it out of the scrollport — on a page shorter than the viewport the box
 * never leaves the constraint, so nothing shifts. A BLOCK parent therefore
 * strands the bar in normal flow, directly under the last piece of content,
 * with the rest of the screen empty below it (the staff schedule shipped
 * that way until 2026-08-20: `main.staff-day` was `display: block`, so its
 * `<ui-spacer />` was inert and a barber with two visits got the bar at
 * mid-screen). The auto margin means a column parent needs no spacer at
 * all; a spacer that is already there is harmless (it takes the free space
 * first and the margin resolves to zero).
 *
 * ### `uiAnchor`
 * `page` (default) is the sticky behaviour above. `pane` anchors the bar to
 * the bottom of the nearest POSITIONED ancestor instead — for a screen that
 * does not scroll at all, such as a full-bleed map with a sheet over it,
 * where sticky has no scroll to stick to. Same slot contract, same chrome,
 * same thumb-zone geometry: a wizard whose CTA lives in one place on four
 * steps and somewhere else on the fifth has no rhythm.
 *
 * ### Slot contract (identical to ui-sheet-action-bar)
 * Project plain controls — no wrapper elements:
 * - **Primary → trailing.** Detected by the `uiSpread` geometry
 *   (`data-spread`), the prominent variant, or an explicit `uiPrimary`
 *   marker. The primary hugs its intrinsic width and docks to the trailing
 *   (thumb-side) edge at EVERY viewport — SwiftUI bottom-bar trailing
 *   placement; no full-width spread (owner ruling 2026-07-25).
 * - **Everything else → leading**, intrinsic box, projection order.
 *
 * Chrome: NONE — no material, no fill, no hairline (the sheet-action-bar's
 * chromeless philosophy, adopted here 2026-07-25). The projected controls
 * carry their own surfaces and float directly over the page; scrolled-under
 * separation deliberately gets no cue. Safe-area floors on all three
 * anchored edges.
 *
 * ### Stacked variant (`uiStacked`)
 * The Setup-Assistant completion anatomy (owner ruling 2026-07-27): ONE
 * centered filled primary with the quiet plain link stacked BENEATH it —
 * for skippable/completion steps where side-by-side skip/continue would
 * read as a dialog. Same sticky anchoring, same chromeless philosophy;
 * project the primary FIRST (DOM order is visual order).
 *
 * ```html
 * <ui-page-action-bar>
 *   <button uiButton uiButtonStyle="borderedProminent" uiControlSize="large">
 *     Continue
 *   </button>
 * </ui-page-action-bar>
 * ```
 */
@Component({
  selector: 'ui-page-action-bar',
  template: `<ng-content />`,
  styleUrl: './page-action-bar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-page-action-bar',
    '[attr.data-layout]': "uiStacked() ? 'stacked' : null",
    '[attr.data-anchor]': 'uiAnchor()',
  },
})
export class UiPageActionBar {
  readonly uiStacked = input(false);
  readonly uiAnchor = input<UiPageActionBarAnchor>('page');
}
