import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AccountStatus,
  Actor,
  type BackfillCall,
  BackfillJobName,
  SystemSource,
  AuditAction,
  AuditContext,
  AuditedProfileField,
  AuditTarget,
  AuditTargetRef,
  EndReasonFields,
  GovernedCollection,
  ImpersonationScope,
  ImpersonationStatus,
  RegistrationField,
  Role,
  SeatLabel,
  SeatOccupant,
  SeatSubject,
  SubjectRelationship,
  EditCommand,
  StaffEditDelta,
} from '@core/components';
import {
  DurationMinutes,
  AppointmentId,
  AttendanceState,
  AuditEntryId,
  AuditResourceId,
  BarberId,
  BookingStatus,
  ClientOperationId,
  CustomerId,
  ImpersonationSessionId,
  LocationId,
  OperationId,
  OtpId,
  PublishRequestId,
  SeatId,
  ServiceId,
  TriggerEventId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { GovernanceErrorCode } from '@core/errors';
import { Collections, type ImpersonationSession } from '@core/entities';
import {
  FIXTURE_NOW_UTC_MS,
  deepFreeze,
  minute,
  unwrapErr,
  unwrapOk,
  utcMs,
  appointmentFixture,
  seatFixture,
  customerOf,
} from '@core/testing';
import {
  type AuditFact,
  type AuditSubject,
  AuditSystem,
  type ProfileChange,
} from './audit.system';

/*
 * The pure cases of apps/functions/src/lib/booking/audit.spec.ts (targets,
 * the per-person plan, the people on a stored visit and on a requested cart,
 * the staff edit's people, the T5 context, the row id's basis), of the
 * legacy governance `audit-entry.spec.ts` (deleted in Phase 4b) and of
 * apps/functions/src/lib/booking/audit-profile-changes.spec.ts, copied onto
 * the flat audit row (actor, context and target slices at its root). The
 * row id is `hash(rowBasis(…))` — the hash is the pipeline's, so the id
 * cases assert the BASIS: deterministic, and separating every part.
 */

const ivan = Actor.admin(UserId.of('dev-staff-ivan'));
/** The client record of the account `uid` — what a booking act's row targets (D29). */
const cus = (uid: string): CustomerId => customerOf(UserId.of(uid));
const account = (uid: string): AuditSubject => ({
  seatSubject: SeatSubject.Account,
  customerId: cus(uid),
});
const guest: AuditSubject = { seatSubject: SeatSubject.Anonymous };
const AT = utcMs('2026-09-25T08:00:00Z');
const APPT_1 = AuditResourceId.forAppointment(AppointmentId.of('appt-1'));
const at = (ms: number): UtcEpochMs => unwrapOk(UtcEpochMs.of(ms));

const OP = OperationId.of('op-0123456789abcdef');
/** A stand-in digest: the hash is a port; the plan must hash exactly the basis. */
const hashOf = (input: string): string => `h(${input.length}:${input})`;

function fact(overrides: Partial<AuditFact> = {}): AuditFact {
  return {
    resourceId: APPT_1,
    subjects: [account('maria')],
    changeKey: 'operation:op-0123456789abcdef',
    operationId: OP,
    context: AuditContext.staffEdit(
      AuditAction.BookingStaffMove,
      3,
      StaffEditDelta.NONE,
    ),
    ...overrides,
  };
}

describe('AuditSystem.targets', () => {
  it('names each client record once, in seat order, and skips guests', () => {
    expect(
      AuditSystem.targets([
        account('maria'),
        guest,
        account('stefan'),
        account('maria'),
      ]),
    ).toEqual([cus('maria'), cus('stefan')]);
  });

  it('names a walk-in’s record too — a client with a record gets a row of its own (OR-26)', () => {
    const record = CustomerId.of('cus_0123456789abcdef0123');
    expect(
      AuditSystem.targets([
        guest,
        { seatSubject: SeatSubject.WalkIn, customerId: record },
        account('maria'),
        { seatSubject: SeatSubject.WalkIn, customerId: record },
      ]),
    ).toEqual([record, cus('maria')]);
  });

  it('keeps one untargeted row when nobody on the visit has an account', () => {
    expect(AuditSystem.targets([guest, guest])).toEqual([null]);
    expect(AuditSystem.targets([])).toEqual([null]);
  });

  it('never names more people than there are account subjects, nor fewer than one row', () => {
    const subject = fc.oneof(
      fc.constant(guest),
      fc.constantFrom('a', 'b', 'c').map(account),
    );
    fc.assert(
      fc.property(fc.array(subject, { maxLength: 8 }), (subjects) => {
        const targets = AuditSystem.targets(subjects);
        const people = new Set(
          subjects.flatMap((s) =>
            s.seatSubject === SeatSubject.Account ? [s.customerId] : [],
          ),
        );
        expect(targets.length).toBe(Math.max(1, people.size));
        expect(new Set(targets).size).toBe(targets.length);
      }),
    );
  });
});

describe('AuditSystem.plan — one row per person', () => {
  it('writes one row per client record on a party of two, each naming that person (D29)', () => {
    const rows = unwrapOk(
      AuditSystem.plan(
        [fact({ subjects: [account('maria'), account('stefan')] })],
        ivan,
        AT,
      ),
    );
    expect(
      rows.map((r) =>
        r.row.auditTarget === AuditTarget.Customer
          ? r.row.targetCustomerId
          : null,
      ),
    ).toEqual([cus('maria'), cus('stefan')]);
    for (const { row } of rows) {
      expect(AuditTargetRef.targetUserIdOf(row)).toBeNull();
    }
    for (const { row } of rows) {
      expect(row).toMatchObject({
        actorRole: 'ADMIN',
        actorAdminUserId: 'dev-staff-ivan',
        auditAction: 'BOOKING_STAFF_MOVE',
        editRevision: 3,
        resourceId: 'appt-1',
        recordedAtUtcMs: AT,
        auditTarget: 'CUSTOMER',
      });
    }
  });

  it("gives a guest seat no row of its own — the booker's row covers the visit", () => {
    const rows = unwrapOk(
      AuditSystem.plan(
        [fact({ subjects: [account('maria'), guest] })],
        ivan,
        AT,
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.row).toMatchObject({
      auditTarget: 'CUSTOMER',
      targetCustomerId: cus('maria'),
    });
  });

  it('writes one untargeted row for a walk-in of guests', () => {
    const rows = unwrapOk(
      AuditSystem.plan([fact({ subjects: [guest] })], ivan, AT),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.row.auditTarget).toBe('NONE');
  });

  it('refuses through the domain rather than writing a half-formed row', () => {
    const blank = fact({
      context: { auditAction: '  ' as AuditAction } as AuditContext,
    });
    expect(unwrapErr(AuditSystem.plan([fact(), blank], ivan, AT))).toEqual({
      errorCode: GovernanceErrorCode.AuditEntryEmptyAction,
    });
  });

  it('bases each row id on its change — every fact carries its key (RU-41), so no row is left to a minted id', () => {
    const subjects = [account('maria'), account('stefan')];
    const keyed = unwrapOk(
      AuditSystem.plan(
        [fact({ subjects, changeKey: 'operation:op-4' })],
        ivan,
        AT,
      ),
    );
    expect(keyed.map((r) => r.idBasis)).toEqual([
      AuditSystem.rowBasis(
        'BOOKING_STAFF_MOVE',
        'appt-1',
        cus('maria'),
        'operation:op-4',
      ),
      AuditSystem.rowBasis(
        'BOOKING_STAFF_MOVE',
        'appt-1',
        cus('stefan'),
        'operation:op-4',
      ),
    ]);
  });

  it('copies the fact’s operation onto every row it fans out to (WS-4.4) — null stays null', () => {
    const subjects = [account('maria'), account('stefan')];
    const named = unwrapOk(AuditSystem.plan([fact({ subjects })], ivan, AT));
    expect(named.map((r) => r.row.auditOperationId)).toEqual([OP, OP]);
    const unnamed = unwrapOk(
      AuditSystem.plan([fact({ subjects, operationId: null })], ivan, AT),
    );
    expect(unnamed.map((r) => r.row.auditOperationId)).toEqual([null, null]);
  });

  it('carries the target slice and the instant onto the flat row: NONE when nobody, the context as given', () => {
    const rows = unwrapOk(
      AuditSystem.plan(
        [
          fact({
            subjects: [],
            context: AuditContext.arrival(AuditAction.BookingStaffArrived),
          }),
        ],
        Actor.system(SystemSource.Fixture),
        AT,
      ),
    );
    expect(rows[0]?.row).toEqual({
      recordedAtUtcMs: AT,
      resourceId: 'appt-1',
      auditOperationId: 'op-0123456789abcdef',
      actorRole: 'SYSTEM',
      actorSystemSource: 'FIXTURE',
      auditAction: 'BOOKING_STAFF_ARRIVED',
      auditTarget: 'NONE',
    });
  });
});

describe('AuditSystem.subjectsOfSeats — the people on a stored visit', () => {
  const visit = appointmentFixture({
    ownerUserId: UserId.of('maria'),
    seats: [
      seatFixture({
        seatId: SeatId.of('s1'),
        occupant: SeatOccupant.account(
          UserId.of('maria'),
          customerOf(UserId.of('maria')),
          SubjectRelationship.Self,
        ),
      }),
      seatFixture({
        seatId: SeatId.of('s2'),
        occupant: SeatOccupant.anonymous(unwrapOk(SeatLabel.parse('Синът'))),
      }),
      seatFixture({
        seatId: SeatId.of('s3'),
        occupant: SeatOccupant.account(
          UserId.of('stefan'),
          customerOf(UserId.of('stefan')),
          SubjectRelationship.Companion,
        ),
      }),
    ],
  });

  it('reads every seat: accounts by their client record, guests as anonymous', () => {
    expect(AuditSystem.subjectsOf(visit)).toEqual([
      account('maria'),
      guest,
      account('stefan'),
    ]);
  });

  it('reads a walk-in’s seat by the record the shop keeps for them (OR-26)', () => {
    const record = CustomerId.of('cus_0123456789abcdef0123');
    const walkIn = seatFixture({
      seatId: SeatId.of('s4'),
      occupant: SeatOccupant.walkIn(record, SeatLabel.of('Мария')),
    });
    expect(
      AuditSystem.subjectsOfSeats([...visit.seats, walkIn], SeatId.of('s4')),
    ).toEqual([{ seatSubject: SeatSubject.WalkIn, customerId: record }]);
  });

  it("narrows to the one seat a per-seat verb touched — a companion's no-show is theirs", () => {
    expect(AuditSystem.subjectsOfSeats(visit.seats, SeatId.of('s3'))).toEqual([
      account('stefan'),
    ]);
    expect(AuditSystem.subjectsOfSeats(visit.seats, SeatId.of('s2'))).toEqual([
      guest,
    ]);
    expect(
      AuditSystem.subjectsOfSeats(visit.seats, SeatId.of('missing')),
    ).toEqual([]);
  });
});

describe('AuditSystem.staffEditSubjects', () => {
  it('keeps everyone the visit had before the edit — a removed seat included', () => {
    expect(
      AuditSystem.staffEditSubjects(
        [account('maria'), account('stefan')],
        cus('maria'),
        [{ editCommand: EditCommand.RemoveSeat, seatId: SeatId.of('s3') }],
      ),
    ).toEqual([account('maria'), account('stefan')]);
  });

  it('adds the owner when an ADD_SEAT gives them a seat', () => {
    expect(
      AuditSystem.staffEditSubjects([guest], cus('maria'), [
        {
          editCommand: EditCommand.AddSeat,
          seatId: SeatId.of('new'),
          serviceId: ServiceId.of('svc'),
          variantId: null,
          barberId: BarberId.of('b'),
          startMinutes: minute(600),
          durationMinutes: unwrapOk(DurationMinutes.of(30)),
          workedAtUtcMs: utcMs('2026-09-28T10:30:00+03:00'),
          seatSubject: SeatSubject.Account,
          subjectUserId: UserId.of('maria'),
          subjectRelationship: SubjectRelationship.Self,
        },
      ]),
    ).toEqual([guest, account('maria')]);
  });
});

describe('audit context carries codes, never free text (T5)', () => {
  it("records a staff cancellation's reason code and the seat — there is no note to drop", () => {
    const context = AuditContext.transition(
      AuditAction.BookingStaffCancelled,
      'OTHER',
      SeatId.of('s1'),
      {
        transitionFromBookingStatus: BookingStatus.Confirmed,
        transitionFromStatusAtUtcMs: AT,
        transitionFromAttendanceState: AttendanceState.Scheduled,
      },
    );
    expect(context).toEqual({
      auditAction: 'BOOKING_STAFF_CANCELLED',
      transitionReason: 'OTHER',
      transitionSeatId: 's1',
      transitionFromBookingStatus: 'CONFIRMED',
      transitionFromStatusAtUtcMs: AT,
      transitionFromAttendanceState: 'SCHEDULED',
    });
  });

  it('records nothing when there is nothing to record — but the state it left', () => {
    expect(
      AuditContext.transition(AuditAction.BookingStaffCompleted, null, null, {
        transitionFromBookingStatus: BookingStatus.Confirmed,
        transitionFromStatusAtUtcMs: AT,
        transitionFromAttendanceState: null,
      }),
    ).toEqual({
      auditAction: 'BOOKING_STAFF_COMPLETED',
      transitionReason: null,
      transitionSeatId: null,
      transitionFromBookingStatus: 'CONFIRMED',
      transitionFromStatusAtUtcMs: AT,
      transitionFromAttendanceState: null,
    });
  });
});

describe('AuditSystem.rowBasis — one id per person per logical change', () => {
  const parts = {
    action: 'booking.committed',
    resourceId: 'appt-1',
    targetUserId: 'maria' as string | null,
    changeKey: 'attempt:abc',
  };
  const basis = (p: typeof parts) =>
    AuditSystem.rowBasis(p.action, p.resourceId, p.targetUserId, p.changeKey);

  it('derives the same basis from the same change, every time', () => {
    expect(basis(parts)).toBe(basis({ ...parts }));
    expect(basis(parts)).toBe(
      JSON.stringify([
        'audit-row/v2',
        'booking.committed',
        'appt-1',
        'maria',
        'attempt:abc',
      ]),
    );
  });

  it('keeps every part recoverable whatever goes in — a hash of it is a legal id', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.string(),
        fc.option(fc.string(), { nil: null }),
        fc.string(),
        (action, resourceId, targetUserId, changeKey) => {
          const parsed: unknown = JSON.parse(
            AuditSystem.rowBasis(action, resourceId, targetUserId, changeKey),
          );
          expect(parsed).toEqual([
            'audit-row/v2',
            action,
            resourceId,
            targetUserId,
            changeKey,
          ]);
        },
      ),
    );
  });

  it('separates every part — a change to any one of them is a different row', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('action', 'resourceId', 'targetUserId', 'changeKey'),
        fc.string({ minLength: 1 }),
        (field, suffix) => {
          const changed = {
            ...parts,
            [field]: `${String(parts[field as keyof typeof parts])}${suffix}`,
          };
          expect(basis(changed)).not.toBe(basis(parts));
        },
      ),
    );
    expect(
      basis({ ...parts, resourceId: 'appt-1:x', changeKey: 'y' }),
    ).not.toBe(basis({ ...parts, resourceId: 'appt-1', changeKey: 'x:y' }));
    expect(basis({ ...parts, targetUserId: null })).not.toBe(
      basis({ ...parts, targetUserId: '' }),
    );
  });

  it('a retried attempt derives the same key, verb by verb — from the act’s operation id, never an instant (WS-1, RU-6)', () => {
    const keys = AuditSystem.changeKey;
    const op = OperationId.of('op-1');
    expect(keys.attempt(AppointmentId.of('abc'))).toBe('attempt:abc');
    expect(
      keys.move(unwrapOk(ClientOperationId.parse('m1m1m1m1m1m1m1m1'))),
    ).toBe('move:m1m1m1m1m1m1m1m1');
    expect(keys.staffEdit(op)).toBe('operation:op-1');
    expect(keys.cancel(op)).toBe('cancel:op-1');
    expect(keys.transition(op, SeatId.of('s1'))).toBe('transition:op-1:s1');
    expect(keys.transition(op, null)).toBe('transition:op-1');
    expect(keys.arrived(op)).toBe('arrived:op-1');
    expect(keys.unarrived(op)).toBe('unarrived:op-1');
    expect(keys.tip(op, SeatId.of('s1'))).toBe('tip:op-1:s1');
    expect(keys.backfillFailed('minted-1')).toBe('backfill-failed:minted-1');
    expect(keys.publish(PublishRequestId.of('req-1'))).toBe('req-1');
    expect(keys.profile(TriggerEventId.of('evt-1'))).toBe('evt-1');
    expect(keys.impersonationStarted(ImpersonationSessionId.of('imp-1'))).toBe(
      'impersonation-start:imp-1',
    );
    expect(keys.impersonationEnded(ImpersonationSessionId.of('imp-1'))).toBe(
      'impersonation-end:imp-1',
    );
    expect(keys.clientExported(op)).toBe('export:op-1');
  });

  it('keeps two acts apart however close in time — and a seat act apart from the party act', () => {
    const keys = AuditSystem.changeKey;
    const a = OperationId.of('op-a');
    const b = OperationId.of('op-b');
    expect(keys.cancel(a)).not.toBe(keys.cancel(b));
    expect(keys.transition(a, null)).not.toBe(
      keys.transition(a, SeatId.of('s1')),
    );
    expect(keys.tip(a, SeatId.of('s1'))).not.toBe(keys.tip(a, SeatId.of('s2')));
    // The arrival pair keeps its two verb words: an undo is its own act.
    expect(keys.arrived(a)).not.toBe(keys.unarrived(a));
    // Two exports are two acts; an export never shares a key with another verb of its id.
    expect(keys.clientExported(a)).not.toBe(keys.clientExported(b));
    expect(keys.clientExported(a)).not.toBe(keys.cancel(a));
    expect(keys.clientExported(a)).not.toBe(keys.staffEdit(a));
  });

  it('keys the erasure’s start and completion by the record’s STATE, the sweep and the re-sweep by their act (Phase 3 WS-D, P3-RU-22, P3-DEP-33)', () => {
    const keys = AuditSystem.changeKey;
    const record = CustomerId.of('cus_0123456789abcdef0123');
    const other = CustomerId.of('cus_fedcba9876543210fedc');
    const op = OperationId.of('op-1');
    expect(keys.erasureStarted(record)).toBe(
      'erasure-start:cus_0123456789abcdef0123',
    );
    expect(keys.erased(record)).toBe('erasure-done:cus_0123456789abcdef0123');
    expect(keys.erasureResweep(op)).toBe('erasure-resweep:op-1');
    // One start and one completion per record, whatever act runs them.
    expect(keys.erasureStarted(record)).toBe(keys.erasureStarted(record));
    expect(keys.erasureStarted(record)).not.toBe(keys.erasureStarted(other));
    expect(keys.erasureStarted(record)).not.toBe(keys.erased(record));
    // Two re-sweeps are two acts; a re-sweep never shares an export’s key.
    expect(keys.erasureResweep(op)).not.toBe(
      keys.erasureResweep(OperationId.of('op-2')),
    );
    expect(keys.erasureResweep(op)).not.toBe(keys.clientExported(op));
    // The pre-stamp sweep is keyed by its act too (P3-DEP-33): two acts are
    // two rows, and it never shares a re-sweep's or an export's key.
    expect(keys.erasureSweep(op)).toBe('erasure-sweep:op-1');
    expect(keys.erasureSweep(op)).not.toBe(
      keys.erasureSweep(OperationId.of('op-2')),
    );
    expect(keys.erasureSweep(op)).not.toBe(keys.erasureResweep(op));
    expect(keys.erasureSweep(op)).not.toBe(keys.clientExported(op));
  });

  it('keys the sign-in rows by state, never by the caller’s operation id (Phase 3 WS-B, P3-RU-7)', () => {
    const keys = AuditSystem.changeKey;
    const otp = OtpId.of('otp-1');
    expect(keys.otpRequested(otp)).toBe('otp-requested:otp-1');
    expect(keys.otpVerified(otp)).toBe('otp-verified:otp-1');
    expect(keys.otpRefused(otp, 1)).toBe('otp-refused:otp-1:1');
    expect(keys.otpRefused(otp, 2)).toBe('otp-refused:otp-1:2');
    expect(keys.sessionIssued(otp)).toBe('session:otp-1');
    expect(keys.registration(UserId.of('u-1'))).toBe('registration:u-1');
    // Each recorded attempt is its own change; the verbs of one challenge stay apart.
    expect(keys.otpRefused(otp, 1)).not.toBe(keys.otpRefused(otp, 2));
    expect(
      new Set([
        keys.otpRequested(otp),
        keys.otpVerified(otp),
        keys.otpRefused(otp, 1),
        keys.sessionIssued(otp),
      ]).size,
    ).toBe(4);
  });

  it('idBasisOf is rowBasis’s exact bytes over the brands — a stored row id stays what it was (Phase 3)', () => {
    // A booking act's stored row: verb, the bare appointment id, the client record, its key.
    const booking = AuditSystem.idBasisOf(
      AuditAction.BookingCommitted,
      APPT_1,
      cus('maria'),
      AuditSystem.changeKey.attempt(AppointmentId.of('appt-1')),
    );
    expect(booking).toBe(
      AuditSystem.rowBasis(
        'BOOKING_COMMITTED',
        'appt-1',
        cus('maria'),
        'attempt:appt-1',
      ),
    );
    expect(booking).toBe(
      JSON.stringify([
        'audit-row/v2',
        'BOOKING_COMMITTED',
        'appt-1',
        cus('maria'),
        'attempt:appt-1',
      ]),
    );
    // The id a planner already writes is the id idBasisOf derives — byte for byte.
    const planned = unwrapOk(
      AuditSystem.plan(
        [
          fact({
            context: AuditContext.placement(
              AuditAction.BookingCommitted,
              LocationId.of('loc-1'),
            ),
            changeKey: AuditSystem.changeKey.attempt(
              AppointmentId.of('appt-1'),
            ),
          }),
        ],
        ivan,
        AT,
      ),
    );
    expect(planned.map((plan) => hashOf(plan.idBasis))).toEqual([
      hashOf(booking),
    ]);
    // An account row and an untargeted row.
    const profile = AuditSystem.planOwnProfileEdit(
      UserId.of('maria'),
      [AuditedProfileField.FirstName],
      AT,
      OP,
    );
    expect(profile?.idBasis).toBe(
      AuditSystem.idBasisOf(
        AuditAction.ProfileUpdated,
        AuditResourceId.forUser(UserId.of('maria')),
        UserId.of('maria'),
        AuditSystem.changeKey.ownProfileEdit(UserId.of('maria'), AT),
      ),
    );
    expect(
      AuditSystem.idBasisOf(AuditAction.OpsBackfill, APPT_1, null, 'k'),
    ).toBe(AuditSystem.rowBasis('OPS_BACKFILL', 'appt-1', null, 'k'));
  });
});

