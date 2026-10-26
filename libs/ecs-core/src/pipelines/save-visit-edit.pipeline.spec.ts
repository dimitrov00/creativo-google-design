import { describe, expect, it } from 'vitest';
import {
  AppointmentId,
  BarberId,
  BookingStatus,
  Currency,
  LocationId,
  SeatId,
  ServiceId,
} from '@core/primitives';
import {
  BookingCall,
  type StaffEditDraft,
  VisitEditWrite,
} from '@core/components';
import {
  PipelineError,
  PipelineErrorCode,
  StaffEditErrorCode,
} from '@core/errors';
import type {
  LiveSides,
  StaffEditWords,
  StaffSaveRowFacts,
} from '@core/systems';
import {
  cents,
  deepFreeze,
  draftPersonKey,
  duration,
  endMinute,
  localDate,
  minute,
  scriptedVisitEditWritePorts,
  trackMinute,
  type VisitEditWriteCall,
} from '@core/testing';
import {
  saveVisitEdit,
  type SaveVisitEditCommand,
} from './save-visit-edit.pipeline';

/*
 * OR-4: the staff dashboard's `writeFromEditor`, moved into a pipeline the
 * store calls for «Запази» and for its undo. The ordering invariant of
 * round 5 — the batch goes first and alone decides; the note, then the tip,
 * only once it landed; a side field a colleague moved refuses the write
 * before anything goes out — proven here on the recorded port calls
 * (`scriptedVisitEditWritePorts`). The dashboard spec's save and undo cases
 * (:5426–:5560) stay the characterisation net above it.
 *
 * The fixture is the dashboard spec's: `appointment-1`, Ivan's chair of a
 * split party (one of its two seats), his 10:00 cut at 28,00 € on
 * 2026-08-05 at `loc-center`, booked by Мартин Илиев, drawn on revision 3.
 */

const VISIT = AppointmentId.of('appointment-1');
const DAY = localDate('2026-08-05');
const SHOP = LocationId.of('loc-center');
const IVAN = BarberId.of('ivan');
const CUT_SEAT = SeatId.of('seat-0002');
const MARTIN = draftPersonKey('user-0001');
const MARTIN_LABEL = 'Мартин Илиев';
const NOTE = 'дължи 5 €';

/** The test catalogue answers with its keys (`provideTestI18n`). */
const WORDS: StaffEditWords = {
  walkIn: 'staff.visit.walkIn',
  walkInNumbered: () => 'staff.visit.walkInNumbered',
};

const ROW: StaffSaveRowFacts = {
  locationId: SHOP,
  clientLabel: MARTIN_LABEL,
  selfSeat: true,
  seatIds: [CUT_SEAT],
  partySize: 2,
  people: [{ label: MARTIN_LABEL }],
  legs: [
    {
      seatId: CUT_SEAT,
      minutes: duration(30),
      barberId: IVAN,
      priceCents: cents(2800),
    },
  ],
  discounts: [],
  vouchers: [],
  rootBookingStatus: BookingStatus.Confirmed,
};

function leg(overrides: Partial<StaffEditDraft.Leg> = {}): StaffEditDraft.Leg {
  return {
    seatId: CUT_SEAT,
    serviceId: ServiceId.of('svc-unknown-0003'),
    variantId: null,
    minutes: duration(30),
    priceCents: cents(2800),
    currency: Currency.EUR,
    typedPriceCents: cents(2800),
    barberId: IVAN,
    clientId: MARTIN,
    ...overrides,
  };
}

/** The visit as the sheet was opened on it — 10:00–10:30, nothing beside. */
const SNAPSHOT: StaffEditDraft = {
  revision: 3,
  dayKey: DAY,
  startMinute: trackMinute(600),
  endMinute: trackMinute(630),
  locationId: SHOP,
  legs: [leg()],
  note: null,
  discounts: [],
  vouchers: [],
  tipCents: null,
  drawn: null,
  clients: [
    { id: MARTIN, label: MARTIN_LABEL, phone: '+359881234567', email: null },
  ],
};

/** The frame dragged an hour on. */
const DRAGGED: StaffEditDraft = {
  ...SNAPSHOT,
  startMinute: trackMinute(660),
  endMinute: trackMinute(690),
};

/** The stored note and tip, heard: nothing on either. */
const QUIET: LiveSides = {
  note: null,
  noteHeard: true,
  tipCents: null,
  tipHeard: true,
};

function save(
  overrides: Partial<SaveVisitEditCommand> = {},
): SaveVisitEditCommand {
  return {
    appointmentId: VISIT,
    commit: DRAGGED,
    row: ROW,
    drawn: { note: null, tipCents: null },
    live: QUIET,
    guestLabels: [],
    words: WORDS,
    before: SNAPSHOT,
    writes: null,
    ...overrides,
  };
}

/** The ports a write went to, in order — by bundle member. */
function order(calls: readonly VisitEditWriteCall[]): readonly string[] {
  return calls.map((call) => call.port);
}

