import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Actor, SystemSource } from '../components/actor.data';
import { AuditAction, AuditContext } from '../components/audit-context.data';
import { GovernanceErrorCode } from '../components/governance-errors.data';
import { Role } from '../components/role.data';
import { SeatLabel } from '../components/seat-label.data';
import {
  SeatId,
  SeatRelationship,
  SeatSubject,
  SeatSubjectKind,
} from '../components/seat.data';
import { BarberId } from '../entities/barber.entity';
import { ServiceId } from '../entities/service.entity';
import { UserId } from '../entities/user.entity';
import {
  FIXTURE_NOW_MS,
  appointmentFixture,
  deepFreeze,
  seatFixture,
  unwrapErr,
  unwrapOk,
} from '../testing';
import { EditCommandKind } from './appointment-edit.system';
import {
  type AuditFact,
  type AuditSubject,
  AuditRequestedSubjectKind,
  AuditSystem,
} from './audit.system';

/*
 * The pure cases of apps/functions/src/lib/booking/audit.spec.ts (targets,
 * the per-person plan, the people on a stored visit and on a requested cart,
 * the staff edit's people, the T5 context, the row id's basis), of
 * libs/domain/governance/src/lib/audit-entry.spec.ts and of
 * apps/functions/src/lib/booking/audit-profile-changes.spec.ts, copied. The
 * row id is `hash(rowBasis(…))` — the hash is the pipeline's, so the id
 * cases assert the BASIS: deterministic, and separating every part.
 */

const ivan = Actor.admin(UserId.of('dev-staff-ivan'));
const account = (uid: string): AuditSubject => ({
  kind: SeatSubjectKind.Account,
  userId: UserId.of(uid),
});
const guest: AuditSubject = { kind: SeatSubjectKind.Anonymous };
const AT_MS = Date.UTC(2026, 8, 25, 8, 0);

function fact(overrides: Partial<AuditFact> = {}): AuditFact {
  return {
    action: AuditAction.BookingStaffMove,
    resourceId: 'appt-1',
    subjects: [account('maria')],
    changeKey: null,
    context: AuditContext.staffEdit(AuditAction.BookingStaffMove, 3),
    ...overrides,
  };
}

describe('AuditSystem.targets', () => {
  it('names each account once, in seat order, and skips guests', () => {
    expect(
      AuditSystem.targets([
        account('maria'),
        guest,
        account('stefan'),
        account('maria'),
      ]),
    ).toEqual(['maria', 'stefan']);
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
            s.kind === SeatSubjectKind.Account ? [s.userId] : [],
          ),
        );
        expect(targets.length).toBe(Math.max(1, people.size));
        expect(new Set(targets).size).toBe(targets.length);
      }),
    );
  });
});

describe('AuditSystem.plan — one row per person', () => {
  it('writes one row per account on a party of two, each naming that person', () => {
    const rows = unwrapOk(
      AuditSystem.plan(
        [fact({ subjects: [account('maria'), account('stefan')] })],
        ivan,
        AT_MS,
      ),
    );
    expect(rows.map((r) => r.row.targetUserId)).toEqual(['maria', 'stefan']);
    for (const { row } of rows) {
      expect(row.actor).toEqual(ivan);
      expect(row.action).toBe('booking.staff_move');
      expect(row.resourceId).toBe('appt-1');
      expect(row.atMs).toBe(AT_MS);
      expect(row.context).toEqual({ kind: 'booking.staff_move', revision: 3 });
    }
  });

  it("gives a guest seat no row of its own — the booker's row covers the visit", () => {
    const rows = unwrapOk(
      AuditSystem.plan(
        [fact({ subjects: [account('maria'), guest] })],
        ivan,
        AT_MS,
      ),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.row.targetUserId).toBe('maria');
  });

  it('writes one untargeted row for a walk-in of guests', () => {
    const rows = unwrapOk(
      AuditSystem.plan([fact({ subjects: [guest] })], ivan, AT_MS),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.row.targetUserId).toBeNull();
  });

  it('refuses through the domain rather than writing a half-formed row', () => {
    const blank = fact({ action: '  ' as AuditAction });
    expect(unwrapErr(AuditSystem.plan([fact(), blank], ivan, AT_MS))).toEqual({
      code: GovernanceErrorCode.AuditEntryEmptyAction,
    });
  });

  it('bases each row id on its change, once a change key is given — and leaves it to the pipeline without one', () => {
    const subjects = [account('maria'), account('stefan')];
    const keyed = unwrapOk(
      AuditSystem.plan(
        [fact({ subjects, changeKey: 'revision:4' })],
        ivan,
        AT_MS,
      ),
    );
    expect(keyed.map((r) => r.idBasis)).toEqual([
      AuditSystem.rowBasis(
        'booking.staff_move',
        'appt-1',
        'maria',
        'revision:4',
      ),
      AuditSystem.rowBasis(
        'booking.staff_move',
        'appt-1',
        'stefan',
        'revision:4',
      ),
    ]);
    const random = unwrapOk(
      AuditSystem.plan([fact({ subjects })], ivan, AT_MS),
    );
    expect(random.map((r) => r.idBasis)).toEqual([null, null]);
  });

  it('carries the targets and the instant from the governance entry: null target when none, the context as given', () => {
    const rows = unwrapOk(
      AuditSystem.plan(
        [
          fact({
            action: AuditAction.BookingStaffArrived,
            subjects: [],
            context: AuditContext.arrival(AuditAction.BookingStaffArrived),
          }),
        ],
        Actor.system(SystemSource.Fixture),
        AT_MS,
      ),
    );
    expect(rows[0]?.row).toEqual({
      actor: { kind: 'system', source: 'fixture' },
      action: 'booking.staff_arrived',
      atMs: AT_MS,
      targetUserId: null,
      resourceId: 'appt-1',
      context: { kind: 'booking.staff_arrived' },
    });
  });
});

