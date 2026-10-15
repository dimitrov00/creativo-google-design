import type {
  ClientStats,
  ClientStatsKey,
  ClientStatsMeta,
  PolicyPassStamp,
} from '@core/components';
import type { CustomerId } from '@core/primitives';

/**
 * `clientStats/{customerId}` — the projection of one CLIENT RECORD's visits
 * (D29, flatten-spec §5.4: whom the shop served), its bookkeeping and the
 * stamp of the policy pass that last judged it, every 1-to-1 field at the
 * root (Law 6). The id is the record's `CustomerId`, repeated in the body as
 * `customerId` (`ClientStatsKey`). Read by the book (`worksTheBook`);
 * rebuilt whole by the projection (`projectClientStats`, reading
 * `subjectCustomerIds array-contains`, index #19), never edited.
 *
 * Named `ClientStatsRecord` (F-17): `ClientStats` is the slice. The
 * `PolicyPassStamp` fields are `null` on the documents no pass has touched
 * yet.
 */
export type ClientStatsRecord = ClientStatsKey &
  ClientStats &
  ClientStatsMeta &
  PolicyPassStamp & {
    readonly id: CustomerId;
  };
