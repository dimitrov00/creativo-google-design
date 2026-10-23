import {
  Actor,
  SystemSource,
  AuditAction,
  AuditContext,
  AuditTargetRef,
  type ProfileAction,
  type Seat,
  SeatSubject,
  SubjectRelationship,
  EditCommand,
  RequestedSubjectRole,
} from '@core/components';
import {
  Result,
  type AppointmentId,
  AuditResourceId,
  type CustomerId,
  type OperationId,
  type PublishRequestId,
  type SeatId,
  type TriggerEventId,
  UserId,
  type UtcEpochMs,
} from '@core/primitives';
import { GovernanceError } from '@core/errors';
import type { Appointment, AuditEntryMeta } from '@core/entities';
import { type EditCommandRequest } from './appointment-edit.system';

/**
 * A seat's person as the audit log sees them (`audit.ts:19-25`): a client
 * with a record gets a row of its own, targeted at that RECORD (D29: a
 * booking act is done to whom the shop serves — `AuditTargetRef.Customer`,
 * flip (1)); a guest does not — a label typed at the desk is not somebody a
 * per-client history can ever be asked about. Discriminated by the seat's
 * own `seatSubject`.
 */
export type AuditSubject = AuditAccountSubject | AuditAnonymousSubject;

export type AuditAccountSubject = {
  readonly seatSubject: typeof SeatSubject.Account;
  /** The seat's client record — the row's `targetCustomerId`. */
  readonly customerId: CustomerId;
};

export type AuditAnonymousSubject = {
  readonly seatSubject: typeof SeatSubject.Anonymous;
};

const ANONYMOUS: AuditAnonymousSubject = {
  seatSubject: SeatSubject.Anonymous,
};

function account(customerId: CustomerId): AuditAccountSubject {
  return { seatSubject: SeatSubject.Account, customerId };
}

/**
 * One audited act, before it fans out to rows — the input of
 * {@link AuditSystem.plan}, and what every lifecycle and edit system hands
 * its pipeline (`AppointmentLifecycleSystem`'s `auditFacts`). Ids and CODES
 * only (T5, R36): never a sentence somebody typed. The verb is the context's
 * own discriminator (`context.auditAction`) — one source, never repeated.
 *
 * `changeKey` is what makes the act ONE logical change — the same on every
 * replay, different for every other change (the companion derivations of
 * {@link AuditSystem.changeKey}). `null` is a caller with no replay to
 * recognise: each row gets a fresh id from the pipeline's `nextId`.
 */
export type AuditFact = {
  readonly resourceId: AuditResourceId;
  /** The seats the act touched, guests included; the plan picks the people. */
  readonly subjects: readonly AuditSubject[];
  readonly changeKey: string | null;
  readonly context: AuditContext;
};

/**
 * One planned audit row — the `AuditEntry` archetype minus its `id`
 * (`Omit<AuditEntry, 'id'>`, distributed over every variant): the instant and
 * the resource, the flat actor slice, the flat context slice and the target
 * slice.
 */
export type AuditRow = Omit<AuditEntryMeta, 'id'> &
  Actor &
  AuditContext &
  AuditTargetRef;

/**
 * One planned row and the basis of its id: the pipeline sets
 * `id = hash(idBasis)` and writes it with `create()`, so a retried attempt
 * derives the same id and never writes twice; `null` is a fact without a
 * change key, whose id the pipeline mints (`nextId`).
 */
export type AuditRowPlan = {
  readonly row: AuditRow;
  readonly idBasis: string | null;
};

/**
 * A requested seat's subject, every field present (`customerId` only for a
 * companion — the client record the pipeline resolved for the companion's
 * account, D29) — who a seat of the cart a commit or a move decides is for
 * (`decide-booking.ts` `RequestedSeat['subject']`).
 */
export type AuditRequestedSubject = {
  readonly requestedSubjectRole: RequestedSubjectRole;
  readonly customerId: CustomerId | null;
};

