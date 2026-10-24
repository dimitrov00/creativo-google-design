import type { BookingPolicy } from '@core/components';
import { BookingPolicySettingsId } from '@core/primitives';

/**
 * The tenant's booking policy — `settings/bookingPolicy`: the seven
 * `BookingPolicy` fields flat at the document root, the archetype
 * `{ id } & BookingPolicy`. Its readers type the document as this entity
 * (Law 5) — the web's live `observePolicy` (`scheduling.adapter.ts`), the
 * functions' `loadPolicy` (`firestore-settings.adapter.ts`) and the daily
 * sweep's `loadPolicyLine` (`firestore-client-stats.adapter.ts`) — and hand
 * it through `BookingPolicy.withDefaults`, which covers an absent field and
 * an absent document (§9 D28). No zone, no `countryCallingCode`, no
 * `flags`: the zone is the shop location's (Law 7.2), the dialling code a
 * deployment constant and flags are build-time manifest values.
 */
export type BookingPolicySettings = {
  readonly id: BookingPolicySettingsId;
} & BookingPolicy;