/* ── The users half of the document-change trigger (audit-profile-changes.ts) ── */

describe('AuditSystem.changedProfileFields — names, never values', () => {
  it('lists the audited fields whose value changed, in a fixed order', () => {
    expect(
      AuditSystem.changedProfileFields(
        { lastName: 'Петров', firstName: 'Мария', phone: '+359888000001' },
        { lastName: 'Иванова', firstName: 'Мариа', phone: '+359888000001' },
      ),
    ).toEqual(['firstName', 'lastName']);
  });

  it('treats absent, null and empty as the same "no value"', () => {
    expect(
      AuditSystem.changedProfileFields({ email: null, birthDate: '' }, {}),
    ).toEqual([]);
    expect(
      AuditSystem.changedProfileFields({}, { birthDate: '1990-04-12' }),
    ).toEqual(['birthDate']);
  });

  it('lists roles and accountStatus too, appended — no writer audits them on its own (WS-3, DEP-13)', () => {
    expect(
      AuditSystem.changedProfileFields(
        // A provisioned stub's server-owned keys, flat at the root…
        {
          registrationState: 'PROVISIONED',
          roles: [],
          accountStatus: 'ACTIVE',
          searchName: null,
          searchPrefixes: [],
        },
        // …set over by a registered, blocked body: roles and status changed.
        {
          registrationState: 'REGISTERED',
          roles: ['barber'],
          accountStatus: 'BLOCKED',
          blockReason: 'MANUAL',
          blockedUntilUtcMs: 1_798_761_600_000,
          searchName: 'b',
          searchPrefixes: ['b'],
        },
      ),
    ).toEqual(['roles', 'accountStatus']);
    // The other server-owned keys are still nobody's row.
    expect(
      AuditSystem.changedProfileFields(
        { registrationState: 'PROVISIONED', searchPrefixes: [] },
        { registrationState: 'REGISTERED', searchPrefixes: ['b'] },
      ),
    ).toEqual([]);
  });

  it('reads an empty roles list as "no value" — the stub lists nothing; the stored order is the registration five first', () => {
    expect(AuditSystem.changedProfileFields({}, { roles: [] })).toEqual([]);
    expect(AuditSystem.changedProfileFields({ roles: [] }, {})).toEqual([]);
    expect(
      AuditSystem.changedProfileFields({}, { accountStatus: 'ACTIVE' }),
    ).toEqual(['accountStatus']);
    expect(
      AuditSystem.changedProfileFields(
        { roles: ['client'] },
        { roles: [], email: 'a@b.bg', accountStatus: 'ACTIVE' },
      ),
    ).toEqual(['email', 'roles', 'accountStatus']);
  });

  it('never lets a value into the row context, whatever the profile held — the tags carry closed vocabularies only', () => {
    const FIELDS = ['firstName', 'lastName', 'phone', 'email', 'birthDate'];
    const AUDITED = [...FIELDS, 'roles', 'accountStatus'];
    const value = fc.oneof(
      fc.constant(undefined),
      fc.constant(null),
      fc.string({ minLength: 1, maxLength: 12 }),
    );
    // Roles and a status as a writer may spell them — known, unknown or junk.
    const roles = fc.oneof(
      fc.constant(undefined),
      fc.constant(null),
      fc.array(
        fc.oneof(
          fc.constantFrom(...Object.values(Role)),
          fc.string({ minLength: 1, maxLength: 12 }),
        ),
        { maxLength: 4 },
      ),
    );
    const status = fc.oneof(
      fc.constant(undefined),
      fc.constantFrom('ACTIVE', 'BLOCKED'),
      fc.string({ minLength: 1, maxLength: 12 }),
    );
    const profile = fc.record({
      ...Object.fromEntries(FIELDS.map((f) => [f, value])),
      roles,
      accountStatus: status,
    });
    fc.assert(
      fc.property(profile, profile, (before, after) => {
        const fields = AuditSystem.changedProfileFields(before, after);
        const plan = unwrapOk(
          AuditSystem.planProfileChange(
            {
              governedCollection: GovernedCollection.Users,
              eventId: TriggerEventId.of('evt-1'),
              eventAtUtcMs: AT,
              ownerUserId: UserId.of('maria'),
              writer: Actor.user(UserId.of('maria')),
              beforeExists: true,
              afterExists: true,
              fields,
              beforeProfileEditedAtUtcMs: null,
              afterProfileEditedAtUtcMs: null,
              ...AuditSystem.profileTagDelta(before, after),
            },
            AT,
          ),
        );
        if (fields.length === 0) {
          expect(plan).toBeNull();
          return;
        }
        expect(plan?.row).toMatchObject({
          auditAction: 'PROFILE_UPDATED',
          profileFields: fields,
        });
        for (const name of fields) expect(AUDITED).toContain(name);
        const row = plan?.row as unknown as Record<string, unknown>;
        // Each tag pair is set iff its field is named.
        expect(row['profileRolesFrom'] !== null).toBe(fields.includes('roles'));
        expect(row['profileRolesTo'] !== null).toBe(fields.includes('roles'));
        // An unchanged status leaves its pair null (a changed one may still
        // read null on a side whose status is unknown).
        if (!fields.includes('accountStatus')) {
          expect(row['profileAccountStatusFrom']).toBeNull();
          expect(row['profileAccountStatusTo']).toBeNull();
        }
        // Nothing but role tags and status tags ever reaches them.
        const roleLists = [
          row['profileRolesFrom'],
          row['profileRolesTo'],
        ] as readonly (readonly unknown[] | null)[];
        for (const list of roleLists) {
          for (const role of list ?? []) {
            expect(Object.values(Role)).toContain(role);
          }
        }
        for (const tag of [
          row['profileAccountStatusFrom'],
          row['profileAccountStatusTo'],
        ]) {
          expect([null, 'ACTIVE', 'BLOCKED']).toContain(tag);
        }
      }),
    );
  });
});

