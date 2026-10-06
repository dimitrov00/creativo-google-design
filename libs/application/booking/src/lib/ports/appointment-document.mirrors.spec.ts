import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Money, ZonedDateTime } from '@creativo/domain/kernel';
import { UserId } from '@creativo/domain/accounts';
import { BarberId, ServiceId, ServiceTerms } from '@creativo/domain/catalog';
import {
  Appointment,
  BarberPref,
  COMPLETED,
  Seat,
  SeatId,
  SeatLabel,
  SeatSubject,
  seatNoShow,
  seatWorked,
} from '@creativo/domain/scheduling';
import {
  APPOINTMENT_DOCUMENT_FIELDS,
  appointmentFromDocument,
  appointmentToDocument,
  inferredPlacementFromDocument,
  placementFromDocument,
  preservedAppointmentFields,
  subjectUserIdsFromDocument,
} from './appointment-document';

const ZONE = 'Europe/Sofia';

function at(iso: string): ZonedDateTime {
  const result = ZonedDateTime.fromISO(iso, ZONE);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function user(id: string): UserId {
  const result = UserId.create(id);
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

function seat(
  subject: SeatSubject,
  startIso: string,
  barber: string,
  priceMinor = 2500,
): Seat {
  const price = Money.fromMinorUnitsAndCode(priceMinor, 'EUR');
  if (price.isFailure()) throw new Error('bad fixture');
  const terms = ServiceTerms.create(price.value, 30, {
    setupMinutes: 5,
    cleanupMinutes: 10,
  });
  const barberId = BarberId.create(barber);
  const serviceId = ServiceId.create('cut');
  if (terms.isFailure() || barberId.isFailure() || serviceId.isFailure()) {
    throw new Error('bad fixture');
  }
  return Seat.of({
    id: SeatId.generate(),
    subject,
    serviceId: serviceId.value,
    variantId: null,
    barberId: barberId.value,
    pref: BarberPref.specific(barberId.value),
    terms: terms.value,
    startsAt: at(startIso),
  });
}

function guest(): SeatSubject {
  const label = SeatLabel.create('Гост 1');
  if (label.isFailure()) throw new Error('bad fixture');
  return SeatSubject.anonymous(label.value);
}

/** A party of four: the booker twice, a companion, a guest — in no order. */
function party(): Appointment {
  const result = Appointment.reconstitute({
    id: 'appt-1',
    locationId: 'shop-1',
    seats: [
      seat(
        SeatSubject.account(user('zora'), 'companion'),
        '2026-06-01T10:00:00',
        'ivan',
      ),
      seat(
        SeatSubject.account(user('ana'), 'self'),
        '2026-06-01T10:00:00',
        'petar',
      ),
      seat(guest(), '2026-06-01T10:45:00', 'ivan'),
      seat(
        SeatSubject.account(user('ana'), 'self'),
        '2026-06-01T10:45:00',
        'petar',
      ),
    ],
    status: COMPLETED,
    bookedAt: at('2026-05-20T09:00:00'),
  });
  if (result.isFailure()) throw new Error('bad fixture');
  return result.value;
}

describe('appointmentToDocument — the subject and placement mirrors (R33)', () => {
  it('writes every account on the visit once, sorted, guests left out', () => {
    expect(appointmentToDocument(party())['subjectUserIds']).toEqual([
      'ana',
      'zora',
    ]);
  });

  it('writes the placement it is given, and null when it was never known', () => {
    expect(
      appointmentToDocument(party(), { placement: 'staff' })['placement'],
    ).toBe('staff');
    expect(appointmentToDocument(party())['placement']).toBeNull();
  });

  it('owns both fields, so a staff edit rewrites them instead of dropping them', () => {
    const written = appointmentToDocument(party(), { placement: 'self' });
    expect(Object.keys(written).sort()).toEqual(
      [...APPOINTMENT_DOCUMENT_FIELDS].sort(),
    );
    expect(preservedAppointmentFields({ ...written, revision: 4 })).toEqual({
      revision: 4,
    });
  });

  it('reads the mirror off a stored document the way the writer computes it', () => {
    const written = appointmentToDocument(party());
    expect(subjectUserIdsFromDocument(written)).toEqual(
      written['subjectUserIds'],
    );
    expect(subjectUserIdsFromDocument({ seats: 'nope' })).toEqual([]);
    expect(subjectUserIdsFromDocument(undefined)).toEqual([]);
  });

  it('reads an unknown placement as not known', () => {
    expect(placementFromDocument({ placement: 'staff' })).toBe('staff');
    expect(placementFromDocument({ placement: 'robot' })).toBeNull();
    expect(placementFromDocument({})).toBeNull();
  });
});

describe('the inferred placement (§12.5.1, legacyPref)', () => {
  it('is read on its own, and never as the commit’s stamp', () => {
    const backfilled = { inferredPlacement: 'staff' };
    expect(inferredPlacementFromDocument(backfilled)).toBe('staff');
    expect(placementFromDocument(backfilled)).toBeNull();
    expect(inferredPlacementFromDocument({ placement: 'self' })).toBeNull();
    expect(
      inferredPlacementFromDocument({ inferredPlacement: 'robot' }),
    ).toBeNull();
    expect(inferredPlacementFromDocument(undefined)).toBeNull();
  });

  it('is never written by the mapper, whatever it is given', () => {
    const written = appointmentToDocument(party(), { placement: 'self' });
    expect(written).not.toHaveProperty('inferredPlacement');
    expect(APPOINTMENT_DOCUMENT_FIELDS).not.toContain('inferredPlacement');
  });

  // A staff edit rewrites the row as `{...preserved, ...mapper}` with the
  // stored placement carried forward: the inference must survive it, and
  // must not come out the other side as a stamp.
  it('rides a staff edit’s rewrite unchanged, and never becomes a stamp', () => {
    const current = {
      ...appointmentToDocument(party()),
      inferredPlacement: 'staff',
      revision: 2,
    };
    const read = appointmentFromDocument('appt-1', current);
    if (read.isFailure()) throw read.error;
    const rewritten = {
      ...preservedAppointmentFields(current),
      ...appointmentToDocument(read.value, {
        placement: placementFromDocument(current),
      }),
    };
    expect(inferredPlacementFromDocument(rewritten)).toBe('staff');
    expect(placementFromDocument(rewritten)).toBeNull();
    expect(rewritten['placement']).toBeNull();
  });
});

describe('appointmentFromDocument', () => {
  it('round-trips the aggregate the writer wrote', () => {
    const original = party();
    const read = appointmentFromDocument(
      'appt-1',
      appointmentToDocument(original),
    );
    expect(read.isSuccess()).toBe(true);
    if (read.isFailure()) return;
    expect(appointmentToDocument(read.value)).toEqual(
      appointmentToDocument(original),
    );
  });

  it('derives outcomes for a row written before they existed', () => {
    const written = appointmentToDocument(party());
    const legacy = {
      ...written,
      seats: (written['seats'] as Record<string, unknown>[]).map((stored) =>
        Object.fromEntries(
          Object.entries(stored).filter(([key]) => key !== 'outcome'),
        ),
      ),
    };
    const read = appointmentFromDocument('appt-1', legacy);
    if (read.isFailure()) throw read.error;
    expect(read.value.seats.every((s) => s.outcome.kind === 'worked')).toBe(
      true,
    );
  });

  it('keeps each seat’s own outcome', () => {
    const original = party();
    const [first, second, ...rest] = original.seats;
    if (!first || !second) throw new Error('bad fixture');
    const mixed = Appointment.reconstitute({
      id: 'appt-1',
      locationId: 'shop-1',
      seats: [
        first.withOutcome(seatNoShow(1)),
        second.withOutcome(seatWorked(2)),
        ...rest,
      ],
      status: COMPLETED,
    });
    if (mixed.isFailure()) throw new Error('bad fixture');
    const read = appointmentFromDocument(
      'appt-1',
      appointmentToDocument(mixed.value),
    );
    if (read.isFailure()) throw read.error;
    expect(read.value.seats.map((s) => s.outcome.kind).slice(0, 2)).toEqual([
      'no_show',
      'worked',
    ]);
  });

  it('answers every malformed seat with a Result and never throws', () => {
    // The browser reads inside a snapshot callback: a throw there is not a
    // failure the page can show, it is a listener that never emits again.
    // So whatever a legacy or hand-written row lacks — an id, the terms, the
    // slot, the subject — the reader must answer, not throw.
    const written = appointmentToDocument(party());
    const [template] = written['seats'] as Record<string, unknown>[];
    if (!template) throw new Error('bad fixture');
    const junk = fc.oneof(
      fc.constant(undefined),
      fc.constant(null),
      fc.integer(),
      fc.string({ maxLength: 4 }),
      fc.boolean(),
      fc.constant({}),
      fc.constant([]),
    );
    // Each field either kept, dropped, or replaced with junk.
    const edit = fc.option(fc.option(junk, { nil: 'drop' as const }), {
      nil: 'keep' as const,
    });
    const nested = (
      fields: readonly string[],
    ): fc.Arbitrary<Record<string, unknown>> =>
      fc.record(Object.fromEntries(fields.map((field) => [field, edit])));

    function apply(
      base: Record<string, unknown>,
      edits: Record<string, unknown>,
    ): Record<string, unknown> {
      const out: Record<string, unknown> = { ...base };
      for (const [field, change] of Object.entries(edits)) {
        if (change === 'keep') continue;
        if (change === 'drop') delete out[field];
        else out[field] = change;
      }
      return out;
    }

    fc.assert(
      fc.property(
        nested(Object.keys(template)),
        nested(['kind', 'userId', 'relationship', 'label']),
        nested(Object.keys(template['terms'] as object)),
        nested(['startIso', 'endIso', 'zone']),
        nested(['status', 'locationId']),
        (seatEdits, subjectEdits, termsEdits, slotEdits, rootEdits) => {
          const seat = apply(
            {
              ...template,
              subject: apply(
                template['subject'] as Record<string, unknown>,
                subjectEdits,
              ),
              terms: apply(
                template['terms'] as Record<string, unknown>,
                termsEdits,
              ),
              slot: apply(
                template['slot'] as Record<string, unknown>,
                slotEdits,
              ),
            },
            seatEdits,
          );
          const doc = apply({ ...written, seats: [seat] }, rootEdits);
          const read = appointmentFromDocument('appt-1', doc);
          expect(read.isSuccess() || read.isFailure()).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  it('refuses a document whose seats cannot be read, rather than shrinking the party', () => {
    const written = appointmentToDocument(party());
    const seats = written['seats'] as Record<string, unknown>[];
    const broken = {
      ...written,
      seats: [
        { ...seats[0], terms: { priceMinorUnits: 'x' } },
        ...seats.slice(1),
      ],
    };
    expect(appointmentFromDocument('appt-1', broken).isFailure()).toBe(true);
    expect(
      appointmentFromDocument('appt-1', {
        ...written,
        seats: null,
      }).isFailure(),
    ).toBe(true);
    expect(
      appointmentFromDocument('appt-1', {
        ...written,
        status: null,
      }).isFailure(),
    ).toBe(true);
  });
});
