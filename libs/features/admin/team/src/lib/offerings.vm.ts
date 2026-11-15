import type { ServiceId, ServiceVariantId } from '@core/primitives';

/** One service on the list: what the barber charges for it, or that they do not perform it. */
export type OfferingRowVm = {
  readonly serviceId: ServiceId;
  readonly name: string;
  /** «10,00 € · 30 мин», or the words for not performed. */
  readonly value: string;
  readonly performed: boolean;
  readonly testId: string;
};

/** A price and a time as their fields print them. */
export type OfferingTermsVm = {
  /** `null` for the service's own terms; a variant's id for a variant. */
  readonly variantId: ServiceVariantId | null;
  /** The variant's name; `null` for the service's own terms. */
  readonly heading: string | null;
  /** «10,00» — the figure alone; the unit is the field's. */
  readonly price: string;
  /** «30» */
  readonly minutes: string;
  readonly priceLabel: string;
  readonly minutesLabel: string;
  /** What the two fields are named after in a test: `base`, or the variant's id. */
  readonly key: string;
};

/** One service's own page: whether the barber performs it, and at what terms. */
export type OfferingPageVm = {
  readonly serviceId: ServiceId;
  readonly name: string;
  readonly performed: boolean;
  /** The service's own terms first, then each variant it declares. */
  readonly terms: readonly OfferingTermsVm[];
  /** «€» — the unit beside a price. */
  readonly currencyUnit: string;
};

/** «Услуги и цени»: the list, and the page of the service that is open. */
export type OfferingsVm = {
  readonly rows: readonly OfferingRowVm[];
  readonly page: OfferingPageVm | null;
};
