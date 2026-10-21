import {
  type Firestore,
  collection,
  limit,
  query,
  where,
} from 'firebase/firestore';
import { map } from 'rxjs';
import { ImpersonationStatus } from '@core/components';
import { Result } from '@core/primitives';
import { Collections, type ImpersonationSession } from '@core/entities';
import type { ImpersonationReadPorts } from '@core/ports';
import { observeQuery } from './observe';

/**
 * `impersonationSessions/*`, read side (flip 2, plan §3.4, F2-13) — the
 * successor of the legacy class adapter's one live use: the admin's
 * `ACTIVE` session, `adminUserId ==` and `impersonationStatus == 'ACTIVE'`,
 * at most one (index #9). The body IS the flat `ImpersonationSession` minus
 * `id` (Law 5), answered as stored, `null` while the admin has none. A
 * lapsed session still reads `ACTIVE` here: `ImpersonationSystem.isExpired`
 * is the rule an authorization reads, never this stream alone.
 *
 * The browser writes nothing here — no session document and no audit row
 * (FIX 1: a trail the people it records can write proves nothing). The
 * start and end writes, their audit rows and the `purgeAt` stamps arrive
 * with Phase 4's `startImpersonation` / `endImpersonation` callables.
 */
export const impersonationReadPorts = (
  db: Firestore,
): ImpersonationReadPorts => ({
  observeActiveImpersonation: (adminUserId) =>
    observeQuery<ImpersonationSession>(
      query(
        collection(db, Collections.ImpersonationSessions),
        where('adminUserId', '==', adminUserId),
        where('impersonationStatus', '==', ImpersonationStatus.Active),
        limit(1),
      ),
      Collections.ImpersonationSessions,
    ).pipe(
      map((found) => (found.ok ? Result.ok(found.value[0] ?? null) : found)),
    ),
});