/**
 * The Firestore trigger's `authType` — who the platform says wrote a
 * document (`audit-profile-changes.ts`). The ONLY source of these tags; the
 * platform delivers them lower-case (`service_account`), and
 * {@link AuditSystem.profileWriter} reads either spelling. Any other value is
 * a writer the event cannot attribute.
 */
export const ProfileAuthType = {
  ServiceAccount: 'SERVICE_ACCOUNT',
  System: 'SYSTEM',
  ApiKey: 'API_KEY',
  Unauthenticated: 'UNAUTHENTICATED',
} as const;
export type ProfileAuthType =
  (typeof ProfileAuthType)[keyof typeof ProfileAuthType];

const PROFILE_AUTH_TYPES: readonly ProfileAuthType[] = [
  ProfileAuthType.ServiceAccount,
  ProfileAuthType.System,
  ProfileAuthType.ApiKey,
  ProfileAuthType.Unauthenticated,
];

/** The platform's `authType` (lower-case) or the tag itself → the tag, or `null`. */
function authTypeOf(raw: string): ProfileAuthType | null {
  for (let i = 0; i < PROFILE_AUTH_TYPES.length; i++) {
    const tag = PROFILE_AUTH_TYPES[i] as ProfileAuthType;
    if (tag === raw || tag.toLowerCase() === raw) return tag;
  }
  return null;
}

/**
 * A `users/{uid}` write, as the profile trigger sees it
 * (`audit-profile-changes.ts:108-126`): the delivery's event id (the row id
 * outright — a redelivery derives the same row), the event's own instant,
 * whose profile, who wrote it and which audited fields changed.
 */
