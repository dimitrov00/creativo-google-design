import type {
  BarberId,
  LocationId,
  ServiceId,
  TimeZone,
} from '@core/primitives';

/*
 * THE CATALOGUE, AS A VISIT ROW READS IT — what a host hands the row and
 * card builders (`visitRowOf`, `visitCardOf`, `waitlistRowOf`) so they name
 * services, barbers and shops without injecting a catalogue service. A
 * contract of lookups, not a display model: it lives in a `*.contracts.ts`
 * of its own (pass D, D-7.6 — Law 10.3 keeps function values out of a
 * `*.vm.ts`).
 *
 * Every lookup is keyed by the id's brand (Law 7.4): the row reads each id
 * off the stored entity as it is. A host may implement a lookup over a
 * wider key (`(id: string) => …`) — it still satisfies the contract. The
 * shop count is a plain number, never a getter (D-7.6): a host that keeps
 * it current rebuilds the lookup when it moves.
 *
 * `ClientCardCatalog` extends it, so the staff sheet hands one object to
 * the card and to the rows.
 */
export interface VisitLookup {
  serviceName(id: ServiceId): string | null;
  barberName(id: BarberId): string | null;
  barberAvatarSrc(id: BarberId): string | null;
  /**
   * The shop as a fact line names it: `Location.shortName` («Център»), not
   * its whole name. Every shop carries the tenant's brand («Креативо ·
   * Център»), so on every row the whole name would repeat the one part
   * that never changes.
   */
  locationName(id: LocationId): string | null;
  /** More than one shop puts the shop's name in a worked visit's fact line. */
  readonly locationCount: number;
  /**
   * The shop's IANA zone (`ShopLocation.timeZone`, Law 7.2) — what a
   * photo's day is read in. Optional: a lookup that names none reads it in
   * the zone the host read "now" in (`VisitRowOptions.timeZone`; every shop
   * of the tenant keeps one clock).
   */
  locationTimeZone?(id: LocationId): TimeZone | null;
}
