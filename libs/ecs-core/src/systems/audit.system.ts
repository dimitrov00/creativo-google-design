import {
  AccountStatus,
  Actor,
  type BackfillCall,
  SystemSource,
  AuditAction,
  AuditContext,
  AuditedProfileField,
  AuditTargetRef,
  type GovernedCollection,
  ImpersonationEndReason,
  ImpersonationStatus,
  type ProfileAction,
  ProfileAuthType,
  type Role,
  Roles,
  type Seat,
  SeatSubject,
  SubjectRelationship,
  EditCommand,
  WriteOp,
} from '@core/components';
import {
  Result,
  type AppointmentId,
  AuditEntryId,
  AuditResourceId,
  type ClientOperationId,
  type CustomerId,
  defect,
  type ImpersonationSessionId,
  type OperationId,
  type OtpId,
  type PublishRequestId,
  type SeatId,
  type StoredFields,
  type TriggerEventId,
  Tag,
  UserId,
  UtcEpochMs,
} from '@core/primitives';
import { GovernanceError } from '@core/errors';
import {
  type Appointment,
  type AuditEntryMeta,
  Collections,
  type ImpersonationSession,
} from '@core/entities';
import { type EditCommandRequest } from './appointment-edit.system';

/**
 * A seat's person as the audit log sees them (`audit.ts:19-25`): a client
 * with a record gets a row of its own, targeted at that RECORD (D29: a
 * booking act is done to whom the shop serves — `AuditTargetRef.Customer`,
 * flip (1)) — an account's, or a walk-in's (OR-26); an anonymous guest does
 * not — a label typed at the desk is not somebody a per-client history can
 * ever be asked about. Discriminated by the seat's own `seatSubject`.
 */
export type AuditSubject =
  AuditAccountSubject | AuditWalkInSubject | AuditAnonymousSubject;

export type AuditAccountSubject = {
  readonly seatSubject: typeof SeatSubject.Account;
  /** The seat's client record — the row's `targetCustomerId`. */
  readonly customerId: CustomerId;
};

export type AuditWalkInSubject = {
  readonly seatSubject: typeof SeatSubject.WalkIn;
  /** The walk-in's client record (OR-26) — the row's `targetCustomerId`. */
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
 * {@link AuditSystem.changeKey}). Never null (RU-41): a booking verb's key
 * derives from its operation id, a failed backfill call's from a minted id
 * — a fact with no key would be a row nobody can recognise again.
 * `operationId` is the operation that caused the act (WS-4.4), copied onto
 * every row it fans out to (`auditOperationId`); `null` for a backfill.
 */
