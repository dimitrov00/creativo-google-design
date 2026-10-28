import { type StoredFields, Tag, UtcEpochMs } from '@core/primitives';

/**
 * Erasure status tags — the ONLY source of these strings, the discriminator
 * `erasureStatus` of {@link ErasureLifecycle}: the tag every writer of a
 * client record reads (audit-hardening Phase 3 WS-D, P3-RU-20).
 */
export const ErasureStatus = {
  /** The record holds the person's values as the shop keeps them — no erasure asked. */
  None: 'NONE',
  /**
   * An erasure has begun: the record's personal values are already cleared
   * (the stamp commit clears them, P3-RU-21) and the rest of the person's
   * footprint is being swept, across calls. Every writer refuses to seat or
   * re-create the record from here on.
   */
  Erasing: 'ERASING',
  /** Erased under Art. 17: terminal — the residue census found nothing personal left. */
  Erased: 'ERASED',
} as const;
export type ErasureStatus = (typeof ErasureStatus)[keyof typeof ErasureStatus];

/**
 * Where a client record stands with respect to a data-subject erasure
 * (GDPR Art. 17, "pseudonymize, keep records") — a union of flat variant
 * slices (Law 6) intersected into the `Customer` archetype at the root, its
 * variant-only stamps prefixed by the domain (`erasureStartedAtUtcMs`,
 * `erasedAtUtcMs`). REQUIRED on every stored customer body (P3-L-18): every
 * writer creates `NONE`, and the read-time guard refuses a body without
 * the key, so the type never lies about a record and a tombstone is never
 * read as ABSENT and re-created.
 *
 * Lifecycle (the transitions are the erasure's write plans,
 * `WriteOp.transition` + `WriteOp.variantFieldsToDelete`):
 *   `NONE` ─ the stamp commit      → `ERASING` (+ `erasureStartedAtUtcMs`)
 *   `ERASING` ─ the completion     → `ERASED`  (+ `erasedAtUtcMs`)
 * No move leaves `ERASED`, and nothing returns to `NONE`.
 */
export type ErasureLifecycle =
  ErasureLifecycle.None | ErasureLifecycle.Erasing | ErasureLifecycle.Erased;

/** The one untouched slice — every record no erasure reached shares this struct. */
const NONE: ErasureLifecycle.None = { erasureStatus: ErasureStatus.None };

export const ErasureLifecycle = {
  /** Every erasure status, dictionary order — derived, never a second source. */
  STATUSES: Tag.values(ErasureStatus),

  /** No erasure — what every writer of a client record creates (`...ErasureLifecycle.none()`). */
  none(): ErasureLifecycle.None {
    return NONE;
  },

  /** The erasure begins at `erasureStartedAtUtcMs` — the stamp commit's slice. */
  begin(erasureStartedAtUtcMs: UtcEpochMs): ErasureLifecycle.Erasing {
    return { erasureStatus: ErasureStatus.Erasing, erasureStartedAtUtcMs };
  },

  /**
   * The erasure completes at `erasedAtUtcMs`, keeping when it began (the
   * history is declared on the later variant, F-20) — the completion
   * commit's slice.
   */
  complete(
    erasing: ErasureLifecycle.Erasing,
    erasedAtUtcMs: UtcEpochMs,
  ): ErasureLifecycle.Erased {
    return {
      erasureStatus: ErasureStatus.Erased,
      erasureStartedAtUtcMs: erasing.erasureStartedAtUtcMs,
      erasedAtUtcMs,
    };
  },

  /**
   * `ERASING` or `ERASED` — the record every writer refuses to seat or
   * re-create (the guard, P3-RU-20). Only `NONE` is a record the shop may
   * still book.
   */
  isUnderErasure(lifecycle: {
    readonly erasureStatus: ErasureStatus;
  }): boolean {
    return lifecycle.erasureStatus !== ErasureStatus.None;
  },

  /**
   * The read-time check of a stored slice (edge hardening D-1), STRICT
   * (P3-L-18): the NAME of the first field that is not well-formed, or
   * `null`. Narrows on the discriminator — `erasureStatus` present and an
   * {@link ErasureStatus} member, else `'erasureStatus'` (an ABSENT key is
   * refused: unlike `writeOperationId`, every body carries this one) — then
   * checks THAT variant's stamps (instants: `erasureStartedAtUtcMs` on
   * `ERASING` and `ERASED`, `erasedAtUtcMs` on `ERASED`). No allocation.
   */
  fieldFault(raw: StoredFields): string | null {
    switch (raw['erasureStatus']) {
      case ErasureStatus.None:
        return null;
      case ErasureStatus.Erasing:
        return UtcEpochMs.is(raw['erasureStartedAtUtcMs'])
          ? null
          : 'erasureStartedAtUtcMs';
      case ErasureStatus.Erased:
        if (!UtcEpochMs.is(raw['erasureStartedAtUtcMs'])) {
          return 'erasureStartedAtUtcMs';
        }
        return UtcEpochMs.is(raw['erasedAtUtcMs']) ? null : 'erasedAtUtcMs';
      default:
        return 'erasureStatus';
    }
  },
} as const;

export namespace ErasureLifecycle {
  export type None = {
    readonly erasureStatus: typeof ErasureStatus.None;
  };
  export type Erasing = {
    readonly erasureStatus: typeof ErasureStatus.Erasing;
    /** When the stamp commit cleared the record and began the sweep. */
    readonly erasureStartedAtUtcMs: UtcEpochMs;
  };
  export type Erased = {
    readonly erasureStatus: typeof ErasureStatus.Erased;
    /** When the erasure began — kept on the later variant (F-20: history worth keeping is declared there). */
    readonly erasureStartedAtUtcMs: UtcEpochMs;
    /** When the residue census found nothing personal left and the record was certified erased. */
    readonly erasedAtUtcMs: UtcEpochMs;
  };
}
