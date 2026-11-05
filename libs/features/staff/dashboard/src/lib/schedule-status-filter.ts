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

function loadBlocksHidden(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(BLOCKS_KEY) === 'true';
  } catch {
    return false;
  }
}

@Injectable({ providedIn: 'root' })
export class ScheduleStatusFilter {
  private readonly state = signal<readonly BookingStatus[]>(load());
  private readonly blocksHidden = signal(loadBlocksHidden());

  /** The states the schedule leaves out — what `ScheduleFilterSystem.shown` takes. */
  readonly hidden = this.state.asReadonly();

  /**
   * BLOCKED TIME is drawn (owner, 2026-11-05: "blocked blocks should be
   * able to be visible") — the grid's blocks and the list's block rows. On
   * until hidden, as every state is.
   */
  readonly blocksShown = computed(() => !this.blocksHidden());

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

  toggleBlocks(): void {
    this.commitBlocks(!this.blocksHidden());
  }

  /** Every state, and blocked time, drawn again. */
  showAll(): void {
    this.commit([]);
    this.commitBlocks(false);
  }

  private commitBlocks(hidden: boolean): void {
    this.blocksHidden.set(hidden);
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(BLOCKS_KEY, String(hidden));
    } catch {
      // As below: the choice simply does not outlive the session.
    }
  }

  private commit(next: readonly BookingStatus[]): void {
    this.state.set(next);
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private mode, quota, a locked-down kiosk — the choice simply does
      // not outlive the session. Not worth failing the switch over.
    }
  }
}
