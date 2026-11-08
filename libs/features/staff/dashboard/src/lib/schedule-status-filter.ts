import { Injectable, computed, signal } from '@angular/core';
import { BookingStatus, Tag } from '@core/primitives';

/**
 * Which booking states the schedule DRAWS (owner, 2026-11-05: "this button
 * should be for filter, so it should filter by statuses").
 *
 * ### Why it names what is HIDDEN
 * Every state is drawn until somebody hides it. A list of the shown ones
 * would hide a state the product adds next year on every device that saved
 * a choice before it existed; a list of the hidden ones shows it.
 *
 * ### Why a hidden cancellation is not the trap `agenda-fields.ts` refused
 * That file dropped a `status` FIELD because a switch that blanks the word
 * «ОТКАЗАН» off a card that is still drawn is a way to miss a cancellation.
 * This hides the whole card, on purpose, from a control that stays ACCENT
 * for as long as anything is hidden — the screen says it is filtered.
 *
 * Per DEVICE, like the card's fields and for the same reason: the front
 * desk and a barber's phone are read by different people.
 */
const STORAGE_KEY = 'staff-schedule-hidden-statuses';
/** Blocked time hidden — its own key: a block is time, not a booking state. */
const BLOCKS_KEY = 'staff-schedule-hide-blocks';
/** Free time drawn — its own key, OFF by default (see `freeTimeShown`). */
const FREE_TIME_KEY = 'staff-schedule-show-free-time';

/** The states in the sheet's order: the lifecycle's, live first. */
export const SCHEDULE_STATUSES: readonly BookingStatus[] = [
  BookingStatus.Confirmed,
  BookingStatus.Pending,
  BookingStatus.Completed,
  BookingStatus.NoShow,
  BookingStatus.Cancelled,
];

function load(): readonly BookingStatus[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Held to the dictionary: a state that no longer exists is dropped,
    // never trusted into a filter that would hide nothing it can name.
    return parsed.filter((value): value is BookingStatus =>
      Tag.has(BookingStatus, value),
    );
  } catch {
    // Corrupt storage is not worth a broken screen.
    return [];
  }
}

/** What the filter sheet edits and «Приложи» applies. */
export interface ScheduleFilterDraft {
  readonly hidden: readonly BookingStatus[];
  readonly blocksHidden: boolean;
  readonly freeTimeShown: boolean;
}

function loadBlocksHidden(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(BLOCKS_KEY) === 'true';
  } catch {
    return false;
  }
}

function loadFreeTimeShown(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(FREE_TIME_KEY) === 'true';
  } catch {
    return false;
  }
}

/** One write per switch; private mode, quota or a kiosk keep it for the session. */
function store(key: string, value: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // The choice simply does not outlive the session.
  }
}

@Injectable({ providedIn: 'root' })
export class ScheduleStatusFilter {
  private readonly state = signal<readonly BookingStatus[]>(load());
  private readonly blocksHidden = signal(loadBlocksHidden());
  private readonly freeTime = signal(loadFreeTimeShown());
  /**
   * Free time drawn for THIS visit of the schedule only — a link that asked
   * for it (`?free=1`, the analytics screen's open-hours card, CUJ 2). Never
   * stored, cleared when the schedule is left (`endFreeTimeOnce`) and by any
   * choice the person makes themselves; the filter root-provided, so a
   * one-off left set would outlive the page.
   */
  private readonly freeTimeOnce = signal(false);

  /** The states the schedule leaves out — what `ScheduleFilterSystem.shown` takes. */
  readonly hidden = this.state.asReadonly();

  /**
   * BLOCKED TIME is drawn (owner, 2026-11-05: "blocked blocks should be
   * able to be visible") — the grid's blocks and the list's block rows. On
   * until hidden, as every state is.
   */
  readonly blocksShown = computed(() => !this.blocksHidden());

  /**
   * FREE TIME is drawn as rows in the list (owner, 2026-11-05: "free time as
   * an option, as blocked time"). OFF by default, and showing it is not a
   * filter — it draws MORE — so it never lights the funnel. On a quiet
   * Tuesday every unsold minute is a row and the run is mostly holes; the
   * day's total free time is still said above the run. The grid draws none:
   * its empty space already is the free time.
   */
  readonly freeTimeShown = computed(
    () => this.freeTime() || this.freeTimeOnce(),
  );

  /**
   * The person's OWN choice of free time, as stored — what the filter
   * sheet's draft starts from, so «Приложи» never stores a one-off a link
   * turned on.
   */
  readonly storedFreeTimeShown = this.freeTime.asReadonly();

  /** Something is hidden: the bar's filter control says so in the accent. */
  readonly filtering = computed(
    () => this.state().length > 0 || this.blocksHidden(),
  );

  isShown(status: BookingStatus): boolean {
    return !this.state().includes(status);
  }

  toggle(status: BookingStatus): void {
    const current = this.state();
    this.commit(
      current.includes(status)
        ? current.filter((held) => held !== status)
        : [...current, status],
    );
  }

  toggleFreeTime(): void {
    const shown = !this.freeTimeShown();
    this.freeTimeOnce.set(false);
    this.freeTime.set(shown);
    store(FREE_TIME_KEY, String(shown));
  }

  /**
   * Draws free time for this visit of the schedule WITHOUT storing it
   * (`?free=1`, staff-analytics CUJ 2): the preference on the device stays
   * what it was.
   */
  showFreeTimeOnce(): void {
    this.freeTimeOnce.set(true);
  }

  /** The schedule is left: a one-off free-time view ends with it. */
  endFreeTimeOnce(): void {
    this.freeTimeOnce.set(false);
  }

  toggleBlocks(): void {
    this.commitBlocks(!this.blocksHidden());
  }

  /** Back to the defaults: every state and blocked time drawn, free time not. */
  showAll(): void {
    this.apply({ hidden: [], blocksHidden: false, freeTimeShown: false });
  }

  /** The sheet's «Приложи»: the draft it was edited as, in one act. */
  apply(draft: ScheduleFilterDraft): void {
    // The person chose: their choice replaces a link's one-off.
    this.freeTimeOnce.set(false);
    this.commit(draft.hidden);
    this.commitBlocks(draft.blocksHidden);
    this.freeTime.set(draft.freeTimeShown);
    store(FREE_TIME_KEY, String(draft.freeTimeShown));
  }

  private commitBlocks(hidden: boolean): void {
    this.blocksHidden.set(hidden);
    store(BLOCKS_KEY, String(hidden));
  }

  private commit(next: readonly BookingStatus[]): void {
    this.state.set(next);
    store(STORAGE_KEY, JSON.stringify(next));
  }
}
