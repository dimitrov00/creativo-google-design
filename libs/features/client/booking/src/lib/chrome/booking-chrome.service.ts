import {
  Directive,
  TemplateRef,
  ElementRef,
  Injectable,
  DestroyRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
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

  /**
   * How tall the chrome currently is, in px — measured, not assumed.
   *
   * A step whose body is its own scroll region has to pin things BELOW the
   * bar (the schedule step's weekday key), and the bar is not one height: it
   * grows by a row the moment the large title collapses into it. Pinning to
   * `--control-size-large` left the key half-covered by the title row it had
   * just grown, with the bar's scrim dissolving the weekday letters. Steps
   * that merely pad the bar off never noticed, because by the time the bar
   * grows their title has already scrolled past.
   *
   * Zero until measured, which is the honest starting value: the first frame
   * has no layout yet, and a guessed height would place the key wrong for
   * exactly one paint.
   */
  private readonly _height = signal(0);
  readonly height = this._height.asReadonly();

  /**
   * The bar's height with the collapsing title row ABSENT — what anything
   * reserving flow space must use.
   *
   * Flow that tracked the live height would shove the page down the instant
   * the title collapsed, which pushes the title back into view, which
   * un-collapses the bar, which lifts the page again: a layout feeding its own
   * trigger. Measured (not `--control-size-large`) because the bar carries a
   * step-contributed accessory row now — the schedule step's weekday key — and
   * that row is present at rest.
   */
  private readonly _restingHeight = signal(0);
  readonly restingHeight = this._restingHeight.asReadonly();

  setHeight(height: number): void {
    this._height.set(height);
    // Only a measurement taken while the title is NOT in the bar describes the
    // resting bar.
    if (!this._collapsed()) this._restingHeight.set(height);
  }

  /**
   * An extra row the step contributes to the bar — the schedule step's Mo–Su
   * key — rendered only once {@link collapsed}, beside the compact title.
   *
   * It is the SAME `TemplateRef` the step renders in its own heading, so there
   * is one weekday key in the source and it simply changes address: in the
   * heading while the heading is on screen, in the bar once the heading has
   * gone under it. That is what makes the title and the key read as one block
   * — they arrive and leave together, on one trigger.
   *
   * The alternative, tried and reverted twice: pin the key separately under
   * the bar. It collapsed the title at one scroll position and pinned the key
   * at another, and needed an opaque fill and a second ramp to stop the bar's
   * own scrim painting through it — two stacked gradients over one boundary.
   */
  private readonly _accessory = signal<TemplateRef<unknown> | null>(null);
  readonly accessory = this._accessory.asReadonly();

  setAccessory(template: TemplateRef<unknown> | null): void {
    this._accessory.set(template);
  }

  publish(title: string | null): void {
    // An EMPTY title is no title. A step whose heading has not been filled in
    // yet (the words arrive with the translation, one binding pass after the
    // element) used to publish `''`, which is not `null` — so the bar grew a
    // row and said nothing at all.
    const next = title !== null && title.trim().length > 0 ? title : null;
    // Re-publishing the SAME title is not a new step. The text is re-read
    // whenever it changes, and resetting the collapse on every one of those
    // would drop the bar's title mid-scroll.
    if (next === this._title()) return;
    this._title.set(next);
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
 * Publishes an `<ng-template>` as the bar's extra row for as long as the step
 * that owns it is on screen. The step renders the same template inline too.
 *
 * ```html
 * <ng-template libChromeAccessory #weekdays> …Mo–Su… </ng-template>
 * ```
 */
@Directive({
  selector: '[libChromeAccessory]',
})
export class BookingChromeAccessory {
  private readonly template = inject<TemplateRef<unknown>>(TemplateRef);
  private readonly chrome = inject(BookingChromeService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.chrome.setAccessory(this.template);
    this.destroyRef.onDestroy(() => this.chrome.setAccessory(null));
  }
}

/**
 * Publishes the wizard toolbar's measured height to {@link BookingChromeService}.
 *
 * A `ResizeObserver` rather than a one-off read, because the bar changes
 * height in normal use: the collapsing title adds a row, and a locale with a
 * taller line box adds more. Put on the `ui-toolbar` element itself.
 *
 * ```html
 * <ui-toolbar libChromeHeight uiSticky uiToolbarBackground="scrim"> … </ui-toolbar>
 * ```
 */
@Directive({
  selector: '[libChromeHeight]',
})
export class BookingChromeHeight {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly chrome = inject(BookingChromeService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    afterNextRender(() => {
      const element = this.host.nativeElement;
      const publish = () =>
        this.chrome.setHeight(element.getBoundingClientRect().height);
      publish();

      // Same enhancement posture as the collapse observer below: without the
      // API the last measured height simply stands, and jsdom has neither.
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(publish);
      observer.observe(element);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
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
/** Words, not merely a value — `''` is how a bare attribute reads. */
function hasText(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

@Directive({
  selector: '[libStepTitle]',
})
export class BookingStepTitle {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly chrome = inject(BookingChromeService);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * The title, when this sits on the heading BLOCK rather than on the `<h1>`.
   *
   * A step whose heading carries more than the title — the schedule step's
   * weekday key closes its heading — has to collapse on the whole block
   * leaving, not on the `<h1>` leaving, or the bar fills in two stages. Put
   * the directive on the block and name the title here; `textContent` would
   * otherwise sweep up the lede as well.
   */
  readonly libStepTitle = input<string | undefined>(undefined);

  constructor() {
    // A bound title re-publishes whenever it changes — the translation
    // arriving is one such change, and so is a language switch.
    effect(() => {
      const explicit = this.libStepTitle();
      if (hasText(explicit)) this.chrome.publish(explicit);
    });

    afterNextRender(() => {
      const element = this.host.nativeElement;

      /**
       * Read the heading's own words.
       *
       * Published REPEATEDLY, not once: `*transloco` creates a step's view
       * from a subscription, so the heading element exists a binding pass
       * before its interpolation is filled in. Reading `textContent` at
       * `afterNextRender` therefore caught an EMPTY element — the review
       * step's bar collapsed into a blank row, which is how this was found.
       */
      const publishText = () => {
        // A bound title wins; the effect above owns that case. `undefined` is
        // NOT the only way to be absent: `<h1 libStepTitle>` — the bare
        // attribute form the services and review steps use — binds the input
        // to the EMPTY STRING, and the original `?? textContent` never fell
        // through it. That is the whole bug: those two steps published '',
        // so the bar grew a row with nothing in it and the title never
        // collapsed.
        if (hasText(this.libStepTitle())) return;
        this.chrome.publish(element.textContent?.trim() ?? null);
      };
      publishText();

      // Same enhancement posture as the observers below — without the API the
      // first read simply stands.
      if (typeof MutationObserver !== 'undefined') {
        const words = new MutationObserver(publishText);
        words.observe(element, {
          characterData: true,
          childList: true,
          subtree: true,
        });
        this.destroyRef.onDestroy(() => words.disconnect());
      }

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
