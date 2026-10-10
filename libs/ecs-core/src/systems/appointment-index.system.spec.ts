import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BusyKey } from '../components/busy-key.data';
import { DayKey } from '../components/day-key.data';
import { DayOffset } from '../components/day-offset.data';
import { PlacementKind } from '../components/placement-kind.data';
import { SeatLabel } from '../components/seat-label.data';
import {
  type Seat,
  SeatId,
  SeatRelationship,
  SeatSubject,
} from '../components/seat.data';
import { TimeInterval } from '../components/time-interval.data';
import type { AppointmentEntity } from '../entities/appointment.entity';
import { BarberId } from '../entities/barber.entity';
import { UserId } from '../entities/user.entity';
import {
  appointmentFixture,
  dayTableFixture,
  deepFreeze,
  seatFixture,
} from '../testing';
import { AppointmentIndexSystem } from './appointment-index.system';
import { ZonedTimeSystem } from './zoned-time.system';

/*
 * The R33 rule cases of
 * libs/application/booking/src/lib/ports/appointment-document.mirrors.spec.ts:106-185
 * (8), COPIED so they survive the mapper's Phase 4 deletion: the subject
 * mirror lists every account once, sorted, guests left out; the placement
 * is the commit's stamp and is never inferred. The mapper-shape assertions
 * (`APPOINTMENT_DOCUMENT_FIELDS`, `preservedAppointmentFields`) become the
 * entity's own keys — there is no document type besides the entity.
 */

const DAYS = dayTableFixture('2026-05-31', '2026-06-02');
const JUNE_1 = DayOffset.find(DayKey.of('2026-06-01'), DAYS) as DayOffset;
const at = (hours: number, minutes = 0) =>
  ZonedTimeSystem.instantOf(JUNE_1, hours * 60 + minutes);

function seat(
  id: string,
  subject: SeatSubject,
  startMs: number,
  barber: string,
): Seat {
  return seatFixture({
    id: SeatId.of(id),
    subject,
    startMs,
    barberId: BarberId.of(barber),
  });
}

const account = (uid: string, relationship: SeatRelationship) =>
  SeatSubject.account(UserId.of(uid), relationship);
const guest = () => SeatSubject.anonymous(SeatLabel.of('Гост 1'));

/** A party of four: the booker twice, a companion, a guest — in no order. */
function party(overrides: Partial<AppointmentEntity> = {}): AppointmentEntity {
  return appointmentFixture({
    seats: [
      seat('s1', account('zora', SeatRelationship.Companion), at(10), 'ivan'),
      seat('s2', account('ana', SeatRelationship.Self), at(10), 'petar'),
      seat('s3', guest(), at(10, 45), 'ivan'),
      seat('s4', account('ana', SeatRelationship.Self), at(10, 45), 'petar'),
    ],
    placement: null,
    ...overrides,
  });
}

const S = AppointmentIndexSystem;

describe('queryKeys — the subject and placement mirrors (R33)', () => {
  it('writes every account on the visit once, sorted, guests left out', () => {
    expect(S.queryKeys(party(), DAYS).subjectUserIds).toEqual(['ana', 'zora']);
  });

  it('writes the placement it is given, and null when it was never known', () => {
    expect(
      S.withQueryKeys(party({ placement: PlacementKind.Staff }), DAYS)
        .placement,
    ).toBe('staff');
    expect(S.withQueryKeys(party(), DAYS).placement).toBeNull();
  });

  it('owns both fields, so a staff edit rewrites them instead of dropping them', () => {
    const written = S.withQueryKeys(
      party({ placement: PlacementKind.Self }),
      DAYS,
    );
    expect(Object.keys(written).sort()).toEqual(Object.keys(party()).sort());
    // The legacy `preservedAppointmentFields({ ...written, revision: 4 })` was
    // `{ revision: 4 }`: the mirrors are not carried, they are RECOMPUTED.
    // A stored entity whose mirror went stale (or was never written) gets
    // the seats' answer back, and the stamp it was given — nothing else rides.
    const stale = S.withQueryKeys(
      party({
        placement: PlacementKind.Staff,
        subjectUserIds: [UserId.of('stale')],
        revision: 4,
      }),
      DAYS,
    );
    expect(stale.subjectUserIds).toEqual(['ana', 'zora']);
    expect(stale.placement).toBe('staff');
    expect(stale.revision).toBe(4);
    expect(
      S.withQueryKeys(party({ subjectUserIds: [] }), DAYS).subjectUserIds,
    ).toEqual(['ana', 'zora']);
  });

  it('reads the mirror off a stored entity the way the writer computes it', () => {
    const written = S.withQueryKeys(party(), DAYS);
    expect(S.queryKeys(written, DAYS).subjectUserIds).toEqual(
      written.subjectUserIds,
    );
    expect(S.queryKeys({ seats: [] }, DAYS).subjectUserIds).toEqual([]);
  });

  it('reads an unknown placement as not known', () => {
    expect(PlacementKind.parse('staff')).toBe('staff');
    expect(PlacementKind.parse('robot')).toBeNull();
    expect(PlacementKind.parse(undefined)).toBeNull();
  });
});

