import { Actor, SystemSource } from '../components/actor.data';
import {
  type AuditAction,
  AuditContext,
  type ProfileAction,
  AuditAction as AuditActions,
} from '../components/audit-context.data';
import { GovernanceError } from '../components/governance-errors.data';
import { Result } from '../components/result.data';
import {
  type Seat,
  type SeatId,
  SeatRelationship,
  SeatSubjectKind,
} from '../components/seat.data';
import type { AppointmentEntity } from '../entities/appointment.entity';
import type { AuditEntryEntity } from '../entities/audit-entry.entity';
import { UserId } from '../entities/user.entity';
import { type EditCommand, EditCommandKind } from './appointment-edit.system';

/**
 * A seat's person as the audit log sees them (`audit.ts:19-25`): an account
 * gets a row of its own, a guest does not — a label typed at the desk is not
 * somebody a per-client history can ever be asked about. The tags are the
 * seat subject's own (`SeatSubjectKind`).
 */
export type AuditSubject = AuditAccountSubject | AuditAnonymousSubject;

export type AuditAccountSubject = {
  readonly kind: typeof SeatSubjectKind.Account;
  readonly userId: UserId;
};

export type AuditAnonymousSubject = {
  readonly kind: typeof SeatSubjectKind.Anonymous;
};

const ANONYMOUS: AuditAnonymousSubject = { kind: SeatSubjectKind.Anonymous };

/**
 * One audited act, before it fans out to rows — the input of
 * {@link AuditSystem.plan}, and what every lifecycle and edit system hands
 * its pipeline (`AppointmentLifecycleSystem`'s `auditFacts`). Ids and CODES
 * only (T5, R36): never a sentence somebody typed.
 *
 * `changeKey` is what makes the act ONE logical change — the same on every
 * replay, different for every other change (the companion derivations of
 * {@link AuditSystem.changeKey}). `null` is a caller with no replay to
 * recognise: each row gets a fresh id from the pipeline's `nextId`.
 */
export type AuditFact = {
  readonly action: AuditAction;
  readonly resourceId: string;
  /** The seats the act touched, guests included; the plan picks the people. */
  readonly subjects: readonly AuditSubject[];
  readonly changeKey: string | null;
  readonly context: AuditContext;
};

/**
 * One planned row and the basis of its id: the pipeline sets
 * `id = hash(idBasis)` and writes it with `create()`, so a retried attempt
 * derives the same id and never writes twice; `null` is a fact without a
 * change key, whose id the pipeline mints (`nextId`).
 */
export type AuditRowPlan = {
  readonly row: Omit<AuditEntryEntity, 'id'>;
  readonly idBasis: string | null;
};

/**
 * Who a REQUESTED seat is for — the cart a commit or a move decides
 * (`decide-booking.ts` `RequestedSeat['subject']`): the booker's own seat,
 * an anonymous guest, or a carried companion with their own account.
 */
export const AuditRequestedSubjectKind = {
  Self: 'self',
  Guest: 'guest',
  Companion: 'companion',
} as const;
export type AuditRequestedSubjectKind =
  (typeof AuditRequestedSubjectKind)[keyof typeof AuditRequestedSubjectKind];

/** A requested seat's subject, every field present (`userId` only for a companion). */
export type AuditRequestedSubject = {
  readonly kind: AuditRequestedSubjectKind;
  readonly userId: UserId | null;
};

/**
 * The Firestore trigger's `authType` — who the platform says wrote a
 * document (`audit-profile-changes.ts`). The ONLY source of these strings;
 * any other value is a writer the event cannot attribute.
 */
export const ProfileAuthType = {
  ServiceAccount: 'service_account',
  System: 'system',
  ApiKey: 'api_key',
  Unauthenticated: 'unauthenticated',
} as const;
export type ProfileAuthType =
  (typeof ProfileAuthType)[keyof typeof ProfileAuthType];

/**
 * A `users/{uid}` write, as the profile trigger sees it
 * (`audit-profile-changes.ts:108-126`): the delivery's event id (the row id
 * outright — a redelivery derives the same row), the event's own instant,
 * whose profile, who wrote it and which audited fields changed.
 */
