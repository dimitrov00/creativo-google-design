import type { Firestore } from 'firebase-admin/firestore';
import { Result } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import { Collections } from '@core/entities';
import type { LeadTimeWritePorts } from '@core/ports';
import { TriggerAttemptSystem } from '@core/systems';
import { withPurgeAt } from './firestore-ttl.adapter';

/**
 * The lead-time sample writer (flip 1, blueprint §4.1 `sampleLeadTime`): one
 * `Set` of `barberLeadTimeSamples/{barberId__localDate}` — the entity minus
 * its id — with the TTL root `purgeAt` stamped by THE one stamp
 * (`firestore-ttl.adapter.ts`, F1-7: `localDate` + 400 d). A write that
 * throws answers a `RepositoryError` value whose `reason` is the failure's
 * canonical code; the pipeline logs it and samples the next barber.
 */

export const firestoreLeadTimePorts = (db: Firestore): LeadTimeWritePorts => ({
  writeLeadTimeSample: async (sample) => {
    const { id, ...body } = sample;
    const path = [Collections.BarberLeadTimeSamples, id];
    try {
      await db.doc(path.join('/')).set(withPurgeAt(path, body));
      return Result.ok(undefined);
    } catch (error) {
      return Result.err(
        RepositoryError.writeFailed(
          path.join('/'),
          TriggerAttemptSystem.failureCode(error),
        ),
      );
    }
  },
});
