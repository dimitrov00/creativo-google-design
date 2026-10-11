import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MinuteRange,
  Placement,
  SeatLabel,
  type Seat,
  SeatOccupant,
  SubjectRelationship,
} from '@core/components';
import type { Appointment } from '@core/entities';
import { BusyKey, BarberId, SeatId, UserId } from '@core/primitives';
import {
  deepFreeze,
  endMinute,
  localDate,
  minute,
  type AppointmentFixtureOverrides,
  appointmentFixture,
  seatFixture,
} from '@core/testing';
import { AppointmentIndexSystem } from './appointment-index.system';

/*
 * The R33 rule cases of
 * libs/application/booking/src/lib/ports/appointment-document.mirrors.spec.ts:106-185
 * (8), COPIED so they survive the mapper's Phase 4 deletion: the subject
 * mirror lists every account once, sorted, guests left out; the placement
 * is the commit's stamp and is never inferred. The mapper-shape assertions
 * (`APPOINTMENT_DOCUMENT_FIELDS`, `preservedAppointmentFields`) become the
 * entity's own keys — there is no document type besides the entity.
 */

const JUNE_1 = localDate('2026-06-01');
/** A wall-clock time on the visit's shop day. */
const at = (hours: number, minutes = 0) => minute(hours * 60 + minutes);

function seat(
  id: string,
  occupant: SeatOccupant,
  startMinutes: ReturnType<typeof at>,
  barber: string,
): Seat {
  return seatFixture({
    seatId: SeatId.of(id),
    occupant,
    startMinutes,
    barberId: BarberId.of(barber),
  });
}

const account = (uid: string, relationship: SubjectRelationship) =>
  SeatOccupant.account(UserId.of(uid), relationship);
const guest = () => SeatOccupant.anonymous(SeatLabel.of('Гост 1'));

/** A party of four on 2026-06-01: the booker twice, a companion, a guest — in no order. */
function party(overrides: AppointmentFixtureOverrides = {}): Appointment {
  return appointmentFixture({
    localDate: JUNE_1,
    seats: [
      seat(
        's1',
        account('zora', SubjectRelationship.Companion),
        at(10),
        'ivan',
      ),
      seat('s2', account('ana', SubjectRelationship.Self), at(10), 'petar'),
      seat('s3', guest(), at(10, 45), 'ivan'),
      seat('s4', account('ana', SubjectRelationship.Self), at(10, 45), 'petar'),
    ],
    placement: null,
    ...overrides,
  });
}

const S = AppointmentIndexSystem;

describe('queryKeys — the subject and placement mirrors (R33)', () => {
  it('writes every account on the visit once, sorted, guests left out', () => {
    expect(S.queryKeys(party()).subjectUserIds).toEqual(['ana', 'zora']);
  });

  it('writes the placement it is given, and null when it was never known', () => {
    expect(
      S.withQueryKeys(party({ placement: Placement.Staff })).placement,
    ).toBe('STAFF');
    expect(S.withQueryKeys(party()).placement).toBeNull();
  });

  it('owns both fields, so a staff edit rewrites them instead of dropping them', () => {
    const written = S.withQueryKeys(party({ placement: Placement.Self }));
    expect(Object.keys(written).sort()).toEqual(Object.keys(party()).sort());
    // The legacy `preservedAppointmentFields({ ...written, revision: 4 })` was
    // `{ revision: 4 }`: the mirrors are not carried, they are RECOMPUTED.
    // A stored entity whose mirror went stale (or was never written) gets
    // the seats' answer back, and the stamp it was given — nothing else rides.
    const stale = S.withQueryKeys(
      party({
        placement: Placement.Staff,
        subjectUserIds: [UserId.of('stale')],
        revision: 4,
      }),
    );
    expect(stale.subjectUserIds).toEqual(['ana', 'zora']);
    expect(stale.placement).toBe('STAFF');
    expect(stale.revision).toBe(4);
    expect(
      S.withQueryKeys(party({ subjectUserIds: [] })).subjectUserIds,
    ).toEqual(['ana', 'zora']);
  });

  it('reads the mirror off a stored entity the way the writer computes it', () => {
    const written = S.withQueryKeys(party());
    expect(S.queryKeys(written).subjectUserIds).toEqual(written.subjectUserIds);
    expect(
      S.queryKeys({ localDate: JUNE_1, seats: [] }).subjectUserIds,
    ).toEqual([]);
  });

  it('reads an unknown placement as not known', () => {
    expect(Placement.parse('STAFF')).toBe('STAFF');
    expect(Placement.parse('robot')).toBeNull();
    expect(Placement.parse(undefined)).toBeNull();
  });
});

