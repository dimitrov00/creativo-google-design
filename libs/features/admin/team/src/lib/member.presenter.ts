import {
  type BarberLifecycle,
  BarberStatus,
  type LeftoverBookings,
  LocalizedText,
  RecordClaim,
  type StaffPermissions,
  StaffSetupItem,
  type TeamMember,
  TeamMemberNote,
} from '@core/components';
import type { Barber, ShopLocation } from '@core/entities';
import type { LocalDate, Locale } from '@core/primitives';
import type { StaffSetupChecklist, StaffSetupEntry } from '@core/systems';
import { shopNameOf } from '@creativo/features/shared/catalog';
import { levelLinks } from './levels.presenter';
import { releaseQuestionVm } from './link-question.presenter';
import type { LinkWords } from './link.words';
import {
  DeleteAnswer,
  type KeptNoticeVm,
  type LeftoverNoticeVm,
  type OwingNoticeVm,
  type LevelLinkVm,
  type MemberAccountVm,
  MemberEditor,
  type MemberPageVm,
  type MemberRowVm,
  type SetupRowVm,
} from './member.vm';
import type { MemberWords } from './member.words';
import { dayWords, firstWord, lineOf } from './team.format';
import type { TeamWords } from './team.words';

/*
 * A TEAM MEMBER'S PAGE, WORDED (Law 10): the record, its checklist and the
 * account beside it in; the rows a template prints out. It decides nothing.
 * What a record still needs is `StaffSetupSystem`'s, who may book it is
 * `TeamSystem.accessOf`'s, whose record it is to the person looking is
 * `TeamRosterSystem.claimOf`'s, and what that person may change is the
 * access service's — each handed in; this file gives them their words.
 */

/** What a member's page is worded from. */
export type MemberPageInput = {
  readonly barber: Barber;
  /** `StaffSetupSystem.checklistOf` over the live record, services and roster. */
  readonly checklist: StaffSetupChecklist;
  /** `StaffSetupSystem.doneCountOf(checklist)`. */
  readonly doneCount: number;
  /** `OfferingPriceSystem.performedCount` — how many services list the barber. */
  readonly servicesCount: number;
  /** `TeamSystem.accessOf` — who may book the record; `null` once it has left. */
  readonly bookedBy: BarberLifecycle.LiveStatus | null;
  /** The shops the record works at (`LocationScopeSystem.servesLocation`), in the catalogue's order. */
  readonly shops: readonly ShopLocation[];
  /** The record names no shop of its own (`LocationScopeSystem.homeOf` is `null`): it works at every one. */
  readonly everyShop: boolean;
  /** `LocationScopeSystem.isMultiShop` — a one-shop business never sees the shops row. */
  readonly multiShop: boolean;
  /** The Team list's row for the record; `null` while the list has none. */
  readonly member: TeamMember.OfBarber | null;
  /** `TeamRosterSystem.claimOf` for the person looking. */
  readonly recordClaim: RecordClaim;
  /** The person looking manages the team: the accounts were read for them. */
  readonly managesTeam: boolean;
  /** They may edit this record's profile, and the record still takes edits. */
  readonly mayEditProfile: boolean;
  /** They may change this record's period, pool and access, and it still takes edits. */
  readonly mayManage: boolean;
  /** They may change this record's weekly hours, and it still takes edits. */
  readonly mayEditHours: boolean;
  /** They may set what this record performs and its prices, and it still takes edits. */
  readonly mayEditOfferings: boolean;
  /** They may delete it (`TeamSystem.removable`, and they manage the team). */
  readonly deletable: boolean;
  /** They may bring it back (`TeamSystem.returnable`, and they manage the team). */
  readonly returnable: boolean;
  /** `EmploymentSystem.leftoverOf` after a leaver's last day; `null` when it was not read. */
  readonly leftover: LeftoverBookings | null;
  /** `TeamRosterSystem.linksAccount` — «Свържи профил» is theirs to offer. */
  readonly linksAccount: boolean;
  /** `TeamRosterSystem.releasesAccount` — «Разкачи профила» is theirs to offer. */
  readonly releasesAccount: boolean;
  /** They edit «Права»: the way to a level's page is theirs. */
  readonly editsPermissions: boolean;
  /** The cells in force, for how far a level departs from the standard. */
  readonly permissions: StaffPermissions;
  readonly avatarSrc: string | null;
  readonly words: TeamWords;
  readonly memberWords: MemberWords;
  readonly linkWords: LinkWords;
  readonly locale: Locale;
  /** The shop's today; `null` until its zone is known (a date then carries its year). */
  readonly today: LocalDate | null;
};

