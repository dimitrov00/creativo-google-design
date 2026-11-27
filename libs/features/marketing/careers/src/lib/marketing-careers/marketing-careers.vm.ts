import type { PositionStatus, WorkplaceMode } from '@core/components';
import type { PositionId } from '@core/primitives';
import type { ContactRowVm } from '@creativo/features/shared/catalog';

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
  /**
   * The workplace word the row prints before its shops
   * (`programs.workplace.<tag>`): «От вкъщи», «Хибридно». `null` for an
   * on-site role — its shops line already says where.
   */
  readonly workplaceTag: WorkplaceMode | null;
  /** How the role is answered: one way is the row's link, several open the sheet. */
  readonly contact: ContactRowVm;
  /** The stored status — the badge's word (`programs.status.position.<tag>`) and tone. */
  readonly positionStatus: PositionStatus;
};