export type ProfileChange = {
  readonly eventId: string;
  /** The event's instant; `null` when it did not parse — the plan's `nowMs` stands in. */
  readonly eventAtMs: number | null;
  readonly ownerUserId: UserId;
  readonly writer: Actor;
  readonly beforeExists: boolean;
  readonly afterExists: boolean;
  readonly fields: readonly string[];
};

/**
 * The profile fields whose change is worth a row (`AUDITED_PROFILE_FIELDS`).
 * `roles` and `status` are absent on purpose: their writers audit
 * themselves, inside their own transactions.
 */
const AUDITED_PROFILE_FIELDS: readonly string[] = [
  'firstName',
  'lastName',
  'phone',
  'email',
  'birthDate',
];

/** A Firebase uid as this app mints and accepts them (the commit path's shape). */
const UID_SHAPE = /^[A-Za-z0-9_-]{1,128}$/;

/** The id basis version — a later derivation never collides with a `v1` row. */
const ROW_BASIS_TAG = 'audit-row/v1';

/** Absent, `null` and `''` are one fact — "no value" — however a writer spelled it. */
function comparable(value: unknown): string {
  return value === undefined || value === null || value === ''
    ? ''
    : JSON.stringify(value);
}

function rowBasis(
  action: string,
  resourceId: string,
  targetUserId: string | null,
  changeKey: string,
): string {
  return JSON.stringify([
    ROW_BASIS_TAG,
    action,
    resourceId,
    targetUserId,
    changeKey,
  ]);
}

/**
 * Who gets a row: each distinct account among the subjects, in seat order —
 * a client with two services on one visit is one person, not two rows. An
 * act that touched no account still happened, so it keeps ONE untargeted row.
 */
function targets(
  subjects: readonly AuditSubject[],
): readonly (UserId | null)[] {
  const people: UserId[] = [];
  for (let i = 0; i < subjects.length; i++) {
    const subject = subjects[i] as AuditSubject;
    if (subject.kind !== SeatSubjectKind.Account) continue;
    if (subject.userId.length === 0 || people.includes(subject.userId)) {
      continue;
    }
    people.push(subject.userId);
  }
  return people.length > 0 ? people : [null];
}

/**
 * The audit log's pure half (`audit.ts:65-178`, `audit-profile-changes.ts`):
 * who gets a row, what each row says, and the basis each row's id is hashed
 * from. No `crypto` here — the pipeline calls `hash(idBasis)`; no clock —
 * `nowMs` is a parameter; no I/O — the rows go to `AppendAudit`.
 */
