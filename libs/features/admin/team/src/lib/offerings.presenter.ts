import {
  type BarberOffering,
  LocalizedText,
  type ServiceTermsInput,
} from '@core/components';
import type { Service } from '@core/entities';
import {
  Currency,
  type Locale,
  PriceCents,
  type ServiceId,
  type ServiceVariantId,
} from '@core/primitives';
import { OfferingEditSystem } from '@core/systems';
import {
  formatCents,
  formatCentsFigure,
  formatCount,
  formatCurrencyUnit,
} from '@creativo/ui/wall-clock';
import type {
  OfferingPageVm,
  OfferingRowVm,
  OfferingTermsVm,
  OfferingsVm,
} from './offerings.vm';
import type { OfferingWords } from './offerings.words';

/*
 * «УСЛУГИ И ЦЕНИ», WORDED (Law 10): the catalogue's services and the list
 * the editor holds in; a row per service and the open service's page out.
 * It decides nothing: what a barber's terms are for a variant is
 * `OfferingEditSystem.termsAt`'s, and whether the list may be saved is
 * `OfferingEditSystem.plan`'s, asked by the sheet.
 */

/** What the services editor is worded from. */
export type OfferingsInput = {
  /** The catalogue's services, in its own order. */
  readonly services: readonly Service[];
  /** The complete list the editor holds: what the barber performs. */
  readonly entries: readonly BarberOffering.Entry[];
  /** The service whose page is open; `null` on the list. */
  readonly openServiceId: ServiceId | null;
  readonly words: OfferingWords;
  readonly locale: Locale;
};

/** The entry the list holds for a service; `undefined` when the barber does not perform it. */
function entryOf(
  input: OfferingsInput,
  serviceId: ServiceId,
): BarberOffering.Entry | undefined {
  return input.entries.find((entry) => entry.serviceId === serviceId);
}

/** «10,00 €» — an amount in the service's currency; the bare number when either is not one. */
function priceOf(terms: ServiceTermsInput, locale: Locale): string {
  const cents = PriceCents.of(terms.priceCents);
  return cents.ok && Currency.is(terms.currency)
    ? formatCents(cents.value, terms.currency, locale)
    : String(terms.priceCents);
}

/** «10,00» — the same amount as a field's bare figure. */
function figureOf(terms: ServiceTermsInput, locale: Locale): string {
  const cents = PriceCents.of(terms.priceCents);
  return cents.ok && Currency.is(terms.currency)
    ? formatCentsFigure(cents.value, terms.currency, locale)
    : String(terms.priceCents);
}

function rowOf(service: Service, input: OfferingsInput): OfferingRowVm {
  const entry = entryOf(input, service.id);
  return {
    serviceId: service.id,
    name: LocalizedText.pick(service.name, input.locale),
    value:
      entry === undefined
        ? input.words.none
        : input.words.terms(
            priceOf(entry, input.locale),
            formatCount(entry.durationMinutes, input.locale),
          ),
    performed: entry !== undefined,
    testId: `offering-${service.id}`,
  };
}

/** A price and a time as their two fields print them — the service's own, or a variant's. */
function termsVm(
  entry: BarberOffering.Entry,
  variantId: ServiceVariantId | null,
  heading: string | null,
  input: OfferingsInput,
): OfferingTermsVm {
  const terms = OfferingEditSystem.termsAt(entry, variantId);
  const { words } = input;
  return {
    variantId,
    heading,
    price: figureOf(terms, input.locale),
    minutes: String(terms.durationMinutes),
    priceLabel: heading === null ? words.price : words.variantPrice(heading),
    minutesLabel:
      heading === null ? words.duration : words.variantDuration(heading),
    key: variantId ?? 'base',
  };
}

function pageOf(service: Service, input: OfferingsInput): OfferingPageVm {
  const entry = entryOf(input, service.id);
  const terms: OfferingTermsVm[] = [];
  if (entry !== undefined) {
    terms.push(termsVm(entry, null, null, input));
    for (const variant of service.variants) {
      terms.push(
        termsVm(
          entry,
          variant.variantId,
          LocalizedText.pick(variant.name, input.locale),
          input,
        ),
      );
    }
  }
  return {
    serviceId: service.id,
    name: LocalizedText.pick(service.name, input.locale),
    performed: entry !== undefined,
    terms,
    currencyUnit: formatCurrencyUnit(service.currency, input.locale),
  };
}

/** «Услуги и цени»: a row per service, and the page of the one that is open. */
export function offeringsVm(input: OfferingsInput): OfferingsVm {
  const open =
    input.openServiceId === null
      ? undefined
      : input.services.find((service) => service.id === input.openServiceId);
  return {
    rows: input.services.map((service) => rowOf(service, input)),
    page: open === undefined ? null : pageOf(open, input),
  };
}
