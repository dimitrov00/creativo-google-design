import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { UiStack } from '@creativo/ui/layout';
import { UiTextDirective } from '@creativo/ui/modifiers';
import type { UiSpacing } from '@creativo/ui/layout';

/**
 * Spacing-rung visualizer — reads like the browser devtools / Figma gap
 * inspection: two dashed placeholder boxes with the GAP itself rendered as
 * a hatched band exactly `--sys-space-<rung>` wide, plus a live pixel
 * readout measured off the real box (so the density toggle updates it).
 */
@Component({
  selector: 'sc-gap-viz',
  imports: [UiStack, UiTextDirective],
  template: `
    <ui-stack uiSpacing="tight" uiAlignment="leading">
      <div class="sc-gap-viz__row">
        <div class="sc-gap-viz__box"></div>
        <div
          #gap
          class="sc-gap-viz__gap"
          [style.inline-size]="'var(--sys-space-' + scSpacing() + ')'"
        ></div>
        <div class="sc-gap-viz__box"></div>
      </div>
      <p uiText uiFont="caption" class="sc-gap-viz__label">
        {{ scSpacing() }} · {{ px() }}px
      </p>
    </ui-stack>
  `,
  styles: `
    .sc-gap-viz__row {
      display: flex;
      align-items: stretch;
      block-size: 3rem;
    }
    .sc-gap-viz__box {
      inline-size: 3rem;
      border: 1px dashed
        color-mix(in srgb, var(--sys-color-foreground) 35%, transparent);
      border-radius: var(--control-radius-subtle);
      background: color-mix(
        in srgb,
        var(--sys-color-foreground) 4%,
        transparent
      );
    }
    /* The gap band — devtools-style diagonal hatching in the accent ink. */
    .sc-gap-viz__gap {
      flex-shrink: 0;
      background: repeating-linear-gradient(
        45deg,
        color-mix(in srgb, var(--sys-color-accent) 45%, transparent) 0 3px,
        color-mix(in srgb, var(--sys-color-accent) 12%, transparent) 3px 8px
      );
    }
    .sc-gap-viz__label {
      font-family: var(--sys-font-family-mono);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScGapViz {
  readonly scSpacing = input.required<Exclude<UiSpacing, 'none'>>();

  protected readonly px = signal('—');
  private readonly gapEl = viewChild.required<ElementRef<HTMLElement>>('gap');
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const el = this.gapEl().nativeElement;
      const read = () =>
        this.px.set(
          (Math.round(el.getBoundingClientRect().width * 10) / 10).toString(),
        );
      read();
      if (typeof ResizeObserver !== 'function') return;
      const observer = new ResizeObserver(read);
      observer.observe(el);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}
