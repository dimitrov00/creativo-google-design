import { Result, fail, ok } from '@creativo/domain/kernel';
import { InvalidBlockReasonError } from './block-reason.errors';

/**
 * Why an account was blocked. Closed enum — no string widening; a new
 * reason is a deliberate code change. Ported verbatim from v2's
 * `BlockReason.ts` (same vocabulary, no renames).
 */
export type BlockReason =
  'excessive_failed_attempts' | 'terms_violation' | 'fraud_suspect' | 'manual';

export const BLOCK_REASONS: readonly BlockReason[] = [
  'excessive_failed_attempts',
  'terms_violation',
  'fraud_suspect',
  'manual',
];

export function isBlockReason(value: unknown): value is BlockReason {
  return (
    typeof value === 'string' &&
    (BLOCK_REASONS as readonly string[]).includes(value)
  );
}

/** Validating factory — the door a raw string (e.g. an admin's dropdown pick) uses to become a BlockReason. */
export function parseBlockReason(
  raw: string,
): Result<BlockReason, InvalidBlockReasonError> {
  return isBlockReason(raw) ? ok(raw) : fail(new InvalidBlockReasonError(raw));
}
