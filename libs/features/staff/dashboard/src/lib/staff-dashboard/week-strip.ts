import {
  ElementRef,
  Injectable,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { LocalDate } from '@core/primitives';
import { CatalogWording } from '@creativo/features/shared/catalog';
import { StaffDayStore } from '../staff-day.store';
import { weekCalendarOf } from './staff-day-chrome.presenter';

/** Frames a cold load is given to lay the strip out before a settle gives up. */
const SETTLE_FRAMES = 24;

/**
 * Park the week strip on a week, and keep asking until it lands.
 *
 * Deliberately arithmetic rather than `scrollIntoView`: every week is
 * exactly one scrollport wide, so the target is `index x clientWidth` and
 * there is nothing to measure. `scrollIntoView` also walks every scrollable
 * ancestor, which on first paint scrolled the PAGE as a side effect.
 *
 * The retry is the same shape as the dashboard's `settleOnNow` and for the
 * same reason: on a cold load the strip is laid out over several frames,
 * and a scroll against a zero-width box clamps silently to nothing.
 */
export function settleStripOnWeek(
  host: HTMLElement,
  index: number,
  framesLeft: number,
): void {
  if (framesLeft <= 0) return;
  const strip = host.querySelector<HTMLElement>(
    '[data-testid="staff-week-strip"]',
  );
  const page = strip?.clientWidth ?? 0;
  const again = () =>
    requestAnimationFrame(() => settleStripOnWeek(host, index, framesLeft - 1));
  if (strip === null || page === 0) {
    again();
    return;
  }
  const target = index * page;
  if (Math.abs(strip.scrollLeft - target) < 1) return;
  strip.scrollTo({ left: target, behavior: 'instant' });
  again();
}

/**
 * THE WEEK STRIP'S STATE, for the dashboard that provides it: thirteen weeks
 * anchored to TODAY (4 back for looking up what happened, 8 forward for the
 * booking horizon) — anchoring to the selection would re-key every week on
 * every tap, and `@for` would rebuild the strip under the user's thumb —
 * and the strip kept on the shown day's week.
 */
@Injectable()
export class StaffWeekStrip {
  private readonly store = inject(StaffDayStore);
  private readonly content = inject(CatalogWording);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /**
   * The strip's CELLS — thirteen weeks of them, and not one of them depends
   * on which day is SHOWN.
   *
   * This used to live inside the strip with the selection, which reads
   * `dayKey()`. So every tap rebuilt all ninety-one cells and, inside the
   * loop, constructed a hundred and eighty-two `Intl.DateTimeFormat`s to
   * re-derive labels that had not changed — constructing a formatter
   * resolves locale data and is the expensive half of `Intl` by a wide
   * margin. Measured, that was ~33ms between the tap and the disc starting
   * to move: two frames of dead air that no easing curve can hide, because
   * the transition cannot begin until change detection lets go.
   *
   * Split out, the skeleton recomputes only when the DATE or the LOCALE
   * turns over, and the two faces come from the shared, cached formatters
   * (`formatWallClock`) instead of two built per cell.
   */
  private readonly calendar = computed(() =>
    weekCalendarOf(this.store.todayKey(), this.content.locale()),
  );

  /**
   * The strip, with the selection laid over it.
   *
   * Only the marker's column is derived here. Whether a given day is the
   * shown one is a comparison the template makes against `store.dayKey()`
   * directly — the same idiom the date picker already uses — so `week.days`
   * keeps its identity from the calendar and a tap allocates thirteen
   * objects rather than a hundred and four.
   */
  readonly weeks = computed(() => {
    const selected = this.store.dayKey();
    return this.calendar().map((week) => ({
      ...week,
      // Which column the marker parks in, or -1 when the shown day is not in
      // this week. The marker is per-week and slides between columns, so the
      // week has to own the index rather than the day owning a flag.
      selectedIndex: week.days.findIndex((day) => day.key === selected),
    }));
  });

  /** Which week holds the shown day — the one the strip scrolls to. */
  private readonly selectedWeek = computed(() => {
    const day = this.store.dayKey();
    return day === null ? null : LocalDate.startOfWeek(day);
  });

  /**
   * Keep the strip on the shown day's week — only when the day moves to a
   * DIFFERENT week: tapping a day inside the visible week must not re-scroll
   * under the thumb that just tapped it.
   */
  private readonly followed = signal<string | null>(null);

  protected readonly followWeek = effect(() => {
    const week = this.selectedWeek();
    // No day yet (the shop's zone is resolving): nothing to follow.
    if (week === null) return;
    // No strip yet either. A `?day=` names the shown week before the shop's
    // today is known, and with no weeks the index used to fall back to 0:
    // the strip "landed" on October, the week was marked as followed, and
    // nothing — «Днес» in that same week included — moved it again
    // (owner, 2026-11-05: "even if I click go to today it doesn't slide").
    const first = this.calendar()[0]?.key;
    if (first === undefined) return;
    // Followed per week AND per strip: a strip that turns over at midnight
    // starts on another Monday, so the same week sits at another index.
    if (untracked(() => this.followed()) === `${first}|${week}`) return;
    untracked(() => this.park(week));
  });

  /** Slide the strip to `week` once it is laid out, and remember it was. */
  park(week: LocalDate): void {
    const first = this.calendar()[0]?.key;
    if (first === undefined) return;
    this.followed.set(`${first}|${week}`);
    const index = Math.round(LocalDate.daysBetween(first, week) / 7);
    const host = this.host.nativeElement;
    afterNextRender(() => settleStripOnWeek(host, index, SETTLE_FRAMES), {
      injector: this.injector,
    });
  }
}
