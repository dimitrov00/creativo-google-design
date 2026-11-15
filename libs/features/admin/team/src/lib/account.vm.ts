import type { Role } from '@core/components';
import type { UserId } from '@core/primitives';
import type { LinkQuestionVm } from './link.vm';
import type { LevelLinkVm } from './member.vm';

/** One staff role of an account's page: its name, and whether the account is drafted to hold it. */
export type RoleTickVm = {
  readonly role: Role;
  readonly label: string;
  readonly checked: boolean;
  readonly testId: string;
};

/** A staff account's page: who it is, the roles it holds, and what the person looking may do. */
export type AccountPageVm = {
  readonly userId: UserId;
  /** The account's name; the word for none when the person has not registered. */
  readonly name: string;
  /** «Рецепция, Съдържание» */
  readonly line: string;
  /** The roles are the viewer's to change: the ticks take presses. */
  readonly editable: boolean;
  /** Every role offered, when editable; else the ones the account holds, to be read. */
  readonly ticks: readonly RoleTickVm[];
  /** The quiet lines under the roles: why they are read, or what a change costs. */
  readonly notes: readonly string[];
  readonly levels: readonly LevelLinkVm[];
  /** The question before the account leaves the team; `null` when that is not the viewer's to do. */
  readonly remove: LinkQuestionVm | null;
};