describe('saveVisitEdit — the batch first, then the note, then the tip (round 5)', () => {
  it('sends the batch claiming the drawn revision, then the note, then the tip, and says all of it landed', async () => {
    const calls: VisitEditWriteCall[] = [];
    const write = await saveVisitEdit(scriptedVisitEditWritePorts({ calls }))(
      save({ commit: { ...DRAGGED, note: NOTE, tipCents: cents(200) } }),
    );

    expect(write).toEqual(VisitEditWrite.written(true));
    expect(calls).toEqual([
      {
        port: 'sendStaffEdit',
        intent: {
          appointmentId: VISIT,
          commands: [
            BookingCall.editMove(DAY, minute(660), [CUT_SEAT]),
            BookingCall.editResizeEnd(DAY, endMinute(690), [CUT_SEAT]),
          ],
          acknowledgedOverlap: false,
          expectedVersion: 3,
          operationId: null,
        },
      },
      { port: 'saveTeamNoteText', appointmentId: VISIT, text: NOTE },
      {
        port: 'sendSeatTip',
        request: {
          appointmentId: VISIT,
          seatId: CUT_SEAT,
          amountCents: cents(200),
        },
      },
    ]);
  });

  it('sends the batch alone for a drag that leaves the note and the tip as drawn', async () => {
    const calls: VisitEditWriteCall[] = [];
    const write = await saveVisitEdit(scriptedVisitEditWritePorts({ calls }))(
      save({
        commit: { ...DRAGGED, note: NOTE, tipCents: cents(300) },
        drawn: { note: NOTE, tipCents: cents(300) },
        live: { ...QUIET, note: NOTE, tipCents: cents(300) },
      }),
    );

    expect(write).toEqual(VisitEditWrite.written(true));
    expect(order(calls)).toEqual(['sendStaffEdit']);
  });

  it('sends a note alone behind its batch — the chair-wide move and resize, no-ops carrying the claim', async () => {
    // DEP (OR-4 brief: "a note-only save sends no batch"): the plan always
    // carries the chair-wide move and resize, and the dashboard's own save
    // and undo specs pin a side-only save as batch-then-side (:5524).
    const calls: VisitEditWriteCall[] = [];
    const write = await saveVisitEdit(scriptedVisitEditWritePorts({ calls }))(
      save({ commit: { ...SNAPSHOT, note: NOTE } }),
    );

    expect(write).toEqual(VisitEditWrite.written(true));
    expect(order(calls)).toEqual(['sendStaffEdit', 'saveTeamNoteText']);
    expect(calls[0]).toEqual({
      port: 'sendStaffEdit',
      intent: expect.objectContaining({
        commands: [
          BookingCall.editMove(DAY, minute(600), [CUT_SEAT]),
          BookingCall.editResizeEnd(DAY, endMinute(630), [CUT_SEAT]),
        ],
        expectedVersion: 3,
      }),
    });
  });

  it('stamps the tip on the seat the batch KEPT after a removal — sent after the batch that removed the other', async () => {
    const FIRST = SeatId.of('seat-first');
    const SECOND = SeatId.of('seat-second');
    const calls: VisitEditWriteCall[] = [];
    await saveVisitEdit(scriptedVisitEditWritePorts({ calls }))(
      save({
        row: {
          ...ROW,
          seatIds: [FIRST, SECOND],
          legs: [FIRST, SECOND].map((seatId) => ({
            seatId,
            minutes: duration(30),
            barberId: IVAN,
            priceCents: cents(2800),
          })),
        },
        commit: {
          ...SNAPSHOT,
          legs: [leg({ seatId: SECOND })],
          tipCents: cents(200),
        },
        before: null,
      }),
    );

    expect(order(calls)).toEqual(['sendStaffEdit', 'sendSeatTip']);
    expect(calls[0]).toEqual({
      port: 'sendStaffEdit',
      intent: expect.objectContaining({
        commands: expect.arrayContaining([BookingCall.editRemoveSeat(FIRST)]),
      }),
    });
    expect(calls[1]).toEqual({
      port: 'sendSeatTip',
      request: {
        appointmentId: VISIT,
        seatId: SECOND,
        amountCents: cents(200),
      },
    });
  });

  it('clears a tip as `null` — never zero', async () => {
    const calls: VisitEditWriteCall[] = [];
    await saveVisitEdit(scriptedVisitEditWritePorts({ calls }))(
      save({
        commit: { ...DRAGGED, tipCents: null },
        drawn: { note: null, tipCents: cents(300) },
        live: { ...QUIET, tipCents: cents(300) },
      }),
    );

    expect(calls.at(-1)).toEqual({
      port: 'sendSeatTip',
      request: { appointmentId: VISIT, seatId: CUT_SEAT, amountCents: null },
    });
  });
});

