import type { SetupCardVm } from './staff-home.vm';

/** The setup card's words, in the catalogue's language (`staff.setupCard.*`). */
export type SetupCardWords = {
  readonly title: string;
  /** «{{done}} от {{total}} готови. …» */
  readonly body: (done: number, total: number) => string;
  readonly action: string;
};

/**
 * THE SETUP CARD, WORDED (Law 10; account first, A5): how much of their
 * own profile a barber has done. Whether there is a card at all is
 * `StaffSetupSystem.profileLeftOf`'s answer — `null` once every detail is
 * done — handed in.
 */
export function setupCardVm(
  left: { readonly done: number; readonly total: number } | null,
  words: SetupCardWords,
): SetupCardVm | null {
  return left === null
    ? null
    : {
        title: words.title,
        body: words.body(left.done, left.total),
        action: words.action,
      };
}
