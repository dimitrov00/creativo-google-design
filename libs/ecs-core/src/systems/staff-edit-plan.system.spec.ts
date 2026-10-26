import { describe, expect, it } from 'vitest';
import {
  AppointmentId,
  BarberId,
  BookingStatus,
  CartLineId,
  type Result,
  CouponGrantId,
  Currency,
  GiftVoucherId,
  LocationId,
  SeatId,
  ServiceId,
  type TrackMinute,
} from '@core/primitives';
import {
  BookingCall,
  CouponValue,
  DiscountMethod,
  DiscountProvenance,
  DiscountSource,
  E164,
  EditCommand,
  Email,
  Placement,
  RequestedSubjectRole,
  ResizeEdge,
  SeatLabel,
  type StaffEditDraft,
  VisitEditWrite,
  VoucherCode,
} from '@core/components';
import {
  BookingErrorCode,
  PipelineError,
  PipelineErrorCode,
  StaffEditErrorCode,
} from '@core/errors';
import {
  cents,
  deepFreeze,
  draftPersonKey,
  duration,
  endMinute,
  localDate,
  minute,
  trackMinute,
  unwrapOk,
} from '@core/testing';
import {
  type StaffBookingRequest,
  type StaffCreateContext,
  StaffEditPlanSystem,
  type StaffEditRowFacts,
  type StaffEditWords,
  type StaffSaveInput,
  type StaffSaveRowFacts,
} from './staff-edit-plan.system';
import type { LiveSides } from './visit-sides.system';

/*
 * PORTED from libs/features/staff/dashboard/src/lib/staff-dashboard/
 * staff-dashboard.spec.ts (pass D, D-10.1: `commandsFor`, the tip seat and
 * `createFromEditor`'s request moved here line for line) — every case of the
 * save, its undo, REPRICE, serial placement, the subject choice and the
 * ladder pins, restated on the system's branded input with the command
 * arrays the dashboard sent, byte for byte (`toEqual` AND `JSON.stringify`:
 * the wire's own text — the undo compared two plans as that text until
 * OR-4's `BookingCall.sameCommands`, and the bytes stay pinned):
 *
 * - «keeps a drag in the frame in the draft … «Запази» carries it» (:4762)
 *   and the receipt's undo (:4823) → «the drag»;
 * - «pins every surviving leg to its ladder slot … restaffs a moved chair
 *   back» (:5570) → «the ladder»;
 * - «undoes a save by the save's own arithmetic …» (:5697) → «the undo»;
 * - «stamps the tip on a seat the batch KEPT» (:5446) → `tipSeat`;
 * - «sends the other shop as a relocate that LEADS the batch» (:5960);
 * - «lets the front desk … reprice a seat» (:6028) → REPRICE;
 * - «numbers a stranger added on one chair of a split party …» (:6274);
 * - «keeps the way back on a save that adds a seat to a chair worked …»
 *   (DEP-3, :7286) → the subject of a non-booker chair;
 * - «places a party as one booking …» (:6149), «names each stranger …»
 *   (:6219), ««Запиши пак» and the rebooking edge» (:5871) → `bookingRequest`.
 *
 * The fixture is the dashboard spec's: `appointment-1`, a SPLIT party (Ivan's
 * chair holds one of its two seats), Ivan's 10:00 cut at 28,00 € on
 * 2026-08-05, at the shop `loc-center`, booked by Мартин Илиев.
 */

const DAY = localDate('2026-08-05');
const SHOP = LocationId.of('loc-center');
const MLADOST = LocationId.of('loc-mladost');
const IVAN = BarberId.of('ivan');
const STEFAN = BarberId.of('stefan');
const CUT_SEAT = SeatId.of('seat-0002');
const BEARD_SEAT = SeatId.of('seat-beard');
const MARTIN = draftPersonKey('user-0001');
const MARTIN_LABEL = 'Мартин Илиев';
const CUT = ServiceId.of('svc-unknown-0003');
const BEARD = ServiceId.of('beard');

/** The test catalogue answers with its keys (`provideTestI18n`). */
const WORDS: StaffEditWords = {
  walkIn: 'staff.visit.walkIn',
  walkInNumbered: () => 'staff.visit.walkInNumbered',
};

/** Ivan's chair of the split party — the row the sheet opens on. */
const ROW: StaffEditRowFacts = {
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
};

function leg(overrides: Partial<StaffEditDraft.Leg> = {}): StaffEditDraft.Leg {
  return {
    seatId: CUT_SEAT,
    serviceId: CUT,
    variantId: null,
    minutes: duration(30),
    priceCents: cents(2800),
    currency: Currency.EUR,
    typedPriceCents: null,
    barberId: IVAN,
    clientId: MARTIN,
    ...overrides,
  };
}

/**
 * The sheet's SNAPSHOT of the row (`snapshotCommitOf`): the visit as the
 * server last said it — each leg carrying its stored price as typed money,
 * so an undo that re-adds the seat re-prices it.
 */
const SNAPSHOT: StaffEditDraft = {
  revision: 0,
  dayKey: DAY,
  startMinute: trackMinute(600),
  endMinute: trackMinute(630),
  locationId: SHOP,
  legs: [leg({ typedPriceCents: cents(2800) })],
  note: null,
  discounts: [],
  vouchers: [],
  tipCents: null,
  drawn: null,
  clients: [
    { id: MARTIN, label: MARTIN_LABEL, phone: '+359881234567', email: null },
  ],
};

function at(
  start: number,
  end: number,
): Pick<StaffEditDraft, 'startMinute' | 'endMinute'> {
  return { startMinute: trackMinute(start), endMinute: trackMinute(end) };
}

function plan(
  draft: StaffEditDraft,
  row: StaffEditRowFacts | null = ROW,
  guests: readonly string[] = [],
): readonly BookingCall.EditCommand[] {
  return unwrapOk(StaffEditPlanSystem.commandsFor(draft, row, guests, WORDS));
}

/** Byte-identical: the same commands, the same key order (the undo's `JSON.stringify`). */
function expectBytes(
  actual: readonly BookingCall.EditCommand[],
  expected: readonly BookingCall.EditCommand[],
): void {
  expect(actual).toEqual(expected);
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
}

const refused = (field: string) =>
  PipelineError.of(
    PipelineErrorCode.InvalidRequest,
    StaffEditErrorCode.InvalidCommand,
    null,
    field,
  );

