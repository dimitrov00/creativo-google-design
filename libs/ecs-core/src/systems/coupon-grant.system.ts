import {
  Combinability,
  type CouponOccasion,
  CouponValue,
  GrantCapacity,
  GrantCapacityTerms,
  GrantExpiry,
  GrantExpiryTerms,
  GrantLifecycle,
  WriteOp,
} from '@core/components';
import {
  type CouponGrantId,
  type CouponId,
  type CustomerId,
  GrantStatus,
  Result,
  type UserId,
  UtcEpochMs,
} from '@core/primitives';
import { EngagementError } from '@core/errors';
import { type Coupon, type CouponGrant, Collections } from '@core/entities';

/**
 * A grant as the card holds it, carrying its coupon's occasion tag. The
 * host's card grant may leave the tag out (`ClientCardGrant.couponOccasion`
 * is optional), so the constraint takes it as it is held — absent reads as
 * `null`, no occasion — and the grants pass in unmapped (Law 3).
 */
export type OccasionTagged = Partial<{
  readonly couponOccasion: CouponOccasion | null;
}>;

/** A grant as the resolver found it — whose it is, whether it can still be honoured, and its value. */
export type ResolvedGrant = {
  readonly grantId: CouponGrantId;
  /** The client record the grant rewards (D29) — matched against the visit's `ownerCustomerId`. */
  readonly customerId: CustomerId;
  /** The coupon's name — what the receipt calls the promise. */
  readonly label: string;
  readonly usable: boolean;
  /** The coupon's own rule: may it share the bill? */
  readonly exclusive: boolean;
} & CouponValue;

/** A held grant and the coupon it was issued from — one row of the visit sheet's «Отстъпка» menu. */
export type HeldGrant = {
  readonly grant: CouponGrant;
  readonly coupon: Coupon;
};

/** The ONE predicate both occasion cuts share: the grant's coupon was made for `occasion`. */
function madeFor(grant: OccasionTagged, occasion: CouponOccasion): boolean {
  return CouponGrantSystem.isOccasion(grant.couponOccasion ?? null, occasion);
}

/** The grant with a new lifecycle variant — its meta and value untouched, the old variant's fields gone. */
function withLifecycle(
  grant: CouponGrant,
  lifecycle: GrantLifecycle,
): CouponGrant {
  return {
    id: grant.id,
    customerId: grant.customerId,
    holderUserId: grant.holderUserId,
    couponId: grant.couponId,
    grantedAtUtcMs: grant.grantedAtUtcMs,
    ...CouponValue.of(grant),
    ...GrantLifecycle.of(lifecycle),
  };
}

/*
 * The four verbs on the LIFECYCLE SLICE (`*Slice`) — the grant's state
 * machine, total on `GrantLifecycle`; each entity verb of
 * {@link CouponGrantSystem} is its slice verb with the grant's meta and
 * value carried through untouched.
 */

/**
 * One redemption (`markUsed`): a single-use grant goes straight to
 * `USED`; a multi-use one counts down, and is `USED` at zero. `note` is
 * the caller's account of the channel («appointment abc123»), `''` when
 * none was given.
 */
function burnSlice(
  grant: GrantLifecycle,
  atUtcMs: UtcEpochMs,
  note: string,
): Result<GrantLifecycle, EngagementError.CouponGrantNotActive> {
  if (grant.grantStatus !== GrantStatus.Active) {
    return Result.err(EngagementError.couponGrantNotActive(grant.grantStatus));
  }
  if (grant.grantCapacity === GrantCapacity.SingleUse) {
    return Result.ok(GrantLifecycle.used(atUtcMs, note));
  }
  const remaining = grant.usesRemaining - 1;
  if (remaining <= 0) {
    return Result.ok(GrantLifecycle.used(atUtcMs, note));
  }
  return Result.ok(
    GrantLifecycle.active(
      {
        grantCapacity: GrantCapacity.MultiUse,
        usesRemaining: remaining,
        usesGranted: grant.usesGranted,
      },
      grant,
    ),
  );
}

