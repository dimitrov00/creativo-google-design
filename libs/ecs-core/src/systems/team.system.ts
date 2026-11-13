import {
  AccountLifecycle,
  type Actor,
  type AuthoredText,
  BarberActivation,
  type BarberActivationAnswer,
  type BarberEmployment,
  BarberLifecycle,
  BarberStatus,
  type LocalizedText,
  Roles,
  ScheduleVersion,
  type TeamBarberAction,
  WriteOp,
  WriteProvenance,
} from '@core/components';
import {
  type BarberId,
  type LocalDate,
  type LocationId,
  type OperationId,
  Result,
  type UtcEpochMs,
} from '@core/primitives';
import { TeamError } from '@core/errors';
import {
  type Barber,
  type BarberAvatar,
  type BarberMeta,
  type BarberSchedule,
  Collections,
  type User,
} from '@core/entities';
import { AuditSystem } from './audit.system';
import { GovernedChangeSystem } from './governed-change.system';
import type { StaffSetupChecklist } from './staff-setup.system';

/**
 * A listed shop, as far as the team's decisions read it — a `ShopLocation`
 * is accepted as it is (Law 3, zero inbound mapping).
 */
export type ListedShop = {
  readonly id: LocationId;
};

/** What «Добави» sends for a new barber record — ids and days already parsed at the edge. */
export type AddBarberInput = {
  readonly name: AuthoredText;
  /** The shops they work at; `[]` is every shop. */
  readonly locationIds: readonly LocationId[];
  readonly barberStartsLocalDate: LocalDate;
  readonly barberLastWorkingLocalDate: LocalDate | null;
  /** Where the record goes when its needed items are done. */
  readonly barberDraftTargetStatus: BarberLifecycle.LiveStatus;
  readonly barberJoinsAnyPool: boolean;
};

/** What the transaction knows when a record is added. */
export type AddBarberContext = {
  /** The new record's id — the pipeline's `nextId`. */
  readonly barberId: BarberId;
  /** Every listed location. */
  readonly listedShops: readonly ListedShop[];
  /** How many barber records exist — the new one sorts after them. */
  readonly barberCount: number;
  readonly nowUtcMs: UtcEpochMs;
  readonly operationId: OperationId | null;
};

/** A barber's whole public profile, as its editor saves it. */
export type BarberProfileInput = {
  readonly name: AuthoredText;
  readonly title: AuthoredText | null;
  readonly bio: AuthoredText | null;
  readonly instagramHandle: string | null;
  readonly yearsExperience: number | null;
};

/**
 * One team act on a barber record, as its pipeline decided it: the verb,
 * the record on both sides (`before` is `null` for a creation, `after` for
 * a deletion), who did it and the act's name.
 */
export type TeamBarberWrite = {
  readonly action: TeamBarberAction;
  readonly before: Barber | null;
  readonly after: Barber | null;
  /** The caller, credited over their STORED roles (`Actor.forCaller`). */
  readonly actor: Actor;
  readonly nowUtcMs: UtcEpochMs;
  readonly operationId: OperationId;
};

const NAME_MAX = 80;
const TITLE_MAX = 80;
const BIO_MAX = 600;
const EXPERIENCE_MAX = 80;
/** An Instagram handle: letters, digits, dots and underscores, at most 30. */
const INSTAGRAM = /^[A-Za-z0-9._]{1,30}$/;

/** Required text: a non-blank Bulgarian within `max`, English falling back to it. */
function requiredText(
  input: AuthoredText,
  field: string,
  max: number,
): Result<LocalizedText, TeamError> {
  const bg = input.bg.trim();
  const en = (input.en ?? '').trim();
  if (bg.length === 0 || bg.length > max || en.length > max) {
    return Result.err(TeamError.invalidInput(field));
  }
  return Result.ok({ bg, en: en.length === 0 ? bg : en });
}