describe('AuditSystem.profileTagDelta — the role and status tags, before and after (WS-3)', () => {
  it('leaves every pair null when neither roles nor accountStatus changed', () => {
    expect(
      AuditSystem.profileTagDelta(
        { firstName: 'Мария', roles: ['barber'], accountStatus: 'ACTIVE' },
        { firstName: 'Мариа', roles: ['barber'], accountStatus: 'ACTIVE' },
      ),
    ).toEqual({
      profileRolesFrom: null,
      profileRolesTo: null,
      profileAccountStatusFrom: null,
      profileAccountStatusTo: null,
    });
    // An empty list is "no value" on both sides.
    expect(
      AuditSystem.profileTagDelta({ roles: [] }, {}).profileRolesFrom,
    ).toBeNull();
  });

  it('sets the roles pair to each side’s known roles when roles changed — unknown strings dropped', () => {
    expect(
      AuditSystem.profileTagDelta(
        { roles: ['client'] },
        { roles: ['barber', 'admin', 'root', 'barber'] },
      ),
    ).toEqual({
      profileRolesFrom: ['client'],
      profileRolesTo: ['barber', 'admin'],
      profileAccountStatusFrom: null,
      profileAccountStatusTo: null,
    });
    // Registration sets the stub's empty list: from nothing to a role.
    expect(
      AuditSystem.profileTagDelta({ roles: [] }, { roles: ['client'] }),
    ).toMatchObject({ profileRolesFrom: [], profileRolesTo: ['client'] });
    // A non-list holds no role.
    expect(
      AuditSystem.profileTagDelta({ roles: 'admin' }, { roles: ['admin'] }),
    ).toMatchObject({ profileRolesFrom: [], profileRolesTo: ['admin'] });
  });

  it('sets the status pair when accountStatus changed — an absent or unknown side is null', () => {
    expect(
      AuditSystem.profileTagDelta(
        { accountStatus: 'ACTIVE' },
        { accountStatus: 'BLOCKED' },
      ),
    ).toEqual({
      profileRolesFrom: null,
      profileRolesTo: null,
      profileAccountStatusFrom: 'ACTIVE',
      profileAccountStatusTo: 'BLOCKED',
    });
    // The provisioned stub's creation: nothing before, ACTIVE after.
    expect(
      AuditSystem.profileTagDelta({}, { accountStatus: 'ACTIVE', roles: [] }),
    ).toEqual({
      profileRolesFrom: null,
      profileRolesTo: null,
      profileAccountStatusFrom: null,
      profileAccountStatusTo: 'ACTIVE',
    });
    expect(
      AuditSystem.profileTagDelta(
        { accountStatus: 'SUSPENDED' },
        { accountStatus: 'ACTIVE' },
      ),
    ).toMatchObject({
      profileAccountStatusFrom: null,
      profileAccountStatusTo: 'ACTIVE',
    });
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const before = deepFreeze({ roles: ['client'], accountStatus: 'ACTIVE' });
    const after = deepFreeze({ roles: ['barber'], accountStatus: 'BLOCKED' });
    const once = AuditSystem.profileTagDelta(before, after);
    expect(AuditSystem.profileTagDelta(before, after)).toEqual(once);
    expect(before).toEqual({ roles: ['client'], accountStatus: 'ACTIVE' });
  });
});

