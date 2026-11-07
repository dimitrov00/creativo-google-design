import type { ShopNow, WallTime } from '@core/components';
import {
  EndMinute,
  type LocalDate,
  type LocationId,
  MinuteOfDay,
  type TimeZone,
  type UtcEpochMs,
} from '@core/primitives';
import { IntervalSetSystem } from '@core/systems';
import { formatDayPill } from '../day-pill/staff-day-pill';
import type { BarberDayLane } from '../staff-day.store';
import type {
  VisitEditorPhoto,
  VisitEditorVm,
} from '../visit-editor/staff-visit-editor';
import {
  occupyingRows,
  peerRowOf,
  visitEditorWords,
} from './staff-day.presenter';
import {
  AgendaRow,
  type DayRowVm,
  type LaneVm,
  type StaffDayWords,
} from './staff-day.vm';

const MIDNIGHT = MinuteOfDay.ofProven(0);
const CLOSING = EndMinute.ofProven(24 * 60);

/** What one visit's sheet is seeded from, beside its row — the page's reads, handed in. */
export interface EditorVmSources {
  /** The shown day, `null` before it is known. */
  readonly dayKey: LocalDate | null;
  /** The agenda's lanes — the neighbours, the party's other chairs. */
  readonly lanes: readonly LaneVm[];
  /** The store's lanes — the roster windows, the stored visits. */
  readonly storeLanes: readonly BarberDayLane[];
  readonly zoneAt: (locationId: LocationId | null) => TimeZone | null;
  readonly dayWords: StaffDayWords;
  readonly lang: string;
  readonly teamNote: string | null;
  readonly photos: readonly VisitEditorPhoto[];
  readonly photoBusy: boolean;
  readonly now: ShopNow | null;
  /** An instant on the shop's wall clock, `null` while no zone is known. */
  readonly stampWall: (atUtcMs: UtcEpochMs) => WallTime | null;
  /** The visit is being written — the store's, or a save from here. */
  readonly acting: boolean;
}

/**
 * ONE VISIT AS ITS SHEET IS SEEDED — the open sheet's, or a block dropped on
 * the grid, whose own save is this seed with the drop laid on it
 * (`snapshotCommitOf`, `dropOnGrid`). `null` before the day is known.
 */
export function editorVmOf(
  row: DayRowVm,
  src: EditorVmSources,
): VisitEditorVm | null {
  // A row is drawn only on a shown day, so the day is known here.
  const dayKey = src.dayKey;
  if (dayKey === null) return null;

  // The agenda lane holds the neighbours; the STORE lane holds the roster
  // windows. `LaneVm.rostered` is a boolean — "does this chair work today" —
  // and the intervals it is named after live one layer down.
  const lane = src.lanes.find((entry) =>
    entry.entries.some(
      (e) => e.agendaRow === AgendaRow.Visit && e.id === row.id,
    ),
  );
  const storeLane = src.storeLanes.find(
    (entry) => entry.barberId === lane?.barberId,
  );

  // What occupies the chair: the visits beside this one whose ROOT is
  // live — the server's overlap rule (`BusySystem.chairOccupants`, DEP-2).
  const neighbours = occupyingRows(
    lane,
    storeLane?.appointments ?? [],
    row.appointmentId,
  );

  const roster = IntervalSetSystem.hull(storeLane?.rostered ?? []);
  const editorWords = visitEditorWords(row, src.dayWords);

  return {
    appointmentId: row.appointmentId,
    rowId: row.id,
    // The revision the sheet's draft is drawn from — what «Запази» claims.
    revision: row.revision,
    locationId: row.locationId,
    // The shop's own zone, else the day's (`StaffDayStore.zoneAt`).
    timeZone: src.zoneAt(row.locationId),
    /*
     * THE REST OF THE BOOKING.
     *
     * Every row of the same appointment that is not this one — which on an
     * ordinary visit is none, and on a split party is the other chair. The
     * sheet frames one chair's share; this is what stops that framing from
     * reading as the whole visit, and it is the only way to reach the other
     * half without going back to the day and hunting for a second card at
     * the same minute.
     */
    peers: src.lanes
      .flatMap((lane) => lane.entries)
      .filter(
        (entry): entry is DayRowVm =>
          entry.agendaRow === AgendaRow.Visit &&
          entry.appointmentId === row.appointmentId &&
          entry.id !== row.id,
      )
      .map(peerRowOf),
    /*
     * ⚠ THE APPOINTMENT'S OWN DAY, never the drafted one.
     *
     * This VM is the BASELINE: `seedDraft` copies it into the draft and
     * `dirty` compares the draft back against it, so NOTHING the draft can
     * change may be fed from the draft. Pointing these at the drafted day
     * closed a loop — draft → `dayChanged` → the parent's signal → this VM
     * → `seedDraft` → draft — and cost two bugs before the shape was
     * right: the draft reseeded on every step, snapping the pill back
     * while the frame moved without it; and `dirty` went blind to the day,
     * because the seed moved with the very value it was measuring.
     *
     * The frame still follows the pill — through `visitFrameDay`, a
     * SEPARATE input carrying only what is drawn and never seeded.
     */
    dayKey,
    dayLabel: formatDayPill(dayKey, src.lang),
    // The chair's own wall clock, as stored (Law 7.3).
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    legs: row.legs,
    clientLabel: row.contactLabel,
    people: row.people,
    clientUserId: row.ownerUserId,
    clientCustomerId: row.ownerCustomerId,
    phone: row.phone,
    phoneHref: row.phoneHref,
    // `rebooked` is the one durable fact the shop holds about a person here:
    // a client who came back. Anything richer needs a history read the sheet
    // does not have, so it says the true thing or nothing.
    clientMeta: editorWords.clientMeta,
    note: row.note,
    teamNote: src.teamNote,
    photos: src.photos,
    photoBusy: src.photoBusy,
    priceLabel: row.priceLabel,
    priceCents: row.priceCents,
    currency: row.currency,
    tipLabel: row.tipLabel,
    tipCents: row.tipCents,
    discounts: row.discounts,
    vouchers: row.vouchers,
    resolution: row.resolution,
    // The chair's stored tag; the sheet prints its word where it shows one.
    bookingStatus: row.bookingStatus,
    statusLabel: editorWords.statusLabel,
    // The arrival STAMP read onto the shop's wall clock (the opening
    // midnight while no zone is known, as it always read then).
    arrivedMinute:
      row.arrivedAtUtcMs === null
        ? null
        : (src.stampWall(row.arrivedAtUtcMs)?.minute ?? MIDNIGHT),
    chairId: lane?.barberId ?? null,
    chairName: row.barberName,
    chairTone: row.barberTone,
    neighbours,
    rosterStartMinute: roster?.startMinutes ?? MIDNIGHT,
    rosterEndMinute: roster?.endMinutes ?? CLOSING,
    // The store's `ShopNow` — the sheet reads "today" and "now" off it
    // (pass D D-10.5).
    now: src.now,
    // Regime A, carried through unchanged. `offeredVerbs` already decided
    // what is legal and `leadVerb` already decided what leads; the editor
    // renders that decision rather than re-taking it.
    primaryVerb: editorWords.primaryVerb,
    overflowVerbs: editorWords.overflowVerbs,
    // Busy while the store holds the visit, or while a save of it is
    // under way here — a note or a tip alone never touches the store's
    // pending set, and «Запази» must turn its ring for those too.
    acting: src.acting,
  };
}
