import { Component, ViewEncapsulation, input } from '@angular/core';
import { UiSpacer, UiStack } from '@creativo/ui/layout';
import { UiFrameDirective, UiPaddingDirective } from '@creativo/ui/modifiers';
import { UiPageActionBar } from '@creativo/ui/patterns';

/**
 * The geometry every `/book` step shares: a centred, gutter-padded measure
 * column with the step's own action bar pinned in the thumb zone below it.
 *
 * It exists because `ui-page-action-bar` only pins correctly as the LAST
 * child of the full-height column, after a `ui-spacer` — so the bar cannot
 * live inside a step's content column. `/auth` solves this by repeating the
 * whole wrapper in every `@switch` arm; five booking steps make that five
 * copies of one measure, which is how columns start disagreeing about their
 * width between steps.
 *
 * The host is the flex child that grows, so the spacer inside it pushes the
 * bar to the viewport floor on a short step and lets it ride the scroll on
 * a tall one — exactly the behaviour the bar documents for a `100svh`
 * column, just one level down.
 *
 * ```html
 * <lib-booking-step-layout>
 *   …step content…
 *   <button stepActions uiButton uiButtonStyle="borderedProminent">Continue</button>
 * </lib-booking-step-layout>
 * ```
 *
 * **Every step component using this MUST set `:host { display: contents }`.**
 * Otherwise the step's own host element becomes the flex item instead of
 * this layout, hugs its content, and the action bar lands under the last
 * row rather than in the thumb zone. `booking-services-step.css` carries the
 * canonical comment.
 *
 * The gutter comes from `UiPaddingDirective`, which has to be IMPORTED for
 * `uiPaddingHorizontal` to do anything — it is a standalone directive, not a
 * `ui-stack` input. Without it the attributes sit inert in the DOM and every
 * step renders edge to edge, which is exactly what happened: the catalog grid
 * ran the full width of the viewport with no gutter at all.
 *
 * `34rem` rather than `/auth`'s `28rem`: the service and slot grids need
 * the width, and a column that changes measure between steps reads as two
 * different designs.
 *
 * ### `uiFill` — when the step scrolls INSIDE itself
 * The default column grows with its content and lets the page scroll, which is
 * right for a form or a catalog. It is wrong for a step whose body is itself a
 * scroll region: the schedule step's calendar runs to a booking horizon
 * months away, and a page that scrolls as well as the calendar inside it gives
 * a user two scrollbars answering to one gesture.
 *
 * `uiFill` makes the measure column fill the available height instead, and
 * drops the spacer — the bar is pinned by the column's geometry rather than
 * pushed there. The step's own content is then responsible for having exactly
 * one scrolling child (`ui-calendar-scroller` does it). Same measure, same
 * gutter, same bar, same thumb zone: a wizard whose CTA moves between steps
 * has no rhythm.
 *
 * A fill step also owns its own TOP clearance. The layout pads the toolbar off
 * for everyone else, but a scroll region that starts below the bar has nothing
 * passing behind it — the scrim fades background into background, and the
 * step's `libStepTitle` can never scroll under the bar, so the house
 * large-title collapse never fires. In fill mode the column therefore runs to
 * the very top and the step clears the bar from inside its scroller, using the
 * `--booking-step-ceiling` property this layout publishes.
 */
@Component({
  selector: 'lib-booking-step-layout',
  imports: [
    UiFrameDirective,
    UiPaddingDirective,
    UiPageActionBar,
    UiSpacer,
    UiStack,
  ],
  template: `
    <ui-stack
      uiAlignment="center"
      uiPaddingHorizontal="regular"
      [uiPaddingVertical]="uiFill() ? 'none' : 'spacious'"
      class="booking-step-layout__measure"
    >
      <ui-stack
        uiSpacing="comfortable"
        uiFrame
        uiFrameMaxWidth="34rem"
        class="booking-step-layout__column"
      >
        <ng-content />
      </ui-stack>
    </ui-stack>

    <!-- No spacer in fill mode: the measure column already claims the height,
         so a spacer would fight it for the same space and collapse to zero. -->
    @if (!uiFill()) {
      <ui-spacer />
    }

    <!-- Chained projection: the step's controls pass through this slot into
         the bar's own content-driven primary/secondary placement.

         Pane-anchored in fill mode, and that is what restores the scrim. The
         bar's house chrome is a bottom fade that dissolves content scrolling
         UNDER it — but a page-anchored bar is a flex SIBLING of the body, so
         the scroll region ends exactly where the bar begins and there is
         never anything beneath it to dissolve. The fade then renders
         background-on-background and reads as no chrome at all. Pane
         anchoring takes the bar out of flow onto this layout's own positioned
         box, the scroller reclaims the full height, and the calendar passes
         under the controls the way every other step's content does. -->
    <ui-page-action-bar [uiAnchor]="uiFill() ? 'pane' : 'page'">
      <ng-content select="[stepActions]" />
    </ui-page-action-bar>
  `,
  styleUrl: './booking-step-layout.css',
  // Unscoped, like every DS-composed wrapper in this workspace: the host
  // rule below must cooperate with `ui-page-action-bar`'s own global
  // `.ui-*` styling contract rather than sit behind an `_ngcontent` scope.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'booking-step-layout',
    '[attr.data-fill]': 'uiFill() ? "" : null',
  },
})
export class BookingStepLayout {
  /** The step's body is itself a scroll region — see the class docblock. */
  readonly uiFill = input(false);
}