/** Optional text: `null`, or a blank Bulgarian, is "none". */
function optionalText(
  input: AuthoredText | null,
  field: string,
  max: number,
): Result<LocalizedText | null, TeamError> {
  if (input === null || input.bg.trim().length === 0) return Result.ok(null);
  return requiredText(input, field, max);
}

/** The record's fields that are not its lifecycle — every one, named. */
function withoutLifecycle(
  barber: Barber,
): BarberMeta & BarberEmployment & BarberAvatar & WriteProvenance {
  return {
    id: barber.id,
    name: barber.name,
    title: barber.title,
    bio: barber.bio,
    yearsExperience: barber.yearsExperience,
    locationIds: barber.locationIds,
    instagramHandle: barber.instagramHandle,
    barberJoinsAnyPool: barber.barberJoinsAnyPool,
    sortOrder: barber.sortOrder,
    barberStartsLocalDate: barber.barberStartsLocalDate,
    barberLastWorkingLocalDate: barber.barberLastWorkingLocalDate,
    avatarMediaId: barber.avatarMediaId,
    avatarMediaPath: barber.avatarMediaPath,
    avatarMediaWidth: barber.avatarMediaWidth,
    avatarMediaHeight: barber.avatarMediaHeight,
    avatarMediaBlurhash: barber.avatarMediaBlurhash,
    avatarMediaFocalX: barber.avatarMediaFocalX,
    avatarMediaFocalY: barber.avatarMediaFocalY,
    writeOperationId: barber.writeOperationId,
  };
}

/** A record that has left the shop takes no edit. */
function current(barber: Barber): Result<Barber, TeamError> {
  return barber.barberStatus === BarberStatus.Departed
    ? Result.err(TeamError.barberDeparted(barber.id))
    : Result.ok(barber);
}

/** Whether `locationId` is one of the listed shops. */
function isListed(
  listed: readonly ListedShop[],
  locationId: LocationId,
): boolean {
  for (let i = 0; i < listed.length; i++) {
    if ((listed[i] as ListedShop).id === locationId) return true;
  }
  return false;
}

/** `locationIds` each once, in order, every one a listed location. */
function shopsOf(
  locationIds: readonly LocationId[],
  listed: readonly ListedShop[],
): Result<readonly LocationId[], TeamError> {
  const shops: LocationId[] = [];
  for (let i = 0; i < locationIds.length; i++) {
    const locationId = locationIds[i] as LocationId;
    if (!isListed(listed, locationId)) {
      return Result.err(TeamError.shopUnknown(locationId));
    }
    if (!shops.includes(locationId)) shops.push(locationId);
  }
  return Result.ok(shops);
}

/**
 * TeamSystem — the team callables' decisions (team onboarding D2, D5,
 * D9, `docs/designs/team-onboarding.md`). Pure: the pipeline reads the
 * caller's account, the barber record and what else a decision names
 * inside its commit, asks, and writes the record the decision answers —
 * the WHOLE next record, so the stored document is always exactly one
 * lifecycle variant.
 *
 * The caller's block is an elapsed-time rule on the account
 * (`AccountLifecycle.isBlockedAt`): `nowUtcMs`, never the shop clock.
 */
