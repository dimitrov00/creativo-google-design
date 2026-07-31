import { Component, ViewEncapsulation } from '@angular/core';
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
      uiPaddingVertical="spacious"
    >
      <ui-stack uiSpacing="comfortable" uiFrame uiFrameMaxWidth="34rem">
        <ng-content />
      </ui-stack>
    </ui-stack>

    <ui-spacer />

    <!-- Chained projection: the step's controls pass through this slot into
         the bar's own content-driven primary/secondary placement. -->
    <ui-page-action-bar>
      <ng-content select="[stepActions]" />
    </ui-page-action-bar>
  `,
  styleUrl: './booking-step-layout.css',
  // Unscoped, like every DS-composed wrapper in this workspace: the host
  // rule below must cooperate with `ui-page-action-bar`'s own global
  // `.ui-*` styling contract rather than sit behind an `_ngcontent` scope.
  encapsulation: ViewEncapsulation.None,
  host: { class: 'booking-step-layout' },
})
export class BookingStepLayout {}
