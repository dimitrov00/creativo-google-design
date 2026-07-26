import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
} from '@angular/core';

/**
 * Page action bar — the bottom action row pinned in the thumb zone of a
 * full-height PAGE (auth/onboarding step screens). The page-level sibling
 * of `ui-sheet-action-bar`: same slot contract, different anchoring — the
 * bar is `position: sticky` at the page's bottom edge (compose it as the
 * last child of a `uiFrameMinHeight="100svh"` column so a short page pins
 * it to the viewport floor and a tall page lets it ride the scroll).
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
  },
})
export class UiPageActionBar {}
