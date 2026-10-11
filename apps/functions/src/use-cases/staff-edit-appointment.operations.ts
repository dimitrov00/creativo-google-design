import { createHash } from 'node:crypto';
import { AppointmentEditSystem } from '@core/systems';

/*
 * THIN SHIM (ECS migration Phase 2). The fingerprint's BASIS — the tagged
 * JSON of the validated commands, in order — is
 * `AppointmentEditSystem.digestBasis`; the hash stays here, at the edge,
 * because no system may hold `crypto`.
 */

/*
 * THE LEDGER ITSELF — `AppliedOperations`, `APPLIED_OPERATIONS_FIELD` —
 * lives with the other persisted shapes, in `@creativo/application/booking`
 * (`applied-operations-document.ts`), beside `preservedAppointmentFields`
 * that its survival depends on. What stays here is the server's half: the
 * fingerprint it computes of each intent's batch.
 */

/**
 * The fingerprint of one intent's batch: the validated commands, in order.
 *
 * It is what makes a REUSED name loud. A re-send is the same intent
 * serialised again, so its digest matches; the same name on a different
 * batch is a client bug that would otherwise be answered "saved" while
 * applying nothing — the silent loss this surface has been bitten by before
 * (2026-09-04). Sixteen hex digits are a sanity check between one client's
 * own sends, not a security boundary.
 */
export function operationDigest(commands: readonly unknown[]): string {
  return createHash('sha256')
    .update(AppointmentEditSystem.digestBasis(commands))
    .digest('hex')
    .slice(0, 16);
}
