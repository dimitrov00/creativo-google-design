import { GridEvent as GridEventTag } from '@core/components';
import {
  BarberId,
  Currency,
  type DurationMinutes,
  EndMinute,
  LocalDate,
  MinuteOfDay,
  type TrackMinute,
} from '@core/primitives';
import { ClockClosing, formatClock } from '@creativo/ui/wall-clock';
import type { GridColumn, GridPendingSlot } from '../time-grid/staff-time-grid';
import type { VisitEditorVm } from '../visit-editor/staff-visit-editor';

/**
 * WHERE A CREATE STARTS FROM — a free-time row of the list, or a slot
 * tapped on the grid (owner, 2026-11-05/06): the chair, the day, where a
 * booking from it starts, where a block from it starts and where it ends.
 * A free-time row (`GapRowVm`) satisfies it as is; a grid slot is built
 * by {@link createFromSlot}.
 */
export interface CreateFrom {
  readonly barberId: BarberId;
  /** The day it is on — absent for a row of the shown day. */
  readonly dayKey?: LocalDate;
  readonly bookableFromMinutes: MinuteOfDay;
  readonly openFromMinutes: MinuteOfDay;
  readonly endMinutes: EndMinute;
  /** How long a booking from it runs — a drawn range's; absent, the default. */
  readonly minutes?: DurationMinutes;
}

/**
 * A grid slot as a create's origin. A CHAIR column's id is its chair's
 * `BarberId` on the shown day; a DATE column's is its day, on the chair a
 * create aims at (`fallbackChair`). The slot runs `span` from its start,
 * kept inside the day. `null` when there is no chair to seat it on, or the
 * column names no day.
 */
export function createFromSlot(
  slot: { readonly columnId: string; readonly startMinute: TrackMinute },
  columns: 'chairs' | 'dates',
  shownDay: LocalDate,
  fallbackChair: BarberId | null,
  span: DurationMinutes,
): CreateFrom | null {
  const start = MinuteOfDay.of(slot.startMinute);
  if (!start.ok) return null;
  let barberId = fallbackChair;
  let dayKey = shownDay;
  if (columns === 'chairs') {
    barberId = BarberId.of(slot.columnId);
  } else {
    const day = LocalDate.parse(slot.columnId);
    if (!day.ok) return null;
    dayKey = day.value;
  }
  if (barberId === null) return null;
  return {
    barberId,
    dayKey,
    bookableFromMinutes: start.value,
    openFromMinutes: start.value,
    endMinutes: EndMinute.ofProven(Math.min(1440, start.value + span)),
    minutes: span,
  };
}

/** «10:30 – 11:00» — a grid slot's draft block words, and its trigger's name. */
export function slotTimeLabel(slot: GridPendingSlot): string {
  const clock = (minute: TrackMinute) => formatClock(minute, ClockClosing.Wrap);
  return `${clock(slot.startMinute)} – ${clock(slot.endMinute)}`;
}

/**
 * The grid blocks a hold may lift (owner, 2026-11-06): visits that can
 * still be moved — none whose story is over (`terminal`).
 */
export function movableIdsOf(
  columns: readonly GridColumn[],
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const column of columns) {
    for (const event of column.events) {
      if (event.gridEvent === GridEventTag.Visit && !event.terminal) {
        ids.add(event.id);
      }
    }
  }
  return ids;
}

/**
 * What a NEW visit's sheet starts without: not saved yet, so no id, no
 * client record (it is the save that names one), nothing priced (the
 * shop's one currency), no tip, no discount or voucher (a visit the server
 * has not seen cannot be discounted or paid yet — the rows wait for the
 * first save, like the tip's), no outcome, no stored tag (the sheet's «new»
 * visit) and no verbs.
 */
export const NEW_VISIT_BLANKS = {
  appointmentId: null,
  peers: [],
  clientCustomerId: null,
  clientMeta: null,
  note: null,
  teamNote: null,
  priceLabel: null,
  priceCents: null,
  currency: Currency.EUR,
  tipLabel: null,
  tipCents: null,
  discounts: [],
  vouchers: [],
  resolution: null,
  bookingStatus: null,
  arrivedMinute: null,
  primaryVerb: null,
  overflowVerbs: [],
} as const satisfies Partial<VisitEditorVm>;