export const TeamSystem = {
  /**
   * Who may manage the team: a caller whose STORED roles hold `Roles.TEAM`
   * and who is not blocked (or erased) at `nowUtcMs` — else
   * `TEAM_FORBIDDEN`.
   */
  admit(caller: User | null, nowUtcMs: UtcEpochMs): Result<User, TeamError> {
    return caller !== null &&
      Roles.managesTeam(caller.roles) &&
      !AccountLifecycle.isBlockedAt(caller, nowUtcMs)
      ? Result.ok(caller)
      : Result.err(TeamError.forbidden());
  },

  /**
   * Who may edit `barberId`'s public profile: a caller, not blocked, whose
   * STORED roles hold `Roles.TEAM_PROFILES`, or whose account is linked to
   * this very record (a barber edits their own) — else `TEAM_FORBIDDEN`.
   */
  admitProfileEdit(
    caller: User | null,
    barberId: BarberId,
    nowUtcMs: UtcEpochMs,
  ): Result<User, TeamError> {
    return caller !== null &&
      !AccountLifecycle.isBlockedAt(caller, nowUtcMs) &&
      (Roles.editsTeamProfiles(caller.roles) ||
        caller.linkedBarberId === barberId)
      ? Result.ok(caller)
      : Result.err(TeamError.forbidden());
  },

  /**
   * Who may ask a draft to go live (`activateBarber`): any staff account,
   * not blocked — else `TEAM_FORBIDDEN`. The step decides nothing a caller
   * chooses: the record goes live only when its needed items are done, at
   * the status the admin set. So whoever may save one of those items — the
   * admin, the content editor, the front desk and a barber saving hours —
   * may trigger it, and the row credits them.
   */
  admitActivation(
    caller: User | null,
    nowUtcMs: UtcEpochMs,
  ): Result<User, TeamError> {
    return caller !== null &&
      Roles.isStaff(caller.roles) &&
      !AccountLifecycle.isBlockedAt(caller, nowUtcMs)
      ? Result.ok(caller)
      : Result.err(TeamError.forbidden());
  },

  /**
   * A new barber record, as a `DRAFT`: a name (Bulgarian required), shops
   * that are all listed locations, a last working day not before the start
   * day. No title, bio, avatar or offering yet; it sorts after every
   * existing record (a tie orders by id, and the admin reorders).
   */
  add(
    input: AddBarberInput,
    context: AddBarberContext,
  ): Result<Barber, TeamError> {
    const name = requiredText(input.name, 'name', NAME_MAX);
    if (!name.ok) return name;
    const shops = shopsOf(input.locationIds, context.listedShops);
    if (!shops.ok) return shops;
    const last = input.barberLastWorkingLocalDate;
    if (last !== null && last < input.barberStartsLocalDate) {
      return Result.err(TeamError.periodInvalid());
    }
    if (!BarberLifecycle.isLiveStatus(input.barberDraftTargetStatus)) {
      return Result.err(TeamError.invalidInput('barberDraftTargetStatus'));
    }
    return Result.ok({
      id: context.barberId,
      name: name.value,
      title: null,
      bio: null,
      yearsExperience: null,
      locationIds: shops.value,
      instagramHandle: null,
      barberJoinsAnyPool: input.barberJoinsAnyPool,
      sortOrder: context.barberCount + 1,
      ...BarberLifecycle.draft(context.nowUtcMs, input.barberDraftTargetStatus),
      barberStartsLocalDate: input.barberStartsLocalDate,
      barberLastWorkingLocalDate: last,
      avatarMediaId: null,
      avatarMediaPath: null,
      avatarMediaWidth: null,
      avatarMediaHeight: null,
      avatarMediaBlurhash: null,
      avatarMediaFocalX: null,
      avatarMediaFocalY: null,
      ...WriteProvenance.of(context.operationId),
    });
  },

  /**
   * The record with its profile replaced: the name (required), the title
   * and bio (`null` or blank is none), the Instagram handle (a leading `@`
   * dropped; `null` or blank is none) and the years of experience (`null`,
   * or a whole number from 0 to 80). `field` of the refusal names the
   * first one at fault.
   */
  editProfile(
    barber: Barber,
    input: BarberProfileInput,
    operationId: OperationId | null,
  ): Result<Barber, TeamError> {
    const live = current(barber);
    if (!live.ok) return live;
    const name = requiredText(input.name, 'name', NAME_MAX);
    if (!name.ok) return name;
    const title = optionalText(input.title, 'title', TITLE_MAX);
    if (!title.ok) return title;
    const bio = optionalText(input.bio, 'bio', BIO_MAX);
    if (!bio.ok) return bio;
    const typedHandle = (input.instagramHandle ?? '').trim().replace(/^@/, '');
    if (typedHandle.length > 0 && !INSTAGRAM.test(typedHandle)) {
      return Result.err(TeamError.invalidInput('instagramHandle'));
    }
    const years = input.yearsExperience;
    if (
      years !== null &&
      (!Number.isInteger(years) || years < 0 || years > EXPERIENCE_MAX)
    ) {
      return Result.err(TeamError.invalidInput('yearsExperience'));
    }
    return Result.ok({
      ...barber,
      name: name.value,
      title: title.value,
      bio: bio.value,
      instagramHandle: typedHandle.length === 0 ? null : typedHandle,
      yearsExperience: years,
      ...WriteProvenance.of(operationId),
    });
  },

  /**
   * The record at these shops (`[]` is every shop): every one a listed
   * location, and no shop removed while the roster's current or coming
   * versions — the ones still in force on `today` or later — have hours
   * there (`TEAM_SHOP_HAS_HOURS`, naming the first such shop).
   */
  setShops(
    barber: Barber,
    locationIds: readonly LocationId[],
    facts: {
      readonly listedShops: readonly ListedShop[];
      readonly schedule: BarberSchedule | null;
      readonly today: LocalDate;
    },
    operationId: OperationId | null,
  ): Result<Barber, TeamError> {
    const live = current(barber);
    if (!live.ok) return live;
    const shops = shopsOf(locationIds, facts.listedShops);
    if (!shops.ok) return shops;
    if (shops.value.length > 0 && facts.schedule !== null) {
      const coming: ScheduleVersion[] = [];
      for (const version of facts.schedule.versions) {
        if (
          version.effectiveToLocalDate === null ||
          version.effectiveToLocalDate >= facts.today
        ) {
          coming.push(version);
        }
      }
      const rostered = ScheduleVersion.locations(coming);
      for (let i = 0; i < rostered.length; i++) {
        const locationId = rostered[i] as LocationId;
        if (!shops.value.includes(locationId)) {
          return Result.err(TeamError.shopHasHours(locationId));
        }
      }
    }
    return Result.ok({
      ...barber,
      locationIds: shops.value,
      ...WriteProvenance.of(operationId),
    });
  },

  /** The record with this working period: a last day, when set, not before the start day. */
  setPeriod(
    barber: Barber,
    barberStartsLocalDate: LocalDate,
    barberLastWorkingLocalDate: LocalDate | null,
    operationId: OperationId | null,
  ): Result<Barber, TeamError> {
    const live = current(barber);
    if (!live.ok) return live;
    if (
      barberLastWorkingLocalDate !== null &&
      barberLastWorkingLocalDate < barberStartsLocalDate
    ) {
      return Result.err(TeamError.periodInvalid());
    }
    return Result.ok({
      ...barber,
      barberStartsLocalDate,
      barberLastWorkingLocalDate,
      ...WriteProvenance.of(operationId),
    });
  },

  /** The record in or out of the «Който и да е» pool. */
  setPool(
    barber: Barber,
    barberJoinsAnyPool: boolean,
    operationId: OperationId | null,
  ): Result<Barber, TeamError> {
    const live = current(barber);
    if (!live.ok) return live;
    return Result.ok({
      ...barber,
      barberJoinsAnyPool,
      ...WriteProvenance.of(operationId),
    });
  },

  /**
   * Who may book the record: for a `DRAFT`, where it goes when it goes
   * live; for a live record, the status it now holds (the same status
   * changes nothing, and keeps its stamp).
   */
  setAccess(
    barber: Barber,
    barberStatus: BarberLifecycle.LiveStatus,
    nowUtcMs: UtcEpochMs,
    operationId: OperationId | null,
  ): Result<Barber, TeamError> {
    const live = current(barber);
    if (!live.ok) return live;
    if (barber.barberStatus === barberStatus) return Result.ok(barber);
    const rest = {
      ...withoutLifecycle(barber),
      ...WriteProvenance.of(operationId),
    };
    return Result.ok(
      barber.barberStatus === BarberStatus.Draft
        ? {
            ...rest,
            ...BarberLifecycle.draft(
              barber.barberStatusChangedAtUtcMs,
              barberStatus,
            ),
          }
        : { ...rest, ...BarberLifecycle.live(barberStatus, nowUtcMs) },
    );
  },

  /**
   * The go-live step (idempotent): a `DRAFT` whose checklist is ready goes
   * live at its target status; one that is not names the first needed item
   * missing; any other record is unchanged. `barber` of the answer is the
   * record to write, present only when it was activated.
   */
  activate(
    barber: Barber,
    checklist: StaffSetupChecklist,
    nowUtcMs: UtcEpochMs,
    operationId: OperationId | null,
  ): {
    readonly answer: BarberActivationAnswer;
    readonly barber: Barber | null;
  } {
    if (barber.barberStatus !== BarberStatus.Draft) {
      return {
        answer: { barberActivation: BarberActivation.Unchanged },
        barber: null,
      };
    }
    if (checklist.firstMissing !== null) {
      return {
        answer: {
          barberActivation: BarberActivation.NotReady,
          staffSetupItem: checklist.firstMissing,
        },
        barber: null,
      };
    }
    return {
      answer: { barberActivation: BarberActivation.Activated },
      barber: {
        ...withoutLifecycle(barber),
        ...WriteProvenance.of(operationId),
        ...BarberLifecycle.live(barber.barberDraftTargetStatus, nowUtcMs),
      },
    };
  },

  /**
   * Whether the record still takes an edit — of itself, or of what it
   * performs: a record that has left the shop is `TEAM_BARBER_DEPARTED`.
   */
  editable: current,

  /** Whether the record may be deleted: only one that never went live. */
  removable(barber: Barber): Result<Barber, TeamError> {
    return barber.barberStatus === BarberStatus.Draft
      ? Result.ok(barber)
      : Result.err(TeamError.notDraft(barber.id));
  },

  /**
   * The stored field NAMES a write changes, ascending and each once
   * (`GovernedChangeSystem.changedFields` — a creation's or a deletion's
   * whole key list) — without the record's id, which is the document's
   * name, and without `writeOperationId`, which every act restamps.
   */
  changedFields(
    before: Barber | null,
    after: Barber | null,
  ): readonly string[] {
    const names = GovernedChangeSystem.changedFields(before, after);
    const changed: string[] = [];
    for (let i = 0; i < names.length; i++) {
      const name = names[i] as string;
      if (name !== 'id' && name !== 'writeOperationId') changed.push(name);
    }
    return changed;
  },

  /**
   * The write plan of one team act (team onboarding D12): the record SET
   * whole (the document is the entity minus `id`, so it is always exactly
   * one lifecycle variant) — or removed — and its ONE `TEAM_BARBER_*` row
   * under `hash(idBasis)`, which lands with the write or not at all. An
   * act that changes no stored field plans NOTHING: a save of what is
   * already there, and the replay of an act that landed, write no document
   * and no row.
   */
  writesOf(
    write: TeamBarberWrite,
    hash: (input: string) => string,
  ): readonly WriteOp[] {
    const { before, after } = write;
    const record = after ?? before;
    if (record === null) return [];
    const fields = TeamSystem.changedFields(before, after);
    if (fields.length === 0) return [];
    const path = [Collections.Barbers, record.id];
    const { id: barberId, ...body } = record;
    return [
      after === null ? WriteOp.remove(path) : WriteOp.set(path, body),
      ...AuditSystem.createsOf(
        [
          AuditSystem.planTeamBarber(
            write.action,
            barberId,
            before,
            after,
            fields,
            write.actor,
            write.nowUtcMs,
            write.operationId,
          ),
        ],
        hash,
      ),
    ];
  },
} as const;
