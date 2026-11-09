import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  computed,
  input,
} from '@angular/core';

/** One dot of a page control: which page it stands for, and how it is drawn. */
export type UiPageDot = {
  readonly page: number;
  /** The page on screen. */
  readonly current: boolean;
  /** At a window's edge with more pages beyond it — drawn smaller. */
  readonly edge: boolean;
};

/** The most dots a page control draws; a longer run slides a window this wide. */
export const UI_PAGE_CONTROL_MAX_DOTS = 7;

/**
 * The dots for `count` pages with `index` on screen. Up to
 * {@link UI_PAGE_CONTROL_MAX_DOTS} pages, one dot each. A longer run (a
 * year of days) shows a window of that many that keeps the current page in
 * its middle where it can, and shrinks the dot at each end that has more
 * pages beyond it — iOS's page control on a long run.
 */
export function uiPageDots(count: number, index: number): readonly UiPageDot[] {
  if (count < 1) return [];
  const size = Math.min(count, UI_PAGE_CONTROL_MAX_DOTS);
  const current = Math.min(Math.max(index, 0), count - 1);
  const start = Math.min(
    Math.max(current - Math.floor(size / 2), 0),
    count - size,
  );
  const dots: UiPageDot[] = [];
  for (let page = start; page < start + size; page++) {
    dots.push({
      page,
      current: page === current,
      edge:
        (page === start && start > 0) ||
        (page === start + size - 1 && start + size < count),
    });
  }
  return dots;
}

/**
 * THE PAGE CONTROL — ≙ `UIPageControl`, the dots under a paged carousel
 * that say where it stands. The page on screen is a solid dot in the
 * foreground ink, every other page a faint one; a single page draws
 * nothing. Decorative unless `uiLabel` names it («Страница 3 от 12»): the
 * pages themselves carry their names, so a consumer whose pages are
 * labelled leaves it empty and the dots stay hidden from assistive tech.
 */
@Component({
  selector: 'ui-page-control',
  template: `
    @for (dot of dots(); track dot.page) {
      <span
        class="ui-page-control__dot"
        [attr.data-current]="dot.current ? '' : null"
        [attr.data-edge]="dot.edge ? '' : null"
      ></span>
    }
  `,
  styleUrl: './page-control.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Unscoped: `.ui-*` is the styling contract, and the host carries it.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'ui-page-control',
    '[attr.role]': "uiLabel() ? 'img' : null",
    '[attr.aria-label]': 'uiLabel() || null',
    '[attr.aria-hidden]': "uiLabel() ? null : 'true'",
    '[hidden]': 'uiCount() < 2',
  },
})
export class UiPageControl {
  /** How many pages the carousel holds. */
  readonly uiCount = input.required<number>();
  /** The page on screen, from 0. */
  readonly uiIndex = input.required<number>();
  /** What the dots say to assistive tech; empty keeps them decorative. */
  readonly uiLabel = input('');

  protected readonly dots = computed(() =>
    uiPageDots(this.uiCount(), this.uiIndex()),
  );
}
