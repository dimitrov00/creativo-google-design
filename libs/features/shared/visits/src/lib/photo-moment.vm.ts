/*
 * A PHOTO'S MOMENT, AS A SCREEN PRINTS IT (owner rulings OR-5): the instant
 * a picture was taken, read on the shop's calendar and worded in the active
 * language — `bg-BG` for Bulgarian, `en-GB` for English (`intlLocaleOf`).
 * Built by `photoMomentOf`; three faces of one reading, so the bar's day and
 * the row's time can never straddle two midnights.
 */

/** The three faces of one photo's moment. */
export type PhotoMomentVm = {
  /** «4.09, 16:21» · «4 Sept, 16:21» — the whole moment, for the names assistive tech hears (a thumbnail's, the picture's alt). */
  readonly when: string;
  /** «4.09» · «4/09» — the day, the photo page's bar title; the year only outside the shop's current one (R59): «6.03.2025 г.» · «6/03/2025». */
  readonly day: string;
  /** «16:21» — the «Снимано» row: what the bar's day leaves unsaid. */
  readonly time: string;
};