export type AuditFact = {
  readonly resourceId: AuditResourceId;
  /** The seats the act touched, guests included; the plan picks the people. */
  readonly subjects: readonly AuditSubject[];
  readonly changeKey: string;
  readonly operationId: OperationId | null;
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
 * One planned row and the basis of its id: `id = hash(idBasis)`, written
 * with `create()` ({@link AuditSystem.createsOf}), so a retried attempt
 * derives the same id. Never null (RU-41).
 */
export type AuditRowPlan = {
  readonly row: AuditRow;
  readonly idBasis: string;
};

/**
 * An act's audit rows as entries of its OWN commit plan (WS-1): one
 * `WriteOp.create([auditLog, hash(idBasis)], row)` per row, appended LAST to
 * the plan the transaction commits — the rows land with the act or not at
 * all. `unaudited` holds the facts dropped for want of a verified actor:
 * the act still commits (unchanged behaviour); the pipeline logs each one
 * (`LogEvent.AuditActorMissing`) after the commit lands.
 */
export type AuditCommit = {
  readonly writes: readonly WriteOp[];
  readonly unaudited: readonly AuditFact[];
};

/** Every `authType` tag, dictionary order — the scan order of {@link authTypeOf}. */
const PROFILE_AUTH_TYPES = Tag.values(ProfileAuthType);

/** The platform's `authType` (lower-case) or the tag itself → the tag, or `null`. */
function authTypeOf(raw: string): ProfileAuthType | null {
  for (const tag of PROFILE_AUTH_TYPES) {
    if (tag === raw || tag.toLowerCase() === raw) return tag;
  }
  return null;
}

/**
 * A profile row's role / status before-and-after (audit-hardening WS-3):
 * the four tag fields of `AuditContext.Profile`, each pair set iff its field
 * changed ({@link AuditSystem.profileTagDelta}), else both `null`.
 */
export type ProfileTagDelta = Omit<
  AuditContext.Profile,
  'auditAction' | 'profileFields'
>;

/**
 * A `users/{uid}` write, as the document-change trigger sees it
 * (`audit-profile-changes.ts:108-126`): the delivery's event id (the row id
 * outright — a redelivery derives the same row), the event's own instant,
 * whose profile, who wrote it, which audited fields changed and how the
 * role / status tags moved. `governedCollection` is always `USERS` — the
 * discriminator that tells it from a `GovernedChange` inside one
 * `DocumentChange` (RU-40).
 */
export type ProfileChange = {
  readonly governedCollection: typeof GovernedCollection.Users;
  readonly eventId: TriggerEventId;
  /** The event's instant; `null` when it did not parse — the plan's `nowUtcMs` stands in. */
  readonly eventAtUtcMs: UtcEpochMs | null;
  /** The account whose profile changed — an account act, so a `UserId` for good (D29). */
  readonly ownerUserId: UserId;
  readonly writer: Actor;
  readonly beforeExists: boolean;
  readonly afterExists: boolean;
  /**
   * The audited fields that changed (`changedProfileFields`).
   */
  readonly fields: readonly AuditedProfileField[];
  /**
   * The two sides' raw `profileEditedAtUtcMs` stamps (4A-16) — `null` for an
   * absent side or an absent key. The decoder only decodes; whether the
   * callable already audited the event is {@link AuditSystem.planProfileChange}'s.
   */
  readonly beforeProfileEditedAtUtcMs: UtcEpochMs | null;
  readonly afterProfileEditedAtUtcMs: UtcEpochMs | null;
} & ProfileTagDelta;

/**
 * The profile fields whose change is worth a row (`AUDITED_PROFILE_FIELDS`),
 * in the stored order — an explicit list, never `Registration.FIELDS` or
 * `Tag.values(AuditedProfileField)` (their order differs): the order is the
 * order of the stored `profileFields` arrays, the registration five first,
 * then `roles` and `accountStatus` appended (audit-hardening WS-3, DEP-13).
 * No other writer audits those two: `completeRegistration`'s `Set` writes
 * the roles with no row of its own, no callable writes the status, and the
 * Admin SDK or the console can change either — so the trigger does.
 */
const AUDITED_PROFILE_FIELDS: readonly AuditedProfileField[] = [
  AuditedProfileField.FirstName,
  AuditedProfileField.LastName,
  AuditedProfileField.Phone,
  AuditedProfileField.Email,
  AuditedProfileField.BirthDate,
  AuditedProfileField.Roles,
  AuditedProfileField.AccountStatus,
];

/** A profile row's tag fields when neither `roles` nor `accountStatus` changed. */
const NO_TAG_DELTA: ProfileTagDelta = {
  profileRolesFrom: null,
  profileRolesTo: null,
  profileAccountStatusFrom: null,
  profileAccountStatusTo: null,
};

/** A Firebase uid as this app mints and accepts them (the commit path's shape). */
const UID_SHAPE = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * The id basis version — a later derivation never collides with an earlier
 * one. `v2` (WS-1, RU-6): the cancel / transition / arrival / tip keys
 * derive from the act's operation id, never from an instant.
 */
const ROW_BASIS_TAG = 'audit-row/v2';

/**
 * Absent, `null`, `''` and an empty array are one fact — "no value" —
 * however a writer spelled it (the PROVISIONED stub's `roles: []` lists
 * nothing).
 */
function comparable(value: unknown): string {
  return value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
    ? ''
    : JSON.stringify(value);
}

/** One side's known roles — an absent or non-list value holds none. */
function rolesOf(raw: unknown): readonly Role[] {
  return Array.isArray(raw) ? Roles.known(raw) : [];
}

/** One side's status, when it is a known one. */
function accountStatusOf(raw: unknown): AccountStatus | null {
  return Tag.has(AccountStatus, raw) ? raw : null;
}

/**
 * The basis of one person's row id for one logical change — the legacy
 * row-id derivation minus the SHA-256: `JSON.stringify(['audit-row/v2',
 * action, resourceId, targetId, changeKey])`. Typed (audit-hardening Phase 3,
 * P3-RU-7): the verb, the resource and the target as their brands (Law 7.4 —
 * a `CustomerId` for a client-record row, a `UserId` for an account row,
 * `null` for an untargeted one); the brands' TEXT is what is hashed, so every
 * stored row id stays what it was. The JSON array keeps the parts
 * unambiguous (`("a:b","c")` and `("a","b:c")` never collide). The planners
 * that build a row outside this file (`IdentityAuditSystem`) key it through
 * here.
 */
function rowBasis(
  action: AuditAction,
  resourceId: AuditResourceId,
  targetId: CustomerId | UserId | null,
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
    if (subject.seatSubject === SeatSubject.Anonymous) continue;
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
 * from. No `crypto` here — `hash` is a parameter; no clock — `nowUtcMs` is
 * a parameter (an audit row has no shop clock, F-5); no I/O — the rows are
 * `WriteOp.create` entries of the act's own commit plan
 * ({@link AuditSystem.commitWrites}), or go to `AppendAudit` (the backfill)
 * and `CreateAuditRows` (the document-change trigger).
 */
export const AuditSystem = {
  rowBasis,

  targets,

  /**
   * The rows the facts write, one per person per fact: every row of one fact
   * shares the actor, the verb, the instant and the context; only the target
   * slice differs — `AuditTargetRef.Customer` (D29), which is what makes
   * "everything done to Maria" one `targetCustomerId` query; every row
   * carries the fact's operation (`auditOperationId`). A fact whose verb is not an audited one is refused
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
            auditOperationId: fact.operationId,
            ...actor,
            ...fact.context,
            ...(target === null
              ? AuditTargetRef.none()
              : AuditTargetRef.customer(target)),
          },
          idBasis: rowBasis(action, fact.resourceId, target, fact.changeKey),
        });
      }
    }
    return Result.ok(rows);
  },

  /**
   * The planned rows as entries of a commit plan: one
   * `WriteOp.create([auditLog, hash(idBasis)], row)` each, in plan order.
   * A replayed act derives the same ids — so a replay must plan NO row
   * (its own replay detection decides first): inside a transaction a
   * `Create` of an existing row refuses the whole act
   * (`REPOSITORY_ALREADY_EXISTS`), a tripwire that never fires on a
   * legitimate replay.
   */
  createsOf(
    plans: readonly AuditRowPlan[],
    hash: (input: string) => string,
  ): readonly WriteOp[] {
    const writes: WriteOp[] = [];
    for (let i = 0; i < plans.length; i++) {
      const plan = plans[i] as AuditRowPlan;
      writes.push(
        WriteOp.create(
          [Collections.AuditLog, AuditEntryId.of(hash(plan.idBasis))],
          plan.row,
        ),
      );
    }
    return writes;
  },

  /**
   * An act's audit rows for its own commit plan (WS-1): {@link plan} then
   * {@link createsOf}. With no verified actor the act still commits, with
   * no row: every fact comes back `unaudited` for the pipeline to log. The
   * verb sets are closed (every fact's verb comes from a constant of its
   * verb), so a fact the planner refuses is a programmer defect, never a
   * value (precedent: `StreakPublishSystem`'s rows).
   */
  commitWrites(
    facts: readonly AuditFact[],
    actor: Actor | null,
    nowUtcMs: UtcEpochMs,
    hash: (input: string) => string,
  ): AuditCommit {
    if (facts.length === 0) return { writes: [], unaudited: [] };
    if (actor === null) return { writes: [], unaudited: facts };
    const planned = AuditSystem.plan(facts, actor, nowUtcMs);
    return planned.ok
      ? { writes: AuditSystem.createsOf(planned.value, hash), unaudited: [] }
      : defect(`audit entry refused by domain: ${planned.error.errorCode}`);
  },

  /**
   * The people on a visit's seats — accounts and walk-ins by their client
   * record (D29, OR-26), anonymous guests as anonymous — narrowed to ONE
   * seat for a per-seat act (a companion's no-show is theirs, not the
   * booker's). `null` is every seat.
   */
  subjectsOfSeats(
    seats: readonly Seat[],
    seatId: SeatId | null,
  ): readonly AuditSubject[] {
    const subjects: AuditSubject[] = [];
    for (let i = 0; i < seats.length; i++) {
      const seat = seats[i] as Seat;
      if (seatId !== null && seat.seatId !== seatId) continue;
      switch (seat.seatSubject) {
        case SeatSubject.Account:
          subjects.push(account(seat.subjectCustomerId));
          break;
        case SeatSubject.WalkIn:
          subjects.push({
            seatSubject: SeatSubject.WalkIn,
            customerId: seat.subjectCustomerId,
          });
          break;
        case SeatSubject.Anonymous:
          subjects.push(ANONYMOUS);
          break;
      }
    }
    return subjects;
  },

  /** Every person on a stored visit — {@link subjectsOfSeats} over all of its seats. */
  subjectsOf(appointment: Pick<Appointment, 'seats'>): readonly AuditSubject[] {
    return AuditSystem.subjectsOfSeats(appointment.seats, null);
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
   * Each verb's change key — one per verb, derived from the client-minted
   * name of the ONE act (WS-1, RU-6), never from an instant: a retried
   * attempt yields the same row ids and a different act never does. The
   * act's own replay detection runs first, so a replay plans no row at all.
   */
  changeKey: {
    /** A commit (`commit-booking.ts:222`): the attempt id — the appointment's own id (WS-4.1). */
    attempt(attemptId: AppointmentId): string {
      return `attempt:${attemptId}`;
    },
    /** A move (`reschedule-appointment.ts:109`): its attempt id. */
    move(attemptId: ClientOperationId): string {
      return `move:${attemptId}`;
    },
    /** A staff edit (`staffEditChangeKey`): its operation id (RU-5). */
    staffEdit(operationId: OperationId): string {
      return `operation:${operationId}`;
    },
    /** A client cancel: its operation id. */
    cancel(operationId: OperationId): string {
      return `cancel:${operationId}`;
    },
    /**
     * A staff lifecycle verb: its operation id, and the seat for a per-seat
     * act (one person can hold two seats); the whole party has none.
     */
    transition(operationId: OperationId, seatId: SeatId | null): string {
      return seatId !== null && seatId.length > 0
        ? `transition:${operationId}:${seatId}`
        : `transition:${operationId}`;
    },
    /** An arrival stamped: its operation id. */
    arrived(operationId: OperationId): string {
      return `arrived:${operationId}`;
    },
    /** An arrival taken back: its operation id. */
    unarrived(operationId: OperationId): string {
      return `unarrived:${operationId}`;
    },
    /** A tip recorded or cleared: its operation id and the seat. */
    tip(operationId: OperationId, seatId: SeatId): string {
      return `tip:${operationId}:${seatId}`;
    },
    /**
     * A FAILED backfill call (RU-41): one row per call, no result to key on,
     * every call a distinct act — the one minted key, built in the one
     * pipeline that stays off the commit plan (L2).
     */
    backfillFailed(mintedId: string): string {
      return `backfill-failed:${mintedId}`;
    },
    /** A streak publish or withdraw: the client's request id. */
    publish(requestId: PublishRequestId): string {
      return requestId;
    },
    /**
     * The document-change trigger (a profile or a governed row): the
     * CloudEvent id — never a constant.
     */
    profile(eventId: TriggerEventId): string {
      return eventId;
    },
    /** An impersonation session opened (audit-hardening WS-3): one per session. */
    impersonationStarted(sessionId: ImpersonationSessionId): string {
      return `impersonation-start:${sessionId}`;
    },
    /** An impersonation session ended: one per session — the first end wins. */
    impersonationEnded(sessionId: ImpersonationSessionId): string {
      return `impersonation-end:${sessionId}`;
    },
    /**
     * An owner's own edit through `updateProfile` (4A-16): the account and
     * the instant its transaction stamped — a retried call that re-commits
     * re-stamps, so each landed edit is its own change.
     */
    ownProfileEdit(ownerUserId: UserId, editedAtUtcMs: UtcEpochMs): string {
      return `profile-edit:${ownerUserId}:${editedAtUtcMs}`;
    },
    /*
     * The sign-in rows (audit-hardening Phase 3, P3-RU-7): keyed by STATE the
     * act's own commit proves, never by the caller's transport id — these
     * callables are unauthenticated, so a client id would neither dedupe a
     * retry nor bound the rows a caller can mint.
     */
    /** A challenge saved: one per challenge (a fresh `nextId`). */
    otpRequested(otpId: OtpId): string {
      return `otp-requested:${otpId}`;
    },
    /** A challenge consumed: one per challenge (the transaction proves it was open). */
    otpVerified(otpId: OtpId): string {
      return `otp-verified:${otpId}`;
    },
    /**
     * A wrong code recorded: the challenge and the attempt count AFTER the
     * increment — strictly increasing, read in the same transaction, so each
     * recorded attempt is its own row and a retried one is the same row.
     */
    otpRefused(otpId: OtpId, attemptCount: number): string {
      return `otp-refused:${otpId}:${attemptCount}`;
    },
    /** A sign-in token answered: one per consumed challenge. */
    sessionIssued(otpId: OtpId): string {
      return `session:${otpId}`;
    },
    /** An account's first registration: one per account (a re-run plans no row). */
    registration(userId: UserId): string {
      return `registration:${userId}`;
    },
    /**
     * An admin's data-subject export (audit-hardening Phase 3 WS-C): its
     * operation id — the act the admin minted once and keeps for a retry,
     * so a replay of the same export plans the same row id (and the
     * pipeline's probe read finds it), while a new export is a new row.
     */
    clientExported(operationId: OperationId): string {
      return `export:${operationId}`;
    },
    /*
     * An admin's data-subject erasure (audit-hardening Phase 3 WS-D,
     * P3-RU-22). The start and the completion are keyed by STATE, never by
     * the act's id: each row is planned only on the transition its own
     * transaction read (`NONE → ERASING`, `ERASING → ERASED`), so a replay,
     * a resumed call or a concurrent second act plans none and never
     * reaches the ALREADY_EXISTS tripwire — one STARTED and one ERASED row
     * per record, ever.
     */
    /**
     * The pre-stamp contact sweep (P3-DEP-28, P3-DEP-33): its operation id —
     * the act's first sweep commit that lands plans it after its probe read
     * finds it absent (the re-sweep's idiom), so a resumed call of the same
     * act plans none, while a new act (a re-minted id) is its own row.
     */
    erasureSweep(operationId: OperationId): string {
      return `erasure-sweep:${operationId}`;
    },
    /** The stamp commit (`NONE → ERASING`): one per record. */
    erasureStarted(customerId: CustomerId): string {
      return `erasure-start:${customerId}`;
    },
    /** The completion commit (`ERASING → ERASED`): one per record. */
    erased(customerId: CustomerId): string {
      return `erasure-done:${customerId}`;
    },
    /**
     * A sweep of an ERASED record that found residue (P3-L-19): its
     * operation id — an ERASED record may be swept by many acts, each its
     * own row, and the pipeline plans it only when its probe read finds the
     * row absent (the export row's idiom), so a replay of one act plans none.
     */
    erasureResweep(operationId: OperationId): string {
      return `erasure-resweep:${operationId}`;
    },
  },

  /**
   * What makes one RETURNED backfill page ONE logical change for the audit
   * log (pass C, P-27 — the pipeline's `backfillChangeKey`, homed beside
   * {@link AuditSystem.changeKey}): the same person walking the same stretch
   * of the same run to the same end. A replayed call derives the same key
   * and logs once; anything else is another change.
   */
  backfillChangeKey(page: BackfillCall.Page, actor: Actor): string {
    return JSON.stringify([
      'ops.backfill/v1',
      page.backfillJobName,
      page.runStartedAtUtcMs,
      page.startedFrom,
      page.cursor,
      page.done,
      actor.actorRole,
      Actor.apparentUserId(actor),
    ]);
  },

  /**
   * The audited fields whose value changed, in a fixed order — NAMES only:
   * the row says THAT the phone changed, never from what to what (R36); the
   * role / status before-and-after is {@link AuditSystem.profileTagDelta}'s.
   */
  changedProfileFields(
    before: StoredFields,
    after: StoredFields,
  ): readonly AuditedProfileField[] {
    const changed: AuditedProfileField[] = [];
    for (const field of AUDITED_PROFILE_FIELDS) {
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
   * The role / status tags of a profile write (audit-hardening WS-3) — the
   * one before-and-after a profile row carries, closed vocabularies only:
   * `profileRolesFrom/To` are each side's known roles (`Roles.known`; an
   * absent side holds none) when `roles` changed, `profileAccountStatusFrom/To`
   * each side's known status (`null` for an absent or unknown one) when
   * `accountStatus` changed; an unchanged field leaves its pair `null`.
   * "Changed" is {@link AuditSystem.changedProfileFields}'s rule (an empty
   * list is no value), so a pair is set iff its name is in `profileFields`.
   */
  profileTagDelta(before: StoredFields, after: StoredFields): ProfileTagDelta {
    const rolesChanged =
      comparable(before[AuditedProfileField.Roles]) !==
      comparable(after[AuditedProfileField.Roles]);
    const statusChanged =
      comparable(before[AuditedProfileField.AccountStatus]) !==
      comparable(after[AuditedProfileField.AccountStatus]);
    if (!rolesChanged && !statusChanged) return NO_TAG_DELTA;
    return {
      profileRolesFrom: rolesChanged
        ? rolesOf(before[AuditedProfileField.Roles])
        : null,
      profileRolesTo: rolesChanged
        ? rolesOf(after[AuditedProfileField.Roles])
        : null,
      profileAccountStatusFrom: statusChanged
        ? accountStatusOf(before[AuditedProfileField.AccountStatus])
        : null,
      profileAccountStatusTo: statusChanged
        ? accountStatusOf(after[AuditedProfileField.AccountStatus])
        : null,
    };
  },

  /**
   * WHO wrote a document, from the event's auth context (RU-17: was
   * `profileWriter`; every document-change trigger reads it): the Admin SDK
   * and the platform are processes; anything else is an end user, credited
   * by a uid-shaped id — an id that is not one is never guessed at: the row
   * says it could not tell. A browser write is `USER` with no role snapshot
   * (the event carries no claims).
   */
  writerOf(authType: string, authId: string | null): Actor {
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
        auditOperationId: null,
        ...change.writer,
        ...AuditContext.profileWithTags(action, change.fields, change),
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
   * the edit's instant, naming the call's transport operation id
   * (`operationId`, `null` when the call sent none — RU-21); its id basis
   * keyed by {@link AuditSystem.changeKey.ownProfileEdit}. `null` when no
   * audited field changed — an unchanged edit writes nothing.
   */
  planOwnProfileEdit(
    ownerUserId: UserId,
    fields: readonly AuditedProfileField[],
    nowUtcMs: UtcEpochMs,
    operationId: OperationId | null,
  ): AuditRowPlan | null {
    if (fields.length === 0) return null;
    const action = AuditAction.ProfileUpdated;
    const resourceId = AuditResourceId.forUser(ownerUserId);
    return {
      row: {
        recordedAtUtcMs: nowUtcMs,
        resourceId,
        auditOperationId: operationId,
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

  /**
   * The ONE row an impersonation start writes inside its own commit
   * (audit-hardening WS-3, DEP-12): `GOVERNANCE_IMPERSONATION_STARTED`,
   * credited to `actor` (the pipeline's `Actor.forCaller` — RU-13), stamped
   * with the session's `startedAtUtcMs`, naming `impersonationSessions/<id>`
   * and targeted at the impersonated account (`AuditTargetRef.user` — the
   * row is on that user's timeline), with the call's transport operation id
   * (`null` without one, RU-21). Ids, the scope and the expiry only — never
   * the session's `reason`.
   */
  planImpersonationStarted(
    session: ImpersonationSession,
    actor: Actor,
    operationId: OperationId | null,
  ): AuditRowPlan {
    const action = AuditAction.GovernanceImpersonationStarted;
    const resourceId = AuditResourceId.forImpersonationSession(session.id);
    return {
      row: {
        recordedAtUtcMs: session.startedAtUtcMs,
        resourceId,
        auditOperationId: operationId,
        ...actor,
        ...AuditContext.impersonationStarted(
          session.id,
          session.impersonationScope,
          session.expiresAtUtcMs,
        ),
        ...AuditTargetRef.user(session.targetUserId),
      },
      idBasis: rowBasis(
        action,
        resourceId,
        session.targetUserId,
        AuditSystem.changeKey.impersonationStarted(session.id),
      ),
    };
  },

  /**
   * The ONE row an impersonation end writes inside its own commit: the
   * start's shape, stamped with `endedAtUtcMs`, plus the end reason. Only
   * `ADMIN_ENDED` and `EXPIRED` are ever written (RU-14: no revocation
   * writer exists); a session that is not ENDED, or one revoked by
   * security, is a programmer defect here — never a row.
   */
  planImpersonationEnded(
    session: ImpersonationSession,
    actor: Actor,
    operationId: OperationId | null,
  ): AuditRowPlan {
    if (session.impersonationStatus !== ImpersonationStatus.Ended) {
      return defect('an impersonation end row needs an ENDED session');
    }
    if (
      session.impersonationEndReason ===
      ImpersonationEndReason.RevokedBySecurity
    ) {
      return defect('no revocation writer exists to audit (RU-14)');
    }
    const action = AuditAction.GovernanceImpersonationEnded;
    const resourceId = AuditResourceId.forImpersonationSession(session.id);
    return {
      row: {
        recordedAtUtcMs: session.endedAtUtcMs,
        resourceId,
        auditOperationId: operationId,
        ...actor,
        ...AuditContext.impersonationEnded(
          session.id,
          session.impersonationScope,
          session.expiresAtUtcMs,
          session.impersonationEndReason,
        ),
        ...AuditTargetRef.user(session.targetUserId),
      },
      idBasis: rowBasis(
        action,
        resourceId,
        session.targetUserId,
        AuditSystem.changeKey.impersonationEnded(session.id),
      ),
    };
  },

  /**
   * The order one operation's rows read in (audit-hardening WS-7,
   * `auditRowsForOperation`): oldest `recordedAtUtcMs` first, rows sharing
   * an instant (an act's fan-out, one per client record) by id in code-unit
   * order — a total, stable order the store's equality read never gives
   * (OR-18's code-unit tie-break precedent). The rule is this system's,
   * never the adapter's (Law 4). A sorted copy; the input is never touched.
   */
  chronological<R extends AuditEntryMeta>(rows: readonly R[]): readonly R[] {
    return [...rows].sort(
      (a, b) =>
        UtcEpochMs.compare(a.recordedAtUtcMs, b.recordedAtUtcMs) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  },
} as const;
