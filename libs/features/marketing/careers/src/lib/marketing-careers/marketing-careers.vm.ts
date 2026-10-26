import type { PositionStatus } from '@core/components';
import type { PositionId } from '@core/primitives';

/*
 * THE CAREERS PAGE'S DISPLAY MODEL (OR-42, Law 10.3) — what one row of
 * `/careers` prints. Filled by `marketing-careers.presenter.ts`; no function
 * lives here.
 */

/** One role as its row prints it. */
export type PositionRowVm = {
  readonly id: PositionId;
  /** «Бръснар — пълно работно време» — the title in the active language. */
  readonly title: string;
  /** The summary in the active language. */
  readonly summary: string;
  /**
   * «Център · Младост» — the shops a role scoped to some is open at, when
   * the tenant has shops to tell apart; `null` for a role open at every
   * shop, at a one-shop tenant, or while the shops are unread.
   */
  readonly shopsLine: string | null;
  /** Where the row leads: the role's apply link, else the shop's Instagram. */
  readonly href: string;
  /** The stored status — the badge's word (`programs.status.position.<tag>`) and tone. */
  readonly positionStatus: PositionStatus;
};