describe('the inferred placement (§12.5.1, legacyPref)', () => {
  it('is read on its own, and never as the commit’s stamp', () => {
    const backfilled = party({ inferredPlacement: Placement.Staff });
    expect(S.inferPlacement(backfilled)).toBe('STAFF');
    expect(S.stampedPlacement(backfilled)).toBeNull();
    expect(S.inferPlacement(party({ placement: Placement.Self }))).toBeNull();
  });

  it('is never written by the mirrors, whatever they are given', () => {
    const written = S.withQueryKeys(party({ placement: Placement.Self }));
    expect(written.inferredPlacement).toBeNull();
  });

  // A staff edit rewrites the row with the stored placement carried
  // forward: the inference must survive it, and must not come out the other
  // side as a stamp.
  it('rides a staff edit’s rewrite unchanged, and never becomes a stamp', () => {
    const current = party({
      inferredPlacement: Placement.Staff,
      revision: 2,
    });
    const rewritten = S.withQueryKeys(current);
    expect(S.inferPlacement(rewritten)).toBe('STAFF');
    expect(S.stampedPlacement(rewritten)).toBeNull();
    expect(rewritten.placement).toBeNull();
  });
});

describe('queryKeys — owner, barbers, busy keys and the envelope', () => {
  it('names the first self seat as owner, the barbers in seat order, the busy keys sorted', () => {
    const keys = S.queryKeys(party());
    expect(keys.ownerUserId).toBe('ana');
    expect(keys.barberIds).toEqual(['ivan', 'petar']);
    expect(keys.busyKeys).toEqual([
      BusyKey.of(BarberId.of('ivan'), JUNE_1),
      BusyKey.of(BarberId.of('petar'), JUNE_1),
    ]);
    expect(S.envelope(party())).toEqual(
      MinuteRange.of(at(10), endMinute(10 * 60 + 45 + 30)),
    );
  });

  it('has no owner for a walk-in the shop entered itself', () => {
    const walkIn = party({
      seats: [seat('s1', guest(), at(9), 'ivan')],
    });
    expect(S.queryKeys(walkIn).ownerUserId).toBeNull();
    expect(S.queryKeys(walkIn).subjectUserIds).toEqual([]);
  });

  it('keys every seat by the appointment’s ONE shop day (T7) — the day is the visit’s, not a seat’s', () => {
    // The legacy instant model keyed a seat by the local day of its own
    // start; under F-6 every seat starts on the appointment's `localDate`,
    // so one barber's seats at 09:00 and 23:00 are one projection document,
    // and moving the visit's day moves every key with it.
    const evening = party({
      seats: [
        seat('s1', guest(), at(23), 'ivan'),
        seat('s2', guest(), at(9), 'ivan'),
      ],
    });
    expect(S.queryKeys(evening).busyKeys).toEqual([
      BusyKey.of(BarberId.of('ivan'), JUNE_1),
    ]);
    const nextDay = localDate('2026-06-02');
    expect(S.queryKeys({ ...evening, localDate: nextDay }).busyKeys).toEqual([
      BusyKey.of(BarberId.of('ivan'), nextDay),
    ]);
  });

  it('lists every account once and sorted, in any seat order (property)', () => {
    const anyUid = fc.constantFrom('ana', 'zora', 'boyan', 'cveta');
    fc.assert(
      fc.property(
        fc.array(fc.option(anyUid, { nil: null }), {
          minLength: 1,
          maxLength: 5,
        }),
        (uids) => {
          const seats = uids.map((uid, index) =>
            seat(
              `s${index}`,
              uid === null
                ? guest()
                : account(uid, SubjectRelationship.Companion),
              at(9 + index),
              'ivan',
            ),
          );
          const expected = [
            ...new Set(uids.filter((uid) => uid !== null)),
          ].sort();
          expect(
            S.queryKeys({ localDate: JUNE_1, seats }).subjectUserIds,
          ).toEqual(expected);
          expect(
            S.queryKeys({ localDate: JUNE_1, seats: [...seats].reverse() })
              .subjectUserIds,
          ).toEqual(expected);
        },
      ),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const appointment = deepFreeze(party());
    const once = S.withQueryKeys(appointment);
    expect(S.withQueryKeys(appointment)).toEqual(once);
    expect(appointment).toEqual(party());
  });
});
