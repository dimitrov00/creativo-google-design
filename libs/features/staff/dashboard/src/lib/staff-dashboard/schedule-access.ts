import { Injectable, inject } from '@angular/core';
import { type BarberId, StaffCapability } from '@core/primitives';
import { StaffAccessService } from '@creativo/features/client/account-state';
import { blockKeyOf, breakKeyOf } from './grid-drop';

/** A chair on offer: anything that names its barber. */
type Chair = { readonly id: BarberId };

/**
 * WHOSE TIME THE PERSON MAY CHANGE ON THE SCHEDULE (staff permissions P8):
 * an entry point for hours or blocked time is shown on a chair the owner's
 * permissions reach, and a colleague's is read-only.
 *
 * Two capabilities, as the server asks them:
 *
 * - `TIME_OFF` — blocked time on a chair, and a day's own breaks: the
 *   `setDayExceptions` callable, whichever pen;
 * - `HOURS` — a chair's weekly hours and its roster breaks: `setRosterWeek`
 *   and `amendRosterBreaks`.
 *
 * It decides nothing itself: every answer is `StaffAccessService.mayFor`'s,
 * so a change of the owner's cells or of the person's account moves a gate
 * with no reload. Nothing here is security-bearing; each call judges the
 * stored account and the cells again.
 *
 * The members are arrow properties so a template, a `computed()` and a
 * helper can take one as a plain function.
 */
@Injectable({ providedIn: 'root' })
export class ScheduleAccess {
  private readonly access = inject(StaffAccessService);

  /** Blocked time on this chair: make it, move it, change it, lift it. */
  readonly blocks = (barberId: BarberId): boolean =>
    this.access.mayFor(StaffCapability.TimeOff, barberId);

  /** This chair's weekly hours and its roster breaks. */
  readonly hours = (barberId: BarberId): boolean =>
    this.access.mayFor(StaffCapability.Hours, barberId);

  /**
   * Whether something drawn on the schedule may be touched, by its id:
   *
   * - `block:<chair>:<day>:<start>` — blocked time: `TIME_OFF` on its chair;
   * - `break:<chair>:<day>:<start>` — a break: the day's own is `TIME_OFF`,
   *   the roster's is `HOURS`, so either one opens it (the question it asks
   *   then offers only what the person may do);
   * - anything else — a visit — is not this gate's to refuse.
   */
  readonly edits = (id: string): boolean => {
    const block = blockKeyOf(id);
    if (block !== null) return this.blocks(block.barberId);
    const pause = breakKeyOf(id);
    return (
      pause === null ||
      this.blocks(pause.barberId) ||
      this.hours(pause.barberId)
    );
  };

  /** The chairs the person may block time on, in the order given. */
  blockable<T extends Chair>(chairs: readonly T[]): readonly T[] {
    return chairs.filter((chair) => this.blocks(chair.id));
  }

  /** The chairs whose weekly hours the person may change, in the order given. */
  hourable<T extends Chair>(chairs: readonly T[]): readonly T[] {
    return chairs.filter((chair) => this.hours(chair.id));
  }

  /**
   * The all-day doors that are shut: every chair on offer the person may
   * not block — its column's blank band in the day view, its day-off chip
   * in every view — and, for someone who may block nobody, every column's
   * band as well (a date column's band would open on no chair at all).
   */
  allDayShut(
    chairs: readonly Chair[],
    columns: readonly { readonly id: string }[],
  ): ReadonlySet<string> {
    const shut = new Set<string>();
    let open = false;
    for (const chair of chairs) {
      if (this.blocks(chair.id)) open = true;
      else shut.add(chair.id);
    }
    if (!open) for (const column of columns) shut.add(column.id);
    return shut;
  }

  /**
   * The chair an act aims at, among those allowed: the one wanted when it
   * is allowed, else the first allowed, else none. A barber looking at the
   * whole shop blocks their own time from the ＋, not the first chair's.
   */
  aimed(wanted: BarberId | null, allowed: readonly Chair[]): BarberId | null {
    return allowed.some((chair) => chair.id === wanted)
      ? wanted
      : (allowed[0]?.id ?? null);
  }
}
