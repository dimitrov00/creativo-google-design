import { Interval } from './interval';
import { OccupancyBlock } from './occupancy-block';
import { RosterWindow, rosteredMinutes } from './roster-window';

export type ExcludedReasonKey =
  'break_unpaid' | 'time_off' | 'sick' | 'training' | 'travel';

/**
 * One barber's day, folded into numbers. A pure function of the windows and
 * blocks, recomputed on every write — which is why it needs no trigger, has
 * no eventual consistency, and can never drift from what it summarises.
 */
export interface BarberDayTotals {
  /** Σ rostered windows — what the barber was scheduled for. */
  readonly rosteredMinutes: number;
  /**
   * THE UTILISATION DENOMINATOR: rostered, minus time that was never sellable,
   * plus work done outside the roster.
   *
   * The overtime term is owner ruling R1: staff may place an appointment
   * outside rostered hours, and that work is real. Without adding it to the
   * denominator as well as the numerator, utilisation would exceed 100%.
   */
  readonly scheduledMinutes: number;
  /** Σ productive blocks — revenue-generating client work. */
  readonly productiveMinutes: number;
  /** Productive work that fell OUTSIDE the rostered windows. */
  readonly overtimeMinutes: number;
  readonly bufferMinutes: number;
  /** Booked, held, and not turned up for — the metric a naive model loses. */
  readonly noShowMinutes: number;
  readonly adminBlockedMinutes: number;
  readonly excludedMinutes: Readonly<Record<ExcludedReasonKey, number>>;
  /** Sellable time nobody bought. */
  readonly idleMinutes: number;
  readonly idleGapCount: number;
  readonly longestIdleGapMinutes: number;
  /**
   * Idle gaps long enough to actually sell — at least `shortestSellableMinutes`.
   *
   * The difference between this and {@link idleGapCount} is the whole
   * FRAGMENTATION story, and it is what tells an owner which problem they
   * have: 60% utilisation lost as one three-hour hole is a DEMAND problem
   * (marketing), and the same 60% lost as eight twenty-minute slivers is a
   * SCHEDULING problem (fixable in `slotStepMinutes` and buffers). No other
   * pair of numbers separates those two, and the wrong diagnosis is expensive
   * in opposite directions.
   */
  readonly sellableGapCount: number;
  /** SEATS, not appointments — a party of three is three services. */
  readonly serviceCount: number;
  /**
   * DISTINCT appointments touched — a party of three is ONE ticket.
   *
   * Kept beside `serviceCount` rather than instead of it because the two
   * answer different questions and are routinely confused: average ticket
   * divides revenue by THIS, per-barber average service value divides by
   * `serviceCount`, and swapping them understates the first by the average
   * party size.
   */
  readonly appointmentCount: number;
  readonly noShowCount: number;
  readonly revenueMinorUnits: number;
  readonly currencyCode: string;
}

const EMPTY_EXCLUDED: Readonly<Record<ExcludedReasonKey, number>> = {
  break_unpaid: 0,
  time_off: 0,
  sick: 0,
  training: 0,
  travel: 0,
};

function excludedKeyFor(block: OccupancyBlock): ExcludedReasonKey | null {
  switch (block.reason.kind) {
    case 'break':
      return block.reason.paid ? null : 'break_unpaid';
    case 'time_off':
      return 'time_off';
    case 'sick':
      return 'sick';
    case 'training':
      return 'training';
    case 'travel':
      return 'travel';
    default:
      return null;
  }
}

/**
 * Fold a day into its numbers.
 *
 * Everything reads the block's FROZEN `klass`, never `classifyOccupancy` —
 * that is what makes a historical report reproducible after a policy change.
 */