function nameOf(input: MemberPageInput): string {
  return LocalizedText.pick(input.barber.name, input.locale);
}

function dayOf(day: LocalDate, input: MemberPageInput): string {
  return dayWords(day, input.today, input.locale);
}

/** «Подготовка · 3 от 5» · «Приема записи» · «Напусна на 30 септ.» */
function standingOf(input: MemberPageInput): string {
  const { barber, words } = input;
  const standing = words.standing.get(barber.barberStatus) ?? '';
  if (barber.barberStatus === BarberStatus.Departed) {
    const last = barber.barberLastWorkingLocalDate;
    return last === null ? standing : words.departedOn(dayOf(last, input));
  }
  return barber.barberStatus === BarberStatus.Draft
    ? lineOf([
        standing,
        words.setup(input.doneCount, input.checklist.needed.length),
      ])
    : standing;
}

/** Whether the checklist shows `item` done — the system's answer, read, never re-derived. */
function isDone(input: MemberPageInput, item: StaffSetupItem): boolean {
  for (const entry of input.checklist.needed) {
    if (entry.staffSetupItem === item) return entry.done;
  }
  return false;
}

/** «12 услуги», or the word for none. */
function servicesValue(input: MemberPageInput): string {
  return isDone(input, StaffSetupItem.Services)
    ? input.memberWords.services(input.servicesCount)
    : input.memberWords.none;
}

/** «Зададено», or the word for none. */
function hoursValue(input: MemberPageInput): string {
  return isDone(input, StaffSetupItem.Hours)
    ? input.memberWords.hoursSet
    : input.memberWords.none;
}

/** «Център, Младост», or «Всички» for a record that works at every shop. */
function shopsValue(input: MemberPageInput): string {
  return input.everyShop
    ? input.memberWords.allShops
    : input.shops.map((shop) => shopNameOf(shop, input.locale)).join(', ');
}

/** «от 3 март» · «3 март – 31 дек.» */
function periodValue(input: MemberPageInput): string {
  const { barber, memberWords } = input;
  const from = dayOf(barber.barberStartsLocalDate, input);
  const last = barber.barberLastWorkingLocalDate;
  return last === null
    ? memberWords.periodFrom(from)
    : memberWords.periodRange(from, dayOf(last, input));
}

/**
 * «Преди: 3.03.2024 г. – 30.11.2025 г.» — the periods worked before the
 * current one (`barberPastPeriods`, oldest first), every end with its year;
 * `null` for a record that has never left and come back.
 */
function earlierPeriodsOf(input: MemberPageInput): string | null {
  const { barber, memberWords } = input;
  if (barber.barberPastPeriods.length === 0) return null;
  return memberWords.periodEarlier(
    barber.barberPastPeriods
      .map((period) =>
        // History: both ends always carry their year, so a period across
        // a new year never reads «12.10.2025 г. – 17.09».
        memberWords.periodRange(
          dayWords(period.pastStartsLocalDate, null, input.locale),
          dayWords(period.pastLastWorkingLocalDate, null, input.locale),
        ),
      )
      .join(', '),
  );
}

/** One row of the checklist; `null` for an item the page gives no row. */
function setupRow(
  entry: StaffSetupEntry,
  input: MemberPageInput,
): SetupRowVm | null {
  const { memberWords } = input;
  const item = entry.staffSetupItem;
  const label = memberWords.items.get(item);
  if (label === undefined) return null;
  if (item === StaffSetupItem.Shops && !input.multiShop) return null;
  let value: string;
  let memberEditor: MemberEditor | null = null;
  switch (item) {
    case StaffSetupItem.Name:
      value = nameOf(input);
      memberEditor = input.mayEditProfile ? MemberEditor.Profile : null;
      break;
    case StaffSetupItem.StartDay:
      value = dayOf(input.barber.barberStartsLocalDate, input);
      memberEditor = input.mayManage ? MemberEditor.Period : null;
      break;
    case StaffSetupItem.Shops:
      value = shopsValue(input);
      memberEditor = input.mayManage ? MemberEditor.Shops : null;
      break;
    case StaffSetupItem.Services:
      value = servicesValue(input);
      memberEditor = input.mayEditOfferings ? MemberEditor.Offerings : null;
      break;
    default:
      value = hoursValue(input);
      memberEditor = input.mayEditHours ? MemberEditor.Hours : null;
  }
  return {
    staffSetupItem: item,
    label,
    value,
    done: entry.done,
    state: entry.done ? memberWords.setupDone : memberWords.setupMissing,
    memberEditor,
    testId: `member-setup-${item}`,
  };
}

