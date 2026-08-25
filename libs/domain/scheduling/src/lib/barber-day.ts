import { Result, fail, ok } from '@creativo/domain/kernel';
import { BarberId } from '@creativo/domain/catalog';
import { BarberDayTotals, foldBarberDay } from './barber-day-totals';
import { CalendarDay } from './calendar-day';
import { Interval } from './interval';
import { OccupancyBlock } from './occupancy-block';
import { RosterWindow } from './roster-window';
import {
  BarberDayBlockCollisionError,
  type BarberDayError,
} from './barber-day.errors';

export interface BarberDayProps {
  readonly barberId: BarberId;
  readonly day: CalendarDay;
  readonly windows: readonly RosterWindow[];
  readonly blocks: readonly OccupancyBlock[];
}

/**
 * **The spine of the availability and statistics model.** One aggregate per
 * (barber, calendar day), holding two things and only two things: the windows
 * the barber was rostered for, and the intervals of that day already spoken
 * for.
 *
 * ### Why intervals and not slots
 * A bookable START is a function of duration, and in this product duration is
 * `Service.termsFor(barber, variant)` — so a stored slot list would have to be
 * keyed on `barber × day × service × variant` and would go stale on every
 * catalog edit, silently: after a 30→45 change the stored 09:30 start is still
 * *a* start, just no longer one that fits. Intervals know nothing about
 * durations, so a catalog edit cannot touch them. That is the whole reason the
 * owner's "day availability per barber" keeps its shape but changes its
 * contents.
 *
 * ### Why the same document answers both questions
 * Availability is `windows − busy`. Statistics are the same blocks, folded by
 * their reason. One artefact, written once, and the two can never disagree
 * about what happened.
 *
 * ### Keyed on (barber, day), NOT (location, barber, day)
 * A barber is one person. Keying by location too would give a barber working
 * two shops in one day two documents, neither aware of the other, and a
 * booking at shop A would not block them at shop B. `locationId` therefore
 * rides on each window and each block.
 */
export class BarberDay {
  private constructor(
    readonly barberId: BarberId,
    readonly day: CalendarDay,
    readonly windows: readonly RosterWindow[],
    readonly blocks: readonly OccupancyBlock[],
  ) {}

  static create(props: BarberDayProps): Result<BarberDay, BarberDayError> {
    const collision = BarberDay.findCollision(props.blocks);
    if (collision) {
      return fail(new BarberDayBlockCollisionError(collision[0], collision[1]));
    }
    return ok(
      new BarberDay(
        props.barberId,
        props.day,
        props.windows,
        // Chronological, so every reader sees one order and the persisted
        // document is stable byte-for-byte across rebuilds.
        props.blocks
          .slice()
          .sort((a, b) => a.interval.startMs - b.interval.startMs),
      ),
    );
  }

  /** A rostered day with nothing booked yet. */
  static empty(
    barberId: BarberId,
    day: CalendarDay,
    windows: readonly RosterWindow[],
  ): BarberDay {
    return new BarberDay(barberId, day, windows, []);
  }

  /**
   * Two blocks overlapping means the barber is in two places at once — the
   * one thing a day may never hold. Deliberately checked even though the
   * booking transaction also checks: a rebuild from source data must not be
   * able to reintroduce a collision the live path prevented.
   */
  private static findCollision(
    blocks: readonly OccupancyBlock[],
  ): readonly [string, string] | null {
    const sorted = blocks
      .slice()
      .sort((a, b) => a.interval.startMs - b.interval.startMs);
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1] as OccupancyBlock;
      const current = sorted[i] as OccupancyBlock;
      if (Interval.overlaps(previous.interval, current.interval)) {
        return [previous.id, current.id];
      }
    }
    return null;
  }

  /**
   * Add or REPLACE a block by id.
   *
   * Replacement rather than append is what makes a duplicated trigger delivery
   * harmless: the block's id is deterministic, so processing the same event
   * twice writes the same block twice and lands in the same state.
   */
  place(block: OccupancyBlock): Result<BarberDay, BarberDayError> {
    const without = this.blocks.filter((existing) => existing.id !== block.id);
    return BarberDay.create({
      barberId: this.barberId,
      day: this.day,
      windows: this.windows,
      blocks: [...without, block],
    });
  }

  /** Remove a block by id — a cancellation, so the slot becomes bookable again. */
  release(blockId: string): BarberDay {
    return new BarberDay(
      this.barberId,
      this.day,
      this.windows,
      this.blocks.filter((block) => block.id !== blockId),
    );
  }

  /**
   * Re-materialise the roster while keeping what is booked.
   *
   * A schedule change regenerates windows; the blocks are facts about work and
   * survive. Blocks that now fall outside the windows are NOT dropped — they
   * are real commitments — and `foldBarberDay` counts them as overtime.
   */
  withWindows(windows: readonly RosterWindow[]): BarberDay {
    return new BarberDay(this.barberId, this.day, windows, this.blocks);
  }

  /** What the availability engine subtracts. */
  busy(): readonly Interval[] {
    return Interval.normalize(this.blocks.map((block) => block.interval));
  }

  /** Free, sellable time — `windows − busy`. */
  free(): readonly Interval[] {
    return Interval.subtract(
      this.windows.map((window) => window.interval),
      this.busy(),
    );
  }

  totals(currencyCode = 'EUR', shortestSellableMinutes = 15): BarberDayTotals {
    return foldBarberDay(
      this.windows,
      this.blocks,
      currencyCode,
      shortestSellableMinutes,
    );
  }

  /**
   * The PUBLIC projection — geometry only.
   *
   * Firestore rules cannot redact fields, so anything a client may read must
   * be in its own document. This is that document: merged busy intervals and
   * the rostered windows, with **no reason, no ids, no revenue, no counts**.
   *
   * Merging matters: unmerged intervals would let a visitor count how many
   * clients a barber served. What remains — booking density — is what anyone
   * learns by looking through the shop window.
   *
   * `sick` in particular is special-category health data under GDPR Art. 9,
   * and this product is EU-based. Reasons stay staff-only, unconditionally.
   */
  toPublicProjection(): PublicBarberDay {
    return {
      barberId: this.barberId.value,
      dayKey: this.day.key(),
      zone: this.day.zone,
      windows: this.windows.map((window) => window.interval),
      busy: this.busy(),
    };
  }
}

/** What an anonymous visitor may see. Nothing here identifies anybody. */
export interface PublicBarberDay {
  readonly barberId: string;
  readonly dayKey: string;
  readonly zone: string;
  readonly windows: readonly Interval[];
  readonly busy: readonly Interval[];
}
