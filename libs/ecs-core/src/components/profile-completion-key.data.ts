/**
 * The items of a profile's completion, in their one order
 * (`ProfileCompletionSystem.completion`) — an item's key is its field
 * `profileCompletionKey` (N15). `NAME` and `PHONE` are always set at
 * registration (the "you've started" beat); `BIRTHDAY` and `PHOTO` are the
 * optional enhancements the nudge drives.
 */
export const ProfileCompletionKey = {
  Name: 'NAME',
  Phone: 'PHONE',
  Birthday: 'BIRTHDAY',
  Photo: 'PHOTO',
} as const;
export type ProfileCompletionKey =
  (typeof ProfileCompletionKey)[keyof typeof ProfileCompletionKey];