describe('AuditSystem.profileAction', () => {
  it('names creation, update and deletion apart', () => {
    expect(AuditSystem.profileAction(false, true)).toBe('PROFILE_CREATED');
    expect(AuditSystem.profileAction(true, true)).toBe('PROFILE_UPDATED');
    expect(AuditSystem.profileAction(true, false)).toBe('PROFILE_DELETED');
  });
});

describe('AuditSystem.writerOf — who wrote it, from the auth context (RU-17: was profileWriter)', () => {
  it('credits the end user a client-SDK write came from', () => {
    expect(AuditSystem.writerOf('api_key', 'maria-uid')).toEqual(
      Actor.user(UserId.of('maria-uid')),
    );
  });

  it('credits the uid, not the profile owner, when somebody else wrote it', () => {
    expect(AuditSystem.writerOf('api_key', 'someone-else')).toEqual(
      Actor.user(UserId.of('someone-else')),
    );
  });

  it('attributes an Admin SDK write to the process, whatever the id says', () => {
    expect(
      AuditSystem.writerOf(
        'service_account',
        'fn@project.iam.gserviceaccount.com',
      ),
    ).toEqual(Actor.system(SystemSource.AdminSdk));
    // The tag itself reads the same as the platform's lower-case spelling.
    expect(AuditSystem.writerOf('SERVICE_ACCOUNT', null)).toEqual(
      Actor.system(SystemSource.AdminSdk),
    );
  });

  it('attributes a platform write to the platform', () => {
    expect(AuditSystem.writerOf('system', null)).toEqual(
      Actor.system(SystemSource.FirestoreSystem),
    );
  });

  it('does not guess when the id is missing or not a uid (the emulator reports a fake e-mail)', () => {
    expect(AuditSystem.writerOf('unknown', 'fake-auth-id@gmail.com')).toEqual(
      Actor.system(SystemSource.UnattributedUnknown),
    );
    expect(AuditSystem.writerOf('api_key', null)).toEqual(
      Actor.system(SystemSource.UnattributedApiKey),
    );
    expect(AuditSystem.writerOf('unauthenticated', null)).toEqual(
      Actor.system(SystemSource.UnattributedUnauthenticated),
    );
    expect(AuditSystem.writerOf('something_new', '')).toEqual(
      Actor.system(SystemSource.UnattributedUnknown),
    );
  });

  it('is pure: same input → same output', () => {
    for (const [type, id] of [
      ['api_key', 'maria-uid'],
      ['service_account', null],
      ['unknown', 'fake-auth-id@gmail.com'],
    ] as const) {
      expect(AuditSystem.writerOf(type, id)).toEqual(
        AuditSystem.writerOf(type, id),
      );
    }
  });
});