describe('StaffEditPlanSystem.commandsFor — the drag (:4762, :4823)', () => {
  it('carries a frame dragged an hour on as the wall clock: the move, then the end, scoped to the chair’s seats', () => {
    expectBytes(plan({ ...SNAPSHOT, ...at(660, 690) }), [
      BookingCall.editMove(DAY, minute(660), [CUT_SEAT]),
      BookingCall.editResizeEnd(DAY, endMinute(690), [CUT_SEAT]),
    ]);
    expect(JSON.stringify(plan({ ...SNAPSHOT, ...at(660, 690) }))).toBe(
      '[{"editCommand":"MOVE","localDate":"2026-08-05","startMinutes":660,"seatIds":["seat-0002"]},' +
        '{"editCommand":"RESIZE","resizeEdge":"END","localDate":"2026-08-05","atMinutes":690,"seatIds":["seat-0002"]}]',
    );
  });

  it('maps the visit back from the moved row in one batch — home at 10:00–10:30, no seat added or removed', () => {
    const back = plan(SNAPSHOT);
    expectBytes(back, [
      BookingCall.editMove(DAY, minute(600), [CUT_SEAT]),
      BookingCall.editResizeEnd(DAY, endMinute(630), [CUT_SEAT]),
    ]);
    expect(back.find((c) => c.editCommand === EditCommand.Resize)).toEqual({
      editCommand: EditCommand.Resize,
      resizeEdge: ResizeEdge.End,
      localDate: DAY,
      atMinutes: 630,
      seatIds: [CUT_SEAT],
    });
  });

  it('addresses the ROOT for a chair holding the whole party — no seat named', () => {
    expectBytes(plan(SNAPSHOT, { ...ROW, partySize: 1 }), [
      BookingCall.editMove(DAY, minute(600), null),
      BookingCall.editResizeEnd(DAY, endMinute(630), null),
    ]);
  });
});

describe('StaffEditPlanSystem.commandsFor — the ladder (:5570)', () => {
  // The snapshot held two legs; the save dropped the beard and dragged the
  // block an hour on. The way back re-adds the beard at its slot and PINS
  // the cut to the ladder's start before the chair-wide move.
  const twoLegs: StaffEditDraft = {
    ...SNAPSHOT,
    endMinute: trackMinute(600 + 30 + 20),
    legs: [
      ...SNAPSHOT.legs,
      leg({
        seatId: BEARD_SEAT,
        serviceId: BEARD,
        minutes: duration(20),
        priceCents: cents(1000),
      }),
    ],
  };

  it('re-adds the beard at its slot, pins the surviving cut, then moves and stretches the chair', () => {
    expectBytes(plan(twoLegs), [
      BookingCall.editAddSeat(
        BEARD_SEAT,
        BEARD,
        null,
        IVAN,
        DAY,
        minute(630),
        duration(20),
        { requestedSubjectRole: RequestedSubjectRole.Self },
      ),
      BookingCall.editMove(DAY, minute(600), [CUT_SEAT]),
      BookingCall.editMove(DAY, minute(600), [CUT_SEAT, BEARD_SEAT]),
      BookingCall.editResizeEnd(DAY, endMinute(650), [CUT_SEAT, BEARD_SEAT]),
    ]);
  });

  it('restaffs a chair the save moved to another barber back', () => {
    const onStefan: StaffEditDraft = {
      ...SNAPSHOT,
      legs: SNAPSHOT.legs.map((entry) => ({ ...entry, barberId: STEFAN })),
    };
    expectBytes(plan(onStefan), [
      BookingCall.editMove(DAY, minute(600), [CUT_SEAT]),
      BookingCall.editResizeEnd(DAY, endMinute(630), [CUT_SEAT]),
      BookingCall.editRestaff(CUT_SEAT, STEFAN),
    ]);
  });

  it('re-durates a leg whose minutes changed, and only that one', () => {
    const longer: StaffEditDraft = {
      ...SNAPSHOT,
      endMinute: trackMinute(645),
      legs: [leg({ minutes: duration(45), typedPriceCents: cents(2800) })],
    };
    expectBytes(plan(longer), [
      BookingCall.editMove(DAY, minute(600), [CUT_SEAT]),
      BookingCall.editResizeEnd(DAY, endMinute(645), [CUT_SEAT]),
      BookingCall.editRedurate(CUT_SEAT, duration(45)),
    ]);
  });
});

describe('StaffEditPlanSystem.commandsFor — the undo (:5697)', () => {
  it('removes the seat the save added, re-adds the one it removed with its price, moves home and clears the bill', () => {
    // The visit as a save left it: an hour later, the cut gone, a beard in
    // its place, a code on the bill.
    const after: StaffEditRowFacts = {
      ...ROW,
      legs: [
        {
          seatId: BEARD_SEAT,
          minutes: duration(20),
          barberId: IVAN,
          priceCents: cents(1000),
        },
      ],
      discounts: [
        {
          ...DiscountProvenance.code(VoucherCode.of('FIRST10')),
          ...unwrapOk(CouponValue.percentOff(10)),
          label: 'FIRST10',
          grantId: null,
          code: VoucherCode.of('FIRST10'),
          exclusive: false,
        },
      ],
    };
    const back = plan(SNAPSHOT, after);
    expectBytes(back, [
      BookingCall.editRemoveSeat(BEARD_SEAT),
      BookingCall.editAddSeat(
        CUT_SEAT,
        CUT,
        null,
        IVAN,
        DAY,
        minute(600),
        duration(30),
        { requestedSubjectRole: RequestedSubjectRole.Self },
      ),
      BookingCall.editReprice(CUT_SEAT, cents(2800)),
      BookingCall.editMove(DAY, minute(600), [CUT_SEAT]),
      BookingCall.editResizeEnd(DAY, endMinute(630), [CUT_SEAT]),
      BookingCall.editDiscounts([]),
    ]);
    // The bill's arm is sent EXPLICITLY, empty, and last.
    expect(back.at(-1)).toEqual({
      editCommand: EditCommand.Discounts,
      discounts: [],
    });
  });
});

describe('StaffEditPlanSystem.commandsFor — the shop (:5960)', () => {
  const at10 = (locationId: LocationId | null): StaffEditDraft => ({
    ...SNAPSHOT,
    locationId,
    clients: [],
    legs: [leg({ clientId: draftPersonKey('user-martin') })],
  });

  it('sends the other shop as a relocate that LEADS the batch', () => {
    expectBytes(plan(at10(MLADOST)), [
      BookingCall.editRelocate(MLADOST),
      BookingCall.editMove(DAY, minute(600), [CUT_SEAT]),
      BookingCall.editResizeEnd(DAY, endMinute(630), [CUT_SEAT]),
    ]);
  });

  it('sends no relocate for the row’s own shop, for no pick, nor without a row', () => {
    for (const draft of [at10(SHOP), at10(null)]) {
      expect(
        plan(draft).some(
          (command) => command.editCommand === EditCommand.Relocate,
        ),
      ).toBe(false);
    }
    expect(
      plan(at10(MLADOST), null).some(
        (command) => command.editCommand === EditCommand.Relocate,
      ),
    ).toBe(false);
  });
});

