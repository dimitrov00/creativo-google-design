import { DayHours, E164 } from '@core/components';
import { at, locationFixture, until } from '@core/testing';
import { shopVm, shopsHeadingKey } from './locations.presenter';

/*
 * A stored shop as the «Visit» section prints it: its own name, address,
 * number and pin, the `tel:` it dials, where «directions» leads, and its
 * week as `HH:MM` pairs, Sunday first.
 */

const shop = locationFixture({
  phoneE164: E164.of('+359881234567'),
  phoneDisplay: '+359 88 123 4567',
  openingHours: [
    DayHours.open(at(9), until(20)),
    DayHours.open(at(9), until(20)),
    DayHours.open(at(9), until(20)),
    DayHours.open(at(9), until(20)),
    DayHours.open(at(9), until(21)),
    DayHours.open(at(10), until(18)),
    DayHours.closed(),
  ],
});

describe('shopVm', () => {
  it('prints the shop’s own facts and dials its canonical number', () => {
    const vm = shopVm(shop, ['https://cdn.test/shop.jpg']);

    expect(vm.id).toBe(shop.id);
    expect(vm.name).toBe(shop.name);
    expect(vm.address).toBe(shop.address);
    expect(vm.phoneDisplay).toBe('+359 88 123 4567');
    expect(vm.callHref).toBe('tel:+359881234567');
    expect(vm.timeZone).toBe(shop.timeZone);
    expect(vm.week).toBe(shop.openingHours);
    expect(vm.gallery).toEqual(['https://cdn.test/shop.jpg']);
    expect([vm.latitude, vm.longitude]).toEqual([
      shop.latitude,
      shop.longitude,
    ]);
  });

  it('sends «directions» to the stored map link, else to the shop’s coordinates', () => {
    expect(
      shopVm({ ...shop, mapUrl: 'https://maps.app.goo.gl/creativo' }, [])
        .directionsHref,
    ).toBe('https://maps.app.goo.gl/creativo');
    expect(shopVm(shop, []).directionsHref).toBe(
      `https://www.google.com/maps/dir/?api=1&destination=${shop.latitude},${shop.longitude}`,
    );
  });

  it('words the week Sunday first, a closed day as null', () => {
    expect(shopVm(shop, []).schedule).toEqual([
      null,
      { open: '09:00', close: '20:00' },
      { open: '09:00', close: '20:00' },
      { open: '09:00', close: '20:00' },
      { open: '09:00', close: '20:00' },
      { open: '09:00', close: '21:00' },
      { open: '10:00', close: '18:00' },
    ]);
  });
});

describe('shopsHeadingKey', () => {
  it('heads one shop as the one place, more as «our locations»', () => {
    const one = [shopVm(shop, [])];
    expect(shopsHeadingKey(one)).toBe('landing.location.title');
    expect(shopsHeadingKey([...one, ...one])).toBe(
      'landing.location.titleMulti',
    );
  });
});