describe('AuditSystem.planProfileChange — one row per event', () => {
  const EVENT_AT = utcMs('2026-09-25T08:00:00.123Z');
  const change: ProfileChange = {
    governedCollection: GovernedCollection.Users,
    eventId: TriggerEventId.of('evt-1f2e'),
    eventAtUtcMs: EVENT_AT,
    ownerUserId: UserId.of('maria'),
    writer: Actor.system(SystemSource.AdminSdk),
    beforeExists: true,
    afterExists: true,
    fields: [RegistrationField.FirstName, RegistrationField.LastName],
    beforeProfileEditedAtUtcMs: null,
    afterProfileEditedAtUtcMs: null,
    profileRolesFrom: null,
    profileRolesTo: null,
    profileAccountStatusFrom: null,
    profileAccountStatusTo: null,
  };

  it('keys the row by the event id, so a redelivery lands on the same document', () => {
    const plan = unwrapOk(AuditSystem.planProfileChange(change, AT));
    expect(plan?.idBasis).toBe(
      AuditSystem.rowBasis(
        'PROFILE_UPDATED',
        'users/maria',
        'maria',
        'evt-1f2e',
      ),
    );
    expect(
      unwrapOk(
        AuditSystem.planProfileChange({ ...change }, UtcEpochMs.plusMs(AT, 1)),
      )?.idBasis,
    ).toBe(plan?.idBasis);
  });

  it('names the profile owner as the target and the fields as the only context', () => {
    const plan = unwrapOk(AuditSystem.planProfileChange(change, AT));
    expect(plan?.row).toMatchObject({
      auditTarget: 'USER',
      targetUserId: 'maria',
      resourceId: 'users/maria',
      auditAction: 'PROFILE_UPDATED',
      profileFields: ['firstName', 'lastName'],
      actorRole: 'SYSTEM',
      actorSystemSource: 'ADMIN_SDK',
    });
    // A trigger row names no operation (WS-4.4).
    expect(plan?.row.auditOperationId).toBeNull();
    // No role or status moved: the four tags stay null (WS-3).
    expect(plan?.row).toMatchObject({
      profileRolesFrom: null,
      profileRolesTo: null,
      profileAccountStatusFrom: null,
      profileAccountStatusTo: null,
    });
  });

  it('carries the role and status tags the decoder found (WS-3, DEP-13) — the lists copied', () => {
    const rolesTo: Role[] = [Role.Barber];
    const plan = unwrapOk(
      AuditSystem.planProfileChange(
        {
          ...change,
          fields: [
            AuditedProfileField.Roles,
            AuditedProfileField.AccountStatus,
          ],
          profileRolesFrom: [Role.Client],
          profileRolesTo: rolesTo,
          profileAccountStatusFrom: AccountStatus.Active,
          profileAccountStatusTo: AccountStatus.Blocked,
        },
        AT,
      ),
    );
    rolesTo.push(Role.Admin);
    expect(plan?.row).toMatchObject({
      auditAction: 'PROFILE_UPDATED',
      profileFields: ['roles', 'accountStatus'],
      profileRolesFrom: ['client'],
      profileRolesTo: ['barber'],
      profileAccountStatusFrom: 'ACTIVE',
      profileAccountStatusTo: 'BLOCKED',
    });
  });

  it("stamps the event's own instant, not the delivery's", () => {
    const plan = unwrapOk(AuditSystem.planProfileChange(change, AT));
    expect(plan?.row.recordedAtUtcMs).toBe(EVENT_AT);
    const unparsed = unwrapOk(
      AuditSystem.planProfileChange({ ...change, eventAtUtcMs: null }, AT),
    );
    expect(unparsed?.row.recordedAtUtcMs).toBe(AT);
  });

  it('refuses an event with no id rather than minting one', () => {
    expect(
      AuditSystem.planProfileChange(
        { ...change, eventId: TriggerEventId.of('') },
        AT,
      ).ok,
    ).toBe(false);
  });

  /*
   * Owner ruling flip-2 §10.15 (Phase 4a 4A-16): an edit `updateProfile`
   * already audited — its stamp changed — plans nothing; everything else is
   * audited as today.
   */
  describe('the edit the callable already audited (4A-16)', () => {
    const BEFORE = utcMs('2026-09-24T08:00:00.000Z');
    const AFTER = utcMs('2026-09-25T08:00:00.000Z');

    it('plans nothing for an update whose profileEditedAtUtcMs stamp changed', () => {
      expect(
        unwrapOk(
          AuditSystem.planProfileChange(
            {
              ...change,
              beforeProfileEditedAtUtcMs: null,
              afterProfileEditedAtUtcMs: AFTER,
            },
            AT,
          ),
        ),
      ).toBeNull();
      expect(
        unwrapOk(
          AuditSystem.planProfileChange(
            {
              ...change,
              beforeProfileEditedAtUtcMs: BEFORE,
              afterProfileEditedAtUtcMs: AFTER,
            },
            AT,
          ),
        ),
      ).toBeNull();
    });

    it('audits an update that left the stamp as it was (a block, an admin write) as today', () => {
      const plan = unwrapOk(
        AuditSystem.planProfileChange(
          {
            ...change,
            beforeProfileEditedAtUtcMs: BEFORE,
            afterProfileEditedAtUtcMs: BEFORE,
          },
          AT,
        ),
      );
      expect(plan?.row).toMatchObject({ auditAction: 'PROFILE_UPDATED' });
    });

    it("audits an update that reset the stamp to null (a whole-body seed set) — a reset is never the callable's", () => {
      const plan = unwrapOk(
        AuditSystem.planProfileChange(
          {
            ...change,
            fields: ['firstName'],
            beforeProfileEditedAtUtcMs: BEFORE,
            afterProfileEditedAtUtcMs: null,
          },
          AT,
        ),
      );
      expect(plan?.row).toMatchObject({
        auditAction: 'PROFILE_UPDATED',
        profileFields: ['firstName'],
        actorRole: 'SYSTEM',
        actorSystemSource: 'ADMIN_SDK',
      });
    });

    it('never skips a creation — the stub, registration and the seed keep their ONE PROFILE_CREATED row', () => {
      const plan = unwrapOk(
        AuditSystem.planProfileChange(
          {
            ...change,
            beforeExists: false,
            beforeProfileEditedAtUtcMs: null,
            afterProfileEditedAtUtcMs: AFTER,
          },
          AT,
        ),
      );
      expect(plan?.row).toMatchObject({ auditAction: 'PROFILE_CREATED' });
    });

    it('never skips a deletion', () => {
      const plan = unwrapOk(
        AuditSystem.planProfileChange(
          {
            ...change,
            afterExists: false,
            beforeProfileEditedAtUtcMs: BEFORE,
            afterProfileEditedAtUtcMs: null,
          },
          AT,
        ),
      );
      expect(plan?.row).toMatchObject({ auditAction: 'PROFILE_DELETED' });
    });
  });
});