describe('StaffEditPlanSystem.commandsFor — REPRICE (:6028, DEP-20)', () => {
  it('reprices a stored seat whose price changed, and a seat minted in the draft right after its addSeat', () => {
    const repriced: StaffEditDraft = {
      ...SNAPSHOT,
      clients: [],
      legs: [
        leg({
          priceCents: cents(1800),
          typedPriceCents: cents(1800),
          clientId: draftPersonKey('user-martin'),
        }),
        leg({
          seatId: SeatId.of('draft-wash-1'),
          serviceId: ServiceId.of('wash'),
          minutes: duration(10),
          priceCents: cents(900),
          typedPriceCents: cents(900),
          clientId: draftPersonKey('user-martin'),
        }),
      ],
    };
    const wash = SeatId.of('draft-wash-1');
    expectBytes(plan(repriced), [
      BookingCall.editAddSeat(
        wash,
        ServiceId.of('wash'),
        null,
        IVAN,
        DAY,
        minute(630),
        duration(10),
        // The unnamed person rides under the catalogue's walk-in word.
        {
          requestedSubjectRole: RequestedSubjectRole.Guest,
          label: SeatLabel.of(WORDS.walkIn),
          contact: null,
        },
      ),
      BookingCall.editReprice(wash, cents(900)),
      BookingCall.editMove(DAY, minute(600), [CUT_SEAT]),
      BookingCall.editMove(DAY, minute(600), [CUT_SEAT, wash]),
      BookingCall.editResizeEnd(DAY, endMinute(630), [CUT_SEAT, wash]),
      BookingCall.editReprice(CUT_SEAT, cents(1800)),
    ]);
  });

  it('reprices nothing for a typed price equal to the stored one — the gate is the price, not the typing', () => {
    expectBytes(plan(SNAPSHOT), [
      BookingCall.editMove(DAY, minute(600), [CUT_SEAT]),
      BookingCall.editResizeEnd(DAY, endMinute(630), [CUT_SEAT]),
    ]);
  });

  it('reprices nothing when nobody typed money, whatever the leg’s price reads', () => {
    expectBytes(
      plan({ ...SNAPSHOT, legs: [leg({ priceCents: cents(1800) })] }),
      [
        BookingCall.editMove(DAY, minute(600), [CUT_SEAT]),
        BookingCall.editResizeEnd(DAY, endMinute(630), [CUT_SEAT]),
      ],
    );
  });

  /*
   * DEP-20 — the gate on CENTS where it was on LABELS. Proven equal for
   * every price a sheet shows: `formatCents` is injective per currency and
   * locale (EUR, BGN, USD, GBP × bg, en, bg-BG, en-GB, every cent 0…10 000,00
   * — no two labels collide). What did NOT hold is the label's way back:
   * `parsePriceInput('28,00 лв.')` reads 280000 (the abbreviation's dot is
   * taken for the decimal point; «щ.д.» likewise), so a BGN or USD seat
   * re-added by an undo in Bulgarian was re-priced at a hundred times its
   * price. On cents the stored price rides as it is.
   */
  it('re-adds a BGN seat at its stored cents (DEP-20: the label «28,00 лв.» parsed back to 280000)', () => {
    const bgn: StaffEditDraft = {
      ...SNAPSHOT,
      legs: [
        leg({
          currency: Currency.BGN,
          priceCents: cents(2800),
          typedPriceCents: cents(2800),
        }),
      ],
    };
    const back = plan(bgn, { ...ROW, legs: [] });
    expect(back).toContainEqual(BookingCall.editReprice(CUT_SEAT, cents(2800)));
  });
});

describe('StaffEditPlanSystem.commandsFor — whose seat (:6274, DEP-3)', () => {
  it("numbers a stranger added on one chair of a split party past the other chair's walk-in", () => {
    const WALK_IN = 'Случаен клиент';
    const words: StaffEditWords = {
      walkIn: WALK_IN,
      walkInNumbered: (number) => `${WALK_IN} ${number}`,
    };
    const stranger = SeatId.of('draft-stranger');
    const withStranger: StaffEditDraft = {
      ...SNAPSHOT,
      endMinute: trackMinute(660),
      legs: [
        ...SNAPSHOT.legs,
        leg({ seatId: stranger, clientId: draftPersonKey('primary') }),
      ],
    };
    const commands = unwrapOk(
      StaffEditPlanSystem.commandsFor(withStranger, ROW, [WALK_IN], words),
    );
    expectBytes(commands, [
      BookingCall.editAddSeat(
        stranger,
        CUT,
        null,
        IVAN,
        DAY,
        minute(630),
        duration(30),
        {
          requestedSubjectRole: RequestedSubjectRole.Guest,
          label: SeatLabel.of(`${WALK_IN} 2`),
          contact: null,
        },
      ),
      BookingCall.editMove(DAY, minute(600), [CUT_SEAT]),
      BookingCall.editMove(DAY, minute(600), [CUT_SEAT, stranger]),
      BookingCall.editResizeEnd(DAY, endMinute(660), [CUT_SEAT, stranger]),
    ]);
    // Without the other chair's labels the stranger would take the plain word.
    expect(
      unwrapOk(
        StaffEditPlanSystem.commandsFor(withStranger, ROW, [], words),
      ).find((c) => c.editCommand === EditCommand.AddSeat),
    ).toMatchObject({ addedSubject: { label: WALK_IN } });
  });

  it('seats a second service of a chair named after a guest under that guest’s label (DEP-3 chair)', () => {
    const companion = draftPersonKey('user-0005');
    const guestChair: StaffEditRowFacts = {
      ...ROW,
      selfSeat: false,
      clientLabel: 'Петър',
      people: [{ label: 'Петър' }],
    };
    const extra = SeatId.of('draft-extra');
    const draft: StaffEditDraft = {
      ...SNAPSHOT,
      clients: [{ id: companion, label: 'Петър', phone: null, email: null }],
      legs: [
        leg({ clientId: companion, typedPriceCents: cents(2800) }),
        leg({
          seatId: extra,
          clientId: companion,
          typedPriceCents: cents(2800),
        }),
      ],
    };
    const added = plan(draft, guestChair).find(
      (command) => command.editCommand === EditCommand.AddSeat,
    );
    expect(added).toEqual(
      BookingCall.editAddSeat(
        extra,
        CUT,
        null,
        IVAN,
        DAY,
        minute(630),
        duration(30),
        {
          requestedSubjectRole: RequestedSubjectRole.Guest,
          label: SeatLabel.of('Петър'),
          contact: null,
        },
      ),
    );
  });

  it('refuses a guest label the server would refuse — the field named', () => {
    // A second person named only in blanks: no label a seat can store.
    const blank = draftPersonKey('guest-blank');
    const draft: StaffEditDraft = {
      ...SNAPSHOT,
      clients: [
        ...SNAPSHOT.clients,
        { id: blank, label: '   ', phone: null, email: null },
      ],
      legs: [
        ...SNAPSHOT.legs,
        leg({ seatId: SeatId.of('draft-x'), clientId: blank }),
      ],
    };
    expect(StaffEditPlanSystem.commandsFor(draft, ROW, [], WORDS)).toEqual({
      ok: false,
      error: refused('addedSubject'),
    });
  });
});