export type ProfileChange = {
  readonly eventId: TriggerEventId;
  /** The event's instant; `null` when it did not parse — the plan's `nowUtcMs` stands in. */
  readonly eventAtUtcMs: UtcEpochMs | null;
  /** The account whose profile changed — an account act, so a `UserId` for good (D29). */
  readonly ownerUserId: UserId;
  readonly writer: Actor;
  readonly beforeExists: boolean;
  readonly afterExists: boolean;
  readonly fields: readonly string[];
  /**
   * The two sides' raw `profileEditedAtUtcMs` stamps (4A-16) — `null` for an
   * absent side or an absent key. The decoder only decodes; whether the
   * callable already audited the event is {@link AuditSystem.planProfileChange}'s.
   */
  readonly beforeProfileEditedAtUtcMs: UtcEpochMs | null;
  readonly afterProfileEditedAtUtcMs: UtcEpochMs | null;
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

/**
 * The basis of one person's row id for one logical change — TEXT in, text
 * out (the brands' text is what is hashed: a booking act's client record, a
 * profile act's account; the action is the verb as the row stores it).
 */
function rowBasis(
  action: string,
  resourceId: string,
  targetId: string | null,
  changeKey: string,
): string {
  return JSON.stringify([
    ROW_BASIS_TAG,
    action,
    resourceId,
    targetId,
    changeKey,
  ]);
}

/**
 * Who gets a row: each distinct client record among the subjects, in seat
 * order — a client with two services on one visit is one person, not two
 * rows. An act that touched no record still happened, so it keeps ONE
 * untargeted row.
 */
function targets(
  subjects: readonly AuditSubject[],
): readonly (CustomerId | null)[] {
  const people: CustomerId[] = [];
  for (let i = 0; i < subjects.length; i++) {
    const subject = subjects[i] as AuditSubject;
    if (subject.seatSubject !== SeatSubject.Account) continue;
    if (
      subject.customerId.length === 0 ||
      people.includes(subject.customerId)
    ) {
      continue;
    }
    people.push(subject.customerId);
  }
  return people.length > 0 ? people : [null];
}

/**
 * The audit log's pure half (`audit.ts:65-178`, `audit-profile-changes.ts`):
 * who gets a row, what each row says, and the basis each row's id is hashed
 * from. No `crypto` here — the pipeline calls `hash(idBasis)`; no clock —
 * `nowUtcMs` is a parameter (an audit row has no shop clock, F-5); no I/O —
 * the rows go to `AppendAudit`.
 */
export const AuditSystem = {
  /**
   * The basis of one person's row id for one logical change — today's
   * `auditEntryIdFor` minus the SHA-256: `JSON.stringify(['audit-row/v1',
   * action, resourceId, targetId, changeKey])` (the target's id text: a
   * client record for a booking act, an account for a profile act). The JSON
   * array keeps the parts unambiguous (`("a:b","c")` and `("a","b:c")` never
   * collide).
   */
  rowBasis,

  targets,

  /**
   * The rows the facts write, one per person per fact: every row of one fact
   * shares the actor, the verb, the instant and the context; only the target
   * slice differs — `AuditTargetRef.Customer` (D29), which is what makes
   * "everything done to Maria" one `targetCustomerId` query. A fact whose verb is not an audited one is refused
   * whole rather than written half-formed (`AuditEntry.create`'s
   * empty-action guard).
   */
  plan(
    facts: readonly AuditFact[],
    actor: Actor,
    nowUtcMs: UtcEpochMs,
  ): Result<readonly AuditRowPlan[], GovernanceError.AuditEntryEmptyAction> {
    const rows: AuditRowPlan[] = [];
    for (let i = 0; i < facts.length; i++) {
      const fact = facts[i] as AuditFact;
      const action = fact.context.auditAction;
      if (!AuditContext.isAuditAction(action)) {
        return Result.err(GovernanceError.auditEntryEmptyAction());
      }
      const people = targets(fact.subjects);
      for (let k = 0; k < people.length; k++) {
        const target = people[k] ?? null;
        rows.push({
          row: {
            recordedAtUtcMs: nowUtcMs,
            resourceId: fact.resourceId,
            ...actor,
            ...fact.context,
            ...(target === null
              ? AuditTargetRef.none()
              : AuditTargetRef.customer(target)),
          },
          idBasis:
            fact.changeKey === null
              ? null
              : rowBasis(action, fact.resourceId, target, fact.changeKey),
        });
      }
    }
    return Result.ok(rows);
  },

  /**
   * The people on a visit's seats — accounts by their client record (D29),
   * guests as anonymous — narrowed to ONE seat for a per-seat act (a
   * companion's no-show is theirs, not the booker's). `null` is every seat.
   */
  subjectsOfSeats(
    seats: readonly Seat[],
    seatId: SeatId | null,
  ): readonly AuditSubject[] {
    const subjects: AuditSubject[] = [];
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i] as Seat;
      if (seatId !== null && seat.seatId !== seatId) continue;
      subjects.push(
        seat.seatSubject === SeatSubject.Account
          ? account(seat.subjectCustomerId)
          : ANONYMOUS,
      );
    }
    return subjects;
  },

  /** Every person on a stored visit — {@link subjectsOfSeats} over all of its seats. */
  subjectsOf(appointment: Pick<Appointment, 'seats'>): readonly AuditSubject[] {
    return AuditSystem.subjectsOfSeats(appointment.seats, null);
  },

  /**
   * The people on a REQUESTED cart: every `SELF` seat binds to the owner's
   * client record, a carried companion keeps their own record, every guest
   * is anonymous — and a `SELF` seat on an owner-less walk-in names nobody.
   */
  requestedSubjects(
    subjects: readonly AuditRequestedSubject[],
    ownerCustomerId: CustomerId | null,
  ): readonly AuditSubject[] {
    const out: AuditSubject[] = [];
    for (let i = 0; i < subjects.length; i++) {
      const subject = subjects[i] as AuditRequestedSubject;
      if (
        subject.requestedSubjectRole === RequestedSubjectRole.Companion &&
        subject.customerId !== null
      ) {
        out.push(account(subject.customerId));
      } else if (
        subject.requestedSubjectRole === RequestedSubjectRole.Self &&
        ownerCustomerId !== null &&
        ownerCustomerId.length > 0
      ) {
        out.push(account(ownerCustomerId));
      } else {
        out.push(ANONYMOUS);
      }
    }
    return out;
  },

  /**
   * Who a staff edit's rows name (`staffEditSubjects`): everyone the visit
   * had BEFORE the edit — a removed seat's person included, the edit was
   * done to them too — plus the owner's client record when the batch gives
   * them a seat of their own (an added `SELF` seat). Nobody else can join
   * through an edit.
   */
  staffEditSubjects(
    before: readonly AuditSubject[],
    ownerCustomerId: CustomerId | null,
    commands: readonly EditCommandRequest[],
  ): readonly AuditSubject[] {
    let addsOwner = false;
    for (let i = 0; i < commands.length && !addsOwner; i++) {
      const command = commands[i] as EditCommandRequest;
      addsOwner =
        command.editCommand === EditCommand.AddSeat &&
        command.seatSubject === SeatSubject.Account &&
        command.subjectRelationship === SubjectRelationship.Self;
    }
    return addsOwner && ownerCustomerId !== null && ownerCustomerId.length > 0
      ? [...before, account(ownerCustomerId)]
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
    attempt(attemptId: string | null, appointmentId: AppointmentId): string {
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
    staffEdit(operationId: OperationId | null, revision: number): string {
      return operationId === null
        ? `revision:${revision}`
        : `operation:${operationId}`;
    },
    /** A client cancel (`cancel-appointment.ts:234`): the instant it stamped. */
    cancelled(cancelledAtUtcMs: UtcEpochMs): string {
      return `cancelled:${cancelledAtUtcMs}`;
    },
    /**
     * A staff lifecycle verb (`transition-appointment.ts:517`) — the seat is
     * in the key because one person can hold two seats.
     */
    transition(seatId: SeatId | null, decidedAtUtcMs: UtcEpochMs): string {
      return `transition:${seatId !== null && seatId.length > 0 ? seatId : 'party'}:${decidedAtUtcMs}`;
    },
    /** An arrival stamped (`mark-arrived.ts:118`). */
    arrived(stampUtcMs: UtcEpochMs): string {
      return `arrived:${stampUtcMs}`;
    },
    /** An arrival taken back (`clear-arrival.ts:88`): the stamp it cleared. */
    unarrived(clearedStampUtcMs: UtcEpochMs): string {
      return `unarrived:${clearedStampUtcMs}`;
    },
    /** A tip recorded or cleared (`record-seat-tip.ts:155`). */
    tip(seatId: SeatId, recordedAtUtcMs: UtcEpochMs): string {
      return `tip:${seatId}:${recordedAtUtcMs}`;
    },
    /** A streak publish or withdraw: the client's request id. */
    publish(requestId: PublishRequestId): string {
      return requestId;
    },
    /** The profile trigger: the CloudEvent id — never a constant. */
    profile(eventId: TriggerEventId): string {
      return eventId;
    },
    /**
     * An owner's own edit through `updateProfile` (4A-16): the account and
     * the instant its transaction stamped — a retried call that re-commits
     * re-stamps, so each landed edit is its own change.
     */
    ownProfileEdit(ownerUserId: UserId, editedAtUtcMs: UtcEpochMs): string {
      return `profile-edit:${ownerUserId}:${editedAtUtcMs}`;
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
    if (!beforeExists) return AuditAction.ProfileCreated;
    return afterExists
      ? AuditAction.ProfileUpdated
      : AuditAction.ProfileDeleted;
  },

  /**
   * WHO wrote a profile, from the event's auth context: the Admin SDK and the
   * platform are processes; anything else is an end user, credited by a
   * uid-shaped id — an id that is not one is never guessed at: the row says
   * it could not tell.
   */
  profileWriter(authType: string, authId: string | null): Actor {
    const tag = authTypeOf(authType);
    if (tag === ProfileAuthType.ServiceAccount) {
      return Actor.system(SystemSource.AdminSdk);
    }
    if (tag === ProfileAuthType.System) {
      return Actor.system(SystemSource.FirestoreSystem);
    }
    if (authId !== null && UID_SHAPE.test(authId)) {
      const userId = UserId.parse(authId);
      if (userId.ok) return Actor.user(userId.value);
    }
    switch (tag) {
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
   * refused rather than minted one (`EMPTY_ACTION` is the governance code
   * for a half-formed row).
   */
  planProfileChange(
    change: ProfileChange,
    nowUtcMs: UtcEpochMs,
  ): Result<AuditRowPlan | null, GovernanceError.AuditEntryEmptyAction> {
    if (change.fields.length === 0) return Result.ok(null);
    if (AuditSystem.auditedByCallable(change)) return Result.ok(null);
    if (change.eventId.trim().length === 0) {
      return Result.err(GovernanceError.auditEntryEmptyAction());
    }
    const action = AuditSystem.profileAction(
      change.beforeExists,
      change.afterExists,
    );
    const resourceId = AuditResourceId.forUser(change.ownerUserId);
    return Result.ok({
      row: {
        recordedAtUtcMs: change.eventAtUtcMs ?? nowUtcMs,
        resourceId,
        ...change.writer,
        ...AuditContext.profile(action, change.fields),
        ...AuditTargetRef.user(change.ownerUserId),
      },
      idBasis: rowBasis(
        action,
        resourceId,
        change.ownerUserId,
        AuditSystem.changeKey.profile(change.eventId),
      ),
    });
  },

  /**
   * Whether `updateProfile` already wrote this event's row (owner ruling
   * flip-2 §10.15, Phase 4a 4A-16): an UPDATE whose `profileEditedAtUtcMs`
   * stamp changed to a new instant is the callable's own edit, audited
   * inside its transaction, credited to the caller. The callable only ever
   * writes an instant, so a reset to `null` (a whole-body Admin `set` — the
   * dev seed, the e2e seed — over an account the callable already stamped)
   * is never the callable's and is audited by the trigger. A creation (the
   * provisioned stub, registration, the seed) and a deletion are never
   * skipped; an edit that leaves the stamp as it was (an account block, an
   * admin write) is the trigger's to audit, as today.
   */
  auditedByCallable(change: ProfileChange): boolean {
    return (
      change.beforeExists &&
      change.afterExists &&
      change.afterProfileEditedAtUtcMs !== null &&
      change.beforeProfileEditedAtUtcMs !== change.afterProfileEditedAtUtcMs
    );
  },

  /**
   * The ONE row an owner's own profile edit writes inside `updateProfile`'s
   * transaction (4A-16): `PROFILE_UPDATED`, credited to the owner
   * (`Actor.user`), the changed field NAMES its only context, stamped with
   * the edit's instant; its id basis keyed by
   * {@link AuditSystem.changeKey.ownProfileEdit}. `null` when no audited
   * field changed — an unchanged edit writes nothing.
   */
  planOwnProfileEdit(
    ownerUserId: UserId,
    fields: readonly string[],
    nowUtcMs: UtcEpochMs,
  ): AuditRowPlan | null {
    if (fields.length === 0) return null;
    const action = AuditAction.ProfileUpdated;
    const resourceId = AuditResourceId.forUser(ownerUserId);
    return {
      row: {
        recordedAtUtcMs: nowUtcMs,
        resourceId,
        ...Actor.user(ownerUserId),
        ...AuditContext.profile(action, fields),
        ...AuditTargetRef.user(ownerUserId),
      },
      idBasis: rowBasis(
        action,
        resourceId,
        ownerUserId,
        AuditSystem.changeKey.ownProfileEdit(ownerUserId, nowUtcMs),
      ),
    };
  },
} as const;
