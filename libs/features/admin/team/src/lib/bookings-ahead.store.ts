import { Injectable, inject, signal } from '@angular/core';
import type { Appointment } from '@core/entities';
import { listBookingsAhead } from '@core/pipelines';
import type { BarberId, LocalDate } from '@core/primitives';
import { BARBER_AHEAD_PORTS } from '@creativo/infrastructure/firebase-app';

/**
 * THE VISITS A BARBER HAS AHEAD (team onboarding D10): read once through
 * `listBookingsAhead` — the busy days after a day, then those days'
 * visits — and kept, so the screen that asked can count, list and dot
 * them, and re-count for another last day, with no second read.
 *
 * `watch` names the day the visits are wanted AFTER. A later day is
 * already covered by what was read and reads nothing; an EARLIER one (a
 * last day drafted in the past) reads again from there. Sequenced, so an
 * answer that comes back late never replaces the answer to a newer ask.
 *
 * It decides nothing: which visits are left after a last day is
 * `EmploymentSystem.leftoverVisitsOf`'s answer — inside the pipeline for
 * the day asked, and the host's `computed` for the day drafted. A read
 * that fails is said as «could not tell», never as «nothing is left».
 * Provided by whoever asks: one barber at a time.
 */
@Injectable()
export class BookingsAheadStore {
  private readonly list = listBookingsAhead(inject(BARBER_AHEAD_PORTS));

  private readonly _visits = signal<readonly Appointment[] | null>(null);
  private readonly _failed = signal(false);
  private seq = 0;
  /** Whose visits are held, and after which day. */
  private held: { barberId: BarberId; after: LocalDate } | null = null;

  /**
   * The live visits the barber holds after the day watched, oldest first;
   * `null` while nothing is watched, or the answer is on its way.
   */
  readonly visits = this._visits.asReadonly();
  /** The visits watched could not be read. */
  readonly failed = this._failed.asReadonly();

  /**
   * The visits `barberId` holds after `afterLocalDate`. `null` watches
   * nothing and forgets the last answer.
   */
  watch(barberId: BarberId, afterLocalDate: LocalDate | null): void {
    if (afterLocalDate === null) {
      this.seq++;
      this.held = null;
      this._visits.set(null);
      this._failed.set(false);
      return;
    }
    const held = this.held;
    // What is held (or on its way) already reaches back this far.
    if (
      held !== null &&
      held.barberId === barberId &&
      held.after <= afterLocalDate &&
      !this._failed()
    ) {
      return;
    }
    const seq = ++this.seq;
    this.held = { barberId, after: afterLocalDate };
    this._visits.set(null);
    this._failed.set(false);
    void this.list(barberId, afterLocalDate).then((answer) => {
      // A newer ask owns the answer now.
      if (seq !== this.seq) return;
      if (answer.ok) this._visits.set(answer.value);
      else this._failed.set(true);
    });
  }
}
