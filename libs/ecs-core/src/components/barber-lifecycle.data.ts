import type { UserId, UtcEpochMs } from '@core/primitives';
import { BarberStatus } from './barber-status.data';

/**
 * The statuses in which a barber works — a `DRAFT` goes live to one of
 * them, a rehire returns to one of them — in this order.
 */
const LIVE_STATUSES: readonly BarberLifecycle.LiveStatus[] = [
  BarberStatus.StaffOnly,
  BarberStatus.Public,
];

/**
 * A barber record's lifecycle (team onboarding D2,
 * `docs/designs/team-onboarding.md`) — a union of FLAT variant slices
 * intersected into the `Barber` archetype (Law 6): `barberStatus`, the
 * instant it last changed, and each variant's own fields.
 *
 * - `DRAFT` carries where it goes when it goes live
 *   (`barberDraftTargetStatus`). A `DRAFT` has never been live: a rehire
 *   returns to `barberRehireStatus`, never to `DRAFT`.
 * - `DEPARTED` carries the account whose staff access the close ended
 *   (`barberDepartedUserId`), whether that account's sessions were revoked
 *   (`barberSessionsRevokedAtUtcMs`, `null` until the revoke succeeds — the
 *   close retries it), the account the close LEFT ALONE because it assigns
 *   roles — an admin, whose roles are the owner's to change
 *   (`barberKeptAccessUserId`) — and where a rehire returns
 *   (`barberRehireStatus`).
 *
 * Holidays, illness and leave are not states: they are day exceptions or
 * a gap in hours. The audit rows hold the history of transitions; the
 * record holds only the latest (`barberStatusChangedAtUtcMs`).
 */
export type BarberLifecycle =
  | BarberLifecycle.Draft
  | BarberLifecycle.StaffOnly
  | BarberLifecycle.Public
  | BarberLifecycle.Departed;

export const BarberLifecycle = {
  /** `[STAFF_ONLY, PUBLIC]` — the statuses in which a barber works. */
  LIVE_STATUSES,

  /** A record being set up, and where it goes when it goes live. */
  draft(
    atUtcMs: UtcEpochMs,
    barberDraftTargetStatus: BarberLifecycle.LiveStatus,
  ): BarberLifecycle.Draft {
    return {
      barberStatus: BarberStatus.Draft,
      barberStatusChangedAtUtcMs: atUtcMs,
      barberDraftTargetStatus,
    };
  },

  /** A working record — staff-only or public — entered at `atUtcMs`. */
  live(
    barberStatus: BarberLifecycle.LiveStatus,
    atUtcMs: UtcEpochMs,
  ): BarberLifecycle.StaffOnly | BarberLifecycle.Public {
    return { barberStatus, barberStatusChangedAtUtcMs: atUtcMs };
  },

  /**
   * A record whose working period has closed (team onboarding D10): the
   * account the close took staff access from — `null` when none was — whose
   * sessions are not revoked yet, and where a rehire returns.
   */
  depart(
    atUtcMs: UtcEpochMs,
    barberDepartedUserId: UserId | null,
    barberRehireStatus: BarberLifecycle.LiveStatus,
    barberKeptAccessUserId: UserId | null = null,
  ): BarberLifecycle.Departed {
    return {
      barberStatus: BarberStatus.Departed,
      barberStatusChangedAtUtcMs: atUtcMs,
      barberDepartedUserId,
      barberSessionsRevokedAtUtcMs: null,
      barberKeptAccessUserId,
      barberRehireStatus,
    };
  },

  /** The same departure, its account's sessions revoked at `atUtcMs`. The status stamp is the departure's own. */
  revoked(
    departed: BarberLifecycle.Departed,
    atUtcMs: UtcEpochMs,
  ): BarberLifecycle.Departed {
    return { ...departed, barberSessionsRevokedAtUtcMs: atUtcMs };
  },

  /**
   * Whether a departure still owes its account a revoke: it took staff
   * access from one, and that account's sessions are not ended yet.
   */
  awaitsRevoke(
    lifecycle: BarberLifecycle,
  ): lifecycle is BarberLifecycle.Departed & {
    readonly barberDepartedUserId: UserId;
  } {
    return (
      lifecycle.barberStatus === BarberStatus.Departed &&
      lifecycle.barberDepartedUserId !== null &&
      lifecycle.barberSessionsRevokedAtUtcMs === null
    );
  },

  /** The edge guard for an untrusted live status (a callable's payload). */
  isLiveStatus(value: unknown): value is BarberLifecycle.LiveStatus {
    return value === BarberStatus.StaffOnly || value === BarberStatus.Public;
  },

  /** Whether the barber works — staff can book them (`STAFF_ONLY` or `PUBLIC`). */
  isLive(
    lifecycle: BarberLifecycle,
  ): lifecycle is BarberLifecycle.StaffOnly | BarberLifecycle.Public {
    return (
      lifecycle.barberStatus === BarberStatus.StaffOnly ||
      lifecycle.barberStatus === BarberStatus.Public
    );
  },

  /** Whether the barber is listed publicly and bookable online. */
  isPublic(lifecycle: BarberLifecycle): lifecycle is BarberLifecycle.Public {
    return lifecycle.barberStatus === BarberStatus.Public;
  },
} as const;

export namespace BarberLifecycle {
  /** A status a barber works in. */
  export type LiveStatus =
    typeof BarberStatus.StaffOnly | typeof BarberStatus.Public;

  export type Draft = {
    readonly barberStatus: typeof BarberStatus.Draft;
    readonly barberStatusChangedAtUtcMs: UtcEpochMs;
    /** Where the record goes when its needed items are done. */
    readonly barberDraftTargetStatus: LiveStatus;
  };
  export type StaffOnly = {
    readonly barberStatus: typeof BarberStatus.StaffOnly;
    readonly barberStatusChangedAtUtcMs: UtcEpochMs;
  };
  export type Public = {
    readonly barberStatus: typeof BarberStatus.Public;
    readonly barberStatusChangedAtUtcMs: UtcEpochMs;
  };
  export type Departed = {
    readonly barberStatus: typeof BarberStatus.Departed;
    readonly barberStatusChangedAtUtcMs: UtcEpochMs;
    /** The account the close took staff access from, or `null` when none was linked. */
    readonly barberDepartedUserId: UserId | null;
    /** When that account's sessions were revoked; `null` until the revoke succeeds. */
    readonly barberSessionsRevokedAtUtcMs: UtcEpochMs | null;
    /**
     * The account that signed in as them and KEPT its roles at the close,
     * because it assigns roles (an admin): no access was taken from it, so
     * none is revoked — its roles are the owner's to change in «Роли».
     * `null` when the close took access, or found no account.
     */
    readonly barberKeptAccessUserId: UserId | null;
    /** Where «Върни в екипа» returns the record. */
    readonly barberRehireStatus: LiveStatus;
  };
}