describe('StaffEditPlanSystem.commandsFor — what the desk typed reaches the server (OR-26)', () => {
  const maria = draftPersonKey('guest-maria-1');
  const added = SeatId.of('draft-maria');
  const withMaria = (client: StaffEditDraft.Client): StaffEditDraft => ({
    ...SNAPSHOT,
    endMinute: trackMinute(660),
    clients: [...SNAPSHOT.clients, client],
    legs: [...SNAPSHOT.legs, leg({ seatId: added, clientId: client.id })],
  });
  const addedSubjectOf = (draft: StaffEditDraft) => {
    const command = plan(draft).find(
      (each) => each.editCommand === EditCommand.AddSeat,
    );
    return command?.editCommand === EditCommand.AddSeat
      ? command.addedSubject
      : null;
  };

  it('sends a drafted guest’s number and e-mail, parsed as the edge parses them', () => {
    expect(
      addedSubjectOf(
        withMaria({
          id: maria,
          label: 'Мария',
          phone: '+359888123456',
          email: ' Maria@Example.com ',
        }),
      ),
    ).toEqual({
      requestedSubjectRole: RequestedSubjectRole.Guest,
      label: SeatLabel.of('Мария'),
      contact: {
        phone: E164.of('+359888123456'),
        email: Email.of('maria@example.com'),
      },
    });
  });

  it('sends what parses and drops what does not — a name alone sends no contact at all', () => {
    expect(
      addedSubjectOf(
        withMaria({ id: maria, label: 'Мария', phone: '12', email: null }),
      ),
    ).toMatchObject({ contact: null });
    expect(
      addedSubjectOf(
        withMaria({
          id: maria,
          label: 'Мария',
          phone: 'not a phone',
          email: 'maria@example.com',
        }),
      ),
    ).toMatchObject({
      contact: { phone: null, email: Email.of('maria@example.com') },
    });
    expect(
      addedSubjectOf(
        withMaria({ id: maria, label: 'Мария', phone: null, email: 'nope' }),
      ),
    ).toMatchObject({ contact: null });
  });

  it('reads a person an older sheet drafted without an e-mail as none — never a crash', () => {
    const older = {
      id: maria,
      label: 'Мария',
      phone: '+359888123456',
    } as unknown as StaffEditDraft.Client;
    expect(addedSubjectOf(withMaria(older))).toMatchObject({
      contact: { phone: E164.of('+359888123456'), email: null },
    });
  });

  it('a stranger the draft never named carries nothing; the chair’s own guest carries their own', () => {
    const stranger: StaffEditDraft = {
      ...SNAPSHOT,
      endMinute: trackMinute(660),
      legs: [
        ...SNAPSHOT.legs,
        leg({ seatId: added, clientId: draftPersonKey('primary') }),
      ],
    };
    expect(addedSubjectOf(stranger)).toMatchObject({ contact: null });

    const guestChair: StaffEditRowFacts = {
      ...ROW,
      selfSeat: false,
      clientLabel: 'Петър',
      people: [{ label: 'Петър' }],
    };
    const petar = draftPersonKey('guest-petar-1');
    const second: StaffEditDraft = {
      ...SNAPSHOT,
      endMinute: trackMinute(660),
      clients: [
        { id: petar, label: 'Петър', phone: '+359888000111', email: null },
      ],
      legs: [leg({ clientId: petar }), leg({ seatId: added, clientId: petar })],
    };
    const command = plan(second, guestChair).find(
      (each) => each.editCommand === EditCommand.AddSeat,
    );
    expect(command).toMatchObject({
      addedSubject: {
        label: 'Петър',
        contact: { phone: E164.of('+359888000111'), email: null },
      },
    });
  });
});

describe('StaffEditPlanSystem.commandsFor — the refusals the server would answer', () => {
  it('refuses a track start the shop day cannot hold (1440) — `startMinutes`', () => {
    expect(
      StaffEditPlanSystem.commandsFor(
        { ...SNAPSHOT, ...at(1440, 1445) },
        ROW,
        [],
        WORDS,
      ),
    ).toEqual({ ok: false, error: refused('startMinutes') });
  });

  it('refuses an end past the closing midnight (1445) — `atMinutes`', () => {
    expect(
      StaffEditPlanSystem.commandsFor(
        { ...SNAPSHOT, ...at(1405, 1445) },
        ROW,
        [],
        WORDS,
      ),
    ).toEqual({ ok: false, error: refused('atMinutes') });
  });

  it('refuses a seat added past the closing midnight — `startMinutes`', () => {
    const late: StaffEditDraft = {
      ...SNAPSHOT,
      ...at(1410, 1440),
      legs: [
        leg({ typedPriceCents: cents(2800) }),
        leg({ seatId: SeatId.of('draft-late') }),
      ],
    };
    expect(StaffEditPlanSystem.commandsFor(late, ROW, [], WORDS)).toEqual({
      ok: false,
      error: refused('startMinutes'),
    });
  });
});