describe('AuditSystem.subjectsOfSeats — the people on a stored visit', () => {
  const visit = appointmentFixture({
    ownerUserId: UserId.of('maria'),
    seats: [
      seatFixture({
        id: SeatId.of('s1'),
        subject: SeatSubject.account(UserId.of('maria'), SeatRelationship.Self),
      }),
      seatFixture({
        id: SeatId.of('s2'),
        subject: SeatSubject.anonymous(unwrapOk(SeatLabel.parse('Синът'))),
      }),
      seatFixture({
        id: SeatId.of('s3'),
        subject: SeatSubject.account(
          UserId.of('stefan'),
          SeatRelationship.Companion,
        ),
      }),
    ],
  });

  it('reads every seat: accounts by uid, guests as anonymous', () => {
    expect(AuditSystem.subjectsOf(visit)).toEqual([
      account('maria'),
      guest,
      account('stefan'),
    ]);
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

describe('AuditSystem.requestedSubjects — the people on a requested cart', () => {
  const self = { kind: AuditRequestedSubjectKind.Self, userId: null };
  const son = { kind: AuditRequestedSubjectKind.Guest, userId: null };

  it('binds every self seat to the owner and every guest to nobody', () => {
    expect(
      AuditSystem.requestedSubjects([self, son], UserId.of('maria')),
    ).toEqual([account('maria'), guest]);
  });

  it('names a carried companion by their own account', () => {
    expect(
      AuditSystem.requestedSubjects(
        [
          self,
          {
            kind: AuditRequestedSubjectKind.Companion,
            userId: UserId.of('son'),
          },
        ],
        UserId.of('maria'),
      ),
    ).toEqual([account('maria'), account('son')]);
  });

  it('names nobody on an owner-less walk-in', () => {
    expect(AuditSystem.requestedSubjects([self], null)).toEqual([guest]);
  });
});

describe('AuditSystem.staffEditSubjects', () => {
  it('keeps everyone the visit had before the edit — a removed seat included', () => {
    expect(
      AuditSystem.staffEditSubjects(
        [account('maria'), account('stefan')],
        UserId.of('maria'),
        [{ kind: EditCommandKind.RemoveSeat, seatId: SeatId.of('s3') }],
      ),
    ).toEqual([account('maria'), account('stefan')]);
  });

  it('adds the owner when an addSeat gives them a seat', () => {
    expect(
      AuditSystem.staffEditSubjects([guest], UserId.of('maria'), [
        {
          kind: EditCommandKind.AddSeat,
          seatId: SeatId.of('new'),
          serviceId: ServiceId.of('svc'),
          variantId: null,
          barberId: BarberId.of('b'),
          startMs: AT_MS,
          minutes: 30,
          subject: SeatSubject.account(
            UserId.of('maria'),
            SeatRelationship.Self,
          ),
        },
      ]),
    ).toEqual([guest, account('maria')]);
  });
});

describe('audit context carries codes, never free text (T5)', () => {
  it("records a staff cancellation's reason code and the seat — there is no note to drop", () => {
    const context = AuditContext.transition(
      AuditAction.BookingStaffCancelled,
      'other',
      's1',
    );
    expect(context).toEqual({
      kind: 'booking.staff_cancelled',
      reason: 'other',
      seatId: 's1',
    });
  });

  it('records nothing when there is nothing to record', () => {
    expect(
      AuditContext.transition(AuditAction.BookingStaffCompleted, null, null),
    ).toEqual({ kind: 'booking.staff_completed', reason: null, seatId: null });
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
        'audit-row/v1',
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
            'audit-row/v1',
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

  it('a retried attempt derives the same key, verb by verb — no per-attempt instant the verb does not carry', () => {
    const keys = AuditSystem.changeKey;
    expect(keys.attempt('abc', 'appt-1')).toBe('attempt:abc');
    expect(keys.attempt(null, 'appt-1')).toBe('attempt:appt-1');
    expect(keys.move('m1')).toBe('move:m1');
    expect(keys.revision(4)).toBe('revision:4');
    expect(keys.staffEdit('op-1', 4)).toBe('operation:op-1');
    expect(keys.staffEdit(null, 4)).toBe('revision:4');
    expect(keys.cancelled(123)).toBe('cancelled:123');
    expect(keys.transition('s1', 9)).toBe('transition:s1:9');
    expect(keys.transition(null, 9)).toBe('transition:party:9');
    expect(keys.arrived(5)).toBe('arrived:5');
    expect(keys.unarrived(5)).toBe('unarrived:5');
    expect(keys.tip('s1', 7)).toBe('tip:s1:7');
    expect(keys.publish('req-1')).toBe('req-1');
    expect(keys.profile('evt-1')).toBe('evt-1');
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
        { roles: ['client'], status: { kind: 'active' }, searchName: 'a' },
        { roles: ['barber'], status: { kind: 'blocked' }, searchName: 'b' },
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
              eventId: 'evt-1',
              eventAtMs: AT_MS,
              ownerUserId: UserId.of('maria'),
              writer: Actor.user(UserId.of('maria')),
              beforeExists: true,
              afterExists: true,
              fields,
            },
            AT_MS,
          ),
        );
        if (fields.length === 0) {
          expect(plan).toBeNull();
          return;
        }
        expect(plan?.row.context).toEqual({
          kind: 'profile.updated',
          fields,
        });
        for (const name of fields) expect(FIELDS).toContain(name);
      }),
    );
  });
});

