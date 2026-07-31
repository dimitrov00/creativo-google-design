import {
  Directive,
  ElementRef,
  Injectable,
  DestroyRef,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';

/**
 * What the wizard's toolbar is currently saying.
 *
 * The chrome lives in the SHELL and the titles live in the steps, so one of
 * them has to tell the other. A tiny shared signal beats threading an output
 * through five components, and beats the shell reaching into a step's DOM by
 * selector — the step owns its own title, and simply publishes it.
 *
 * Provided on `ClientBooking`, so it lives exactly as long as one `/book`
 * visit and cannot leak a stale title into the next.
 */
@Injectable()
export class BookingChromeService {
  private readonly _title = signal<string | null>(null);
  private readonly _collapsed = signal(false);

  /** The step's own large title, mirrored into the bar when it scrolls away. */
  readonly title = this._title.asReadonly();

  /** True once the large title has passed under the toolbar. */
  readonly collapsed = computed(
    () => this._collapsed() && this._title() !== null,
  );

  publish(title: string | null): void {
    this._title.set(title);
    // A new step starts uncollapsed: its own title has not scrolled anywhere
    // yet, and inheriting the previous step's state would flash a title in
    // the bar over a screen that is showing the same words full-size.
    this._collapsed.set(false);
  }

  setCollapsed(collapsed: boolean): void {
    this._collapsed.set(collapsed);
  }
}

/**
 * Marks a step's large title — ≙ the SwiftUI large-title collapse, and the
 * page-level twin of what `ui-sheet-header` does inside a sheet.
 *
 * The element publishes its own text to {@link BookingChromeService}, then
 * watches itself: once it scrolls up under the toolbar the bar takes over
 * saying it, and once it comes back the bar goes quiet again. The identity
 * belongs to the in-content title; the bar only "lands" when that title is no
 * longer doing the job.
 *
 * ```html
 * <h1 libStepTitle uiText uiFont="title2">What are we doing?</h1>
 * ```
 */
@Directive({
  selector: '[libStepTitle]',
})
export class BookingStepTitle {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly chrome = inject(BookingChromeService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const element = this.host.nativeElement;
      this.chrome.publish(element.textContent?.trim() || null);

      // The toolbar's own height is the trigger line: the title is "gone" the
      // moment it passes behind the bar, not when it leaves the viewport.
      const barHeight = Math.round(
        parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            '--control-size-large',
          ),
        ) || 52,
      );

      // The collapse is an ENHANCEMENT: without an observer the bar simply
      // stays quiet and the in-content title keeps doing the job on its own.
      // Constructing one unguarded threw in every environment that lacks it
      // (jsdom among them), taking the rest of `afterNextRender` with it.
      if (typeof IntersectionObserver === 'undefined') {
        this.destroyRef.onDestroy(() => this.chrome.publish(null));
        return;
      }

      const observer = new IntersectionObserver(
        ([entry]) => this.chrome.setCollapsed(!entry?.isIntersecting),
        { rootMargin: `-${barHeight}px 0px 0px 0px`, threshold: 0 },
      );
      observer.observe(element);
      this.destroyRef.onDestroy(() => {
        observer.disconnect();
        this.chrome.publish(null);
      });
    });
  }
}
