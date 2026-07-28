import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';

export type UiSectionHeaderAlign = 'leading' | 'center';

/**
 * Eyebrow ink. `accent` (default) is the marketing brand-moment eyebrow
 * (category labels over landing sections). `secondary` is for STATUS
 * qualifiers — e.g. onboarding's "Optional" — where tint would hand the
 * least important word on the screen the loudest ink (HIG: color signals
 * importance/interactivity; status metadata reads in secondary label).
 */
export type UiSectionHeaderEyebrowTone = 'accent' | 'secondary';

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
    '[attr.data-alignment]': 'uiAlignment()',
    '[attr.data-on-media]': "uiOnMedia() ? '' : null",
    '[attr.data-eyebrow-tone]': 'uiEyebrowTone()',
  },
})
export class UiSectionHeader {
  readonly uiAlignment = input<UiSectionHeaderAlign>('leading');
  readonly uiOnMedia = input(false);
  readonly uiEyebrowTone = input<UiSectionHeaderEyebrowTone>('accent');
}
