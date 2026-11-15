import type { LocationId } from '@core/primitives';

/** One shop of «Салони»: its name, whether the record works there, whether the tick is held. */
export type ShopRowVm = {
  readonly locationId: LocationId;
  readonly name: string;
  /** Ticked in the draft. */
  readonly picked: boolean;
  /** The roster still has hours here: the tick cannot be taken off, and the row says why. */
  readonly held: boolean;
  readonly testId: string;
};
