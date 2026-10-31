import {
  Combinability,
  type CouponOccasion,
  CouponValue,
  DiscountProvenance,
  GrantCapacity,
  GrantExpiry,
  GrantLifecycle,
  WriteOp,
} from '@core/components';
import {
  type AppointmentId,
  type CouponGrantId,
  type CouponId,
  type CustomerId,
  GrantStatus,
  Result,
  UtcEpochMs,
} from '@core/primitives';
import { EngagementError } from '@core/errors';
import { type Coupon, type CouponGrant, Collections } from '@core/entities';

/**
 * A grant as the card holds it, carrying its coupon's occasion tag — every
 * producer sets it, `null` for no occasion (OR-16: required, one hidden
 * class) — so the grants pass in unmapped (Law 3).
 */
export type OccasionTagged = {
  readonly couponOccasion: CouponOccasion | null;
};

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

/**
 * What a cancel or a no-show gives back of a bill's grants
 * (`CouponGrantSystem.releasePlan`): the discounts with every grant line
 * dropped, and the write plan that restores each grant they named.
 */
export type GrantReleasePlan<D extends DiscountProvenance> = {
  readonly discounts: readonly D[];
  readonly writes: readonly WriteOp[];
};

/** The note a bill's burn stamps on the grant it spends. */
function appointmentNote(appointmentId: AppointmentId): string {
  return `appointment:${appointmentId}`;
}

/** The grants read, by id — the first of two copies of one grant answers. */
function grantsById(
  grants: readonly CouponGrant[],
): ReadonlyMap<CouponGrantId, CouponGrant> {
  const byId = new Map<CouponGrantId, CouponGrant>();
  for (let i = 0; i < grants.length; i++) {
    const grant = grants[i] as CouponGrant;
    if (!byId.has(grant.id)) byId.set(grant.id, grant);
  }
  return byId;
}

/** The grant ids a bill's lines name, in line order. */
function grantIdsOf(
  discounts: readonly DiscountProvenance[],
): ReadonlySet<CouponGrantId> {
  const ids = new Set<CouponGrantId>();
  for (let i = 0; i < discounts.length; i++) {
    const grantId = DiscountProvenance.grantIdOf(
      discounts[i] as DiscountProvenance,
    );
    if (grantId !== null) ids.add(grantId);
  }
  return ids;
}

/**
 * The restore of the grant a line that left the bill named, as its write —
 * `null` when the grant was not read or will not take the use back (an
 * expired or revoked grant, one with no use spent): a give-back never
 * fails the save or the cancel that makes it.
 */
function restoreWrite(grant: CouponGrant | undefined): WriteOp | null {
  if (grant === undefined) return null;
  const back = CouponGrantSystem.restore(grant);
  return back.ok ? CouponGrantSystem.transitionWrite(grant, back.value) : null;
}

/** The ONE predicate both occasion cuts share: the grant's coupon was made for `occasion`. */
function madeFor(grant: OccasionTagged, occasion: CouponOccasion): boolean {
  return CouponGrantSystem.isOccasion(grant.couponOccasion, occasion);
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
    ...CouponValue.sliceOf(grant),
    ...GrantLifecycle.sliceOf(lifecycle),
  };
}

/*
 * The two verbs on the LIFECYCLE SLICE (`*Slice`) — the grant's state
 * machine, total on `GrantLifecycle`; each entity verb of
 * {@link CouponGrantSystem} is its slice verb with the grant's meta and
 * value carried through untouched.
 */

/**
 * One redemption (`markUsed`): a single-use grant goes straight to
 * `USED`; a multi-use one counts down, and is `USED` at zero — the terms
 * kept either way (OR-13). `note` is the caller's account of the channel
 * (`appointment:<id>`), `''` when none was given.
 */