describe('StaffEditPlanSystem.commandsFor — the bill', () => {
  const percent = (value: number): StaffEditDraft.Discount => ({
    ...DiscountProvenance.manual(),
    ...unwrapOk(CouponValue.percentOff(value)),
    label: '',
    grantId: null,
    code: null,
    exclusive: false,
  });
  const granted: StaffEditDraft.Discount = {
    ...DiscountProvenance.grant(CouponGrantId.of('grant-1')),
    ...CouponValue.freeService(),
    label: 'Рожден ден',
    grantId: CouponGrantId.of('grant-1'),
    code: null,
    exclusive: true,
  };
  const coded: StaffEditDraft.Discount = {
    ...DiscountProvenance.code(VoucherCode.of('first10')),
    ...unwrapOk(CouponValue.percentOff(10)),
    label: 'FIRST10',
    grantId: null,
    code: VoucherCode.of(' first10 '),
    exclusive: false,
  };
  const amount: StaffEditDraft.Discount = {
    ...DiscountProvenance.manual(),
    ...unwrapOk(CouponValue.fixedAmount(cents(500), Currency.EUR)),
    label: '',
    grantId: null,
    code: null,
    exclusive: false,
  };
  const free: StaffEditDraft.Discount = {
    ...DiscountProvenance.manual(),
    ...CouponValue.freeService(),
    label: '',
    grantId: null,
    code: null,
    exclusive: false,
  };

  it('sends the drafted set as references and figures when it promises otherwise — last of the seat commands', () => {
    const commands = plan({
      ...SNAPSHOT,
      discounts: [granted, coded, percent(15), amount, free],
    });
    expect(commands.at(-1)).toEqual(
      BookingCall.editDiscounts([
        {
          discountSource: DiscountSource.Grant,
          grantId: CouponGrantId.of('grant-1'),
        },
        {
          discountSource: DiscountSource.Code,
          code: VoucherCode.of('FIRST10'),
        },
        {
          discountSource: DiscountSource.Manual,
          discountMethod: DiscountMethod.PercentOff,
          discountPercent: 15,
        },
        {
          discountSource: DiscountSource.Manual,
          discountMethod: DiscountMethod.FixedAmount,
          discountAmountCents: cents(500),
        },
      ]),
    );
    expect(JSON.stringify(commands.at(-1))).toBe(
      '{"editCommand":"DISCOUNTS","discounts":[{"discountSource":"GRANT","grantId":"grant-1"},' +
        '{"discountSource":"CODE","code":"FIRST10"},' +
        '{"discountSource":"MANUAL","discountMethod":"PERCENT_OFF","discountPercent":15},' +
        '{"discountSource":"MANUAL","discountMethod":"FIXED_AMOUNT","discountAmountCents":500}]}',
    );
  });

  it('sends nothing for the same promises in another order', () => {
    const stored = { ...ROW, discounts: [percent(15), granted] };
    expect(
      plan({ ...SNAPSHOT, discounts: [granted, percent(15)] }, stored).some(
        (command) => command.editCommand === EditCommand.Discounts,
      ),
    ).toBe(false);
    expect(
      plan({ ...SNAPSHOT, discounts: [granted, percent(20)] }, stored).some(
        (command) => command.editCommand === EditCommand.Discounts,
      ),
    ).toBe(true);
  });

  it('sends the vouchers, normalised and in cover order, only when the cover changed', () => {
    const voucher = (code: string): StaffEditDraft.Voucher => ({
      voucherId: GiftVoucherId.of(`voucher-${code}`),
      code: VoucherCode.of(code),
      availableCents: cents(5000),
    });
    const commands = plan({
      ...SNAPSHOT,
      vouchers: [voucher(' gift-b '), voucher('GIFT-A')],
    });
    expect(commands.at(-1)).toEqual(
      BookingCall.editVouchers([
        VoucherCode.of('GIFT-B'),
        VoucherCode.of('GIFT-A'),
      ]),
    );
    expect(
      plan(
        { ...SNAPSHOT, vouchers: [voucher('gift-a')] },
        { ...ROW, vouchers: [{ code: VoucherCode.of('GIFT-A') }] },
      ).some((command) => command.editCommand === EditCommand.Vouchers),
    ).toBe(false);
  });
});

describe('StaffEditPlanSystem.tipSeat — the seat a tip is stamped on (:5446)', () => {
  const FIRST = SeatId.of('seat-first');
  const SECOND = SeatId.of('seat-second');
  const twoSeats: StaffEditRowFacts = { ...ROW, seatIds: [FIRST, SECOND] };

  it('stamps the tip on a seat the batch KEPT, never on one it removed', () => {
    expect(
      StaffEditPlanSystem.tipSeat(twoSeats, {
        ...SNAPSHOT,
        legs: [leg({ seatId: SECOND })],
      }),
    ).toBe(SECOND);
  });

  it('falls back to the row’s first seat, and names none without a row or a seat', () => {
    expect(
      StaffEditPlanSystem.tipSeat(twoSeats, {
        ...SNAPSHOT,
        legs: [leg({ seatId: SeatId.of('draft-new') })],
      }),
    ).toBe(FIRST);
    expect(StaffEditPlanSystem.tipSeat(null, SNAPSHOT)).toBeNull();
    expect(
      StaffEditPlanSystem.tipSeat({ ...ROW, seatIds: [] }, SNAPSHOT),
    ).toBeNull();
  });
});