describe('AuditSystem.planOwnProfileEdit — the row updateProfile writes itself (4A-16)', () => {
  const OWNER = UserId.of('maria');
  const EDITED_AT = utcMs('2026-09-25T08:00:00.000Z');

  it('credits the owner, names the changed fields and stamps the edit', () => {
    const plan = AuditSystem.planOwnProfileEdit(
      OWNER,
      ['firstName', 'birthDate'],
      EDITED_AT,
      OP,
    );
    expect(plan?.row).toMatchObject({
      recordedAtUtcMs: EDITED_AT,
      resourceId: 'users/maria',
      auditOperationId: OP,
      auditAction: 'PROFILE_UPDATED',
      profileFields: ['firstName', 'birthDate'],
      actorRole: 'USER',
      actorUserId: 'maria',
      auditTarget: 'USER',
      targetUserId: 'maria',
      // An own edit never touches roles or status (WS-3).
      profileRolesFrom: null,
      profileRolesTo: null,
      profileAccountStatusFrom: null,
      profileAccountStatusTo: null,
    });
    expect(plan?.idBasis).toBe(
      AuditSystem.rowBasis(
        'PROFILE_UPDATED',
        'users/maria',
        'maria',
        AuditSystem.changeKey.ownProfileEdit(OWNER, EDITED_AT),
      ),
    );
  });

  it('plans nothing for an edit that changed no audited field', () => {
    expect(AuditSystem.planOwnProfileEdit(OWNER, [], EDITED_AT, OP)).toBeNull();
  });

  it('names no operation when the call sent none (RU-21: optional on the wire)', () => {
    expect(
      AuditSystem.planOwnProfileEdit(OWNER, ['lastName'], EDITED_AT, null)?.row
        .auditOperationId,
    ).toBeNull();
  });

  it('keys each landed edit by its owner and instant', () => {
    expect(AuditSystem.changeKey.ownProfileEdit(OWNER, EDITED_AT)).toBe(
      `profile-edit:maria:${EDITED_AT}`,
    );
  });
});

