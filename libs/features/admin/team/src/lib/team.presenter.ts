import {
  BarberStatus,
  LocalizedText,
  type StaffLevel,
  StaffPermissions,
  type TeamMember,
  TeamMemberNote,
  TeamMemberStatus,
} from '@core/components';
import {
  AccessScope,
  type BarberId,
  type LocalDate,
  type Locale,
} from '@core/primitives';
import type { TeamSections } from '@core/systems';
import { formatWallClock } from '@creativo/ui/wall-clock';
import {
  type LevelPageVm,
  type LevelRowVm,
  type LevelsVm,
  type PermissionGroupVm,
  type PermissionRowVm,
  type TeamPageVm,
  type TeamRowVm,
  TeamRun,
  type TeamRunVm,
} from './team.vm';
import type { TeamWords } from './team.words';

/*
 * THE TEAM SCREENS' PRESENTERS (Law 10): ecs-core values in, the words a
 * template prints out. They decide nothing. Which run a member stands in,
 * who holds a level, on which capabilities a level departs from the
 * standard, which answers a cell offers and what the standard is are all
 * answers of `TeamRosterSystem` and `StaffPermissions`, handed in or asked
 * here; this file gives each its words.
 */

/**
 * The no-break space: inside a fact («31 дек.», «3 от 5») so it is one word
 * to the line breaker, and BEFORE a separator, so a quiet line that wraps
 * ends its first line on the «·».
 */
const NBSP = ' ';

/** A quiet line of facts: each one word to the line breaker, «·» between. */
function lineOf(facts: readonly string[]): string {
  return facts.map((fact) => fact.replaceAll(' ', NBSP)).join(`${NBSP}· `);
}