/**
 * The exact inverse of {@link burn} — a grant discount a save removed, or
 * a cancel released, goes back to the client: a `USED` grant returns to
 * `ACTIVE` with one use (single-use, or a multi-use with one of its
 * `issued` total), a multi-use `ACTIVE` one gains a use back. Refused for
 * an expired or revoked grant (`NOT_ACTIVE`), and for a grant with no use
 * spent to give back (`INVALID_CAPACITY`, naming the count it would reach).
 */
function restoreSlice(
  grant: GrantLifecycle,
  issued: GrantLifecycle.Terms,
): Result<
  GrantLifecycle,
  | EngagementError.CouponGrantNotActive
  | EngagementError.CouponGrantCapacityInvalid
> {
  if (grant.grantStatus === GrantStatus.Used) {
    const capacity: GrantCapacityTerms =
      issued.grantCapacity === GrantCapacity.SingleUse
        ? GrantCapacityTerms.singleUse()
        : {
            grantCapacity: GrantCapacity.MultiUse,
            usesRemaining: 1,
            usesGranted: issued.usesGranted,
          };
    return Result.ok(GrantLifecycle.active(capacity, issued));
  }
  if (grant.grantStatus !== GrantStatus.Active) {
    return Result.err(EngagementError.couponGrantNotActive(grant.grantStatus));
  }
  if (
    grant.grantCapacity === GrantCapacity.SingleUse ||
    grant.usesRemaining >= grant.usesGranted
  ) {
    return Result.err(
      EngagementError.couponGrantCapacityInvalid(
        grant.grantCapacity === GrantCapacity.SingleUse
          ? 2
          : grant.usesRemaining + 1,
      ),
    );
  }
  return Result.ok(
    GrantLifecycle.active(
      {
        grantCapacity: GrantCapacity.MultiUse,
        usesRemaining: grant.usesRemaining + 1,
        usesGranted: grant.usesGranted,
      },
      grant,
    ),
  );
}

/** The expiry job's act — only an `ACTIVE` grant that HAS an `EXPIRES_AT`. */
function expireSlice(
  grant: GrantLifecycle,
  atUtcMs: UtcEpochMs,
): Result<
  GrantLifecycle,
  EngagementError.CouponGrantNotActive | EngagementError.CouponGrantNotExpiring
> {
  if (grant.grantStatus !== GrantStatus.Active) {
    return Result.err(EngagementError.couponGrantNotActive(grant.grantStatus));
  }
  if (grant.grantExpiry !== GrantExpiry.ExpiresAt) {
    return Result.err(EngagementError.couponGrantNotExpiring());
  }
  return Result.ok(GrantLifecycle.expired(atUtcMs, grant.grantExpiresAtUtcMs));
}

/** An admin takes a grant back — a reason is required, stored trimmed. */
function revokeSlice(
  grant: GrantLifecycle,
  atUtcMs: UtcEpochMs,
  revokedBy: UserId,
  reason: string,
): Result<
  GrantLifecycle,
  EngagementError.CouponGrantNotActive | EngagementError.CouponGrantReasonEmpty
> {
  if (grant.grantStatus !== GrantStatus.Active) {
    return Result.err(EngagementError.couponGrantNotActive(grant.grantStatus));
  }
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    return Result.err(EngagementError.couponGrantReasonEmpty());
  }
  return Result.ok(GrantLifecycle.revoked(atUtcMs, revokedBy, trimmed));
}

/**
 * A client's coupon grant through its life (`coupon-grant.ts:134-299`):
 *
 *   `ACTIVE` ─ burn    → `ACTIVE` (multi-use, one fewer) OR `USED`
 *   `ACTIVE` ─ expire  → `EXPIRED` (only with an `EXPIRES_AT` expiry)
 *   `ACTIVE` ─ revoke  → `REVOKED`
 *   `USED` / `ACTIVE` ─ restore → the exact inverse of `burn`
 *
 * Every transition refuses a grant that is not `ACTIVE` (`NOT_ACTIVE`,
 * naming the state it found). `nowUtcMs`/`atUtcMs` are parameters; usability
 * against an expiry instant is a T2 lifecycle comparison (G-1).
 */