describe('AuditSystem.planImpersonationStarted / planImpersonationEnded — the session rows (WS-3, DEP-12)', () => {
  const SESSION = ImpersonationSessionId.of('imp-7');
  const STARTED_AT = utcMs('2026-09-25T08:00:00.000Z');
  const EXPIRES_AT = utcMs('2026-09-25T09:00:00.000Z');
  const ENDED_AT = utcMs('2026-09-25T08:30:00.000Z');
  /** A reason nobody may ever find in a row (free text, T5 / R36). */
  const SECRET = 'XYZZY-a-distinctive-reason-417';
  const active: ImpersonationSession = {
    id: SESSION,
    adminUserId: UserId.of('ivan'),
    targetUserId: UserId.of('maria'),
    impersonationScope: ImpersonationScope.Write,
    reason: SECRET,
    startedAtUtcMs: STARTED_AT,
    expiresAtUtcMs: EXPIRES_AT,
    impersonationStatus: ImpersonationStatus.Active,
  };
  const ended = (reason: EndReasonFields): ImpersonationSession => ({
    ...active,
    impersonationStatus: ImpersonationStatus.Ended,
    endedAtUtcMs: ENDED_AT,
    ...reason,
  });
  const admin = Actor.forCaller(UserId.of('ivan'), [Role.Admin, Role.Barber]);
  const sysadmin = Actor.forCaller(UserId.of('ops-1'), [Role.Sysadmin]);

  it('a start row: the session resource, the impersonated account as target, the scope and window — stamped at the start', () => {
    const plan = AuditSystem.planImpersonationStarted(active, admin, OP);
    expect(plan.row).toEqual({
      recordedAtUtcMs: STARTED_AT,
      resourceId: `${Collections.ImpersonationSessions}/imp-7`,
      auditOperationId: OP,
      actorRole: 'ADMIN',
      actorAdminUserId: 'ivan',
      auditAction: 'GOVERNANCE_IMPERSONATION_STARTED',
      impersonationSessionId: 'imp-7',
      impersonationScope: 'WRITE',
      impersonationExpiresAtUtcMs: EXPIRES_AT,
      auditTarget: 'USER',
      targetUserId: 'maria',
    });
    expect(plan.row.resourceId).toBe(
      AuditResourceId.forImpersonationSession(SESSION),
    );
    expect(plan.idBasis).toBe(
      AuditSystem.rowBasis(
        'GOVERNANCE_IMPERSONATION_STARTED',
        'impersonationSessions/imp-7',
        'maria',
        'impersonation-start:imp-7',
      ),
    );
  });

  it('an end row: the end reason, stamped at the end; the same resource and target', () => {
    const plan = AuditSystem.planImpersonationEnded(
      ended(EndReasonFields.adminEnded(UserId.of('ivan'))),
      admin,
      OP,
    );
    expect(plan.row).toEqual({
      recordedAtUtcMs: ENDED_AT,
      resourceId: 'impersonationSessions/imp-7',
      auditOperationId: OP,
      actorRole: 'ADMIN',
      actorAdminUserId: 'ivan',
      auditAction: 'GOVERNANCE_IMPERSONATION_ENDED',
      impersonationSessionId: 'imp-7',
      impersonationScope: 'WRITE',
      impersonationExpiresAtUtcMs: EXPIRES_AT,
      impersonationEndReason: 'ADMIN_ENDED',
      auditTarget: 'USER',
      targetUserId: 'maria',
    });
    expect(plan.idBasis).toBe(
      AuditSystem.rowBasis(
        'GOVERNANCE_IMPERSONATION_ENDED',
        'impersonationSessions/imp-7',
        'maria',
        'impersonation-end:imp-7',
      ),
    );
    // The start and the end of one session are two rows, never one.
    expect(plan.idBasis).not.toBe(
      AuditSystem.planImpersonationStarted(active, admin, OP).idBasis,
    );
  });

  it('names the call’s operation, or none when the call sent none (RU-21)', () => {
    expect(
      AuditSystem.planImpersonationStarted(active, admin, null).row
        .auditOperationId,
    ).toBeNull();
    expect(
      AuditSystem.planImpersonationEnded(
        ended(EndReasonFields.expired()),
        admin,
        null,
      ).row.auditOperationId,
    ).toBeNull();
  });

  it('credits the sysadmin as STAFF with a role snapshot, never as the owner (RU-13)', () => {
    expect(
      AuditSystem.planImpersonationStarted(active, sysadmin, OP).row,
    ).toMatchObject({
      actorRole: 'STAFF',
      actorUserId: 'ops-1',
      actorRoles: ['sysadmin'],
    });
    expect(
      AuditSystem.planImpersonationStarted(active, admin, OP).row,
    ).toMatchObject({ actorRole: 'ADMIN', actorAdminUserId: 'ivan' });
  });

  it('writes only ADMIN_ENDED or EXPIRED — a revoked or a still-active session is a defect, never a row (RU-14)', () => {
    expect(
      AuditSystem.planImpersonationEnded(
        ended(EndReasonFields.expired()),
        admin,
        OP,
      ).row,
    ).toMatchObject({ impersonationEndReason: 'EXPIRED' });
    expect(() =>
      AuditSystem.planImpersonationEnded(
        ended(
          EndReasonFields.revokedBySecurity(
            UserId.of('sec-1'),
            'notes-QWERTY-free-text',
          ),
        ),
        admin,
        OP,
      ),
    ).toThrow(/defect/);
    expect(() => AuditSystem.planImpersonationEnded(active, admin, OP)).toThrow(
      /defect/,
    );
  });

  it('never carries the reason or revocation notes — no free text in a row (T5, R36)', () => {
    const rows = [
      AuditSystem.planImpersonationStarted(active, admin, OP).row,
      AuditSystem.planImpersonationEnded(
        ended(EndReasonFields.adminEnded(UserId.of('ivan'))),
        admin,
        OP,
      ).row,
    ];
    for (const row of rows) {
      const json = JSON.stringify(row);
      expect(json).not.toContain(SECRET);
      expect(Object.keys(row)).not.toContain('reason');
      expect(Object.keys(row)).not.toContain('revocationNotes');
    }
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const session = deepFreeze(ended(EndReasonFields.expired()));
    const actor = deepFreeze(sysadmin);
    const once = AuditSystem.planImpersonationEnded(session, actor, OP);
    expect(AuditSystem.planImpersonationEnded(session, actor, OP)).toEqual(
      once,
    );
    const start = deepFreeze({ ...active });
    expect(AuditSystem.planImpersonationStarted(start, actor, OP)).toEqual(
      AuditSystem.planImpersonationStarted(start, actor, OP),
    );
  });
});

describe('AuditSystem.backfillChangeKey — one returned backfill page, one logical change (pass C, P-27)', () => {
  const sysadmin = Actor.admin(UserId.of('ops-1'));
  const page = (
    overrides: Partial<BackfillCall.Page> = {},
  ): BackfillCall.Page => ({
    backfillJobName: BackfillJobName.ClientStats,
    cursor: 'a1',
    done: false,
    processed: 1,
    storedClients: 0,
    stamped: 1,
    recomputed: 2,
    total: 1,
    runStartedAtUtcMs: AT,
    startedFrom: null,
    sampleChecked: null,
    sampleMismatched: [],
    budgetSpent: true,
    ...overrides,
  });

  it('is the run, the stretch walked, its end and who walked it — carried over verbatim', () => {
    expect(AuditSystem.backfillChangeKey(page(), sysadmin)).toBe(
      JSON.stringify([
        'ops.backfill/v1',
        'CLIENT_STATS',
        AT,
        null,
        'a1',
        false,
        'ADMIN',
        'ops-1',
      ]),
    );
  });

  it('is the same for a replayed call — the counts of the page are not the change', () => {
    expect(
      AuditSystem.backfillChangeKey(
        page({ processed: 9, stamped: 0, budgetSpent: false }),
        sysadmin,
      ),
    ).toBe(AuditSystem.backfillChangeKey(page(), sysadmin));
  });

  it('separates every part: another job, run, start, cursor, end or person is another change', () => {
    const key = AuditSystem.backfillChangeKey(page(), sysadmin);
    for (const other of [
      page({ backfillJobName: BackfillJobName.SubjectMirror }),
      page({ runStartedAtUtcMs: at(AT + 1) }),
      page({ startedFrom: 'a0' }),
      page({ cursor: 'a2' }),
      page({ cursor: null, done: true }),
    ]) {
      expect(AuditSystem.backfillChangeKey(other, sysadmin)).not.toBe(key);
    }
    expect(
      AuditSystem.backfillChangeKey(page(), Actor.admin(UserId.of('ops-2'))),
    ).not.toBe(key);
    expect(
      AuditSystem.backfillChangeKey(
        page(),
        Actor.staff(UserId.of('ops-1'), [Role.Sysadmin]),
      ),
    ).not.toBe(key);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const frozen = deepFreeze(page());
    const actor = deepFreeze(sysadmin);
    expect(AuditSystem.backfillChangeKey(frozen, actor)).toBe(
      AuditSystem.backfillChangeKey(frozen, actor),
    );
  });
});

