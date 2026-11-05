import type { ServiceId, ServiceVariantId } from '@core/primitives';

/**
 * A service's variant, named WITH its service — «Подстрижка с ножица ·
 * Дълга коса». A variant id is unique only within its service (two services
 * may each have a `long`), so a variant is never picked, matched or stored
 * by its id alone.
 */
export type ServiceVariantPick = {
  readonly serviceId: ServiceId;
  readonly variantId: ServiceVariantId;
};

export const ServiceVariantPick = {
  of(serviceId: ServiceId, variantId: ServiceVariantId): ServiceVariantPick {
    return { serviceId, variantId };
  },

  /** One string per pick — `svc-cut/long` — to compare and to index by. */
  keyOf(pick: ServiceVariantPick): string {
    return `${pick.serviceId}/${pick.variantId}`;
  },
} as const;