/** «31 дек.» · «31 дек. 2027 г.» — a day in a quiet line, the year only outside `today`'s. */
function dayWords(
  day: LocalDate,
  today: LocalDate | null,
  locale: Locale,
): string {
  const sameYear = today !== null && day.slice(0, 4) === today.slice(0, 4);
  return formatWallClock(day, null, locale, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** What the Team list is worded from. */
export type TeamPageInput = {
  /** `TeamRosterSystem.sectionsOf` over the rows `listTeam` answered. */
  readonly sections: TeamSections;
  /** The person manages the team (`TEAM_MANAGE`): the lede speaks of people, not of profiles. */
  readonly managesTeam: boolean;
  /** Each record's portrait, where the catalogue has one. */
  readonly avatars: ReadonlyMap<BarberId, string | null>;
  readonly words: TeamWords;
  readonly locale: Locale;
  /** The shop's today; `null` until its zone is known (a date then carries its year). */
  readonly today: LocalDate | null;
};

/** How a barber record stands: its lifecycle in words, a draft's progress, a leaver's day. */
function standingOf(
  member: TeamMember.OfBarber,
  input: TeamPageInput,
): readonly string[] {
  const { words } = input;
  const standing = words.standing.get(member.teamMemberStatus) ?? '';
  if (member.teamMemberStatus === BarberStatus.Departed) {
    const last = member.barberLastWorkingLocalDate;
    return [
      last === null
        ? standing
        : words.departedOn(dayWords(last, input.today, input.locale)),
    ];
  }
  return member.teamMemberStatus === BarberStatus.Draft
    ? [standing, words.setup(member.setupDoneCount, member.setupNeededCount)]
    : [standing];
}

/** The one note a record carries, in words; none when it carries none. */
function noteOf(
  member: TeamMember.OfBarber,
  input: TeamPageInput,
): readonly string[] {
  const { words } = input;
  if (member.teamMemberNote === TeamMemberNote.NoAccount) {
    return [words.noAccount];
  }
  const last = member.barberLastWorkingLocalDate;
  return member.teamMemberNote === TeamMemberNote.LastDaySet && last !== null
    ? [words.lastDay(dayWords(last, input.today, input.locale))]
    : [];
}

function barberRow(
  member: TeamMember.OfBarber,
  input: TeamPageInput,
): TeamRowVm {
  return {
    id: member.barberId,
    name: LocalizedText.pick(member.memberName, input.locale),
    line: lineOf([...standingOf(member, input), ...noteOf(member, input)]),
    avatarSrc: input.avatars.get(member.barberId) ?? null,
    testId: `team-member-${member.barberId}`,
  };
}

function accountRow(
  member: TeamMember.RoleOnly,
  input: TeamPageInput,
): TeamRowVm {
  const roles: string[] = [];
  for (const [role, word] of input.words.roles) {
    if (member.memberRoles.includes(role)) roles.push(word);
  }
  return {
    id: member.memberUserId,
    name: member.memberAccountName,
    line: roles.join(', '),
    avatarSrc: null,
    testId: `team-member-${member.memberUserId}`,
  };
}

/** The Team list: its lede and its runs, an empty run left out. */
export function teamPageVm(input: TeamPageInput): TeamPageVm {
  const { sections, words } = input;
  const runs: TeamRunVm[] = [
    {
      teamRun: TeamRun.Barbers,
      title: words.groupBarbers,
      rows: sections.working.map((member) => barberRow(member, input)),
    },
    {
      teamRun: TeamRun.Others,
      title: words.groupOthers,
      rows: sections.others.map((member) => accountRow(member, input)),
    },
    {
      teamRun: TeamRun.Departed,
      title: words.groupDeparted,
      rows: sections.departed.map((member) => barberRow(member, input)),
    },
  ];
  return {
    lede: input.managesTeam ? words.ledeAll : words.ledeRecords,
    runs: runs.filter((run) => run.rows.length > 0),
  };
}

/** How many names a holders line spells out before «и още N». */
const NAMES_SHOWN = 3;

/**
 * The name a member goes by on a holders line: the first word of the name
 * the Team list shows them under — a record's own, an account's for
 * someone with no record.
 */
function shortName(member: TeamMember, locale: Locale): string {
  const name =
    member.teamMemberStatus === TeamMemberStatus.RoleOnly
      ? member.memberAccountName
      : LocalizedText.pick(member.memberName, locale);
  return name.trim().split(/\s+/)[0] ?? name;
}

/** What «Права» is worded from. */
export type LevelsInput = {
  /** The cells as the page would save them (`PermissionsStore.next`). */
  readonly next: StaffPermissions;
  /** The levels that hold changes not saved yet. */
  readonly unsaved: ReadonlySet<StaffLevel>;
  /** `TeamRosterSystem.holdersOf` per level; `null` while the team has not loaded. */
  readonly holders: ReadonlyMap<StaffLevel, readonly TeamMember[]> | null;
  readonly words: TeamWords;
  readonly locale: Locale;
};

/** «Иван, Георги, Мартин и още 1» — who holds a level, the word for nobody, nothing while unknown. */
function holdersLine(
  holders: readonly TeamMember[] | undefined,
  input: LevelsInput,
): string {
  if (holders === undefined) return '';
  if (holders.length === 0) return input.words.holdersNone;
  const names = holders
    .slice(0, NAMES_SHOWN)
    .map((member) => shortName(member, input.locale))
    .join(', ');
  return holders.length > NAMES_SHOWN
    ? input.words.holdersMore(names, holders.length - NAMES_SHOWN)
    : names;
}

/** «Права»: each editable level with who holds it and how far it departs. */
export function levelsVm(input: LevelsInput): LevelsVm {
  const { words } = input;
  return {
    levels: StaffPermissions.LEVELS.map((level): LevelRowVm => {
      const departures = StaffPermissions.departuresOf(input.next, level);
      return {
        level,
        name: words.roles.get(level) ?? level,
        holders: holdersLine(input.holders?.get(level), input),
        value:
          departures.length === 0
            ? words.standard
            : words.changes(departures.length),
        unsaved: input.unsaved.has(level),
        testId: `permissions-level-${level}`,
      };
    }),
    adminTitle: words.adminTitle,
    adminLine: words.adminLine,
  };
}

/** What a level's page is worded from. */
export type LevelPageInput = {
  readonly level: StaffLevel;
  /** The cells as the page would save them (`PermissionsStore.next`). */
  readonly next: StaffPermissions;
  /** How many members hold the level; `null` while the team has not loaded. */
  readonly holderCount: number | null;
  readonly words: TeamWords;
};

function permissionRow(
  input: LevelPageInput,
  staffCapability: PermissionRowVm['staffCapability'],
  departures: readonly PermissionRowVm['staffCapability'][],
): PermissionRowVm {
  const { level, words } = input;
  const accessScope = StaffPermissions.scopeOf(
    input.next,
    level,
    staffCapability,
  );
  const standard = StaffPermissions.standardOf(level, staffCapability);
  const offered = StaffPermissions.offered(level, staffCapability);
  const isSwitch = offered.length === 2;
  const word = (scope: AccessScope): string => words.scopes.get(scope) ?? scope;
  const key = `${level}-${staffCapability}`;
  return {
    staffCapability,
    label: words.capabilities.get(staffCapability) ?? staffCapability,
    isSwitch,
    on: accessScope !== AccessScope.None,
    accessScope,
    scopeWord: word(accessScope),
    options: offered.map((scope) => ({
      id: scope,
      label: word(scope),
      testId: `permission-scope-${key}-${scope}`,
    })),
    changed: departures.includes(staffCapability),
    standardWas: words.standardWas(
      isSwitch
        ? standard === AccessScope.None
          ? words.switchOff
          : words.switchOn
        : word(standard),
    ),
    key,
  };
}

/** A level's page: its rows in the page's groups, each a question with its answer. */
export function levelPageVm(input: LevelPageInput): LevelPageVm {
  const { level, words } = input;
  // `StaffPermissions.departuresOf` says which rows have left the standard;
  // a row is marked by its answer, never by a comparison made here.
  const departures = StaffPermissions.departuresOf(input.next, level);
  return {
    level,
    name: words.roles.get(level) ?? level,
    applies: input.holderCount === null ? '' : words.applies(input.holderCount),
    groups: StaffPermissions.GROUPS.map((group): PermissionGroupVm => ({
      id: group.capabilityGroup,
      title:
        words.capabilityGroups.get(group.capabilityGroup) ??
        group.capabilityGroup,
      rows: group.staffCapabilities.map((capability) =>
        permissionRow(input, capability, departures),
      ),
    })),
    departs: departures.length > 0,
  };
}
