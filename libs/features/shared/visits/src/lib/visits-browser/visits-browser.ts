import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  booleanAttribute,
  computed,
  inject,
  input,
  linkedSignal,
  output,
} from '@angular/core';
import { visitPerspectiveWords } from '@creativo/infrastructure/i18n';
import { LoadState } from '@creativo/shared/view-state';
import { nearestScroller } from '@creativo/ui/controls';
import { VisitList, type VisitListPaging } from '../visit-list/visit-list';
import {
  type VisitListStyle,
  VisitPerspective,
  type VisitSectionVm,
} from '../visit-row.vm';
import { VisitPills, type VisitPillsBleed } from './visit-pills';

// What a folder adds beside the file the barrel names, that file
// re-exports (contract delta K3-3): the pills, for a host that mounts the
// rail alone.
export { VisitPills, type VisitPillsBleed } from './visit-pills';

/**
 * How far the pill rail bleeds: to the `viewport`'s edge on a page, to
 * its `container`'s (the sheet's inset) inside a sheet.
 */
export type VisitsBrowserBleed = VisitPillsBleed;

/**
 * How long a tapped pill holds the scroll spy off when the scroller never
 * says its scroll ended (an engine without `scrollend`, or a jump that had
 * nowhere to go): a smooth scroll down a long history is over by then.
 */
const JUMP_HOLD_MS = 1200;

/**
 * How far below the chrome's line a heading may stand and still count as
 * AT it: a scroll offset is a whole pixel, so a heading a jump sent to the
 * line lands up to half a pixel either side of it.
 */
const LINE_SLACK_PX = 1;

/**
 * THE VISITS BROWSER (client-card revision 3 §3.11, R2-I) — the body of
 * «Моите часове», whole: the jump pills over the list. `/account/
 * appointments` and the staff card's «Посещения» mount this ONE
 * component, so the two screens change together; what only staff see
 * (money, status words, «Този час», the marks, paging) arrives through
 * the rows and the inputs, never through a second list.
 *
 * Presentational: no store is injected. It OWNS the scroll spy and the
 * jump (moved from the client's page). The current section is THE ONE AT
 * THE CHROME'S LINE — the first legible line under the host's floating
 * chrome, where a jumped-to heading lands: the last heading at or above
 * that line, or the first section while every heading still stands below
 * it. It is read from every heading's own box each time the spy wakes,
 * never from which headings crossed an observer's band: a heading that
 * slid under the chrome is not gone, its section is the one at the line,
 * and on the way back up nothing may cross a band at all (the pill stuck
 * on a later month, 2026-10-06). What wakes the spy is an observer over
 * the scroller's area under the line — a heading crossing the line, or
 * the scroller's foot, either way — and the scroller's own `scrollend`,
 * which settles a jump no heading crossed for. The observer's root is the
 * nearest scroller (`nearestScroller`; `null` = the viewport), its top
 * margin the COMPUTED `scroll-margin-block-start` of the first section
 * anchor — an observer takes px or %, never a custom property, and that
 * property resolves to px. The host states the length as
 * `--visit-list-anchor-clearance` (its own floating chrome: the page's
 * toolbar, the sheet's bar), and a jump lands clear of the same chrome.
 * The pills are re-derived from `sections()`, and the current one is
 * forgotten when the sections change under it (a filter); a page added at
 * the list's end moves nothing.
 *
 * Slots: `[visitListEmpty]` — the host words its own empty, since only it
 * knows whether the list is empty or merely filtered; `[visitPillsAction]`
 * — ONE control pinned at the pill rail's trailing end (the staff page's
 * funnel). The control stays when a filter leaves no section: the way
 * back out is on it.
 *
 * Custom properties the host may state: `--visit-list-anchor-clearance`
 * (above), `--visit-pills-gutter` (the rail's inline gutter, when the
 * page's column is not the content container).
 *
 * Test ids are a family: `{prefix}-pills`, `{prefix}-pill` (+
 * `data-section`, `data-selected`) and the list's own; with
 * `appointments` they are exactly today's.
 */