function burnSlice(
  grant: GrantLifecycle,
  atUtcMs: UtcEpochMs,
  note: string,
): Result<GrantLifecycle, EngagementError.CouponGrantNotActive> {
  if (grant.grantStatus !== GrantStatus.Active) {
    return Result.err(EngagementError.couponGrantNotActive(grant.grantStatus));
  }
  if (
    grant.grantCapacity === GrantCapacity.SingleUse ||
    grant.usesRemaining - 1 <= 0
  ) {
    return Result.ok(GrantLifecycle.used(grant, atUtcMs, note));
  }
  return Result.ok(
    GrantLifecycle.active(
      {
        grantCapacity: GrantCapacity.MultiUse,
        usesRemaining: grant.usesRemaining - 1,
        usesGranted: grant.usesGranted,
      },
      grant,
    ),
  );
}

/**
 * The exact inverse of {@link burnSlice}, read off the grant's own terms
 * (a `USED` grant keeps them): a grant discount a save removed, or a
 * cancel or a no-show released, goes back to the client — a `USED` grant
 * returns to `ACTIVE` with one use, a multi-use `ACTIVE` one gains a use
 * back. Expiry is not judged: a grant restored past its expiry is `ACTIVE`
 * and not usable. Refused for an expired or revoked grant (`NOT_ACTIVE`),
 * and for a grant with no use spent to give back (`INVALID_CAPACITY`,
 * naming the count it would reach).
 */
function restoreSlice(
  grant: GrantLifecycle,
): Result<
  GrantLifecycle,
  | EngagementError.CouponGrantNotActive
  | EngagementError.CouponGrantCapacityInvalid
