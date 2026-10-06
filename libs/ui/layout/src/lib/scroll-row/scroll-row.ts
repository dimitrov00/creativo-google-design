import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
} from '@angular/core';
import type { UiSpacing } from '../stack/stack';

/** SwiftUI parity: `.scrollTargetBehavior(.viewAligned)` alignment. */
export type UiScrollRowSnap = 'none' | 'start' | 'center';

/**
 * How far the row breaks out of its column. `true` = the VIEWPORT (a page's
 * centred column); `'container'` = the parent's inline padding (a sheet's
 * column: `--ui-sheet-inset`), so a shelf inside a sheet runs to the
 * sheet's edges and its first item still starts on the column's edge.
 */
export type UiScrollRowFullBleed = boolean | 'container';

/** What the keyboard can already reach inside a row (a link, a control, a stop). */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/**
 * SwiftUI parity: `ScrollView(.horizontal)` + `.scrollIndicators(.hidden)` —
 * the horizontal carousel/strip container. Scroll indicators are ALWAYS
 * hidden; snap alignment applies per child. `uiFullBleed` breaks the row out
 * to the full viewport width while keeping content aligned to the page
 * gutter via the `--ui-scroll-row-gutter` custom property (consumers
 * override it to match their own gutter); `uiFullBleed="container"` breaks
 * it out of a sheet's column instead (the gutter defaults to the sheet's
 * own inset).
 *
 * `uiContainerRelativeCount` / `uiContainerRelativeSpan` ≙
 * `containerRelativeFrame(.horizontal, count:span:spacing:)` — every item's
 * width as a share of the row: `count` columns across the column's width,
 * each item `span` of them, the spacing between them counted. A count that
 * does not divide by the span is the PEEK: 7 / 2 shows three and a half
 * items, and the half says there is more.
 *
 * ```html
 * <ui-scroll-row uiFullBleed="container" uiSpacing="compact"
 *   [uiContainerRelativeCount]="7" [uiContainerRelativeSpan]="2">…</ui-scroll-row>
 * ```
 *
 * A KEYBOARD STOP when nothing else is (2026-09-28, WCAG 2.1.1 · axe
 * `scrollable-region-focusable`). A row of static cards that overflows —
 * the achievements' records — could not be scrolled without a pointer,
 * and its last card was out of reach. While the row overflows and holds
 * nothing focusable, it stamps `tabindex="0"` (the arrow keys then scroll
 * it), `role="group"` unless the consumer gave it a role, and `uiLabel` as
 * its name unless the consumer named it; it wears the house focus ring. A
 * row of buttons or links is already reachable and stays out of the tab
 * order. Whatever the consumer set itself (a tabindex, a role, a name) is
 * never written over or lifted.
 */
@Component({
  selector: 'ui-scroll-row',
  template: `<ng-content />`,
  styleUrl: './scroll-row.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: bare `.ui-*`/`[data-*]` selectors never match a component's
  // own HOST element under emulated encapsulation (see avatar.ts) — and
  // global `.ui-*` classes are this system's actual styling contract (§3.1).
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-scroll-row',
    '[attr.data-snap]': 'uiSnap()',
    '[attr.data-spacing]': 'uiSpacing()',
    '[attr.data-full-bleed]': 'fullBleed()',
    '[attr.data-relative]': "relativeCount() === null ? null : ''",
    '[style.--ui-scroll-row-count]': 'relativeCount()',
    '[style.--ui-scroll-row-span]':
      'relativeCount() === null ? null : uiContainerRelativeSpan()',
  },
})
export class UiScrollRow {
  readonly uiSnap = input<UiScrollRowSnap>('start');
  readonly uiSpacing = input<UiSpacing>('regular');
  /** `true` (or the bare attribute) = the viewport; `'container'` = the column. */
  readonly uiFullBleed = input<UiScrollRowFullBleed, UiScrollRowFullBleed | ''>(
    false,
    {
      transform: (value) => (value === '' ? true : value),
    },
  );
  /** ≙ `containerRelativeFrame`'s `count`: columns across the row. */
  readonly uiContainerRelativeCount = input<number | null>(null);
  /** ≙ its `span`: how many of those columns one item takes. */
  readonly uiContainerRelativeSpan = input(1);
  /**
   * The row's name when it becomes a keyboard stop (a row of static cards
   * that overflows) — the section's heading, «Рекорди». A consumer's own
   * `aria-label`/`aria-labelledby` wins.
   */
  readonly uiLabel = input<string | null>(null);

  private readonly host =
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** Whether the row is a stop now, and which attributes it wrote itself. */
  private stop = false;
  private wroteTabindex = false;
  private wroteRole = false;
  private wroteLabel = false;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (typeof ResizeObserver === 'undefined') return;
      const resize = new ResizeObserver(() => this.syncStop());
      const watch = () => {
        resize.observe(this.host);
        for (const child of Array.from(this.host.children)) {
          resize.observe(child);
        }
      };
      watch();
      const mutation =
        typeof MutationObserver === 'undefined'
          ? null
          : new MutationObserver(() => {
              watch();
              this.syncStop();
            });
      mutation?.observe(this.host, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['tabindex', 'href', 'disabled', 'contenteditable'],
      });
      this.syncStop();
      destroyRef.onDestroy(() => {
        resize.disconnect();
        mutation?.disconnect();
      });
    });
    // A label that changes while the row is a stop follows it.
    effect(() => {
      const label = this.uiLabel();
      if (!this.wroteLabel) return;
      if (label) this.host.setAttribute('aria-label', label);
      else {
        this.host.removeAttribute('aria-label');
        this.wroteLabel = false;
      }
    });
  }

  /** Stamps or lifts the keyboard stop from what the row holds now. */
  private syncStop(): void {
    const host = this.host;
    const stop =
      host.scrollWidth - host.clientWidth > 1 && !host.querySelector(FOCUSABLE);
    if (stop === this.stop) return;
    this.stop = stop;
    if (stop) {
      if (!host.hasAttribute('tabindex')) {
        host.setAttribute('tabindex', '0');
        this.wroteTabindex = true;
      }
      host.setAttribute('data-keyboard-stop', '');
      if (!host.hasAttribute('role')) {
        host.setAttribute('role', 'group');
        this.wroteRole = true;
      }
      const label = this.uiLabel();
      if (
        label &&
        !host.hasAttribute('aria-label') &&
        !host.hasAttribute('aria-labelledby')
      ) {
        host.setAttribute('aria-label', label);
        this.wroteLabel = true;
      }
      return;
    }
    host.removeAttribute('data-keyboard-stop');
    if (this.wroteTabindex) host.removeAttribute('tabindex');
    if (this.wroteRole) host.removeAttribute('role');
    if (this.wroteLabel) host.removeAttribute('aria-label');
    this.wroteTabindex = false;
    this.wroteRole = false;
    this.wroteLabel = false;
  }

  /** `''` for the viewport bleed, `'container'` for the column's, else none. */
  protected readonly fullBleed = computed(() => {
    const bleed = this.uiFullBleed();
    return bleed === 'container' ? 'container' : bleed ? '' : null;
  });

  /** A usable count or none: a share of zero columns is no width at all. */
  protected readonly relativeCount = computed(() => {
    const count = this.uiContainerRelativeCount();
    return count !== null && count > 0 ? count : null;
  });
}