describe('AuditSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const facts = deepFreeze([
      fact({ subjects: [account('a'), guest, account('b')], changeKey: 'k' }),
    ]);
    const actor = deepFreeze(Actor.staff(UserId.of('s'), [Role.Barber]));
    const once = AuditSystem.plan(facts, actor, FIXTURE_NOW_UTC_MS);
    const twice = AuditSystem.plan(facts, actor, FIXTURE_NOW_UTC_MS);
    expect(twice).toEqual(once);
  });

  it('createsOf is pure: same input → same output, inputs untouched', () => {
    const plans = deepFreeze(
      unwrapOk(
        AuditSystem.plan(
          [fact({ subjects: [account('a'), account('b')] })],
          ivan,
          AT,
        ),
      ),
    );
    expect(AuditSystem.createsOf(plans, hashOf)).toEqual(
      AuditSystem.createsOf(plans, hashOf),
    );
  });

  it('commitWrites is pure: same input → same output, inputs untouched', () => {
    const facts = deepFreeze([fact({ subjects: [account('a'), guest] })]);
    const actor = deepFreeze(ivan);
    const once = AuditSystem.commitWrites(facts, actor, AT, hashOf);
    expect(AuditSystem.commitWrites(facts, actor, AT, hashOf)).toEqual(once);
    expect(AuditSystem.commitWrites(facts, null, AT, hashOf)).toEqual(
      AuditSystem.commitWrites(facts, null, AT, hashOf),
    );
  });
});

describe('AuditSystem.createsOf — each planned row a Create of the commit plan (WS-1)', () => {
  it('creates auditLog/<hash(idBasis)> with the row as its body, in plan order', () => {
    const plans = unwrapOk(
      AuditSystem.plan(
        [fact({ subjects: [account('maria'), account('stefan')] })],
        ivan,
        AT,
      ),
    );
    expect(AuditSystem.createsOf(plans, hashOf)).toEqual(
      plans.map((plan) => ({
        writeAction: 'CREATE',
        path: [Collections.AuditLog, AuditEntryId.of(hashOf(plan.idBasis))],
        body: plan.row,
      })),
    );
  });

  it('plans nothing for no rows', () => {
    expect(AuditSystem.createsOf([], hashOf)).toEqual([]);
  });
});

describe('AuditSystem.commitWrites — an act’s rows inside its own commit (WS-1)', () => {
  it('plans one Create per person per fact, under the derived ids', () => {
    const facts = [
      fact({ subjects: [account('maria'), guest, account('stefan')] }),
    ];
    const commit = AuditSystem.commitWrites(facts, ivan, AT, hashOf);
    expect(commit.unaudited).toEqual([]);
    expect(commit.writes).toEqual(
      AuditSystem.createsOf(
        unwrapOk(AuditSystem.plan(facts, ivan, AT)),
        hashOf,
      ),
    );
    expect(commit.writes).toHaveLength(2);
  });

  it('derives the same ids on a re-run of the decision — the same facts, actor and instant', () => {
    const facts = [fact()];
    expect(AuditSystem.commitWrites(facts, ivan, AT, hashOf).writes).toEqual(
      AuditSystem.commitWrites(facts, ivan, AT, hashOf).writes,
    );
  });

  it('plans no row without a verified actor — every fact comes back unaudited, the act still commits', () => {
    const facts = [fact(), fact({ changeKey: 'operation:other' })];
    expect(AuditSystem.commitWrites(facts, null, AT, hashOf)).toEqual({
      writes: [],
      unaudited: facts,
    });
  });

  it('plans nothing for no facts — an unchanged act, with or without an actor', () => {
    expect(AuditSystem.commitWrites([], ivan, AT, hashOf)).toEqual({
      writes: [],
      unaudited: [],
    });
    expect(AuditSystem.commitWrites([], null, AT, hashOf)).toEqual({
      writes: [],
      unaudited: [],
    });
  });

  it('treats a fact the planner refuses as a programmer defect — the verb sets are closed', () => {
    const blank = fact({
      context: { auditAction: '  ' as AuditAction } as AuditContext,
    });
    expect(() => AuditSystem.commitWrites([blank], ivan, AT, hashOf)).toThrow(
      /audit entry refused by domain/,
    );
  });
});

describe('AuditSystem.chronological — one operation’s rows, oldest first (WS-7)', () => {
  const OWNER = UserId.of('u-owner');
  const row = (id: string, recordedAtUtcMs: UtcEpochMs) => ({
    id: AuditEntryId.of(id),
    recordedAtUtcMs,
    resourceId: AuditResourceId.forUser(OWNER),
    auditOperationId: OP,
    ...Actor.user(OWNER),
    ...AuditContext.profile(AuditAction.ProfileUpdated, [
      RegistrationField.FirstName,
    ]),
    ...AuditTargetRef.user(OWNER),
  });
  const idsOf = (rows: readonly { readonly id: AuditEntryId }[]) =>
    rows.map((entry) => entry.id);

  it('reads the oldest instant first', () => {
    const rows = [
      row('c', at(3_000)),
      row('a', at(1_000)),
      row('b', at(2_000)),
    ];

    expect(idsOf(AuditSystem.chronological(rows))).toEqual(['a', 'b', 'c']);
  });

  it('orders rows sharing one instant by id, in code-unit order', () => {
    // 'Z' (U+005A) < 'a' (U+0061) < 'ä' (U+00E4): code units, never a locale.
    const rows = [
      row('ä', at(1_000)),
      row('a', at(1_000)),
      row('Z', at(1_000)),
      row('0', at(500)),
    ];

    expect(idsOf(AuditSystem.chronological(rows))).toEqual([
      '0',
      'Z',
      'a',
      'ä',
    ]);
  });

  it('answers an empty list for no rows, and the one row for one', () => {
    expect(AuditSystem.chronological([])).toEqual([]);
    expect(idsOf(AuditSystem.chronological([row('x', at(7))]))).toEqual(['x']);
  });

  it('is total: every arrival order of the same rows reads the same', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 4 }),
            atMs: fc.integer({ min: 0, max: 3 }),
          }),
          { selector: (entry) => entry.id, maxLength: 12 },
        ),
        (specs) => {
          const rows = specs.map((entry) => row(entry.id, at(entry.atMs)));
          const once = AuditSystem.chronological(rows);
          const reversed = AuditSystem.chronological([...rows].reverse());

          expect(reversed).toEqual(once);
          expect(once).toHaveLength(rows.length);
          let prev: (typeof once)[number] | null = null;
          for (const next of once) {
            if (prev !== null) {
              expect(
                prev.recordedAtUtcMs < next.recordedAtUtcMs ||
                  (prev.recordedAtUtcMs === next.recordedAtUtcMs &&
                    prev.id < next.id),
              ).toBe(true);
            }
            prev = next;
          }
        },
      ),
    );
  });

  it('is pure: same input → same output, input untouched, a copy answered', () => {
    const rows = deepFreeze([
      row('b', at(2_000)),
      row('a', at(2_000)),
      row('c', at(1_000)),
    ]);

    const once = AuditSystem.chronological(rows);
    const twice = AuditSystem.chronological(rows);

    expect(twice).toEqual(once);
    expect(once).not.toBe(rows);
    expect(idsOf(rows)).toEqual(['b', 'a', 'c']);
  });
});