export const CouponGrantSystem = {
  /** Is the grant `ACTIVE`? Reads the lifecycle slice alone — a whole grant passes. */
  isActive(grant: GrantLifecycle): boolean {
    return GrantLifecycle.isActive(grant);
  },

  /** Active, and not past its expiry — AT the instant is still usable. */
  isUsable(grant: GrantLifecycle, nowUtcMs: UtcEpochMs): boolean {
    if (grant.grantStatus !== GrantStatus.Active) return false;
    return !(
      grant.grantExpiry === GrantExpiry.ExpiresAt &&
      UtcEpochMs.compare(nowUtcMs, grant.grantExpiresAtUtcMs) > 0
    );
  },

  /**
   * The instant a held grant lapses (moved here from the staff day store in
   * pass C, Y-7):
   * its `grantExpiresAtUtcMs` while it is `ACTIVE` with an `EXPIRES_AT`
   * expiry, `null` for one that never lapses or is no longer held. The shop
   * DAY it prints is the caller's zone read (Law 7: a system holds no zone).
   */
  expiresAtUtcMs(grant: GrantLifecycle): UtcEpochMs | null {
    if (grant.grantStatus !== GrantStatus.Active) return null;
    if (grant.grantExpiry !== GrantExpiry.ExpiresAt) return null;
    return grant.grantExpiresAtUtcMs;
  },

  /**
   * A grant as the staff save's bill settle reads it (moved here from
   * `edit-appointment.pipeline.ts` in pass C): its coupon's NAME is
   * the receipt's word, and a grant whose coupon is gone (or nameless) is
   * labelled by itself — its coupon id, else its own id — and read as
   * stackable: the promise stands. Usable by {@link isUsable} at
   * `nowUtcMs`; the value is the grant's own snapshot.
   */
  resolved(
    grant: CouponGrant,
    coupon: Coupon | null,
    nowUtcMs: UtcEpochMs,
  ): ResolvedGrant {
    return {
      grantId: grant.id,
      customerId: grant.customerId,
      label:
        coupon !== null && coupon.name.trim().length > 0
          ? coupon.name
          : grant.couponId || grant.id,
      usable: CouponGrantSystem.isUsable(grant, nowUtcMs),
      exclusive:
        coupon === null
          ? false
          : Combinability.isExclusive(coupon.combinability),
      ...CouponValue.of(grant),
    };
  },

  /**
   * The grants joined to their coupons by id (`staff-day.store.ts`
   * `loadGrants`), in the grants' order: a grant whose coupon is absent from
   * `coupons` — gone altogether — has nothing to say and is left out; a
   * coupon disabled since still names its grant. Two coupons with one id:
   * the later one answers.
   */
  held(
    grants: readonly CouponGrant[],
    coupons: readonly Coupon[],
  ): readonly HeldGrant[] {
    const byId = new Map<CouponId, Coupon>();
    for (let i = 0; i < coupons.length; i++) {
      const coupon = coupons[i] as Coupon;
      byId.set(coupon.id, coupon);
    }
    const out: HeldGrant[] = [];
    for (let i = 0; i < grants.length; i++) {
      const grant = grants[i] as CouponGrant;
      const coupon = byId.get(grant.couponId);
      if (coupon !== undefined) out.push({ grant, coupon });
    }
    return out;
  },

  /**
   * One redemption (`markUsed`) of a whole grant — {@link burnSlice}, the
   * meta and value carried through.
   */
  burn(
    grant: CouponGrant,
    atUtcMs: UtcEpochMs,
    note: string,
  ): Result<CouponGrant, EngagementError.CouponGrantNotActive> {
    const next = burnSlice(grant, atUtcMs, note);
    return next.ok ? Result.ok(withLifecycle(grant, next.value)) : next;
  },

  /** {@link restoreSlice} on a whole grant. */
  restore(
    grant: CouponGrant,
    issued: GrantLifecycle.Terms,
  ): Result<
    CouponGrant,
    | EngagementError.CouponGrantNotActive
    | EngagementError.CouponGrantCapacityInvalid
  > {
    const next = restoreSlice(grant, issued);
    return next.ok ? Result.ok(withLifecycle(grant, next.value)) : next;
  },

  /** {@link expireSlice} on a whole grant. */
  expire(
    grant: CouponGrant,
    atUtcMs: UtcEpochMs,
  ): Result<
    CouponGrant,
    | EngagementError.CouponGrantNotActive
    | EngagementError.CouponGrantNotExpiring
  > {
    const next = expireSlice(grant, atUtcMs);
    return next.ok ? Result.ok(withLifecycle(grant, next.value)) : next;
  },

  /** {@link revokeSlice} on a whole grant. */
  revoke(
    grant: CouponGrant,
    atUtcMs: UtcEpochMs,
    revokedBy: UserId,
    reason: string,
  ): Result<
    CouponGrant,
    | EngagementError.CouponGrantNotActive
    | EngagementError.CouponGrantReasonEmpty
  > {
    const next = revokeSlice(grant, atUtcMs, revokedBy, reason);
    return next.ok ? Result.ok(withLifecycle(grant, next.value)) : next;
  },

  /** The terms an active grant holds — what {@link restore} needs back once it is spent. */
  termsOf(grant: GrantLifecycle.Active): GrantLifecycle.Terms {
    return {
      ...GrantCapacityTerms.of(grant),
      ...GrantExpiryTerms.of(grant),
    };
  },

  /**
   * The write plan of a grant moving from `before` to `after`: ONE update of
   * its root — every field of the new lifecycle variant set, every field of
   * the old one the new one does not declare deleted (§6).
   */
  transitionWrite(before: CouponGrant, after: CouponGrant): WriteOp {
    const from = GrantLifecycle.of(before);
    const to = GrantLifecycle.of(after);
    return WriteOp.transition(
      [Collections.CouponGrants, after.id],
      { ...to },
      WriteOp.variantFieldsToDelete(from, to),
    );
  },

  /**
   * Was the grant's coupon made for `occasion` (`isBirthdayGrant`)? Read off
   * the coupon's own tag — a name is never parsed (§4.6).
   */
  isOccasion(
    couponOccasion: CouponOccasion | null,
    occasion: CouponOccasion,
  ): boolean {
    return couponOccasion === occasion;
  },

  /**
   * The grants whose coupon was made for `occasion`, in their order — the
   * birthday card's gift is picked from these (G-22). A grant with no
   * occasion is not one. The complement of {@link besideOccasionGift}'s
   * cut; both read one predicate over {@link isOccasion}.
   */
  forOccasion<G extends OccasionTagged>(
    grants: readonly G[],
    occasion: CouponOccasion,
  ): readonly G[] {
    const kept: G[] = [];
    for (let i = 0; i < grants.length; i++) {
      const grant = grants[i] as G;
      if (madeFor(grant, occasion)) kept.push(grant);
    }
    return kept;
  },

  /**
   * The grants the reward ticket keeps beside the occasion's card (G-12):
   * while today's card carries the gift (`giftCarried`), every grant but
   * the occasion's, so the ticket never repeats it; otherwise every grant —
   * an occasion grant still held is then an ordinary ticket. The same
   * array comes back when nothing is taken out.
   */
  besideOccasionGift<G extends OccasionTagged>(
    grants: readonly G[],
    occasion: CouponOccasion,
    giftCarried: boolean,
  ): readonly G[] {
    if (!giftCarried) return grants;
    const kept: G[] = [];
    for (let i = 0; i < grants.length; i++) {
      const grant = grants[i] as G;
      if (!madeFor(grant, occasion)) kept.push(grant);
    }
    return kept;
  },
} as const;
