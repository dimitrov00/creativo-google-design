import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  input,
  linkedSignal,
} from '@angular/core';
import { UiSkeleton } from '../skeleton/skeleton';

export type UiAsyncImageState = 'idle' | 'loaded' | 'error';

/**
 * Custom element — SwiftUI `AsyncImage(url:) { image } placeholder: { … }`:
 * a lazily-loaded cover image that shows a placeholder surface until the
 * bytes arrive, then fades the picture in. One component instead of the
 * img-or-fallback + placeholder-background pattern hand-rolled per gallery.
 *
 * - Projected `[uiPlaceholder]` content is the placeholder; when none is
 *   projected a `ui-skeleton` fills in (one placeholder surface per role).
 * - `uiSrc: null` renders the placeholder permanently (the services
 *   gradient-fallback case).
 * - `uiRatio` takes a raw CSS `aspect-ratio` value ('4 / 5') — like
 *   UiFrame, intrinsic media geometry has no finite semantic scale.
 *   Without it, the host takes its size from the loaded image or the
 *   consumer's frame.
 */
@Component({
  selector: 'ui-async-image',
  imports: [UiSkeleton],
  template: `
    <div class="ui-async-image__placeholder">
      <ng-content select="[uiPlaceholder]">
        <ui-skeleton class="ui-async-image__skeleton" />
      </ng-content>
    </div>
    @if (uiSrc(); as src) {
      <img
        class="ui-async-image__image"
        [src]="src"
        [alt]="uiAlt()"
        loading="lazy"
        (load)="state.set('loaded')"
        (error)="state.set('error')"
      />
    }
  `,
  styleUrl: './async-image.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-async-image',
    '[attr.data-state]': 'state()',
    '[attr.data-ring]': "uiRing() ? '' : null",
    '[style.aspect-ratio]': 'uiRatio() ?? null',
  },
})
export class UiAsyncImage {
  readonly uiSrc = input<string | null>(null);
  readonly uiAlt = input('');
  /** Raw CSS aspect-ratio (e.g. '4 / 5') — see class docs. */
  readonly uiRatio = input<string | undefined>(undefined);
  /** Inset hairline over the image (the shared 1px separator ring). */
  readonly uiRing = input(false);

  /** Resets to 'idle' whenever the source changes. */
  protected readonly state = linkedSignal<string | null, UiAsyncImageState>({
    source: this.uiSrc,
    computation: () => 'idle',
  });
}