describe('the inferred placement (§12.5.1, legacyPref)', () => {
  it('is read on its own, and never as the commit’s stamp', () => {
    const backfilled = party({ inferredPlacement: PlacementKind.Staff });
    expect(S.inferPlacement(backfilled)).toBe('staff');
    expect(S.stampedPlacement(backfilled)).toBeNull();
    expect(
      S.inferPlacement(party({ placement: PlacementKind.Self })),
    ).toBeNull();
  });

  it('is never written by the mirrors, whatever they are given', () => {
    const written = S.withQueryKeys(
      party({ placement: PlacementKind.Self }),
      DAYS,
    );
    expect(written.inferredPlacement).toBeNull();
  });

  // A staff edit rewrites the row with the stored placement carried
  // forward: the inference must survive it, and must not come out the other
  // side as a stamp.
  it('rides a staff edit’s rewrite unchanged, and never becomes a stamp', () => {
    const current = party({
      inferredPlacement: PlacementKind.Staff,
      revision: 2,
    });
    const rewritten = S.withQueryKeys(current, DAYS);
    expect(S.inferPlacement(rewritten)).toBe('staff');
    expect(S.stampedPlacement(rewritten)).toBeNull();
    expect(rewritten.placement).toBeNull();
  });
});

describe('queryKeys — owner, barbers, busy keys and the envelope', () => {
  it('names the first self seat as owner, the barbers in seat order, the busy keys sorted', () => {
    const keys = S.queryKeys(party(), DAYS);
    expect(keys.ownerUserId).toBe('ana');
    expect(keys.barberIds).toEqual(['ivan', 'petar']);
    expect(keys.busyKeys).toEqual([
      BusyKey.of(BarberId.of('ivan'), DayKey.of('2026-06-01')),
      BusyKey.of(BarberId.of('petar'), DayKey.of('2026-06-01')),
    ]);
    expect(S.envelope(party())).toEqual(
      TimeInterval.of(at(10), at(10, 45) + 30 * 60_000),
    );
  });

  it('has no owner for a walk-in the shop entered itself', () => {
    const walkIn = party({
      seats: [seat('s1', guest(), at(9), 'ivan')],
    });
    expect(S.queryKeys(walkIn, DAYS).ownerUserId).toBeNull();
    expect(S.queryKeys(walkIn, DAYS).subjectUserIds).toEqual([]);
  });

  it('keys a seat by its own local day — two days, two keys', () => {
    const june2 = DayOffset.find(DayKey.of('2026-06-02'), DAYS) as DayOffset;
    const split = party({
      seats: [
        seat('s1', guest(), at(23), 'ivan'),
        seat('s2', guest(), ZonedTimeSystem.instantOf(june2, 9 * 60), 'ivan'),
      ],
    });
    expect(S.queryKeys(split, DAYS).busyKeys).toEqual([
      BusyKey.of(BarberId.of('ivan'), DayKey.of('2026-06-01')),
      BusyKey.of(BarberId.of('ivan'), DayKey.of('2026-06-02')),
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
              uid === null ? guest() : account(uid, SeatRelationship.Companion),
              at(9 + index),
              'ivan',
            ),
          );
          const expected = [
            ...new Set(uids.filter((uid) => uid !== null)),
          ].sort();
          expect(S.queryKeys({ seats }, DAYS).subjectUserIds).toEqual(expected);
          expect(
            S.queryKeys({ seats: [...seats].reverse() }, DAYS).subjectUserIds,
          ).toEqual(expected);
        },
      ),
    );
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const appointment = deepFreeze(party());
    const days = deepFreeze([...DAYS]);
    const once = S.withQueryKeys(appointment, days);
    expect(S.withQueryKeys(appointment, days)).toEqual(once);
    expect(appointment).toEqual(party());
    expect(days).toEqual(DAYS);
  });
});
