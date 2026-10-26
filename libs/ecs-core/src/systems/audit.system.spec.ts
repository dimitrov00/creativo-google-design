import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  Actor,
  type BackfillCall,
  BackfillJobName,
  SystemSource,
  AuditAction,
  AuditContext,
  AuditTarget,
  AuditTargetRef,
  RegistrationField,
  Role,
  SeatLabel,
  SeatOccupant,
  SeatSubject,
  SubjectRelationship,
  EditCommand,
} from '@core/components';
import {
  DurationMinutes,
  AppointmentId,
  AuditEntryId,
  AuditResourceId,
  BarberId,
  ClientOperationId,
  CustomerId,
  OperationId,
  PublishRequestId,
  SeatId,
  ServiceId,
  TriggerEventId,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { GovernanceErrorCode } from '@core/errors';
import { Collections } from '@core/entities';
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
import { type AuditFact, type AuditSubject, AuditSystem } from './audit.system';

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
    context: AuditContext.staffEdit(AuditAction.BookingStaffMove, 3),
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
    );
    expect(context).toEqual({
      auditAction: 'BOOKING_STAFF_CANCELLED',
      transitionReason: 'OTHER',
      transitionSeatId: 's1',
    });
  });

  it('records nothing when there is nothing to record', () => {
    expect(
      AuditContext.transition(AuditAction.BookingStaffCompleted, null, null),
    ).toEqual({
      auditAction: 'BOOKING_STAFF_COMPLETED',
      transitionReason: null,
      transitionSeatId: null,
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
  });
});

/* ── The profile trigger (audit-profile-changes.ts) ──────────────────── */

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

  it('ignores fields other writers own — roles and status are audited by their callables', () => {
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
        // …set over by a registered, blocked body: no audited field among them.
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
    ).toEqual([]);
  });

  it('never lets a value into the row context, whatever the profile held', () => {
    const FIELDS = ['firstName', 'lastName', 'phone', 'email', 'birthDate'];
    const value = fc.oneof(
      fc.constant(undefined),
      fc.constant(null),
      fc.string({ minLength: 1, maxLength: 12 }),
    );
    const profile = fc.record(
      Object.fromEntries(FIELDS.map((f) => [f, value])),
    );
    fc.assert(
      fc.property(profile, profile, (before, after) => {
        const fields = AuditSystem.changedProfileFields(before, after);
        const plan = unwrapOk(
          AuditSystem.planProfileChange(
            {
              eventId: TriggerEventId.of('evt-1'),
              eventAtUtcMs: AT,
              ownerUserId: UserId.of('maria'),
              writer: Actor.user(UserId.of('maria')),
              beforeExists: true,
              afterExists: true,
              fields,
              beforeProfileEditedAtUtcMs: null,
              afterProfileEditedAtUtcMs: null,
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
        for (const name of fields) expect(FIELDS).toContain(name);
      }),
    );
  });
});

describe('AuditSystem.profileAction', () => {
  it('names creation, update and deletion apart', () => {
    expect(AuditSystem.profileAction(false, true)).toBe('PROFILE_CREATED');
    expect(AuditSystem.profileAction(true, true)).toBe('PROFILE_UPDATED');
    expect(AuditSystem.profileAction(true, false)).toBe('PROFILE_DELETED');
  });
});

describe('AuditSystem.profileWriter — who wrote it, from the auth context', () => {
  it('credits the end user a client-SDK write came from', () => {
    expect(AuditSystem.profileWriter('api_key', 'maria-uid')).toEqual(
      Actor.user(UserId.of('maria-uid')),
    );
  });

  it('credits the uid, not the profile owner, when somebody else wrote it', () => {
    expect(AuditSystem.profileWriter('api_key', 'someone-else')).toEqual(
      Actor.user(UserId.of('someone-else')),
    );
  });

  it('attributes an Admin SDK write to the process, whatever the id says', () => {
    expect(
      AuditSystem.profileWriter(
        'service_account',
        'fn@project.iam.gserviceaccount.com',
      ),
    ).toEqual(Actor.system(SystemSource.AdminSdk));
    // The tag itself reads the same as the platform's lower-case spelling.
    expect(AuditSystem.profileWriter('SERVICE_ACCOUNT', null)).toEqual(
      Actor.system(SystemSource.AdminSdk),
    );
  });

  it('attributes a platform write to the platform', () => {
    expect(AuditSystem.profileWriter('system', null)).toEqual(
      Actor.system(SystemSource.FirestoreSystem),
    );
  });

  it('does not guess when the id is missing or not a uid (the emulator reports a fake e-mail)', () => {
    expect(
      AuditSystem.profileWriter('unknown', 'fake-auth-id@gmail.com'),
    ).toEqual(Actor.system(SystemSource.UnattributedUnknown));
    expect(AuditSystem.profileWriter('api_key', null)).toEqual(
      Actor.system(SystemSource.UnattributedApiKey),
    );
    expect(AuditSystem.profileWriter('unauthenticated', null)).toEqual(
      Actor.system(SystemSource.UnattributedUnauthenticated),
    );
    expect(AuditSystem.profileWriter('something_new', '')).toEqual(
      Actor.system(SystemSource.UnattributedUnknown),
    );
  });
});

describe('AuditSystem.planProfileChange — one row per event', () => {
  const EVENT_AT = utcMs('2026-09-25T08:00:00.123Z');
  const change = {
    eventId: TriggerEventId.of('evt-1f2e'),
    eventAtUtcMs: EVENT_AT,
    ownerUserId: UserId.of('maria'),
    writer: Actor.system(SystemSource.AdminSdk),
    beforeExists: true,
    afterExists: true,
    fields: [RegistrationField.FirstName, RegistrationField.LastName],
    beforeProfileEditedAtUtcMs: null,
    afterProfileEditedAtUtcMs: null,
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