@Component({
  selector: 'lib-visits-browser',
  imports: [VisitList, VisitPills],
  templateUrl: './visits-browser.html',
  styleUrl: './visits-browser.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-perspective]': 'perspectiveWord()',
    '[attr.data-bleed]': 'bleed()',
  },
})
export class VisitsBrowser {
  readonly sections = input.required<readonly VisitSectionVm[]>();
  readonly perspective = input.required<VisitPerspective>();
  /** ≙ `.listStyle`: both perspectives run their rows as inset groups. */
  readonly listStyle = input<VisitListStyle>('insetGrouped');
  readonly state = input<LoadState>(LoadState.Ready);
  readonly paging = input<VisitListPaging | null>(null);
  /**
   * The family the browser's test ids belong to; null reads the
   * perspective's — `history` on the staff card, `appointments` on the
   * client's list.
   */
  readonly testIdPrefix = input<string | null>(null);
  /** False draws the list alone, without the jump pills. */
  readonly pills = input(true, { transform: booleanAttribute });
  readonly bleed = input<VisitsBrowserBleed>('viewport');
  /**
   * Whether a row is a control. `null` is the perspective's own: the
   * client's rows are buttons, the staff's static (owner question Q6
   * sets it).
   */
  readonly interactive = input<boolean | null>(null);
  /** A row was tapped: the appointment's id. */
  readonly openRow = output<string>();
  /** The next page, or the failed one again. */
  readonly loadMore = output<void>();
  /** The whole list, again, after it failed. */
  readonly retry = output<void>();

  /** The template's dictionary, for the rail's loading flag. */
  protected readonly LoadState = LoadState;

  /** The perspective as the host prints it: `client` · `staff` (`visitPerspectiveWords`). */
  protected readonly perspectiveWord = computed(
    () => visitPerspectiveWords[this.perspective()],
  );

  protected readonly prefix = computed(
    () =>
      this.testIdPrefix() ??
      (this.perspective() === VisitPerspective.Staff
        ? 'history'
        : 'appointments'),
  );

  /** The rail's pills: the sections of a list that is drawn, and no others. */
  protected readonly railSections = computed<readonly VisitSectionVm[]>(() =>
    this.state() === LoadState.Ready ? this.sections() : [],
  );

  /** The sections' keys, in order; the same run of keys is the same value. */
  private readonly keys = computed(
    () => this.sections().map((section) => section.key),
    { equal: sameKeys },
  );

  /**
   * Which section the pills call current — set by a tap, then by scrolling.
   *
   * `null` until either happens, because there is no honest default: a
   * client with no upcoming visit opens on their most recent month, so the
   * rail falls back to whatever the list starts with.
   *
   * It is forgotten when the sections change under it (a filter: the
   * section a moment ago may not exist now). Sections ADDED at the end (the
   * next page) change nothing about where the person stands.
   */
  private readonly touched = linkedSignal<readonly string[], string | null>({
    source: this.keys,
    computation: (keys, previous) =>
      previous !== undefined && startsWith(keys, previous.source)
        ? previous.value
        : null,
  });

  protected readonly activeKey = computed(
    () => this.touched() ?? this.sections()[0]?.key ?? null,
  );

  private readonly host =
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** A tapped pill holds the spy off until its own scroll has ended. */
  private jumping = false;
  private releaseJump: (() => void) | null = null;

  constructor() {
    // The pills follow the scroll: the section at the chrome's line is the
    // one they call current, read from the headings' own boxes whenever the
    // spy wakes. Tapping one scrolls there and the spy confirms it — one
    // source of truth for "where am I", rather than a selection that
    // drifts out of step with what is on screen.
    //
    // After RENDER, because the headings are the list's own: a new set of
    // sections exists in the DOM only once `lib-visit-list` has drawn it.
    afterRenderEffect((onCleanup) => {
      this.keys();
      if (!this.pills() || this.state() !== LoadState.Ready) return;
      const anchors = this.anchors();
      const first = anchors[0];
      const view = this.host.ownerDocument.defaultView;
      if (
        first === undefined ||
        view === null ||
        typeof IntersectionObserver === 'undefined'
      ) {
        return;
      }
      const root = nearestScroller(this.host);
      // What crossed is only the wake-up call: the answer is read whole.
      const sync = () => {
        if (this.jumping) return;
        const key = sectionAtLine(anchors, root);
        if (key !== null) this.touched.set(key);
      };
      const observer = new IntersectionObserver(sync, {
        root,
        // The scroller's area under its chrome: the spy wakes when a
        // heading crosses the line, down or up, or the scroller's foot.
        rootMargin: `-${clearanceOf(first)}px 0px 0px 0px`,
        threshold: 0,
      });
      for (const anchor of anchors) observer.observe(anchor);
      // A jump no heading crossed the line for (a scrollbar drag, the
      // keyboard's End) still ends, and the scroller says so.
      const scroller: EventTarget = root ?? view;
      scroller.addEventListener('scrollend', sync);
      onCleanup(() => {
        observer.disconnect();
        scroller.removeEventListener('scrollend', sync);
      });
    });

    inject(DestroyRef).onDestroy(() => this.releaseJump?.());
  }

