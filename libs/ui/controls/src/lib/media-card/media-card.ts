import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
} from '@angular/core';
import { UiAsyncImage } from '../async-image/async-image';
import { UiOverlayDirective, UiRadiusDirective } from '@creativo/ui/modifiers';

/**
 * Cover-art card — the image-forward surface the catalog reads in:
 * the picture IS the card, a bottom scrim grades it for legibility, and
 * the caption sits INSIDE the media rather than under it (≙ SwiftUI
 * `AsyncImage { … }.overlay(alignment: .bottom) { caption }`).
 *
 * Presentational only — it is never the control. The consumer decides what
 * carries the tap (a wrapping `button`/`a`, or nothing at all) so the card
 * can also be used inside surfaces that already own their semantics.
 *
 * Slots (attribute-marked, all optional):
 * - `[uiPlaceholder]` — forwarded to `ui-async-image`; the permanent art
 *   for a `null` source (a motif beats a broken frame).
 * - `[uiCaption]` — the inset copy stack over the scrim. Ink is the
 *   media ramp: the stack reads `--sys-color-on-media`, and anything
 *   marked `uiForegroundStyle="secondary"` de-emphasizes to the muted
 *   white rung instead of the page's grey (which would vanish on a photo).
 * - `[uiOverlayLeading]` / `[uiOverlayTrailing]` — the top corner
 *   accessories (a selection chip, a bundle tell, a quiet info pill).
 *
 * ```html
 * <ui-media-card [uiSrc]="service.coverSrc" uiRadius="prominent">
 *   <span uiPlaceholder>…motif…</span>
 *   <ui-stack uiCaption uiSpacing="tight">
 *     <span uiText uiFont="callout" uiWeight="bold">{{ name }}</span>
 *     <span uiText uiFont="footnote" uiForegroundStyle="secondary">{{ meta }}</span>
 *   </ui-stack>
 * </ui-media-card>
 * ```
 */
@Component({
  selector: 'ui-media-card',
  imports: [UiAsyncImage, UiOverlayDirective],
  template: `
    <ui-async-image
      class="ui-media-card__media"
      [uiSrc]="uiSrc()"
      [uiAlt]="uiAlt()"
      [uiRatio]="uiRatio()"
      [uiRing]="uiRing()"
    >
      <!-- The wrapper carries uiPlaceholder itself: a bare ng-content
           with a selector, nested inside another component's content, is
           matched by the CHILD against the ng-content node — not against
           the nodes that later flow through it — so forwarding the slot
           needs a real element to hang the attribute on. With nothing
           projected it degrades to the media-canvas tone (see the CSS);
           ui-async-image's own skeleton default is unreachable from here
           by that same rule. -->
      <span uiPlaceholder class="ui-media-card__placeholder">
        <ng-content select="[uiPlaceholder]" />
      </span>
    </ui-async-image>

    <!-- The ONE sanctioned legibility grade (modifiers.css owns the
         gradient stops); gated so a card with no caption stays a clean
         picture. -->
    @if (uiScrim()) {
      <span uiOverlay="scrim-media" aria-hidden="true"></span>
    }

    <span class="ui-media-card__caption">
      <ng-content select="[uiCaption]" />
    </span>

    <ng-content select="[uiOverlayLeading]" />
    <ng-content select="[uiOverlayTrailing]" />
  `,
  styleUrl: './media-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  // Radius rides the shared modifier rather than a private input — the
  // skeleton precedent.
  hostDirectives: [{ directive: UiRadiusDirective, inputs: ['uiRadius'] }],
  host: {
    class: 'ui-media-card',
    // Everything inside sits ON media: nested rings and `uiButton`
    // accessories flip to the theme-independent white ramp for free.
    'data-on-media': '',
  },
})
export class UiMediaCard {
  readonly uiSrc = input<string | null>(null);
  readonly uiAlt = input('');
  /** Raw CSS aspect-ratio ('4 / 5', '1 / 1') — see UiAsyncImage. */
  readonly uiRatio = input<string>('4 / 5');
  /** Inset hairline over the picture (on-media white at this scale). */
  readonly uiRing = input(true);
  /** Drop the grade on cards that carry no inset copy. */
  readonly uiScrim = input(true);
}