describe('AuditSystem.profileAction', () => {
  it('names creation, update and deletion apart', () => {
    expect(AuditSystem.profileAction(false, true)).toBe('profile.created');
    expect(AuditSystem.profileAction(true, true)).toBe('profile.updated');
    expect(AuditSystem.profileAction(true, false)).toBe('profile.deleted');
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
  const change = {
    eventId: 'evt-1f2e',
    eventAtMs: Date.parse('2026-09-25T08:00:00.123Z'),
    ownerUserId: UserId.of('maria'),
    writer: Actor.system(SystemSource.AdminSdk),
    beforeExists: true,
    afterExists: true,
    fields: ['firstName', 'lastName'],
  };

  it('keys the row by the event id, so a redelivery lands on the same document', () => {
    const plan = unwrapOk(AuditSystem.planProfileChange(change, AT_MS));
    expect(plan?.idBasis).toBe(
      AuditSystem.rowBasis(
        'profile.updated',
        'users/maria',
        'maria',
        'evt-1f2e',
      ),
    );
    expect(
      unwrapOk(AuditSystem.planProfileChange({ ...change }, AT_MS + 1))
        ?.idBasis,
    ).toBe(plan?.idBasis);
  });

  it('names the profile owner as the target and the fields as the only context', () => {
    const plan = unwrapOk(AuditSystem.planProfileChange(change, AT_MS));
    expect(plan?.row.targetUserId).toBe('maria');
    expect(plan?.row.resourceId).toBe('users/maria');
    expect(plan?.row.context).toEqual({
      kind: 'profile.updated',
      fields: ['firstName', 'lastName'],
    });
    expect(plan?.row.actor).toEqual({ kind: 'system', source: 'admin_sdk' });
  });

  it("stamps the event's own instant, not the delivery's", () => {
    const plan = unwrapOk(AuditSystem.planProfileChange(change, AT_MS));
    expect(plan?.row.atMs).toBe(Date.parse('2026-09-25T08:00:00.123Z'));
    const unparsed = unwrapOk(
      AuditSystem.planProfileChange({ ...change, eventAtMs: null }, AT_MS),
    );
    expect(unparsed?.row.atMs).toBe(AT_MS);
  });

  it('refuses an event with no id rather than minting one', () => {
    expect(
      AuditSystem.planProfileChange({ ...change, eventId: '' }, AT_MS).ok,
    ).toBe(false);
  });
});

describe('AuditSystem — purity', () => {
  it('is pure: same input → same output, inputs untouched', () => {
    const facts = deepFreeze([
      fact({ subjects: [account('a'), guest, account('b')], changeKey: 'k' }),
    ]);
    const actor = deepFreeze(Actor.staff(UserId.of('s'), [Role.Barber]));
    const once = AuditSystem.plan(facts, actor, FIXTURE_NOW_MS);
    const twice = AuditSystem.plan(facts, actor, FIXTURE_NOW_MS);
    expect(twice).toEqual(once);
  });
});
