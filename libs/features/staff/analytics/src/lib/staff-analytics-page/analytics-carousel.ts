import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  inject,
  input,
  output,
  untracked,
  viewChild,
} from '@angular/core';
import { UiPageControl } from '@creativo/ui/controls';
import type { AnalyticsPageVm } from '../analytics-home.vm';
import { AnalyticsBento } from './analytics-bento';

/** How long a scroll stays quiet before it counts as settled, where `scrollend` is missing. */
const SETTLE_MS = 140;

/**
 * THE CAROUSEL OF PERIODS (staff-analytics-v3, «The home screen» 3): one
 * page per period of the grain, oldest first, snapping one at a time, opened
 * on `index` — the current period, the last page. A swipe from left to right
 * settles on the period before and says so (`settled`); the store makes it
 * the period, the period button relabels and the page's report is asked
 * for. Only the page on screen and its two neighbours draw their bento: the
 * rest are empty slots of the same width, so a year of days costs nothing.
 *
 * Pages off screen are `inert` and hidden from assistive technology — the
 * period menu and the swipe move between them; a screen reader reaches the
 * other periods through the menu.
 */
@Component({
  selector: 'lib-analytics-carousel',
  imports: [AnalyticsBento, UiPageControl],
  template: `
    <div
      #track
      class="analytics-carousel__track"
      data-testid="analytics-carousel"
      (scroll)="scrolled()"
      (scrollend)="settle()"
    >
      @for (page of pages(); track page.key; let i = $index) {
        <section
          class="analytics-carousel__page"
          [attr.aria-label]="page.label"
          [attr.aria-hidden]="i === index() ? null : 'true'"
          [attr.inert]="i === index() ? null : ''"
          [attr.data-current]="i === index() ? '' : null"
          [attr.data-testid]="'analytics-page-' + page.key"
        >
          @if (near(i)) {
            <lib-analytics-bento [page]="page" />
          }
        </section>
      }
    </div>
    <!-- Where the carousel stands — Revolut's dots. The pages carry their
         own names, so the dots stay decorative. -->
    <ui-page-control
      class="analytics-carousel__dots"
      data-testid="analytics-page-dots"
      [uiCount]="pages().length"
      [uiIndex]="index()"
    />
  `,
  styleUrl: './analytics-carousel.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalyticsCarousel {
  readonly pages = input.required<readonly AnalyticsPageVm[]>();
  /** The page on screen. */
  readonly index = input.required<number>();
  /** A swipe settled on another page. */
  readonly settled = output<number>();

  private readonly track = viewChild.required<ElementRef<HTMLElement>>('track');
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // The track follows `index` when the owner moves it (the opening page, a
    // new grain, the URL); a swipe already stands there, so nothing jumps.
    afterRenderEffect(() => {
      const index = this.index();
      this.pages();
      const track = this.track().nativeElement;
      untracked(() => {
        if (this.indexOn(track) === index) return;
        // An instant jump: the owner moved the period, nothing slides.
        track.scrollLeft = index * track.clientWidth;
      });
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.timer !== null) clearTimeout(this.timer);
    });
  }

  /** Content for the page on screen and its two neighbours. */
  protected near(i: number): boolean {
    return Math.abs(i - this.index()) <= 1;
  }

  /** A browser without `scrollend` settles after a quiet moment. */
  protected scrolled(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.settle(), SETTLE_MS);
  }

  protected settle(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const index = this.indexOn(this.track().nativeElement);
    if (index !== this.index() && index >= 0 && index < this.pages().length) {
      this.settled.emit(index);
    }
  }

  /** The page the track stands on. */
  private indexOn(track: HTMLElement): number {
    const width = track.clientWidth;
    return width > 0 ? Math.round(track.scrollLeft / width) : 0;
  }
}
