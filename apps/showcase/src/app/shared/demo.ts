import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';

/**
 * Demo section — a titled spec block whose canvas puts the rendered
 * primitives on a Figma-style dot grid. Wide content scrolls INSIDE the
 * canvas (never the page), and `scTone="media"` flips the canvas to the
 * dark media surface for on-media/glass demos. `scCanvasOverflow="visible"`
 * lets content escape the canvas instead — for a page whose demos are never
 * wider than it and hold an anchored popover the scroll box would clip.
 */
@Component({
  selector: 'sc-demo',
  imports: [UiStack, UiTextDirective],
  template: `
    <section>
      <ui-stack uiSpacing="compact">
        <ui-stack uiSpacing="none">
          <h2 uiText uiFont="title3">{{ scTitle() }}</h2>
          <p
            uiText
            uiFont="footnote"
            uiForegroundStyle="secondary"
            class="sc-demo__about"
          >
            <ng-content select="[scAbout]" />
          </p>
        </ui-stack>
        <div
          class="sc-demo__canvas"
          [attr.data-tone]="scTone()"
          [attr.data-canvas-overflow]="
            scCanvasOverflow() === 'visible' ? 'visible' : null
          "
        >
          <ng-content />
        </div>
      </ui-stack>
    </section>
  `,
  styles: `
    .sc-demo__about:empty {
      display: none;
    }
    .sc-demo__canvas {
      border: 1px solid var(--sys-color-separator);
      border-radius: var(--control-radius-prominent);
      padding: var(--sys-space-comfortable);
      background-color: var(--sys-color-surface);
      /* Figma-style dot grid, from the ink at whisper strength. */
      background-image: radial-gradient(
        color-mix(in srgb, var(--sys-color-foreground) 9%, transparent) 1px,
        transparent 1px
      );
      background-size: 16px 16px;
      /* Wide demos scroll inside the canvas — the page never overflows. */
      overflow-x: auto;
    }
    /* A canvas that scrolls (overflow-x: auto) clips on both axes, which
       would swallow an anchored popover; a page with nothing wider than the
       canvas lets it escape. */
    .sc-demo__canvas[data-canvas-overflow='visible'] {
      overflow-x: visible;
    }
    .sc-demo__canvas[data-tone='media'] {
      background-color: var(--sys-color-media-canvas);
      background-image: radial-gradient(
        color-mix(in srgb, var(--sys-color-on-media) 14%, transparent) 1px,
        transparent 1px
      );
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScDemo {
  readonly scTitle = input.required<string>();
  readonly scTone = input<'default' | 'media'>('default');
  /**
   * `scroll` (the default): wide content scrolls inside the canvas.
   * `visible`: nothing is clipped — an anchored popover escapes the canvas.
   */
  readonly scCanvasOverflow = input<'scroll' | 'visible'>('scroll');
}
