import {
  BarberId,
  LocalDate,
  type Result,
  StoredFields,
  Tag,
  UserId,
} from '@core/primitives';
import { BarberStatus } from './barber-status.data';
import type { LocalizedText } from './localized-text.data';
import { Role } from './role.data';
import { StaffSetupItem } from './staff-setup-item.data';

/**
 * Where a member of the team stands (team onboarding D8) — the ONLY source
 * of these strings, the field `teamMemberStatus`: a barber record's own
 * lifecycle status, or `ROLE_ONLY` for an account that holds a staff role
 * and is linked to no barber record (the front desk, a content editor, an
 * admin, a barber not linked yet).
 */
export const TeamMemberStatus = {
  Draft: BarberStatus.Draft,
  StaffOnly: BarberStatus.StaffOnly,
  Public: BarberStatus.Public,
  Departed: BarberStatus.Departed,
  RoleOnly: 'ROLE_ONLY',
} as const;
export type TeamMemberStatus =
  (typeof TeamMemberStatus)[keyof typeof TeamMemberStatus];

/**
 * The one note a barber member's row carries (team onboarding D8) — the
 * ONLY source of these strings, the field `teamMemberNote`; the first that
 * applies, in this order. The invite notes join it with the invites.
 */
export const TeamMemberNote = {
  /** A last working day is set, and the barber has not left yet. */
  LastDaySet: 'LAST_DAY_SET',
  /** No account is linked to the record: bookable, but nobody signs in as them. */
  NoAccount: 'NO_ACCOUNT',
} as const;
export type TeamMemberNote =
  (typeof TeamMemberNote)[keyof typeof TeamMemberNote];

/**
 * One row of the Team page, as `listTeam` answers it — flat variants on
 * `teamMemberStatus`. Ids, names, roles, shop days and counts only: no
 * contact of anyone.
 */
export type TeamMember = TeamMember.OfBarber | TeamMember.RoleOnly;

/** A list of known roles, each once — `null` when it is no list or holds anything else. */
function rolesOf(raw: unknown): readonly Role[] | null {
  if (!Array.isArray(raw)) return null;
  const roles: Role[] = [];
  for (const value of raw as readonly unknown[]) {
    if (!Tag.has(Role, value)) return null;
    if (!roles.includes(value)) roles.push(value);
  }
  return roles;
}

/** A whole number from 0 up, else `null`. */
function countOf(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0
    ? raw
    : null;
}

/** A field through a smart constructor: the brand, or `null`. */
function parsedOf<T>(
  raw: unknown,
  parse: (value: string) => Result<T, unknown>,
): T | null {
  if (typeof raw !== 'string') return null;
  const parsed = parse(raw);
  return parsed.ok ? parsed.value : null;
}

/** Display text in both languages, else `null`. */
function textOf(raw: unknown): LocalizedText | null {
  if (!StoredFields.isRecord(raw)) return null;
  const bg = raw['bg'];
  const en = raw['en'];
  return typeof bg === 'string' && typeof en === 'string' ? { bg, en } : null;
}

export const TeamMember = {
  /**
   * The edge guard for one member of a `listTeam` answer: every field read
   * by name and re-parsed — else `null`, and the whole answer is unusable.
   */
  read(raw: unknown): TeamMember | null {
    if (!StoredFields.isRecord(raw)) return null;
    const teamMemberStatus = raw['teamMemberStatus'];
    if (!Tag.has(TeamMemberStatus, teamMemberStatus)) return null;
    const memberRoles = rolesOf(raw['memberRoles']);
    if (memberRoles === null) return null;
    if (teamMemberStatus === TeamMemberStatus.RoleOnly) {
      const memberUserId = parsedOf(raw['memberUserId'], UserId.parse);
      const memberAccountName = raw['memberAccountName'];
      return memberUserId === null || typeof memberAccountName !== 'string'
        ? null
        : { teamMemberStatus, memberUserId, memberAccountName, memberRoles };
    }
    const barberId = parsedOf(raw['barberId'], BarberId.parse);
    const memberName = textOf(raw['memberName']);
    const sentUserId = raw['memberUserId'] ?? null;
    const memberUserId =
      sentUserId === null ? null : parsedOf(sentUserId, UserId.parse);
    const memberAccountName = raw['memberAccountName'] ?? null;
    const teamMemberNote = raw['teamMemberNote'] ?? null;
    const barberStartsLocalDate = parsedOf(
      raw['barberStartsLocalDate'],
      LocalDate.parse,
    );
    const sentLast = raw['barberLastWorkingLocalDate'] ?? null;
    const barberLastWorkingLocalDate =
      sentLast === null ? null : parsedOf(sentLast, LocalDate.parse);
    const setupDoneCount = countOf(raw['setupDoneCount']);
    const setupNeededCount = countOf(raw['setupNeededCount']);
    const staffSetupItem = raw['staffSetupItem'] ?? null;
    if (
      barberId === null ||
      memberName === null ||
      (sentUserId !== null && memberUserId === null) ||
      (memberAccountName !== null && typeof memberAccountName !== 'string') ||
      (teamMemberNote !== null && !Tag.has(TeamMemberNote, teamMemberNote)) ||
      barberStartsLocalDate === null ||
      (sentLast !== null && barberLastWorkingLocalDate === null) ||
      setupDoneCount === null ||
      setupNeededCount === null ||
      (staffSetupItem !== null && !Tag.has(StaffSetupItem, staffSetupItem))
    ) {
      return null;
    }
    return {
      teamMemberStatus,
      barberId,
      memberName,
      memberUserId,
      memberAccountName,
      memberRoles,
      teamMemberNote,
      barberStartsLocalDate,
      barberLastWorkingLocalDate,
      setupDoneCount,
      setupNeededCount,
      staffSetupItem,
    };
  },
} as const;

export namespace TeamMember {
  /** A barber record, with the account linked to it (if any) and its setup progress. */
  export type OfBarber = {
    readonly teamMemberStatus: BarberStatus;
    readonly barberId: BarberId;
    /** The record's name, as the catalogue shows it. */
    readonly memberName: LocalizedText;
    /** The account linked to the record; `null` when nobody signs in as them. */
    readonly memberUserId: UserId | null;
    /** That account's first and last name; `null` with no account. */
    readonly memberAccountName: string | null;
    /** That account's stored roles; `[]` with no account. */
    readonly memberRoles: readonly Role[];
    readonly teamMemberNote: TeamMemberNote | null;
    readonly barberStartsLocalDate: LocalDate;
    readonly barberLastWorkingLocalDate: LocalDate | null;
    /** How many of the items bookings need are done, and how many there are. */
    readonly setupDoneCount: number;
    readonly setupNeededCount: number;
    /** The first needed item still missing; `null` when every one is done. */
    readonly staffSetupItem: StaffSetupItem | null;
  };
  /** A staff account linked to no barber record. */
  export type RoleOnly = {
    readonly teamMemberStatus: typeof TeamMemberStatus.RoleOnly;
    readonly memberUserId: UserId;
    /** The account's first and last name; `''` for one that has not registered. */
    readonly memberAccountName: string;
    readonly memberRoles: readonly Role[];
  };
}
