/**
 * A document body AS READ — field names to values nobody has checked yet:
 * what an adapter holds between `snap.data()` and the read-time guard
 * (`StoredDocumentSystem`) that admits it as its entity, and what a
 * companion's `fieldFault` reads a slice's fields from. Never an entity: a
 * value typed `StoredFields` has proved nothing about its shape. A
 * zero-mapping read (Law 5) validates this very object and hands the same
 * object on as the entity — nothing is copied, renamed or defaulted.
 *
 * The companion is the ONE home of the stored-SHAPE checks every read-time
 * check composes (a record, an array of them, a text or `null`, a count) —
 * the components' `fieldFault` members and `StoredDocumentSystem` call
 * these, never a copy. Every check is a typeof test or an indexed scan: no
 * allocation.
 */
export type StoredFields = Readonly<Record<string, unknown>>;

/** `raw` is an array whose every element passes `is` — a narrowing, no copy. */
function isArrayOf<T>(
  raw: unknown,
  is: (element: unknown) => element is T,
): raw is readonly T[] {
  if (!Array.isArray(raw)) return false;
  for (let i = 0; i < raw.length; i++) {
    if (!is(raw[i])) return false;
  }
  return true;
}

/**
 * A non-null object that is not an array — what a document body, a seat or
 * a busy block must be before any of its fields can be read.
 */
function isRecord(raw: unknown): raw is StoredFields {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

export const StoredFields = {
  /**
   * A non-null object that is not an array — what a document body, a seat
   * or a busy block must be before any of its fields can be read. No
   * allocation.
   */
  isRecord,

  /**
   * An array whose every element passes `is` (an id door, `isRecord`) — a
   * narrowing of the stored array itself, never a copy.
   */
  isArrayOf,

  /** An array whose every element is a record — a line of the bill, the ledger, a remembered pair. */
  isRecordArray(raw: unknown): raw is readonly StoredFields[] {
    return isArrayOf(raw, isRecord);
  },

  /** A stored text that may be absent as `null` — a contact field, a customer's phone. */
  isTextOrNull(raw: unknown): raw is string | null {
    return raw === null || typeof raw === 'string';
  },

  /** A non-negative safe integer — a revision counter. */
  isCount(raw: unknown): raw is number {
    return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0;
  },
} as const;
