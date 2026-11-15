import { describe, expect, it } from 'vitest';
import { Locale, ServiceId, ServiceVariantId } from '@core/primitives';
import { OfferingEditSystem } from '@core/systems';
import {
  deepFreeze,
  serviceFixture,
  termsFixture,
  textFixture,
} from '@core/testing';
import { catalogueTranslate } from './catalogue.spec-support';
import { offeringsVm } from './offerings.presenter';
import { offeringWordsOf } from './offerings.words';
import { IVAN, NIKOLAY } from './team.fixtures.spec-support';

/*
 * «Услуги и цени», worded (Law 10): a row per service and the open
 * service's page, pinned in both languages from fixed inputs and the app's
 * real catalogue.
 */

const NBSP = ' ';
const read = (line: string): string => line.replaceAll(NBSP, ' ');

const CUT = ServiceId.of('svc-cut');
const BEARD = ServiceId.of('svc-beard');
const SHORT = ServiceVariantId.of('short');
const LONG = ServiceVariantId.of('long');

/** A cut with two hair lengths — Ivan charges more for long hair — and a beard trim nobody is listed for. */
const SERVICES = deepFreeze([
  serviceFixture({
    id: CUT,
    name: textFixture('Haircut', 'Подстригване'),
    ...termsFixture(2800, 30),
    variants: [
      { variantId: SHORT, name: textFixture('Short hair', 'Къса коса') },
      { variantId: LONG, name: textFixture('Long hair', 'Дълга коса') },
    ],
    offerings: [
      {
        barberId: IVAN.barberId,
        ...termsFixture(3000, 30),
        overrides: [{ variantId: LONG, ...termsFixture(3500, 45) }],
      },
    ],
  }),
  serviceFixture({
    id: BEARD,
    name: textFixture('Beard trim', 'Оформяне на брада'),
    ...termsFixture(1000, 20),
    offerings: [],
  }),
]);

const vmOf = (
  barberId = IVAN.barberId,
  openServiceId: ServiceId | null = null,
  lang: 'bg' | 'en' = 'bg',
) =>
  offeringsVm({
    services: SERVICES,
    entries: OfferingEditSystem.entriesOf(SERVICES, barberId),
    openServiceId,
    words: offeringWordsOf(catalogueTranslate(lang)),
    locale: lang === 'bg' ? Locale.Bg : Locale.En,
  });

describe('offeringsVm — the list', () => {
  it('rows the catalogue’s services in its order: the barber’s own price and time, or that they do not perform it', () => {
    const vm = vmOf();
    expect(
      vm.rows.map((row) => [row.name, read(row.value), row.performed]),
    ).toEqual([
      ['Подстригване', '30,00 € · 30 мин', true],
      ['Оформяне на брада', 'Не извършва', false],
    ]);
    expect(vm.rows.map((row) => row.testId)).toEqual([
      'offering-svc-cut',
      'offering-svc-beard',
    ]);
    expect(vm.page).toBeNull();
  });

  it('says a barber with nothing yet performs nothing', () => {
    expect(vmOf(NIKOLAY.barberId).rows.map((row) => row.performed)).toEqual([
      false,
      false,
    ]);
  });

  it('words it in English', () => {
    expect(
      vmOf(IVAN.barberId, null, 'en').rows.map((row) => read(row.value)),
    ).toEqual(['€30.00 · 30 min', 'Not performed']);
  });
});

describe('offeringsVm — a service’s page', () => {
  it('prints the barber’s own terms first, then each variant: its own when priced differently, else the base', () => {
    const page = vmOf(IVAN.barberId, CUT).page;
    expect(page?.name).toBe('Подстригване');
    expect(page?.performed).toBe(true);
    expect(page?.currencyUnit).toBe('€');
    expect(
      page?.terms.map((terms) => [
        terms.key,
        terms.heading,
        terms.price,
        terms.minutes,
      ]),
    ).toEqual([
      ['base', null, '30,00', '30'],
      ['short', 'Къса коса', '30,00', '30'],
      ['long', 'Дълга коса', '35,00', '45'],
    ]);
  });

  it('names each field for a reader: the service’s own plainly, a variant’s after the variant', () => {
    const terms = vmOf(IVAN.barberId, CUT).page?.terms ?? [];
    expect([terms[0]?.priceLabel, terms[0]?.minutesLabel]).toEqual([
      'Цена',
      'Времетраене',
    ]);
    expect([terms[2]?.priceLabel, terms[2]?.minutesLabel]).toEqual([
      'Цена, Дълга коса',
      'Времетраене, Дълга коса',
    ]);
  });

  it('offers no terms for a service the barber does not perform', () => {
    const page = vmOf(IVAN.barberId, BEARD).page;
    expect(page?.performed).toBe(false);
    expect(page?.terms).toEqual([]);
  });

  it('holds no page for a service the catalogue does not list', () => {
    expect(vmOf(IVAN.barberId, ServiceId.of('svc-gone')).page).toBeNull();
  });
});

describe('offeringsVm — purity', () => {
  it('same input → same output', () => {
    expect(vmOf(IVAN.barberId, CUT)).toEqual(vmOf(IVAN.barberId, CUT));
  });
});