describe('saveVisitEdit — refused writes send nothing beside the batch', () => {
  it('writes nothing at all when a note it carries moved under the draft (:5509)', async () => {
    const calls: VisitEditWriteCall[] = [];
    const write = await saveVisitEdit(scriptedVisitEditWritePorts({ calls }))(
      save({
        commit: { ...DRAGGED, note: NOTE, tipCents: cents(200) },
        live: { ...QUIET, note: 'не обича да говори' },
      }),
    );

    expect(write).toEqual(VisitEditWrite.stale());
    expect(calls).toEqual([]);
  });

  it('writes nothing at all when a tip it carries moved under the draft (:5480)', async () => {
    const calls: VisitEditWriteCall[] = [];
    const write = await saveVisitEdit(scriptedVisitEditWritePorts({ calls }))(
      save({
        commit: { ...DRAGGED, tipCents: cents(200) },
        live: { ...QUIET, tipCents: cents(300) },
      }),
    );

    expect(write).toEqual(VisitEditWrite.stale());
    expect(calls).toEqual([]);
  });

  it('writes neither the note nor the tip when the batch is refused (:5439) — the server’s answer is the row’s', async () => {
    const calls: VisitEditWriteCall[] = [];
    const write = await saveVisitEdit(
      scriptedVisitEditWritePorts({ calls, staffEdit: false }),
    )(save({ commit: { ...DRAGGED, note: NOTE, tipCents: cents(200) } }));

    expect(write).toEqual(VisitEditWrite.batchRefused(null));
    expect(order(calls)).toEqual(['sendStaffEdit']);
  });

  it('sends nothing for a placement the call cannot carry, and hands the refusal back to file', async () => {
    const calls: VisitEditWriteCall[] = [];
    const write = await saveVisitEdit(scriptedVisitEditWritePorts({ calls }))(
      save({
        commit: { ...DRAGGED, startMinute: trackMinute(1440), note: NOTE },
      }),
    );

    expect(write).toEqual(
      VisitEditWrite.batchRefused(
        PipelineError.of(
          PipelineErrorCode.InvalidRequest,
          StaffEditErrorCode.InvalidCommand,
          null,
          'startMinutes',
        ),
      ),
    );
    expect(calls).toEqual([]);
  });

  it('says a side that did not land — and still sends the tip after a note that failed', async () => {
    const calls: VisitEditWriteCall[] = [];
    const write = await saveVisitEdit(
      scriptedVisitEditWritePorts({ calls, teamNote: false }),
    )(save({ commit: { ...DRAGGED, note: NOTE, tipCents: cents(200) } }));

    expect(write).toEqual(VisitEditWrite.written(false));
    expect(VisitEditWrite.batchLanded(write)).toBe(true);
    expect(order(calls)).toEqual([
      'sendStaffEdit',
      'saveTeamNoteText',
      'sendSeatTip',
    ]);

    const tipLost = await saveVisitEdit(
      scriptedVisitEditWritePorts({ seatTip: false }),
    )(save({ commit: { ...DRAGGED, tipCents: cents(200) } }));
    expect(tipLost).toEqual(VisitEditWrite.written(false));
  });
});

describe('saveVisitEdit — the undo is the same write, drawn from what the save wrote', () => {
  it('maps the visit back in one batch and writes back the note the save wrote', async () => {
    // The save moved the visit an hour on and wrote the note; its undo
    // targets the snapshot from the live row, drawn from what the save wrote.
    const calls: VisitEditWriteCall[] = [];
    const write = await saveVisitEdit(scriptedVisitEditWritePorts({ calls }))(
      save({
        commit: SNAPSHOT,
        drawn: { note: NOTE, tipCents: null },
        live: { ...QUIET, note: NOTE },
        writes: { note: true, tip: false },
        before: null,
      }),
    );

    expect(write).toEqual(VisitEditWrite.written(true));
    expect(calls).toEqual([
      {
        port: 'sendStaffEdit',
        intent: expect.objectContaining({
          commands: [
            BookingCall.editMove(DAY, minute(600), [CUT_SEAT]),
            BookingCall.editResizeEnd(DAY, endMinute(630), [CUT_SEAT]),
          ],
        }),
      },
      { port: 'saveTeamNoteText', appointmentId: VISIT, text: null },
    ]);
  });

  it('does not undo a tip over one a colleague recorded after the save (:5524)', async () => {
    const calls: VisitEditWriteCall[] = [];
    const write = await saveVisitEdit(scriptedVisitEditWritePorts({ calls }))(
      save({
        commit: SNAPSHOT,
        drawn: { note: null, tipCents: cents(200) },
        live: { ...QUIET, tipCents: cents(300) },
        writes: { note: false, tip: true },
        before: null,
      }),
    );

    expect(write).toEqual(VisitEditWrite.stale());
    expect(calls).toEqual([]);
  });
});

describe('saveVisitEdit — the command', () => {
  it('leaves its input untouched, and plans the same write twice', async () => {
    const cmd = deepFreeze(
      save({ commit: { ...DRAGGED, note: NOTE, tipCents: cents(200) } }),
    );
    const first: VisitEditWriteCall[] = [];
    const second: VisitEditWriteCall[] = [];
    const once = await saveVisitEdit(
      scriptedVisitEditWritePorts({ calls: first }),
    )(cmd);
    const twice = await saveVisitEdit(
      scriptedVisitEditWritePorts({ calls: second }),
    )(cmd);

    expect(twice).toEqual(once);
    expect(second).toEqual(first);
    expect(cmd.commit.note).toBe(NOTE);
  });
});
