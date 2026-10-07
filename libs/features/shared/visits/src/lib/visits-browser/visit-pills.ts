import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { translateSignal } from '@jsverse/transloco';
import { UiScrollRow, UiSkeleton } from '@creativo/ui/controls';
import {
  UiFrameDirective,
  UiInteractiveDirective,
} from '@creativo/ui/modifiers';
import type { VisitSectionVm } from '../visit-row.vm';

/**
 * How far the rail bleeds: to the `viewport`'s edge on a page, to its
 * `container`'s (the sheet's inset) inside a sheet.
 */
export type VisitPillsBleed = 'viewport' | 'container';

/**
 * THE JUMP PILLS (client-card revision 3 §3.11) — one capsule per section
 * that holds a visit, so every option leads somewhere. They moved here from
 * «Моите часове» (`.appointments__pill*`), and the staff card's «Посещения»
 * wears the same rail.
 *
 * Not `ui-chip`: a chip is a filter that changes what you see (it is
 * pressed or it is not), and a pill changes where you ARE. So the rail is
 * a navigation landmark, «Месеци», a pill is a plain button, and the
 * current one says so with `aria-current` — filled, inverted, because it
 * states a position and not a chosen option.
 *
 * The band is a grid `[rail 1fr] [action auto]`. The rail is the DS
 * scroll row, bleeding to the viewport's edge on a page and to its
 * container's inside a sheet. ONE control may be pinned at the rail's
 * trailing end (`[visitPillsAction]`, the staff page's funnel): the rail
 * then bleeds on its leading side alone and scrolls under a short fade
 * before the control, which never moves. With nothing projected the
 * column is absent and the rail is the client page's, to the pixel.
 *
 * Presentational: it is told which pill is current (`activeKey`) and says
 * which one was tapped (`jump`); the browser owns the scroll. What it does
 * on its own is keep the current pill in sight: when the page's scroll
 * makes a pill current that stands past the rail's edge, the rail brings
 * it to its leading gutter, on its inline axis alone.
 *
 * Test ids are the host's family: `{prefix}-pills`, `{prefix}-pill` (+
 * `data-section`, `data-selected`).
 */
@Component({
  selector: 'lib-visit-pills',
  imports: [UiFrameDirective, UiInteractiveDirective, UiScrollRow, UiSkeleton],
  templateUrl: './visit-pills.html',
  styleUrl: './visit-pills.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-bleed]': 'bleed()',
  },
})
export class VisitPills {
  readonly sections = input.required<readonly VisitSectionVm[]>();
  /** The section the page stands on; null lights no pill. */
  readonly activeKey = input<string | null>(null);
  readonly bleed = input<VisitPillsBleed>('viewport');
  readonly testIdPrefix = input('visits');
  /** The first page is on its way: three capsules stand in for the pills. */
  readonly loading = input(false);
  /** A pill was tapped: its section's key. */
  readonly jump = output<string>();

  /** «Месеци» — the landmark's name (`visits.pills.label`). */
  protected readonly label = translateSignal('visits.pills.label');

  /** The placeholder capsules' widths: a long month, a short one, one cut by the edge. */
  protected readonly placeholders = ['9.5rem', '8rem', '7rem'] as const;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly rail = viewChild('rail', {
    read: ElementRef<HTMLElement>,
  });

  constructor() {
    // The current pill stays in sight. After RENDER: the pill wears
    // `data-selected` only once the template has drawn the new key. The
    // rail is moved on its inline axis by its own `scrollTo`, never with
    // `scrollIntoView`: that would also pull the PAGE back up to a rail it
    // has scrolled past.
    afterRenderEffect(() => {
      const key = this.activeKey();
      this.sections();
      const rail: HTMLElement | undefined = this.rail()?.nativeElement;
      if (!key || !rail || typeof rail.scrollTo !== 'function') return;
      const pill = [
        ...rail.querySelectorAll<HTMLElement>('.visit-pills__pill'),
      ].find((each) => each.dataset['section'] === key);
      if (!pill) return;
      const left = this.revealOffset(rail, pill);
      if (left !== null) rail.scrollTo({ left, behavior: this.behavior() });
    });
  }

  /**
   * Where the rail has to stand for the pill to be in sight, or null when
   * it already is, whole. The rail's inline padding is its gutter (and,
   * before a pinned control, its fade): a pill under it is not in sight.
   *
   * A pill out of sight comes to the rail's LEADING gutter, whichever edge
   * it left by: that is one of the rail's own snap points, so the scroll
   * rests where it was sent (sent to the trailing edge, the snap pulled the
   * pill back under the fade), and the months after it show beside it.
   */
  private revealOffset(rail: HTMLElement, pill: HTMLElement): number | null {
    const style = getComputedStyle(rail);
    const lead = Number.parseFloat(style.paddingInlineStart) || 0;
    const trail = Number.parseFloat(style.paddingInlineEnd) || 0;
    const railBox = rail.getBoundingClientRect();
    const pillBox = pill.getBoundingClientRect();
    const start = railBox.left + lead;
    const end = railBox.right - trail;
    if (pillBox.left >= start && pillBox.right <= end) return null;
    return Math.max(0, rail.scrollLeft + pillBox.left - start);
  }

  /** Smooth, unless the person asked for less motion. */
  private behavior(): ScrollBehavior {
    const view = this.host.nativeElement.ownerDocument.defaultView;
    return view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth';
  }
}