/** The «Профил» group's value rows. */
function profileRows(
  input: MemberPageInput,
  isDraft: boolean,
): readonly MemberRowVm[] {
  const { barber, memberWords } = input;
  const rows: MemberRowVm[] = [
    {
      id: 'profile',
      label: memberWords.profileRow,
      value:
        barber.title === null
          ? memberWords.none
          : LocalizedText.pick(barber.title, input.locale),
      memberEditor: input.mayEditProfile ? MemberEditor.Profile : null,
      testId: 'member-row-profile',
      detail: null,
    },
  ];
  // A draft's hours and services are rows of its checklist; a record at
  // work lists them here.
  if (!isDraft) {
    rows.push({
      id: 'hours',
      label: memberWords.items.get(StaffSetupItem.Hours) ?? '',
      value: hoursValue(input),
      memberEditor: input.mayEditHours ? MemberEditor.Hours : null,
      testId: 'member-row-hours',
      detail: null,
    });
    rows.push({
      id: 'services',
      label: memberWords.items.get(StaffSetupItem.Services) ?? '',
      value: servicesValue(input),
      memberEditor: input.mayEditOfferings ? MemberEditor.Offerings : null,
      testId: 'member-row-services',
      detail: null,
    });
  }
  // A one-shop business has no shops to tell apart, and no row for them.
  if (!isDraft && input.multiShop) {
    rows.push({
      id: 'shops',
      label: memberWords.items.get(StaffSetupItem.Shops) ?? '',
      value: shopsValue(input),
      memberEditor: input.mayManage ? MemberEditor.Shops : null,
      testId: 'member-row-shops',
      detail: null,
    });
  }
  rows.push({
    id: 'period',
    label: memberWords.periodRow,
    value: periodValue(input),
    memberEditor: input.mayManage ? MemberEditor.Period : null,
    testId: 'member-row-period',
    detail: earlierPeriodsOf(input),
  });
  return rows;
}

/** «Администратор, Бръснар» — the roles a row may name, in its order. */
function rolesLine(member: TeamMember.OfBarber, words: TeamWords): string {
  const named: string[] = [];
  for (const [role, word] of words.roles) {
    if (member.memberRoles.includes(role)) named.push(word);
  }
  return named.join(', ');
}

/** The account block: who is linked, in what roles, and the line under it. */
function accountOf(input: MemberPageInput): MemberAccountVm | null {
  const { member, memberWords, recordClaim } = input;
  if (!input.managesTeam || member === null) return null;
  const mine = recordClaim === RecordClaim.Mine;
  const facts = [
    ...(mine ? [memberWords.mine] : []),
    rolesLine(member, input.words),
  ].filter((fact) => fact.length > 0);
  const first = firstWord(nameOf(input));
  return {
    isMine: mine,
    isOpen: recordClaim === RecordClaim.Open,
    linkable: input.linksAccount,
    release:
      input.releasesAccount && member.memberAccountName !== null
        ? releaseQuestionVm(member.memberAccountName, input.linkWords)
        : null,
    name: member.memberAccountName,
    line: facts.join(' · '),
    footnote: mine
      ? memberWords.accountMine
      : member.memberUserId !== null
        ? null
        : input.barber.barberStatus === BarberStatus.Departed
          ? // A leaver's record says why nobody signs in as them.
            memberWords.accountDeparted(first)
          : input.linksAccount
            ? memberWords.accountLink(first)
            : memberWords.accountNone(first),
  };
}