export function foldBarberDay(
  windows: readonly RosterWindow[],
  blocks: readonly OccupancyBlock[],
  currencyCode = 'EUR',
  /**
   * The shortest service this shop actually sells, in minutes — the bar an
   * idle gap has to clear to count as sellable. A parameter rather than a
   * constant because it is a CATALOG fact that differs per shop, and the fold
   * must stay pure. The default is deliberately small: over-counting sellable
   * gaps understates fragmentation, which is the safer direction to be wrong
   * (it never invents a scheduling problem that is not there).
   */
  shortestSellableMinutes = 15,
): BarberDayTotals {
  const rostered = rosteredMinutes(windows);
  const windowIntervals = windows.map((window) => window.interval);

  const excluded: Record<ExcludedReasonKey, number> = { ...EMPTY_EXCLUDED };
  let productive = 0;
  let overtime = 0;
  let buffer = 0;
  let noShow = 0;
  let adminBlocked = 0;
  let serviceCount = 0;
  let noShowCount = 0;
  let revenue = 0;
  // A party's seats each carry the SAME appointment id, so a set is what turns
  // "three services" into "one ticket".
  const appointmentIds = new Set<string>();

  for (const block of blocks) {
    const minutes = block.minutes();

    if (block.isProductive()) {
      productive += minutes;
      if (block.outsideWindow) overtime += minutes;
    }
    if (block.reason.kind === 'buffer') buffer += minutes;
    if (block.reason.kind === 'admin') adminBlocked += minutes;
    if (block.reason.kind === 'service') {
      serviceCount += 1;
      appointmentIds.add(block.reason.appointmentId.value);
      revenue += block.revenueMinorUnits;
      if (block.reason.outcome === 'no_show') {
        noShow += minutes;
        noShowCount += 1;
      }
    }

    const key = excludedKeyFor(block);
    // eslint-disable-next-line security/detect-object-injection -- closed union.
    if (key !== null) excluded[key] += minutes;
  }

  const excludedTotal = Object.values(excluded).reduce((a, b) => a + b, 0);
  const scheduled = Math.max(0, rostered - excludedTotal) + overtime;

  // Idle is the sellable time nobody bought: the windows, minus every block
  // that consumed capacity. Derived, never stored — storing it would
  // re-partition the day on every edit.
  const capacityTaken = blocks
    .filter((block) => block.consumesCapacity())
    .map((block) => block.interval);
  const idleGaps = Interval.subtract(windowIntervals, capacityTaken);
  const idleMinutes = Interval.totalMinutes(idleGaps);

  return {
    rosteredMinutes: rostered,
    scheduledMinutes: scheduled,
    productiveMinutes: productive,
    overtimeMinutes: overtime,
    bufferMinutes: buffer,
    noShowMinutes: noShow,
    adminBlockedMinutes: adminBlocked,
    excludedMinutes: excluded,
    idleMinutes,
    idleGapCount: idleGaps.length,
    longestIdleGapMinutes: idleGaps.reduce(
      (longest, gap) => Math.max(longest, Interval.durationMinutes(gap)),
      0,
    ),
    sellableGapCount: idleGaps.filter(
      (gap) => Interval.durationMinutes(gap) >= shortestSellableMinutes,
    ).length,
    serviceCount,
    appointmentCount: appointmentIds.size,
    noShowCount,
    revenueMinorUnits: revenue,
    currencyCode,
  };
}

/**
 * Productive work as a share of sellable time. `null` when nothing was
 * sellable — a day off has no utilisation, and reporting 0% would defame a
 * barber for a holiday.
 */
export function utilisation(totals: BarberDayTotals): number | null {
  if (totals.scheduledMinutes === 0) return null;
  return totals.productiveMinutes / totals.scheduledMinutes;
}

/**
 * Productive work PLUS turnaround, as a share of sellable time. Reported
 * alongside {@link utilisation} — the gap between the two is exactly what the
 * shop's buffer policy costs, which is otherwise invisible.
 */
export function chairTimeUtilisation(totals: BarberDayTotals): number | null {
  if (totals.scheduledMinutes === 0) return null;
  return (
    (totals.productiveMinutes + totals.bufferMinutes) / totals.scheduledMinutes
  );
}

/** Rostered time that was never sellable, by reason — "busy from else". */
export function committedButUnsellableMinutes(totals: BarberDayTotals): number {
  return Object.values(totals.excludedMinutes).reduce((a, b) => a + b, 0);
}

/**
 * The share of idle gaps too short to sell — the DIAGNOSIS that turns a bad
 * utilisation figure into an action.
 *
 * Near 0 means the idle time is in usable blocks: the shop has a demand
 * problem and should market. Near 1 means the same idle minutes are shredded
 * into unsellable slivers: the shop has a scheduling problem and should look
 * at its slot step and buffers. Identical utilisation, opposite remedies.
 *
 * `null` when there was no idle time at all — a fully booked day has no
 * fragmentation, and reporting 0 would read as "perfectly packed gaps"
 * rather than "no gaps".
 */
export function fragmentationRatio(totals: BarberDayTotals): number | null {
  if (totals.idleGapCount === 0) return null;
  return (totals.idleGapCount - totals.sellableGapCount) / totals.idleGapCount;
}
