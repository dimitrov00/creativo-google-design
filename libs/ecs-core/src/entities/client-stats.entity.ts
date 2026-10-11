import type {
  ClientStats,
  ClientStatsMeta,
  PolicyPassStamp,
} from '../components/client-stats.data';
import type { UserId } from '../primitives/ids.primitive';

/**
 * `clientStats/{uid}` — the projection, its bookkeeping and the stamp of
 * the policy pass that last judged it, every 1-to-1 field at the root
 * (Law 6). The id is the client's uid (`userId` repeats it in the body, as
 * stored) until flip (1) re-keys the record to `clientStats/{customerId}`
 * (D29, §5.5). Read by the book (`worksTheBook`); rebuilt whole by the
 * recompute, never edited.
 *
 * Named `ClientStatsRecord` (F-17): `ClientStats` is the slice. The
 * `PolicyPassStamp` fields are `null` on the documents no pass has touched
 * yet (most, today).
 */
export type ClientStatsRecord = ClientStats &
  ClientStatsMeta &
  PolicyPassStamp & {
    readonly id: UserId;
  };
