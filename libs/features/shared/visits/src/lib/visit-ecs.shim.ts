import { type TimeZone, UtcEpochMs, defect } from '@core/primitives';
import { type ShopNow, type WallTime } from '@core/components';
import {
  CancelledSide,
  type FilterRow,
  VisitFilter as EcsVisitFilter,
  VisitGrain as EcsVisitGrain,
  VisitPerspective as EcsVisitPerspective,
  VisitRowOutcome as EcsVisitRowOutcome,
  ZonedTimeSystem,
} from '@core/systems';
import type {
  VisitFilter,
  VisitGrain,
  VisitPerspective,
  VisitRowOutcome,
} from './visit-row.vm';

/*
 * THE FLATTEN-PASS BOUNDARY of the visit lists (flatten-spec §0.1, §8.9) —
 * internal to this lib, never exported from its index. The list's systems
 * (`VisitListSystem`, `VisitStorySystem`) speak SCREAMING tags and the
 * shop's wall clock; the view models (`visit-row.vm.ts`, frozen) and every
 * caller keep the legacy lower-case words and epoch instants. Each
 * dictionary has ONE table here, the legacy word of each value, and its
 * inverse, so `visit-filter.ts`, `visit-sections.ts` and
 * `visit-row.presenter.ts` convert the same way. Deleted with the legacy
 * view models (Phase 4).
 */

/** The legacy word of each row outcome — and its inverse below. */
export const LEGACY_VISIT_ROW_OUTCOME = {
  [EcsVisitRowOutcome.Open]: 'open',
  [EcsVisitRowOutcome.Worked]: 'worked',
  [EcsVisitRowOutcome.NoShow]: 'no_show',
  [EcsVisitRowOutcome.Cancelled]: 'cancelled',
} as const satisfies Record<EcsVisitRowOutcome, VisitRowOutcome>;

export const VISIT_ROW_OUTCOME_OF = {
  open: EcsVisitRowOutcome.Open,
  worked: EcsVisitRowOutcome.Worked,
  no_show: EcsVisitRowOutcome.NoShow,
  cancelled: EcsVisitRowOutcome.Cancelled,
} as const satisfies Record<VisitRowOutcome, EcsVisitRowOutcome>;

/** The legacy word of each funnel option — and its inverse below. */
export const LEGACY_VISIT_FILTER = {
  [EcsVisitFilter.All]: 'all',
  [EcsVisitFilter.Upcoming]: 'upcoming',
  [EcsVisitFilter.Completed]: 'completed',
  [EcsVisitFilter.Cancelled]: 'cancelled',
  [EcsVisitFilter.NoShow]: 'no_show',
} as const satisfies Record<EcsVisitFilter, VisitFilter>;

export const VISIT_FILTER_OF = {
  all: EcsVisitFilter.All,
  upcoming: EcsVisitFilter.Upcoming,
  completed: EcsVisitFilter.Completed,
  cancelled: EcsVisitFilter.Cancelled,
  no_show: EcsVisitFilter.NoShow,
} as const satisfies Record<VisitFilter, EcsVisitFilter>;

/** The system's reader of each legacy perspective (the list only ever asks this way). */
export const VISIT_PERSPECTIVE_OF = {
  client: EcsVisitPerspective.Client,
  staff: EcsVisitPerspective.Staff,
} as const satisfies Record<VisitPerspective, EcsVisitPerspective>;

/** The system's grain of each legacy grain (the list only ever asks this way). */
export const VISIT_GRAIN_OF = {
  month: EcsVisitGrain.Month,
  year: EcsVisitGrain.Year,
} as const satisfies Record<VisitGrain, EcsVisitGrain>;

/** The legacy word of each side a cancellation is on (the row only ever reads it). */
export const LEGACY_CANCELLED_SIDE = {
  [CancelledSide.Client]: 'client',
  [CancelledSide.Shop]: 'shop',
} as const satisfies Record<CancelledSide, 'client' | 'shop'>;

/**
 * The shop's zone for a legacy instant that does not carry its own. The
 * product is one Sofia tenant (blueprint §7.1 — the legacy `TENANT_ZONE`):
 * a list row (`VisitRowVm`) holds only its start instant, so the boundary
 * reads it on the shop's calendar here. A row built from a visit converts in
 * that visit's own zone instead (`visit-row.presenter.ts`); the rows carry
 * their location's `timeZone` once their collection flips (Phase 3b).
 */
export const VISITS_TIME_ZONE: TimeZone = zoneOf('Europe/Sofia');

/** An IANA zone the legacy kernel already accepted — `ZonedTimeSystem.checkZone`. */
export function zoneOf(raw: string): TimeZone {
  const zone = ZonedTimeSystem.checkZone(raw);
  if (!zone.ok) defect(`unreachable: an unknown zone ${raw}`);
  return zone.value;
}

/** A legacy epoch instant as the brand (a stored instant is a safe integer). */
export function utcMsOf(epochMs: number): UtcEpochMs {
  const instant = UtcEpochMs.of(epochMs);
  if (!instant.ok) defect(`unreachable: not an instant ${epochMs}`);
  return instant.value;
}

/**
 * The shop's "now" for a list's clock reading — derived ONCE per list, not
 * per row: every row of a list is built with the same `nowMs`, so the last
 * reading (its instant and zone) is kept and handed back to the next row.
 */
let lastNow: {
  readonly nowMs: number;
  readonly zone: TimeZone;
  readonly shopNow: ShopNow;
} | null = null;

export function shopNowOf(nowMs: number, timeZone: TimeZone): ShopNow {
  if (
    lastNow !== null &&
    lastNow.nowMs === nowMs &&
    lastNow.zone === timeZone
  ) {
    return lastNow.shopNow;
  }
  const shopNow = ZonedTimeSystem.shopNow(utcMsOf(nowMs), timeZone);
  lastNow = { nowMs, zone: timeZone, shopNow };
  return shopNow;
}

/** A legacy instant on the shop's wall clock (`ZonedTimeSystem.toLocal`). */
export function wallTimeOf(
  epochMs: number,
  timeZone: TimeZone = VISITS_TIME_ZONE,
): WallTime {
  return ZonedTimeSystem.toLocal(utcMsOf(epochMs), timeZone);
}

/** A row as the funnel reads it — its own outcome under the system's tag. */
export function filterRowOf(row: {
  readonly upcoming: boolean;
  readonly outcome: VisitRowOutcome | null;
}): FilterRow {
  return {
    upcoming: row.upcoming,
    outcome: row.outcome === null ? null : VISIT_ROW_OUTCOME_OF[row.outcome],
  };
}
