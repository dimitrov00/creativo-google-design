import type {
  ClientStats,
  ClientStatsMeta,
  PolicyPass,
} from '../components/client-stats.data';
import type { UserId } from './user.entity';

/**
 * `clientStats/{uid}` — the stored body of `client-stats-document.ts`
 * (`ClientStatsRecord = ClientStats + ClientStatsMeta`), every instant as
 * epoch ms (blueprint §2.6). The id is the client's uid (`userId` repeats it
 * in the body, as stored). Read by the book (`worksTheBook`); rebuilt whole
 * by the recompute, never edited.
 *
 * `policyPass` is the stamp of the policy pass that last judged this answer —
 * `null` on the documents no pass has touched yet (most, today).
 */
export type ClientStatsEntity = ClientStats &
  ClientStatsMeta & {
    readonly id: UserId;
    readonly policyPass: PolicyPass | null;
  };
