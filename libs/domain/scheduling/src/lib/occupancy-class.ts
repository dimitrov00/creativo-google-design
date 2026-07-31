import { OccupancyReason } from './occupancy-reason';

/**
 * How a block of occupied time counts in the numbers.
 *
 * Three independent axes, because the owner's questions are independent:
 * - `capacity` — was this time SELLABLE? It is the utilisation DENOMINATOR.
 * - `productive` — was it revenue-generating client work? The NUMERATOR.
 * - `paid` — is the shop paying for it? The labour-cost denominator.
 */
export interface OccupancyClass {
  readonly capacity: 'scheduled' | 'excluded';
  readonly productive: boolean;
  readonly paid: boolean;
}

/**
 * Bumped whenever the table below changes. Every block stores the version it
 * was classified under, so a policy change tomorrow cannot silently restate
 * last July — the same reasoning that makes `Seat.terms` a snapshot.
 */
export const OCCUPANCY_POLICY_VERSION = 1;

/**
 * The classification table (owner ruling R2, 2026-07-29).
 *
 * | reason | capacity | productive | paid |
 * |---|---|---|---|
 * | `service` worked / scheduled | scheduled | yes | yes |
 * | `service` **no_show** | **scheduled** | no | yes |
 * | `buffer` | scheduled | no | yes |
 * | `admin` | **scheduled** | no | yes |
 * | `break` paid | scheduled | no | yes |
 * | `break` unpaid | excluded | no | no |
 * | `training` / `travel` | excluded | no | yes |
 * | `time_off` | excluded | no | no |
 * | `sick` | excluded | no | per `paid` |
 *
 * The two judgement calls, both confirmed by the owner:
 *
 * - **A no-show stays in the denominator.** The barber genuinely stood idle in
 *   a slot nobody else could take. Excluding it would merge "nobody booked"
 *   with "somebody booked and didn't come" — a marketing problem and a
 *   deposits problem that look identical in a naive model.
 * - **An admin block stays in the denominator.** A manager reserving two hours
 *   is a choice that consumed sellable time, and utilisation should show what
 *   it cost. Excluding it lets bad scheduling hide behind a block.
 *
 * Training and travel are EXCLUDED because no scheduler could have filled
 * them — penalising a barber for a shop decision is wrong — but they stay
 * visible as their own lines in the totals.
 */
export function classifyOccupancy(reason: OccupancyReason): OccupancyClass {
  switch (reason.kind) {
    case 'service':
      return {
        capacity: 'scheduled',
        productive: reason.outcome !== 'no_show',
        paid: true,
      };
    case 'buffer':
      return { capacity: 'scheduled', productive: false, paid: true };
    case 'admin':
      return { capacity: 'scheduled', productive: false, paid: true };
    case 'break':
      return {
        capacity: reason.paid ? 'scheduled' : 'excluded',
        productive: false,
        paid: reason.paid,
      };
    case 'training':
    case 'travel':
      return { capacity: 'excluded', productive: false, paid: true };
    case 'time_off':
      return { capacity: 'excluded', productive: false, paid: false };
    case 'sick':
      return { capacity: 'excluded', productive: false, paid: reason.paid };
  }
}