> {
  if (
    grant.grantStatus !== GrantStatus.Used &&
    grant.grantStatus !== GrantStatus.Active
  ) {
    return Result.err(EngagementError.couponGrantNotActive(grant.grantStatus));
  }
  if (grant.grantCapacity === GrantCapacity.SingleUse) {
    return grant.grantStatus === GrantStatus.Used
      ? Result.ok(GrantLifecycle.active(grant, grant))
      : Result.err(EngagementError.couponGrantCapacityInvalid(2));
  }
  if (grant.usesRemaining >= grant.usesGranted) {
    return Result.err(
      EngagementError.couponGrantCapacityInvalid(grant.usesRemaining + 1),
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

/**
 * A client's coupon grant through its life (`coupon-grant.ts:134-299`):
 *
 *   `ACTIVE` ─ burn    → `ACTIVE` (multi-use, one fewer) OR `USED`
 *   `USED` / `ACTIVE` ─ restore → the exact inverse of `burn`
 *
 * A burn refuses a grant that is not `ACTIVE` (`NOT_ACTIVE`, naming the
 * state it found). The bill moves grants (OR-13, the voucher semantics):
 * {@link CouponGrantSystem.settleBill} burns a grant line new on a saved
 * bill and restores one that left it; {@link CouponGrantSystem.releasePlan}
 * gives every grant back when a cancel or a no-show releases the visit's
 * holdings (`BillingSystem.releasesHoldings`). `nowUtcMs`/`atUtcMs` are
 * parameters; usability against an expiry instant is a T2 lifecycle
 * comparison (G-1).
 */
export const CouponGrantSystem = {
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
      ...CouponValue.sliceOf(grant),
    };
  },

  /**
   * THE GRANTS THE VISIT SHEET'S «Отстъпка» MENU OFFERS (OR-13): the
   * record's grants still usable at `nowUtcMs` ({@link isUsable} — an
   * expired one is never offered as a new promise), in `held` order, then
   * every grant the open visit's SAVED bill names, in `billIds` order,
   * WHATEVER its status — the save burned it (`USED`), and a burned grant
   * must still show on its own visit's card. A bill id is answered by
   * `held` or `billed`, whichever names it; one neither names offers
   * nothing; each grant is offered once.
   */
  offered(
    held: readonly CouponGrant[],
    billed: readonly CouponGrant[],
    billIds: readonly CouponGrantId[],
    nowUtcMs: UtcEpochMs,
  ): readonly CouponGrant[] {
    const out: CouponGrant[] = [];
    for (let i = 0; i < held.length; i++) {
      const grant = held[i] as CouponGrant;
      if (CouponGrantSystem.isUsable(grant, nowUtcMs)) out.push(grant);
    }
    for (let i = 0; i < billIds.length; i++) {
      const id = billIds[i] as CouponGrantId;
      const grant =
        held.find((each) => each.id === id) ??
        billed.find((each) => each.id === id);
      if (grant !== undefined && !out.includes(grant)) out.push(grant);
    }
    return out;
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

  /** {@link restoreSlice} on a whole grant — its own kept terms, nothing handed in. */
  restore(
    grant: CouponGrant,
  ): Result<
    CouponGrant,
    | EngagementError.CouponGrantNotActive
    | EngagementError.CouponGrantCapacityInvalid
  > {
    const next = restoreSlice(grant);
    return next.ok ? Result.ok(withLifecycle(grant, next.value)) : next;
  },

  /**
   * The grant writes of a saved bill (OR-13, the edit transaction's own
   * reads): ONE linear pass over the bill's grant lines `before` (as
   * stored) and `after` (as settled), against the `grants` the
   * transaction read —
   * - a grant line NEW on the bill is burned, stamped `nowUtcMs` and noted
   *   `appointment:<appointmentId>`; a grant that will not burn refuses
   *   the save (`NOT_ACTIVE` — the read set is the transaction's, so a
   *   double spend cannot land);
   * - a line that LEFT the bill is restored; a restore the grant refuses
   *   (expired, revoked, nothing spent) is skipped, never failing the save;
   * - a KEPT line writes nothing — a replay of the same bill writes nothing.
   * A line whose grant was not read writes nothing: the settle never admits
   * a new grant it could not resolve (`BillingSystem.settleDiscounts`).
   */
  settleBill(
    before: readonly DiscountProvenance[],
    after: readonly DiscountProvenance[],
    grants: readonly CouponGrant[],
    appointmentId: AppointmentId,
    nowUtcMs: UtcEpochMs,
  ): Result<readonly WriteOp[], EngagementError.CouponGrantNotActive> {
    const read = grantsById(grants);
    const stored = grantIdsOf(before);
    const settled = grantIdsOf(after);
    const writes: WriteOp[] = [];
    for (const grantId of settled) {
      if (stored.has(grantId)) continue;
      const grant = read.get(grantId);
      if (grant === undefined) continue;
      const burnt = CouponGrantSystem.burn(
        grant,
        nowUtcMs,
        appointmentNote(appointmentId),
      );
      if (!burnt.ok) return burnt;
      writes.push(CouponGrantSystem.transitionWrite(grant, burnt.value));
    }
    for (const grantId of stored) {
      if (settled.has(grantId)) continue;
      const write = restoreWrite(read.get(grantId));
      if (write !== null) writes.push(write);
    }
    return Result.ok(writes);
  },

  /**
   * What a cancel or a no-show gives back of the bill (OR-13, DEP-F10b —
   * read when `BillingSystem.releasesHoldings` says the move releases): the
   * `discounts` with every grant line dropped, in their order (the same
   * array when none is a grant line), and the restore of each grant they
   * named among the `grants` read — a grant not read, or one that will not
   * take the use back, is skipped: the cancel still lands.
   */
  releasePlan<D extends DiscountProvenance>(
    discounts: readonly D[],
    grants: readonly CouponGrant[],
  ): GrantReleasePlan<D> {
    const read = grantsById(grants);
    const kept: D[] = [];
    const writes: WriteOp[] = [];
    for (let i = 0; i < discounts.length; i++) {
      const discount = discounts[i] as D;
      const grantId = DiscountProvenance.grantIdOf(discount);
      if (grantId === null) {
        kept.push(discount);
        continue;
      }
      const write = restoreWrite(read.get(grantId));
      if (write !== null) writes.push(write);
    }
    return {
      discounts: kept.length === discounts.length ? discounts : kept,
      writes,
    };
  },

  /**
   * The write plan of a grant moving from `before` to `after`: ONE update of
   * its root — every field of the new lifecycle variant set, every field of
   * the old one the new one does not declare deleted (§6).
   */
  transitionWrite(before: CouponGrant, after: CouponGrant): WriteOp {
    const from = GrantLifecycle.sliceOf(before);
    const to = GrantLifecycle.sliceOf(after);
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
