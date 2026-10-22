/**
 * The browser storage's own reason for a failure — the thrown error's
 * message (`QuotaExceededError`, a disabled storage), `null` for anything
 * that is no `Error`. Read into `RepositoryError.reason`, never branched on.
 */
export function storageReason(cause: unknown): string | null {
  return cause instanceof Error ? cause.message : null;
}
