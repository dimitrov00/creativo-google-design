import { Injectable, inject, signal } from '@angular/core';
import type { LeftoverBookings } from '@core/components';
import { listBookingsAhead } from '@core/pipelines';
import type { BarberId, LocalDate } from '@core/primitives';
import { BARBER_AHEAD_PORTS } from '@creativo/infrastructure/firebase-app';

/**
 * THE BOOKINGS A LAST DAY WOULD LEAVE BEHIND (team onboarding D10): asked
 * once per day picked, through `listBookingsAhead` — the busy days after
 * it, then those days' visits. Sequenced, so an answer that comes back
 * late never replaces the answer to a newer day.
 *
 * It counts and decides nothing else: which visits are left is
 * `EmploymentSystem.leftoverOf`'s answer, inside the pipeline. A read that
 * fails is said as «could not tell», never as «nothing is left».
 * Provided by whoever asks: one question at a time.
 */
@Injectable()
export class BookingsAheadStore {
  private readonly list = listBookingsAhead(inject(BARBER_AHEAD_PORTS));

  private readonly _leftover = signal<LeftoverBookings | null>(null);
  private readonly _failed = signal(false);
  private seq = 0;

  /** What the day in force would leave behind; `null` while nothing is asked, or the answer is on its way. */
  readonly leftover = this._leftover.asReadonly();
  /** The question in force could not be read. */
  readonly failed = this._failed.asReadonly();

  /** The bookings `barberId` holds after `lastLocalDate`; `null` asks nothing and forgets the last answer. */
  ask(barberId: BarberId, lastLocalDate: LocalDate | null): void {
    const seq = ++this.seq;
    this._leftover.set(null);
    this._failed.set(false);
    if (lastLocalDate === null) return;
    void this.list(barberId, lastLocalDate).then((answer) => {
      // A newer day owns the answer now.
      if (seq !== this.seq) return;
      if (answer.ok) this._leftover.set(answer.value);
      else this._failed.set(true);
    });
  }
}
