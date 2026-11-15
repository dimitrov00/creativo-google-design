import type { UserId } from '@core/primitives';

/** One account «Свържи профил» offers: a face, a name and one quiet line. */
export type LinkRowVm = {
  readonly userId: UserId;
  readonly name: string;
  /** The contact a lookup found the account by, then its staff roles; `null` when it has neither. */
  readonly line: string | null;
  readonly testId: string;
};

/** «Свържи профил»: the accounts on show, and what the sheet says with none. */
export type LinkVm = {
  /** «Николай ще влиза в приложението с този профил…» */
  readonly lede: string;
  /** «От екипа» over the team's own accounts; `null` over a lookup's answer. */
  readonly heading: string | null;
  readonly rows: readonly LinkRowVm[];
  /** The headline of the empty sheet; `''` when it has none. */
  readonly emptyTitle: string;
  /** What the sheet says with no row to show; `null` while it has rows or a lookup is still out. */
  readonly emptyBody: string | null;
};

/**
 * What a yes/no question about an account's link is answered with — the
 * field `linkAnswer`, the ONLY source of these strings.
 */
export const LinkAnswer = {
  Confirm: 'CONFIRM',
  Cancel: 'CANCEL',
} as const;
export type LinkAnswer = (typeof LinkAnswer)[keyof typeof LinkAnswer];

/** One answer of the question — the shape `ui-alert` reads. */
export type LinkActionVm = {
  readonly id: LinkAnswer;
  readonly label: string;
  readonly role: 'default' | 'cancel';
  readonly testId: string;
};

/** The question before an account is linked to a record, or released from it. */
export type LinkQuestionVm = {
  readonly title: string;
  /** «Георги ще трябва да влезе отново.» */
  readonly message: string;
  readonly actions: readonly LinkActionVm[];
};
