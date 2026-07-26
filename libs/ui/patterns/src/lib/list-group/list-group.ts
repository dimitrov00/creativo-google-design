import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
} from '@angular/core';

/**
 * List group — the segmented grouped list (M3-expressive "list group",
 * read through this DS's SwiftUI vocabulary: ≙ `List { Section { … } }`
 * in inset-grouped style, minus the section chrome).
 *
 * The GROUP is chromeless: no surface, no elevation, no border — it is a
 * vertical run with a hairline seam (half a space unit) between rows.
 * Every direct `ui-list-row` child paints its own segment surface
 * (`--sys-color-surface-secondary`, the container-on-surface role that
 * stays visible on a white page where `surface` == `background`): subtle
 * radius on the inner seams, and the group's outer corners take the
 * prominent rung — the card tier — so a group reads as "a card exploded
 * into segments". Pressing a segment morphs it to the full prominent
 * radius (the M3 shape morph); the shared state layer follows for free
 * via `border-radius: inherit`.
 *
 * Contract:
 * - Children are `ui-list-row`s (any form — `a`, `button`, `li`,
 *   element). NO `ui-divider`s — the seam IS the separator.
 * - Prominent rows stay STANDALONE (their primary fill + own radius);
 *   a group is a run of plain rows.
 * - `ul[uiListGroup]` keeps semantic-list groups (`li[uiListRow]` rows)
 *   real lists for AT counts, same recipe.
 * ```html
 * <ui-list-group>
 *   <a uiListRow [uiInteractive]="true">…</a>
 *   <a uiListRow [uiInteractive]="true">…</a>
 * </ui-list-group>
 * ```
 */
@Component({
  selector: 'ui-list-group, ul[uiListGroup], nav[uiListGroup]',
  template: `<ng-content />`,
  styleUrl: './list-group.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped like every pattern: bare `.ui-*` selectors are the styling
  // contract and must reach projected children (see list-row.ts).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-list-group',
  },
})
export class UiListGroup {}
