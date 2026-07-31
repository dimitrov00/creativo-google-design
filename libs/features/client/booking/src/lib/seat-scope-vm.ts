import { SeatKey } from '@creativo/application/booking';

/**
 * One member of the party, as every surface that scopes BY PERSON reads them.
 *
 * Lives here rather than beside the catalog step because it is no longer that
 * step's private shape: the bag groups by the same people, with the same
 * portraits and the same fallbacks, and a second copy of this interface would
 * be a second set of rules about what "You" looks like when nobody has told us
 * a name.
 */
export interface SeatScopeVm {
  readonly key: string;
  readonly seatKey: SeatKey;
  readonly label: string;
  /**
   * What the AVATAR derives its monogram from — empty when nobody has told us
   * a name, which is not the same thing as the label.
   *
   * A guest is named the moment they exist ("Guest 1"), so the two agree for
   * them. The booker's label falls back to "You", and initials of "You" spell
   * nothing: the avatar shows a silhouette instead.
   */
  readonly monogramName: string;
  readonly lineCount: number;
  /**
   * The booker's own portrait when they have one. A guest has none — they are
   * a label until they have an account of their own — so `ui-avatar` falls
   * back to their initials, which is still a face-shaped anchor rather than a
   * word in a row of words.
   */
  readonly avatarSrc: string | null;
}
