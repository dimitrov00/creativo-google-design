import type { StaffLevel } from '@core/components';
import type {
  AccessScope,
  BarberId,
  StaffCapability,
  UserId,
} from '@core/primitives';

/** A run of the Team list — the field `teamRun`, the ONLY source of these strings. */
export const TeamRun = {
  /** Barber records that are setting up or working. */
  Barbers: 'BARBERS',
  /** Staff accounts with no barber record. */
  Others: 'OTHERS',
  /** Barber records that have left. */
  Departed: 'DEPARTED',
} as const;
export type TeamRun = (typeof TeamRun)[keyof typeof TeamRun];

/** One person of the Team list: a face, a name and one quiet line. */
export type TeamRowVm = {
  /** The record's id, or the account's for someone with no record. */
  readonly id: string;
  /** The barber record the row leads to; `null` for an account with no record. */
  readonly barberId: BarberId | null;
  /** The staff account the row leads to; `null` for a barber record. */
  readonly accountUserId: UserId | null;
  readonly name: string;
  /** How the person stands, then the one note; the role names for an account alone. */
  readonly line: string;
  readonly avatarSrc: string | null;
  readonly testId: string;
};

/** One run of the Team list, under its heading. */
export type TeamRunVm = {
  readonly teamRun: TeamRun;
  readonly title: string;
  readonly rows: readonly TeamRowVm[];
};

/** The Team page: what it says under its title, and its runs (the empty ones left out). */
export type TeamPageVm = {
  readonly lede: string;
  readonly runs: readonly TeamRunVm[];
};

/** One level on «Права»: who holds it and how far it departs from the standard. */
export type LevelRowVm = {
  readonly level: StaffLevel;
  readonly name: string;
  /** «Иван, Георги и още 2», or the word for nobody. */
  readonly holders: string;
  /** «Стандартни» · «2 промени» — as the page would save it. */
  readonly value: string;
  /** The level holds changes that are not saved yet. */
  readonly unsaved: boolean;
  readonly testId: string;
};

/** «Права»: the levels the owner edits, and the one that cannot be cut. */
export type LevelsVm = {
  readonly levels: readonly LevelRowVm[];
  readonly adminTitle: string;
  readonly adminLine: string;
};

/** One answer a value's menu offers — the shape `ui-choice-menu` reads. */
export type PermissionOptionVm = {
  readonly id: AccessScope;
  readonly label: string;
  readonly testId: string;
};

/** One permission of a level's page: a question and its answer. */
export type PermissionRowVm = {
  readonly staffCapability: StaffCapability;
  readonly label: string;
  /** The cell offers two answers: a switch. Three: a value with a menu. */
  readonly isSwitch: boolean;
  /** A switch's answer: the cell grants something. */
  readonly on: boolean;
  readonly accessScope: AccessScope;
  readonly scopeWord: string;
  /** The answers a value's menu offers. */
  readonly options: readonly PermissionOptionVm[];
  /** The cell departs from the standard. */
  readonly changed: boolean;
  /** «Стандартно: Само своите» — said only under a changed row. */
  readonly standardWas: string;
  /** Names the row's menu and its test ids: `<level>-<capability>`. */
  readonly key: string;
};

/** A group of permission rows, under its heading. */
export type PermissionGroupVm = {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly PermissionRowVm[];
};

/** A level's page. */
export type LevelPageVm = {
  readonly level: StaffLevel;
  readonly name: string;
  /** «Важи за 4 души» */
  readonly applies: string;
  readonly groups: readonly PermissionGroupVm[];
  /** The level departs from the standard: «Върни стандартните» has work to do. */
  readonly departs: boolean;
};
