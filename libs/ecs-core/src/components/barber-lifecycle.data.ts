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
 *   close retries it), and where a rehire returns (`barberRehireStatus`).
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
    /** Where «Върни в екипа» returns the record. */
    readonly barberRehireStatus: LiveStatus;
  };
}
