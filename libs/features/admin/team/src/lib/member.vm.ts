import type { StaffLevel, StaffSetupItem } from '@core/components';
import type { BarberId } from '@core/primitives';
import type { LinkQuestionVm } from './link.vm';

/**
 * The editor a row of a member's page opens — the field `memberEditor`,
 * the ONLY source of these strings.
 */
export const MemberEditor = {
  /** The name, the title, the few words, Instagram and the experience. */
  Profile: 'PROFILE',
  /** The start day and the last working day. */
  Period: 'PERIOD',
  /** The weekly hours — the schedule's own sheet. */
  Hours: 'HOURS',
  /** What the record performs, and at what price. */
  Offerings: 'OFFERINGS',
  /** The shops the record works at. */
  Shops: 'SHOPS',
  /** «Свържи профил» — whose account the record is. */
  Link: 'LINK',
  /** «Върни в екипа» — a record that has left, back with a new start day. */
  Return: 'RETURN',
} as const;
export type MemberEditor = (typeof MemberEditor)[keyof typeof MemberEditor];

/** One thing a record needs before anyone can book it: done or missing, and the way in. */
export type SetupRowVm = {
  readonly staffSetupItem: StaffSetupItem;
  readonly label: string;
  /** What is there: the name, the day, «12 услуги», or the word for nothing. */
  readonly value: string;
  readonly done: boolean;
  /** «готово» · «липсва», for a reader. */
  readonly state: string;
  /** The editor the row opens; `null` for a row that is read. */
  readonly memberEditor: MemberEditor | null;
  readonly testId: string;
};

/** A value row of the «Профил» group. */
export type MemberRowVm = {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  /** The editor the row opens; `null` for a row that is read. */
  readonly memberEditor: MemberEditor | null;
  readonly testId: string;
};

/** One answer of «Кой може да записва» — the shape `ui-choice-menu` reads. */
export type BookedByOptionVm = {
  readonly id: string;
  readonly label: string;
  readonly testId: string;
};

/** «Кой може да записва»: the answer in force and the answers offered. */
export type BookedByVm = {
  /** The live status that says it. */
  readonly id: string;
  readonly word: string;
  readonly options: readonly BookedByOptionVm[];
};

/** What the delete question's answers are — the field `deleteAnswer`, the ONLY source of these strings. */
export const DeleteAnswer = {
  Delete: 'DELETE',
  Cancel: 'CANCEL',
} as const;
export type DeleteAnswer = (typeof DeleteAnswer)[keyof typeof DeleteAnswer];

/** One answer of the delete question — the shape `ui-alert` reads. */
export type DeleteActionVm = {
  readonly id: DeleteAnswer;
  readonly label: string;
  readonly role: 'destructive' | 'cancel';
  readonly testId: string;
};

/** The account linked to the record, and what the person looking may do about it. */
export type MemberAccountVm = {
  /** The record is the viewer's own: «Не съм аз» is offered. */
  readonly isMine: boolean;
  /** Nobody is linked and the viewer may take it: «Това съм аз» is offered. */
  readonly isOpen: boolean;
  /** Nobody is linked and the viewer links accounts: «Свържи профил» is offered. */
  readonly linkable: boolean;
  /**
   * The question before someone else's account is released («Разкачи
   * профила»); `null` when that is not the viewer's to do.
   */
  readonly release: LinkQuestionVm | null;
  /** The linked account's name; `null` when nobody is linked. */
  readonly name: string | null;
  /** «Твоят профил · Администратор, Бръснар» */
  readonly line: string;
  /** The quiet line under the block; `null` when it says nothing. */
  readonly footnote: string | null;
};

/** The way to a level's page on «Права», for a level the person holds. */
export type LevelLinkVm = {
  readonly level: StaffLevel;
  /** «Права на „Бръснар“» */
  readonly label: string;
  /** «Стандартни» · «2 промени» */
  readonly value: string;
  readonly testId: string;
};

/** A team member's page. */
export type MemberPageVm = {
  readonly barberId: BarberId;
  readonly name: string;
  /** «Подготовка · 3 от 5» · «Приема записи» · «Напусна на 30 септ.» */
  readonly standing: string;
  readonly avatarSrc: string | null;
  /** «Добави снимка» · «Смени снимката»; `null` when the photo is not theirs to change. */
  readonly photoLabel: string | null;
  /** What bookings need, while the record is in preparation; empty after. */
  readonly setup: readonly SetupRowVm[];
  /** The line under the checklist; `null` when there is none. */
  readonly goesLive: string | null;
  readonly profile: readonly MemberRowVm[];
  /** `null` once the record has left: nobody books a leaver. */
  readonly bookedBy: BookedByVm | null;
  /** The record takes changes from the person looking. */
  readonly manageable: boolean;
  /** `null` for someone who does not manage the team: no account was read. */
  readonly account: MemberAccountVm | null;
  readonly levels: readonly LevelLinkVm[];
  /** «Върни в екипа» is offered: the record has left, and the viewer manages the team. */
  readonly returnable: boolean;
  /** «След последния си ден Стефан още има 3 записа…»; `null` with none, or none read. */
  readonly leftover: string | null;
  readonly deletable: boolean;
  readonly deleteTitle: string;
  readonly deleteActions: readonly DeleteActionVm[];
  /** «Николай вече приема записи.» — said once the record goes live. */
  readonly liveReceipt: string;
};
