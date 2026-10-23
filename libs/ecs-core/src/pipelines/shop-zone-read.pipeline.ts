import { type LocationId, Result, type TimeZone } from '@core/primitives';
import { CatalogErrorCode, RepositoryError } from '@core/errors';
import { Collections } from '@core/entities';
import type { DefaultLocationPorts, LocationLoadPorts } from '@core/ports';
import { resolveShopZone } from './resolve-shop-zone.pipeline';

/**
 * THE SERVER'S ZONE READ (Phase 4a 4A-11, 4A-2 (e)) — `resolveShopZone` as
 * a server pipeline's impure read takes it: the named location's zone, else
 * the deployment's default location's. A boundary that cannot read one
 * answers ITS EXISTING store-failure outcome, a `RepositoryError`: a read
 * that failed is its own; neither location stored (a deploy precondition
 * since flip 4) is `REPOSITORY_READ_FAILED` on the location last asked for,
 * the refusal's code as its `reason` — what the retrying edge judges a
 * redelivery by (never transient) and what a callable answers as its
 * `internal` store failure, the cause in the log only.
 *
 * The ONE copy of that reading, shared by every server pipeline whose wall
 * clock has no location in scope or whose command names one
 * (`request-waitlist`, `rebuild-busy`, `rebuild-capacity`, `match-waitlist`,
 * `sample-lead-time`, `project-client-stats`, `continue-policy-recompute`,
 * `run-backfill`, `publish-streak-definition`) — and by the browser's
 * `shop-today` (the loyalty catalogue's shop day, no location in scope).
 */
export const readShopZone =
  (ports: LocationLoadPorts & DefaultLocationPorts) =>
  async (
    locationId: LocationId | null,
  ): Promise<Result<TimeZone, RepositoryError>> => {
    const zone = await resolveShopZone(ports)(locationId);
    if (zone.ok) return zone;
    const error = zone.error;
    return error.errorCode === CatalogErrorCode.LocationZoneUnknown
      ? Result.err(
          RepositoryError.readFailed(
            `${Collections.Locations}/${error.locationId}`,
            error.errorCode,
          ),
        )
      : Result.err(error);
  };