/** The bookings a leaver still holds: how many, and what to do — the days are the list's, beside it. */
function leftoverOf(input: MemberPageInput): LeftoverNoticeVm | null {
  const { leftover, memberWords } = input;
  const count = leftover?.leftoverCount ?? 0;
  return count === 0
    ? null
    : {
        title: memberWords.departedLeftoverTitle(
          firstWord(nameOf(input)),
          count,
        ),
        body: memberWords.departedLeftoverBody(count),
      };
}

/**
 * A leaver whose account still has its sessions (`TeamMemberNote.SESSIONS_OWED`,
 * the Team row's own note — said only to whoever sees accounts), and
 * «Опитай пак»; `null` otherwise.
 */
function owingOf(input: MemberPageInput): OwingNoticeVm | null {
  const { member, memberWords } = input;
  return input.managesTeam &&
    member?.teamMemberNote === TeamMemberNote.SessionsOwed
    ? {
        title: memberWords.owingTitle(firstWord(nameOf(input))),
        body: memberWords.owingBody,
        action: memberWords.owingRetry,
      }
    : null;
}

/**
 * A leaver whose account kept its roles at the close (`ACCESS_KEPT`, the
 * Team row's own note — said only to whoever sees accounts), and «Роли» on
 * that account; `null` otherwise.
 */
function keptOf(input: MemberPageInput): KeptNoticeVm | null {
  const { member, memberWords } = input;
  return input.managesTeam &&
    member?.teamMemberNote === TeamMemberNote.AccessKept &&
    member.memberKeptUserId !== null
    ? {
        title: memberWords.keptTitle(firstWord(nameOf(input))),
        body: memberWords.keptBody,
        action: memberWords.keptAction,
        accountUserId: member.memberKeptUserId,
      }
    : null;
}

/** The way to «Права» for each level the linked account holds. */
function levelsOf(input: MemberPageInput): readonly LevelLinkVm[] {
  const { member } = input;
  return member === null
    ? []
    : levelLinks({
        roles: member.memberRoles,
        editsPermissions: input.editsPermissions,
        permissions: input.permissions,
        words: input.words,
        levelRow: input.memberWords.levelRow,
        testIdPrefix: 'member-level',
      });
}

/** A team member's page: the head, the checklist, the profile, the account. */
export function memberPageVm(input: MemberPageInput): MemberPageVm {
  const { barber, memberWords } = input;
  const name = nameOf(input);
  const isDraft = barber.barberStatus === BarberStatus.Draft;
  const setup: SetupRowVm[] = [];
  if (isDraft) {
    for (const entry of input.checklist.needed) {
      const row = setupRow(entry, input);
      if (row !== null) setup.push(row);
    }
  }
  const bookedBy = input.bookedBy;
  return {
    barberId: barber.id,
    name,
    standing: standingOf(input),
    avatarSrc: input.avatarSrc,
    // The photo is part of the profile: whoever edits it sets the photo.
    photoLabel: !input.mayEditProfile
      ? null
      : barber.avatarMediaPath === null
        ? memberWords.photoAdd
        : memberWords.photoChange,
    setup,
    goesLive: isDraft ? memberWords.goesLive(firstWord(name)) : null,
    profile: profileRows(input, isDraft),
    bookedBy:
      bookedBy === null
        ? null
        : {
            id: bookedBy,
            word: memberWords.bookedBy.get(bookedBy) ?? bookedBy,
            options: [...memberWords.bookedBy].map(([status, label]) => ({
              id: status,
              label,
              testId: `member-booked-by-${status}`,
            })),
          },
    manageable: input.mayManage,
    account: accountOf(input),
    levels: levelsOf(input),
    returnable: input.returnable,
    leftover: leftoverOf(input),
    owing: owingOf(input),
    kept: keptOf(input),
    deletable: input.deletable,
    deleteTitle: memberWords.deleteTitle(name),
    deleteActions: [
      {
        id: DeleteAnswer.Delete,
        label: memberWords.deleteLabel,
        role: 'destructive',
        testId: 'member-delete-confirm',
      },
      {
        id: DeleteAnswer.Cancel,
        label: memberWords.deleteCancel,
        role: 'cancel',
        testId: 'member-delete-cancel',
      },
    ],
    liveReceipt: memberWords.live(firstWord(name)),
  };
}