  /** The list's section headings, in order — each carries its `data-section-key`. */
  private anchors(): readonly HTMLElement[] {
    return [...this.host.querySelectorAll<HTMLElement>('[data-section-key]')];
  }

  /**
   * A tapped pill scrolls its heading to the chrome's line — except the
   * FIRST section's, which brings the browser's own top there instead: the
   * rail, whole, with the first heading a section's gap under it. The
   * first heading stands that gap under the rail, so landing IT at the
   * line put the rail under the host's chrome, cut in half by its fade —
   * the pill just tapped, gone (review r4). The spy reads the same answer
   * either way: every heading still stands below the line, so the first
   * section is current.
   */
  protected jumpTo(key: string): void {
    this.touched.set(key);
    const anchors = this.anchors();
    const anchor = anchors.find(
      (element) => element.dataset['sectionKey'] === key,
    );
    if (anchor === undefined) return;
    const target = anchor === anchors[0] ? this.host : anchor;
    if (typeof target.scrollIntoView !== 'function') return;
    this.holdSpy();
    target.scrollIntoView({ behavior: this.behavior(), block: 'start' });
  }

  /**
   * On its way to the tapped section the scroll passes every heading
   * between, and each would light its own pill for a moment. The spy
   * stands down until the scroller says the scroll ended, or the hold
   * runs out.
   */
  private holdSpy(): void {
    this.releaseJump?.();
    const view = this.host.ownerDocument.defaultView;
    if (view === null) return;
    const scroller: EventTarget = nearestScroller(this.host) ?? view;
    const release = () => {
      this.jumping = false;
      this.releaseJump = null;
      scroller.removeEventListener('scrollend', release);
      view.clearTimeout(timer);
    };
    const timer = view.setTimeout(release, JUMP_HOLD_MS);
    scroller.addEventListener('scrollend', release);
    this.jumping = true;
    this.releaseJump = release;
  }

  /** Smooth, unless the person asked for less motion. */
  private behavior(): ScrollBehavior {
    const view = this.host.ownerDocument.defaultView;
    return view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ? 'auto'
      : 'smooth';
  }
}

/**
 * The section at the chrome's line: the last heading whose top is at or
 * above the line (the scroller's top — the viewport's, with no scroller —
 * plus the host's clearance), or the first section while every heading
 * still stands below it, the list's head in view. The headings come in
 * the list's order, so the first one past the line ends the walk.
 */
function sectionAtLine(
  anchors: readonly HTMLElement[],
  root: Element | null,
): string | null {
  const first = anchors[0];
  if (first === undefined) return null;
  const line =
    (root?.getBoundingClientRect().top ?? 0) +
    clearanceOf(first) +
    LINE_SLACK_PX;
  let current = first;
  for (const anchor of anchors) {
    if (anchor.getBoundingClientRect().top > line) break;
    current = anchor;
  }
  return current.getAttribute('data-section-key');
}

/**
 * The anchor's clearance in px: its computed `scroll-margin-block-start`,
 * which the host stated as `--visit-list-anchor-clearance` in any unit it
 * liked (`6rem`, a `calc()` over the sheet's chrome). Zero when nothing is
 * stated, or where nothing is laid out.
 */
function clearanceOf(anchor: HTMLElement): number {
  const style = getComputedStyle(anchor);
  const px = Number.parseFloat(
    style.scrollMarginBlockStart || style.scrollMarginTop || '0',
  );
  return Number.isFinite(px) ? Math.max(0, Math.round(px)) : 0;
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b.at(index));
}

/** `keys` begins with every key of `head`, in order: nothing moved, more came. */
function startsWith(keys: readonly string[], head: readonly string[]): boolean {
  return (
    head.length <= keys.length &&
    head.every((key, index) => key === keys.at(index))
  );
}
