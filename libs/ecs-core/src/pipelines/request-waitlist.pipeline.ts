import {
  LocationId,
  type RepositoryError,
  RepositoryErrorCode,
  Result,
  ServiceId,
  type TimeZone,
  type UserId,
  WaitlistError,
  WaitlistRequestId,
} from '@core/primitives';
import {
  BookingPolicy,
  type BookingCart,
  ServiceStatus,
  WriteOp,
} from '@core/components';
import {
  Collections,
  type Service,
  type ShopLocation,
  type WaitlistRequest,
} from '@core/entities';
import type {
  CatalogLoadPorts,
  ClockPorts,
  CommitPorts,
  HashPorts,
  LogPorts,
  PolicyReadPorts,
} from '@core/ports';
import {
  PartyAdmissionSystem,
  type WaitlistAskInput,
  WaitlistSystem,
  ZonedTimeSystem,
} from '@core/systems';

/**
 * `requestWaitlist` — record a standing request to be told when these days
 * open up (`request-waitlist.ts`, `decide-waitlist.ts`, blueprint §4.1). The
 * owner comes from the VERIFIED token, never the payload.
 *
 * Outside the transaction: the policy, then — only for a caller who can be
 * notified at all — the cart's ACTIVE services (unless the cart is past the
 * read bound, `WaitlistSystem.withinReadBounds`) and the named shop, in one
 * `loadCatalog`. The door is `WaitlistSystem.decide`, with the commit's own
 * time-independent admission (`PartyAdmissionSystem.admitCart`) and shop
 * rule (`shopListed`) as its verdicts. The id is `wl_` + the first 40 hex of
 * `hash(WaitlistSystem.idBasis(…))` — what the request MEANS — so a
 * duplicate is the one in-transaction read (or a lost `Create` race), and
 * answers `BOOKING_WAITLIST_ALREADY_WATCHING`.
 */

export type RequestWaitlistCommand = {
  /** The verified caller; `null` for an anonymous visitor (refused by the door). */
  readonly ownerUserId: UserId | null;
  readonly ask: WaitlistAskInput;
  /** The tenant's zone — the shop's "today" and each request's first instant. */
  readonly timeZone: TimeZone;
};

export type RequestWaitlistAnswer = {
  readonly requestId: WaitlistRequestId;
};

export type RequestWaitlistPorts = CommitPorts &
  HashPorts &
  ClockPorts &
  CatalogLoadPorts &
  PolicyReadPorts &
  LogPorts;

/** How many hex digits of the digest the request id keeps (`wl_` + 40). */
const ID_DIGEST_LENGTH = 40;

/** The distinct services a cart names, in first-seen order — each one a readable id. */
function cartServiceIds(cart: BookingCart): readonly ServiceId[] {
  const ids: ServiceId[] = [];
  for (const seat of cart.cartSeats) {
    for (const line of seat.lines) {
      const id = ServiceId.parse(line.serviceId);
      if (id.ok && !ids.includes(id.value)) ids.push(id.value);
    }
  }
  return ids;
}

/** A named shop that could be a document id, else `null` (nothing is read for it). */
function namedLocation(raw: string | null): LocationId | null {
  if (raw === null) return null;
  const id = LocationId.parse(raw);
  return id.ok ? id.value : null;
}

/** The deterministic id of a decided request. */
export function waitlistRequestIdOf(
  body: Parameters<typeof WaitlistSystem.idBasis>[0],
  hash: (input: string) => string,
): WaitlistRequestId {
  return WaitlistRequestId.of(
    `wl_${hash(WaitlistSystem.idBasis(body)).slice(0, ID_DIGEST_LENGTH)}`,
  );
}

export const requestWaitlist =
  (ports: RequestWaitlistPorts) =>
  async (
    cmd: RequestWaitlistCommand,
  ): Promise<
    Result<RequestWaitlistAnswer, WaitlistError | RepositoryError>
  > => {
    const policy = await ports.loadPolicy();
    if (!policy.ok) return policy;
    const now = ZonedTimeSystem.shopNow(ports.nowUtcMs(), cmd.timeZone);

    // Read for a caller who can be notified at all: an anonymous request is
    // refused by the door and costs no reads, and a cart past the read bound
    // costs none either — the admission refuses it.
    const locationId = namedLocation(cmd.ask.locationId);
    let services: readonly Service[] = [];
    let location: ShopLocation | null = null;
    if (cmd.ownerUserId !== null) {
      const serviceIds = WaitlistSystem.withinReadBounds(
        cmd.ask.cart,
        policy.value.maxPartySize,
      )
        ? cartServiceIds(cmd.ask.cart)
        : [];
      if (serviceIds.length > 0 || locationId !== null) {
        const catalog = await ports.loadCatalog(serviceIds, locationId);
        if (!catalog.ok) return catalog;
        // A retired service is ABSENT, exactly as the commit reads it.
        const active: Service[] = [];
        for (const service of catalog.value.services) {
          if (
            service !== null &&
            service.serviceStatus === ServiceStatus.Active
          ) {
            active.push(service);
          }
        }
        services = active;
        location = catalog.value.location;
      }
    }

    // The commit's own admission of the bag at that shop — whatever the time.
    const admitted =
      cmd.ask.locationId !== null && locationId === null
        ? Result.ok(null)
        : PartyAdmissionSystem.admitCart(
            cmd.ask.cart,
            services,
            policy.value,
            locationId,
          );
    const decided = WaitlistSystem.decide(cmd.ask, {
      ownerUserId: cmd.ownerUserId,
      now,
      horizonEndLocalDate: BookingPolicy.horizonEndFrom(
        policy.value,
        now.localDate,
      ),
      maxFlexibleDays: policy.value.maxFlexibleDays,
      shopListed: PartyAdmissionSystem.shopListed(location),
      admission: admitted.ok ? null : { errorCode: admitted.error.errorCode },
    });
    if (!decided.ok) return decided;

    const body = decided.value;
    const requestId = waitlistRequestIdOf(body, ports.hash);
    const firstDay = body.localDates[0];
    // `decide` never answers a request without a day.
    if (firstDay === undefined) {
      return Result.err(WaitlistError.invalidRequest('localDate'));
    }
    const stored: Omit<WaitlistRequest, 'id'> = {
      ...body,
      utcEpochMs: ZonedTimeSystem.startOfLocalDay(firstDay, cmd.timeZone),
    };
    const path = [Collections.WaitlistRequests, requestId];
    const committed = await ports.commit(
      (tx) => tx.get<WaitlistRequest>(path),
      (existing) =>
        existing !== null
          ? Result.err(WaitlistError.alreadyWatching())
          : Result.ok({ writes: [WriteOp.create(path, stored)] }),
    );
    if (!committed.ok) {
      // A lost create race is the same answer as the read: already watched.
      return committed.error.errorCode === RepositoryErrorCode.AlreadyExists
        ? Result.err(WaitlistError.alreadyWatching())
        : committed;
    }
    return Result.ok({ requestId });
  };
