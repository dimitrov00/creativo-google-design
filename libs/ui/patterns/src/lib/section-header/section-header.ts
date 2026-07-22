import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';

export type UiSectionHeaderAlign = 'start' | 'center';

/**
 * Section-opening header trio — the ONE sanctioned eyebrow/title/lede
 * recipe (UI/UX case study §2.4: six hand-rolled eyebrow copies and three
 * title scales collapsed into this pattern).
 *
 * Markup contract (attribute-marked slots, any heading level):
 * ```html
 * <ui-section-header>
 *   <p uiEyebrow>{{ eyebrow }}</p>
 *   <h2 uiTitle id="...">{{ title }}</h2>
 *   <p uiLede>{{ lede }}</p>
 * </ui-section-header>
 * ```
 * `uiOnMedia` flips the ink to the media-overlay ramp (text over video or
 * photography). Every slot is optional.
 */
@Component({
  selector: 'ui-section-header',
  template: `<ng-content />`,
  styleUrl: './section-header.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-section-header',
    '[attr.data-align]': 'uiAlign()',
    '[attr.data-on-media]': "uiOnMedia() ? '' : null",
  },
})
export class UiSectionHeader {
  readonly uiAlign = input<UiSectionHeaderAlign>('start');
  readonly uiOnMedia = input(false);
}
