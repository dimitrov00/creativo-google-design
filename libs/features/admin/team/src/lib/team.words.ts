import { BarberStatus, Role } from '@core/components';
import {
  AccessScope,
  CapabilityGroup,
  StaffCapability,
  Tag,
} from '@core/primitives';

/** `translate(key, params)` in the language the catalogue has loaded. */
export type Translate = (
  key: string,
  params?: Readonly<Record<string, unknown>>,
) => string;

/**
 * Every word the Team screens print (`admin.team.*`, `admin.permissions.*`)
 * beside the words they share with the rest of the app: a role's name is
 * the client card's (`clientCard.roles.role.*`), a capability's row label
 * and its group are the staff vocabulary's (`staff.permissions.*`).
 */
export type TeamWords = {
  readonly ledeAll: string;
  readonly ledeRecords: string;
  readonly groupBarbers: string;
  readonly groupOthers: string;
  readonly groupDeparted: string;
  /** How a barber record stands, by its lifecycle tag. */
  readonly standing: ReadonlyMap<BarberStatus, string>;
  /** «Напусна на 31 дек.» */
  readonly departedOn: (date: string) => string;
  /** «3 от 5» — a record's progress through what it needs. */
  readonly setup: (done: number, needed: number) => string;
  /** «Последен ден: 31 дек.» */
  readonly lastDay: (date: string) => string;
  readonly noAccount: string;
  /** A role's name; a role with no word here is not printed. */
  readonly roles: ReadonlyMap<Role, string>;

  readonly standard: string;
  /** «1 промяна · 3 промени» */
  readonly changes: (count: number) => string;
  readonly holdersNone: string;
  /** «Иван, Георги и още 2» */
  readonly holdersMore: (names: string, count: number) => string;
  /** «Важи за 4 души» — for nobody, one person, several. */
  readonly applies: (count: number) => string;
  readonly adminTitle: string;
  readonly adminLine: string;
  readonly scopes: ReadonlyMap<AccessScope, string>;
  readonly switchOn: string;
  readonly switchOff: string;
  /** «Стандартно: Само своите» */
  readonly standardWas: (scope: string) => string;
  readonly capabilities: ReadonlyMap<StaffCapability, string>;
  readonly capabilityGroups: ReadonlyMap<CapabilityGroup, string>;
};

/** The roles a Team row may name, in the order it names them. */
const NAMED_ROLES: readonly Role[] = [
  Role.Admin,
  Role.Barber,
  Role.Receptionist,
  Role.ContentManager,
  Role.Sysadmin,
];

/** The Team screens' words in one language. */
export function teamWordsOf(translate: Translate): TeamWords {
  return {
    ledeAll: translate('admin.team.ledeAll'),
    ledeRecords: translate('admin.team.ledeRecords'),
    groupBarbers: translate('admin.team.groups.barbers'),
    groupOthers: translate('admin.team.groups.others'),
    groupDeparted: translate('admin.team.groups.departed'),
    standing: new Map(
      Tag.values(BarberStatus).map((barberStatus) => [
        barberStatus,
        translate(`admin.team.status.${barberStatus}`),
      ]),
    ),
    departedOn: (date) => translate('admin.team.status.departedOn', { date }),
    setup: (done, needed) => translate('admin.team.setup', { done, needed }),
    lastDay: (date) => translate('admin.team.note.LAST_DAY_SET', { date }),
    noAccount: translate('admin.team.note.NO_ACCOUNT'),
    roles: new Map(
      NAMED_ROLES.map((role) => [
        role,
        role === Role.Sysadmin
          ? translate('admin.team.roles.sysadmin')
          : translate(`clientCard.roles.role.${role}`),
      ]),
    ),

    standard: translate('admin.permissions.standard'),
    changes: (count) =>
      count === 1
        ? translate('admin.permissions.changesOne')
        : translate('admin.permissions.changesMany', { count }),
    holdersNone: translate('admin.permissions.holdersNone'),
    holdersMore: (names, count) =>
      translate('admin.permissions.holdersMore', { names, count }),
    applies: (count) =>
      count === 0
        ? translate('admin.permissions.appliesNone')
        : count === 1
          ? translate('admin.permissions.appliesOne')
          : translate('admin.permissions.appliesMany', { count }),
    adminTitle: translate('admin.permissions.adminTitle'),
    adminLine: translate('admin.permissions.adminLine'),
    scopes: new Map(
      Tag.values(AccessScope).map((scope) => [
        scope,
        translate(`admin.permissions.scope.${scope}`),
      ]),
    ),
    switchOn: translate('admin.permissions.switchOn'),
    switchOff: translate('admin.permissions.switchOff'),
    standardWas: (scope) =>
      translate('admin.permissions.standardWas', { scope }),
    capabilities: new Map(
      Tag.values(StaffCapability).map((capability) => [
        capability,
        translate(`staff.permissions.capabilities.${capability}`),
      ]),
    ),
    capabilityGroups: new Map(
      Tag.values(CapabilityGroup).map((group) => [
        group,
        translate(`staff.permissions.groups.${group}`),
      ]),
    ),
  };
}