describe('StaffEditPlanSystem.savePlan — the whole write (OR-4)', () => {
  /*
   * The staff dashboard's `saveFromEditor` / `writeFromEditor` decisions,
   * moved here (OR-4): the side fields a write carries, the stale guard,
   * the batch, the tip's seat and the way back. The dashboard spec's save
   * and undo cases («sends the batch first …» :5426, «refuses a tip typed
   * over one a colleague recorded since» :5480, «refuses a note typed over
   * one a colleague wrote since» :5509, «does not undo a tip over one a
   * colleague recorded after the save» :5524, «stamps the tip on a seat the
   * batch KEPT» :5546, «withholds the way back only from a save that added
   * a seat to a finished visit» :5778) restated on the plan.
   */
  const ROW_OPEN: StaffSaveRowFacts = {
    ...ROW,
    rootBookingStatus: BookingStatus.Confirmed,
  };
  /** The stored note and tip, heard: nothing on either. */
  const QUIET: LiveSides = {
    note: null,
    noteHeard: true,
    tipCents: null,
    tipHeard: true,
  };
  const NOTE = 'дължи 5 €';
  const THEIR_NOTE = 'не обича да говори';

  function input(overrides: Partial<StaffSaveInput> = {}): StaffSaveInput {
    return {
      commit: SNAPSHOT,
      row: ROW_OPEN,
      drawn: { note: null, tipCents: null },
      live: QUIET,
      guestLabels: [],
      words: WORDS,
      before: SNAPSHOT,
      writes: null,
      ...overrides,
    };
  }

  it('carries the note and the tip the commit changed from what it drew — and nothing it left alone', () => {
    const typed = StaffEditPlanSystem.savePlan(
      input({ commit: { ...SNAPSHOT, note: NOTE, tipCents: cents(200) } }),
    );
    expect(typed.writes).toEqual({ note: true, tip: true });
    expect(typed.tipSeat).toBe(CUT_SEAT);
    expect(typed.refusal).toBeNull();

    // The stored form is what counts: blanks around the same words are no change.
    const untouched = StaffEditPlanSystem.savePlan(
      input({
        commit: { ...SNAPSHOT, note: `  ${NOTE} `, tipCents: cents(300) },
        drawn: { note: NOTE, tipCents: cents(300) },
      }),
    );
    expect(untouched.writes).toEqual({ note: false, tip: false });
    expect(untouched.tipSeat).toBeNull();
  });

  it('carries no tip without a row or a seat to stamp it on', () => {
    const tipped = { ...SNAPSHOT, tipCents: cents(200) };
    for (const row of [null, { ...ROW_OPEN, seatIds: [] }]) {
      const plan = StaffEditPlanSystem.savePlan(input({ commit: tipped, row }));
      expect(plan.writes.tip).toBe(false);
      expect(plan.tipSeat).toBeNull();
    }
  });

  it('stamps the tip on a seat the batch KEPT, never on one it removed (:5546)', () => {
    const FIRST = SeatId.of('seat-first');
    const SECOND = SeatId.of('seat-second');
    const plan = StaffEditPlanSystem.savePlan(
      input({
        row: {
          ...ROW_OPEN,
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
    expect(plan.commands[0]).toEqual(BookingCall.editRemoveSeat(FIRST));
    expect(plan.tipSeat).toBe(SECOND);
  });

  it('lets an undo carry its save’s side fields as handed in, whatever the commit says', () => {
    const plan = StaffEditPlanSystem.savePlan(
      input({
        commit: SNAPSHOT,
        drawn: { note: NOTE, tipCents: cents(200) },
        writes: { note: true, tip: false },
        before: null,
      }),
    );
    expect(plan.writes).toEqual({ note: true, tip: false });
    expect(plan.tipSeat).toBeNull();
  });

  it('is STALE when a note it carries moved under the draft (:5509) — refused before anything is sent', () => {
    const plan = StaffEditPlanSystem.savePlan(
      input({
        commit: { ...SNAPSHOT, note: NOTE },
        live: { ...QUIET, note: THEIR_NOTE },
      }),
    );
    expect(plan.refusal).toEqual(VisitEditWrite.stale());
  });

  it('is STALE when a tip it carries moved under the draft (:5480), and judges stale before the batch', () => {
    const tipped = { ...SNAPSHOT, tipCents: cents(200) };
    const moved = { ...QUIET, tipCents: cents(300) };
    expect(
      StaffEditPlanSystem.savePlan(input({ commit: tipped, live: moved }))
        .refusal,
    ).toEqual(VisitEditWrite.stale());
    // A batch that could not be built is still a stale write first.
    expect(
      StaffEditPlanSystem.savePlan(
        input({
          commit: { ...tipped, startMinute: trackMinute(1440) },
          live: moved,
        }),
      ).refusal,
    ).toEqual(VisitEditWrite.stale());
  });

  it('refuses no write over a field it does not carry, one this device does not hear, or one already saying what it writes', () => {
    const noted = { ...SNAPSHOT, note: NOTE };
    for (const live of [
      // A colleague's tip under a save that writes no tip (:5465).
      { ...QUIET, tipCents: cents(300) },
      // The note's listener has not answered.
      { ...QUIET, note: THEIR_NOTE, noteHeard: false },
      // The barber's own save landing, as its undo's listener sees it.
      { ...QUIET, note: NOTE },
    ]) {
      expect(
        StaffEditPlanSystem.savePlan(input({ commit: noted, live })).refusal,
      ).toBeNull();
    }
  });

  it('does not undo a tip over one a colleague recorded after the save (:5524)', () => {
    // The save wrote 2,00 €; a colleague recorded 3,00 € over it since.
    const plan = StaffEditPlanSystem.savePlan(
      input({
        commit: SNAPSHOT,
        drawn: { note: null, tipCents: cents(200) },
        live: { ...QUIET, tipCents: cents(300) },
        writes: { note: false, tip: true },
        before: null,
      }),
    );
    expect(plan.refusal).toEqual(VisitEditWrite.stale());
  });

  it('is BATCH_REFUSED, with the refusal, when a placement cannot be carried — the batch empty', () => {
    const plan = StaffEditPlanSystem.savePlan(
      input({ commit: { ...SNAPSHOT, startMinute: trackMinute(1440) } }),
    );
    expect(plan.refusal).toEqual(
      VisitEditWrite.batchRefused(refused('startMinutes')),
    );
    expect(plan.commands).toEqual([]);
    expect(plan.shapeNeutral).toBe(false);
  });

  it('plans the batch commandsFor plans, guest labels and words passed through', () => {
    const dragged = { ...SNAPSHOT, ...at(660, 690) };
    expectBytes(
      StaffEditPlanSystem.savePlan(
        input({ commit: dragged, guestLabels: ['Гост 1'] }),
      ).commands,
      plan(dragged, ROW_OPEN, ['Гост 1']),
    );
  });

  it('withholds the way back only from a save that adds a seat to a finished visit (:5778)', () => {
    const added = {
      ...SNAPSHOT,
      endMinute: trackMinute(640),
      legs: [
        ...SNAPSHOT.legs,
        leg({
          seatId: SeatId.of('draft-wash-1'),
          serviceId: ServiceId.of('wash'),
          minutes: duration(10),
        }),
      ],
    };
    const finished = {
      ...ROW_OPEN,
      rootBookingStatus: BookingStatus.Completed,
    };
    expect(
      StaffEditPlanSystem.savePlan(input({ commit: added, row: finished }))
        .reversible,
    ).toBe(false);
    expect(
      StaffEditPlanSystem.savePlan(
        input({ commit: { ...SNAPSHOT, ...at(660, 690) }, row: finished }),
      ).reversible,
    ).toBe(true);
    expect(
      StaffEditPlanSystem.savePlan(input({ commit: added })).reversible,
    ).toBe(true);
    expect(
      StaffEditPlanSystem.savePlan(input({ commit: added, row: null }))
        .reversible,
    ).toBe(true);
  });

  it('calls a note alone shape-neutral — its batch asks nothing the snapshot’s would not — and nothing else', () => {
    expect(
      StaffEditPlanSystem.savePlan(
        input({ commit: { ...SNAPSHOT, note: NOTE } }),
      ).shapeNeutral,
    ).toBe(true);
    // A drag, a tip, or no snapshot to measure against.
    for (const overrides of [
      { commit: { ...SNAPSHOT, ...at(660, 690) } },
      { commit: { ...SNAPSHOT, tipCents: cents(200) } },
      { commit: { ...SNAPSHOT, note: NOTE }, before: null },
      {
        commit: { ...SNAPSHOT, note: NOTE },
        before: { ...SNAPSHOT, startMinute: trackMinute(1440) },
      },
    ]) {
      expect(StaffEditPlanSystem.savePlan(input(overrides)).shapeNeutral).toBe(
        false,
      );
    }
  });
});

describe('StaffEditPlanSystem.bookingRequest — the create sheet’s booking (:6149, :6219, :5871)', () => {
  const COLD: StaffCreateContext = {
    homeLocationId: SHOP,
    clientId: null,
    bookedFrom: null,
  };
  const create = (overrides: Partial<StaffEditDraft>): StaffEditDraft => ({
    ...SNAPSHOT,
    revision: null,
    dayKey: localDate('2026-09-03'),
    locationId: null,
    ...overrides,
  });
  const draftLeg = (
    seatId: string,
    clientId: string,
    minutes: number,
    serviceId = 'cut',
  ): StaffEditDraft.Leg =>
    leg({
      seatId: SeatId.of(seatId),
      serviceId: ServiceId.of(serviceId),
      minutes: duration(minutes),
      priceCents: null,
      clientId: draftPersonKey(clientId),
    });
  const guest = (label: string) => BookingCall.guestSubject(label, null);
  /** The request a create answers — a test failure when it asked for nothing. */
  const requestOf = (
    result: Result<StaffBookingRequest, PipelineError> | null,
  ): StaffBookingRequest => {
    if (result === null) throw new Error('the create asked for nothing');
    return unwrapOk(result);
  };

  it('places a party as one booking: the account holder owns it, the rest ride as guests, serially from the start', () => {
    const request = StaffEditPlanSystem.bookingRequest(
      create({
        ...at(600, 645),
        clients: [
          {
            id: draftPersonKey('primary'),
            label: 'Без запазен час',
            phone: null,
            email: null,
          },
          {
            id: draftPersonKey('user-martin'),
            label: MARTIN_LABEL,
            phone: '+359881234567',
            email: null,
          },
        ],
        legs: [
          draftLeg('draft-cut', 'primary', 30),
          draftLeg('draft-beard', 'user-martin', 15, 'beard'),
        ],
      }),
      COLD,
      WORDS,
    );
    const expected = {
      locationId: SHOP,
      localDate: localDate('2026-09-03'),
      seats: [
        BookingCall.seat(
          CartLineId.of('draft-cut'),
          ServiceId.of('cut'),
          null,
          IVAN,
          null,
          minute(600),
          guest('Без запазен час'),
        ),
        BookingCall.seat(
          CartLineId.of('draft-beard'),
          ServiceId.of('beard'),
          null,
          IVAN,
          null,
          minute(630),
          BookingCall.selfSubject(),
        ),
      ],
      contact: {
        name: MARTIN_LABEL,
        phone: '+359881234567',
        email: null,
        note: null,
      },
      placement: Placement.Staff,
      onBehalfOfUserId: 'user-martin',
      bookedFromAppointmentId: null,
    };
    expect(request).toEqual({ ok: true, value: expected });
    expect(JSON.stringify(request)).toBe(
      JSON.stringify({ ok: true, value: expected }),
    );
  });

  it('names each stranger on one visit apart — the second is numbered, one person once; no owner, no contact', () => {
    const request = requestOf(
      StaffEditPlanSystem.bookingRequest(
        create({
          ...at(600, 690),
          clients: [],
          legs: [
            draftLeg('draft-a', 'primary', 30),
            draftLeg('draft-b', 'guest-second', 30),
            draftLeg('draft-c', 'primary', 30),
          ],
        }),
        COLD,
        WORDS,
      ),
    );
    expect(request.seats.map((seat) => seat.subject)).toEqual([
      guest('staff.visit.walkIn'),
      guest('staff.visit.walkInNumbered'),
      guest('staff.visit.walkIn'),
    ]);
    expect(request.seats.map((seat) => seat.startMinutes)).toEqual([
      600, 630, 660,
    ]);
    expect(request.onBehalfOfUserId).toBeNull();
    expect(request.contact).toBeNull();
  });

  it('books FROM the finished visit for the same client, and sends no edge once the desk swaps the person, nor cold', () => {
    const martin = 'user-0001';
    const rebook: StaffCreateContext = {
      homeLocationId: SHOP,
      clientId: draftPersonKey(martin),
      bookedFrom: AppointmentId.of('appointment-1'),
    };
    const saveFor = (clientId: string, label: string) =>
      create({
        ...at(600, 630),
        dayKey: localDate('2026-09-02'),
        clients: [
          {
            id: draftPersonKey(clientId),
            label,
            phone: '+359881234567',
            email: null,
          },
        ],
        legs: [draftLeg('draft-cut', clientId, 30)],
      });
    const same = requestOf(
      StaffEditPlanSystem.bookingRequest(
        saveFor(martin, MARTIN_LABEL),
        rebook,
        WORDS,
      ),
    );
    expect(same.onBehalfOfUserId).toBe(martin);
    expect(same.placement).toBe(Placement.Staff);
    expect(same.bookedFromAppointmentId).toBe('appointment-1');
    for (const [draft, context] of [
      [saveFor('user-someone-else', 'Петър'), rebook],
      [saveFor('user-martin', 'Мартин'), COLD],
    ] as const) {
      const request = requestOf(
        StaffEditPlanSystem.bookingRequest(draft, context, WORDS),
      );
      expect(request.bookedFromAppointmentId).toBeNull();
    }
  });

  it('asks for nothing with no leg or no shop, and takes the draft’s shop over the chair’s home', () => {
    expect(
      StaffEditPlanSystem.bookingRequest(create({ legs: [] }), COLD, WORDS),
    ).toBeNull();
    expect(
      StaffEditPlanSystem.bookingRequest(
        create({}),
        { ...COLD, homeLocationId: null },
        WORDS,
      ),
    ).toBeNull();
    const picked = StaffEditPlanSystem.bookingRequest(
      create({ locationId: MLADOST }),
      COLD,
      WORDS,
    );
    expect(picked !== null && picked.ok && picked.value.locationId).toBe(
      MLADOST,
    );
  });

  it('refuses a seat past the shop’s midnight as the server refuses such a start', () => {
    expect(
      StaffEditPlanSystem.bookingRequest(
        create({
          ...at(1410, 1440),
          legs: [draftLeg('a', 'primary', 30), draftLeg('b', 'primary', 30)],
        }),
        COLD,
        WORDS,
      ),
    ).toEqual({
      ok: false,
      error: PipelineError.of(
        PipelineErrorCode.InvalidRequest,
        BookingErrorCode.InvalidInput,
        null,
        'startMinutes',
      ),
    });
  });
});

describe('StaffEditPlanSystem.bookingRequest — every guest’s contact (OR-26)', () => {
  const COLD_CREATE: StaffCreateContext = {
    homeLocationId: SHOP,
    clientId: null,
    bookedFrom: null,
  };
  const legFor = (seatId: string, clientId: string): StaffEditDraft.Leg =>
    leg({
      seatId: SeatId.of(seatId),
      priceCents: null,
      clientId: draftPersonKey(clientId),
    });
  const requestFor = (draft: StaffEditDraft): StaffBookingRequest => {
    const result = StaffEditPlanSystem.bookingRequest(
      draft,
      COLD_CREATE,
      WORDS,
    );
    if (result === null) throw new Error('the create asked for nothing');
    return unwrapOk(result);
  };

  it('sends each guest the desk took a contact for with it — not only the first person’s number', () => {
    const request = requestFor({
      ...SNAPSHOT,
      revision: null,
      ...at(600, 690),
      clients: [
        {
          id: draftPersonKey('user-martin'),
          label: MARTIN_LABEL,
          phone: '+359881234567',
          email: 'martin@example.com',
        },
        {
          id: draftPersonKey('guest-maria-1'),
          label: 'Мария',
          phone: '+359888123456',
          email: null,
        },
        {
          id: draftPersonKey('guest-ana-2'),
          label: 'Ана',
          phone: null,
          email: 'Ana@Example.com',
        },
      ],
      legs: [
        legFor('draft-a', 'user-martin'),
        legFor('draft-b', 'guest-maria-1'),
        legFor('draft-c', 'guest-ana-2'),
      ],
    });
    expect(request.seats.map((seat) => seat.subject)).toEqual([
      BookingCall.selfSubject(),
      BookingCall.staffGuestSubject('Мария', {
        phone: E164.of('+359888123456'),
        email: null,
      }),
      BookingCall.staffGuestSubject('Ана', {
        phone: null,
        email: Email.of('ana@example.com'),
      }),
    ]);
    // The booking's contact is the owner's — the e-mail beside the number now.
    expect(request.contact).toEqual({
      name: MARTIN_LABEL,
      phone: '+359881234567',
      email: 'martin@example.com',
      note: null,
    });
  });

  it('sends no contact for a second ACCOUNT holder riding as a guest — their record is the account’s, never a walk-in’s', () => {
    const request = requestFor({
      ...SNAPSHOT,
      revision: null,
      clients: [
        {
          id: draftPersonKey('user-martin'),
          label: MARTIN_LABEL,
          phone: '+359881234567',
          email: 'martin@example.com',
        },
        {
          id: draftPersonKey('user-georgi'),
          label: 'Георги',
          phone: '+359888000222',
          email: 'georgi@example.com',
        },
      ],
      legs: [
        legFor('draft-a', 'user-martin'),
        legFor('draft-b', 'user-georgi'),
      ],
    });
    expect(request.seats.map((seat) => seat.subject)).toEqual([
      BookingCall.selfSubject(),
      BookingCall.staffGuestSubject('Георги', null),
    ]);
  });

  it('keeps a walk-in visit’s first guest’s contact on their seat, and never sends an e-mail that is none', () => {
    const request = requestFor({
      ...SNAPSHOT,
      revision: null,
      clients: [
        {
          id: draftPersonKey('guest-maria-1'),
          label: 'Мария',
          phone: '+359888123456',
          email: 'not an e-mail',
        },
      ],
      legs: [legFor('draft-a', 'guest-maria-1')],
    });
    expect(request.seats[0]?.subject).toEqual(
      BookingCall.staffGuestSubject('Мария', {
        phone: E164.of('+359888123456'),
        email: null,
      }),
    );
    expect(request.onBehalfOfUserId).toBeNull();
    expect(request.contact).toEqual({
      name: 'Мария',
      phone: '+359888123456',
      email: null,
      note: null,
    });
  });
});

describe('StaffEditPlanSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const draft = deepFreeze({
      ...SNAPSHOT,
      ...at(660, 700),
      legs: [
        ...SNAPSHOT.legs,
        leg({ seatId: BEARD_SEAT, serviceId: BEARD, minutes: duration(10) }),
      ],
    });
    const row = deepFreeze(ROW);
    const once = StaffEditPlanSystem.commandsFor(draft, row, ['x'], WORDS);
    expect(StaffEditPlanSystem.commandsFor(draft, row, ['x'], WORDS)).toEqual(
      once,
    );
    expect(StaffEditPlanSystem.tipSeat(row, draft)).toBe(
      StaffEditPlanSystem.tipSeat(row, draft),
    );
    const context = deepFreeze({
      homeLocationId: SHOP,
      clientId: null,
      bookedFrom: null,
    });
    expect(StaffEditPlanSystem.bookingRequest(draft, context, WORDS)).toEqual(
      StaffEditPlanSystem.bookingRequest(draft, context, WORDS),
    );
    const save = deepFreeze({
      commit: { ...draft, note: 'дължи 5 €', tipCents: cents(200) },
      row: { ...ROW, rootBookingStatus: BookingStatus.Confirmed },
      drawn: { note: null, tipCents: null },
      live: { note: null, noteHeard: true, tipCents: null, tipHeard: true },
      guestLabels: ['x'],
      words: WORDS,
      before: SNAPSHOT,
      writes: null,
    });
    expect(StaffEditPlanSystem.savePlan(save)).toEqual(
      StaffEditPlanSystem.savePlan(save),
    );
    expect(draft.legs).toHaveLength(2);
    expect(row.legs).toHaveLength(1);
    expect(save.commit.note).toBe('дължи 5 €');
  });

  it('answers track minutes off the clock with a refusal, never a throw', () => {
    const track: TrackMinute = trackMinute(2880);
    expect(() =>
      StaffEditPlanSystem.commandsFor(
        { ...SNAPSHOT, startMinute: track, endMinute: track },
        ROW,
        [],
        WORDS,
      ),
    ).not.toThrow();
  });
});