export const AuditSystem = {
  /**
   * The basis of one person's row id for one logical change — today's
   * `auditEntryIdFor` minus the SHA-256: `JSON.stringify(['audit-row/v1',
   * action, resourceId, targetUserId, changeKey])`. The JSON array keeps the
   * parts unambiguous (`("a:b","c")` and `("a","b:c")` never collide).
   */
  rowBasis,

  targets,

  /**
   * The rows the facts write, one per person per fact: every row of one fact
   * shares the actor, action, instant and context; only the target differs —
   * which is what makes "everything done to Maria" one `targetUserId` query.
   * A fact whose action is not an audited verb is refused whole rather than
   * written half-formed (`AuditEntry.create`'s empty-action guard).
   */
  plan(
    facts: readonly AuditFact[],
    actor: Actor,
    nowMs: number,
  ): Result<readonly AuditRowPlan[], GovernanceError.AuditEntryEmptyAction> {
    const rows: AuditRowPlan[] = [];
    for (let i = 0; i < facts.length; i++) {
      const fact = facts[i] as AuditFact;
      if (!AuditContext.isAuditAction(fact.action)) {
        return Result.err(GovernanceError.auditEntryEmptyAction());
      }
      const people = targets(fact.subjects);
      for (let k = 0; k < people.length; k++) {
        const target = people[k] as UserId | null;
        rows.push({
          row: {
            actor,
            action: fact.action,
            atMs: nowMs,
            targetUserId: target,
            resourceId: fact.resourceId,
            context: fact.context,
          },
          idBasis:
            fact.changeKey === null
              ? null
              : rowBasis(fact.action, fact.resourceId, target, fact.changeKey),
        });
      }
    }
    return Result.ok(rows);
  },

  /**
   * The people on a visit's seats — accounts by uid, guests as anonymous —
   * narrowed to ONE seat for a per-seat act (a companion's no-show is
   * theirs, not the booker's). `null` is every seat.
   */
  subjectsOfSeats(
    seats: readonly Seat[],
    seatId: SeatId | null,
  ): readonly AuditSubject[] {
    const subjects: AuditSubject[] = [];
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i] as Seat;
      if (seatId !== null && seat.id !== seatId) continue;
      const subject = seat.subject;
      subjects.push(
        subject.kind === SeatSubjectKind.Account
          ? { kind: SeatSubjectKind.Account, userId: subject.userId }
          : ANONYMOUS,
      );
    }
    return subjects;
  },

  /** Every person on a stored visit — {@link subjectsOfSeats} over all of its seats. */
  subjectsOf(appointment: AppointmentEntity): readonly AuditSubject[] {
    return AuditSystem.subjectsOfSeats(appointment.seats, null);
  },

  /**
   * The people on a REQUESTED cart: every `self` seat binds to the owner,
   * a carried companion keeps their own account, every guest is anonymous —
   * and a `self` seat on an owner-less walk-in names nobody.
   */
  requestedSubjects(
    subjects: readonly AuditRequestedSubject[],
    ownerUserId: UserId | null,
  ): readonly AuditSubject[] {
    const out: AuditSubject[] = [];
    for (let i = 0; i < subjects.length; i++) {
      const subject = subjects[i] as AuditRequestedSubject;
      if (
        subject.kind === AuditRequestedSubjectKind.Companion &&
        subject.userId !== null
      ) {
        out.push({ kind: SeatSubjectKind.Account, userId: subject.userId });
      } else if (
        subject.kind === AuditRequestedSubjectKind.Self &&
        ownerUserId !== null &&
        ownerUserId.length > 0
      ) {
        out.push({ kind: SeatSubjectKind.Account, userId: ownerUserId });
      } else {
        out.push(ANONYMOUS);
      }
    }
    return out;
  },

  /**
   * Who a staff edit's rows name (`staffEditSubjects`): everyone the visit
   * had BEFORE the edit — a removed seat's person included, the edit was
   * done to them too — plus the owner when the batch gives them a seat of
   * their own (an added `self` seat). Nobody else can join through an edit.
   */
  staffEditSubjects(
    before: readonly AuditSubject[],
    ownerUserId: UserId | null,
    commands: readonly EditCommand[],
  ): readonly AuditSubject[] {
    let addsOwner = false;
    for (let i = 0; i < commands.length && !addsOwner; i++) {
      const command = commands[i] as EditCommand;
      addsOwner =
        command.kind === EditCommandKind.AddSeat &&
        command.subject.kind === SeatSubjectKind.Account &&
        command.subject.relationship === SeatRelationship.Self;
    }
    return addsOwner && ownerUserId !== null && ownerUserId.length > 0
      ? [...before, { kind: SeatSubjectKind.Account, userId: ownerUserId }]
      : before;
  },

  /**
   * Each verb's change key, carried over VERBATIM — one per verb, so a
   * retried attempt yields the same row ids and a different change never
   * does. None of them includes a per-attempt instant the verb's own key
   * does not already carry.
   */
  changeKey: {
    /** A commit (`commit-booking.ts:222`): the attempt id, else the appointment's. */
    attempt(attemptId: string | null, appointmentId: string): string {
      return `attempt:${attemptId ?? appointmentId}`;
    },
    /** A named move (`reschedule-appointment.ts:109`). */
    move(attemptId: string): string {
      return `move:${attemptId}`;
    },
    /** An unnamed move or edit: the revision its transaction stamped. */
    revision(revision: number): string {
      return `revision:${revision}`;
    },
    /** A staff edit (`staffEditChangeKey`): its operation id, else its revision. */
    staffEdit(operationId: string | null, revision: number): string {
      return operationId === null
        ? `revision:${revision}`
        : `operation:${operationId}`;
    },
    /** A client cancel (`cancel-appointment.ts:234`): the instant it stamped. */
    cancelled(cancelledAtMs: number): string {
      return `cancelled:${cancelledAtMs}`;
    },
    /**
     * A staff lifecycle verb (`transition-appointment.ts:517`) — the seat is
     * in the key because one person can hold two seats.
     */
    transition(seatId: string | null, decidedAtMs: number): string {
      return `transition:${seatId !== null && seatId.length > 0 ? seatId : 'party'}:${decidedAtMs}`;
    },
    /** An arrival stamped (`mark-arrived.ts:118`). */
    arrived(stampMs: number): string {
      return `arrived:${stampMs}`;
    },
    /** An arrival taken back (`clear-arrival.ts:88`): the stamp it cleared. */
    unarrived(clearedStampMs: number): string {
      return `unarrived:${clearedStampMs}`;
    },
    /** A tip recorded or cleared (`record-seat-tip.ts:155`). */
    tip(seatId: string, recordedAtMs: number): string {
      return `tip:${seatId}:${recordedAtMs}`;
    },
    /** A streak publish or withdraw: the client's request id. */
    publish(requestId: string): string {
      return requestId;
    },
    /** The profile trigger: the CloudEvent id — never a constant. */
    profile(eventId: string): string {
      return eventId;
    },
  },

  /**
   * The audited fields whose value changed, in a fixed order — NAMES only:
   * the row says THAT the phone changed, never from what to what (R36).
   */
  changedProfileFields(
    before: Readonly<Record<string, unknown>>,
    after: Readonly<Record<string, unknown>>,
  ): readonly string[] {
    const changed: string[] = [];
    for (let i = 0; i < AUDITED_PROFILE_FIELDS.length; i++) {
      const field = AUDITED_PROFILE_FIELDS[i] as string;
      if (comparable(before[field]) !== comparable(after[field])) {
        changed.push(field);
      }
    }
    return changed;
  },

  /** Creation, update and deletion, named apart. */
  profileAction(beforeExists: boolean, afterExists: boolean): ProfileAction {
    if (!beforeExists) return AuditActions.ProfileCreated;
    return afterExists
      ? AuditActions.ProfileUpdated
      : AuditActions.ProfileDeleted;
  },

  /**
   * WHO wrote a profile, from the event's auth context: the Admin SDK and the
   * platform are processes; anything else is an end user, credited by a
   * uid-shaped id — an id that is not one is never guessed at: the row says
   * it could not tell.
   */
  profileWriter(authType: string, authId: string | null): Actor {
    if (authType === ProfileAuthType.ServiceAccount) {
      return Actor.system(SystemSource.AdminSdk);
    }
    if (authType === ProfileAuthType.System) {
      return Actor.system(SystemSource.FirestoreSystem);
    }
    if (authId !== null && UID_SHAPE.test(authId)) {
      return Actor.user(UserId.of(authId));
    }
    switch (authType) {
      case ProfileAuthType.ApiKey:
        return Actor.system(SystemSource.UnattributedApiKey);
      case ProfileAuthType.Unauthenticated:
        return Actor.system(SystemSource.UnattributedUnauthenticated);
      default:
        return Actor.system(SystemSource.UnattributedUnknown);
    }
  },

  /**
   * The ONE row a profile write produces — targeted at the profile's owner,
   * the changed field names its only context, stamped with the event's own
   * instant. Its id basis IS the event id (`changeKey = event.id`): a
   * redelivery derives the same row, each distinct write its own. A write
   * that changed no audited field plans nothing; an event with no id is
   * refused rather than minted one (`empty_action` is the governance code
   * for a half-formed row).
   */
  planProfileChange(
    change: ProfileChange,
    nowMs: number,
  ): Result<AuditRowPlan | null, GovernanceError.AuditEntryEmptyAction> {
    if (change.fields.length === 0) return Result.ok(null);
    if (change.eventId.trim().length === 0) {
      return Result.err(GovernanceError.auditEntryEmptyAction());
    }
    const action = AuditSystem.profileAction(
      change.beforeExists,
      change.afterExists,
    );
    const resourceId = `users/${change.ownerUserId}`;
    return Result.ok({
      row: {
        actor: change.writer,
        action,
        atMs: change.eventAtMs ?? nowMs,
        targetUserId: change.ownerUserId,
        resourceId,
        context: AuditContext.profile(action, change.fields),
      },
      idBasis: rowBasis(
        action,
        resourceId,
        change.ownerUserId,
        AuditSystem.changeKey.profile(change.eventId),
      ),
    });
  },
} as const;
