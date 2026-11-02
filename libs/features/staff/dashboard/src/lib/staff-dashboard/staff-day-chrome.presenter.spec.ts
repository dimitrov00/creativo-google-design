import { describe, expect, it } from 'vitest';
import { BarberId, LocalDate, ServiceVariantId } from '@core/primitives';
import {
  FIXTURE_TIME_ZONE,
  FIXTURE_TODAY,
  locationFixture,
  serviceFixture,
  termsFixture,
  textFixture,
  utcMs,
} from '@core/testing';
import { catalogueTranslate } from './catalogue.spec-support';
import {
  abbreviateWeekday,
  chairColumnHead,
  dateColumnHead,
  discardActionsOf,
  periodLabelOf,
  scopeChoicesOf,
  serviceOptionsOf,
  shopOptionsOf,
  staffChromeWordsOf,
  streetOf,
  viewChoicesOf,
  viewSegmentsOf,
  weekCalendarOf,
  zoneActionsOf,
  zoneLabelOf,
} from './staff-day-chrome.presenter';

const BG = staffChromeWordsOf(catalogueTranslate('bg'));
const EN = staffChromeWordsOf(catalogueTranslate('en'));
const IVAN = BarberId.of('ivan');
const VIEWS = [
  { id: 'agenda', icon: 'calendar.viewAgenda' },
  { id: 'three-day', icon: 'calendar.viewThreeDay' },
] as const;
// A Monday, the fixtures' one "today".
const MONDAY = FIXTURE_TODAY;

describe('the toolbar’s option lists', () => {
  it('names the readings in both languages, with their test ids', () => {
    expect(viewChoicesOf(VIEWS, BG).map((option) => option.label)).toEqual([
      'Списък',
      '3 дни',
    ]);
    expect(viewChoicesOf(VIEWS, EN).map((option) => option.label)).toEqual([
      'List',
      '3 days',
    ]);
    expect(viewChoicesOf(VIEWS, BG)[0]?.testId).toBe('staff-view-agenda');
  });

  it('draws the same readings as icon-only segments', () => {
    const [first] = viewSegmentsOf(VIEWS, EN);
    expect(first?.label).toBe('List');
    expect(first?.iconOnly).toBe(true);
    expect(first?.testId).toBe('staff-view-segment-agenda');
  });

  it('leads the chairs with everyone', () => {
    const options = scopeChoicesOf(
      [{ id: IVAN, name: 'Иван Колев', avatarSrc: null }],
      BG,
    );
    expect(options.map((option) => option.label)).toEqual([
      'Всички бръснари',
      'Иван Колев',
    ]);
    expect(options.map((option) => option.testId)).toEqual([
      'staff-scope-all',
      'staff-scope-ivan',
    ]);
    expect(scopeChoicesOf([], EN)[0]?.label).toBe('All barbers');
  });
});

describe('the alerts’ answers', () => {
  it('words the discard’s destructive answer and its safe one', () => {
    expect(discardActionsOf(BG).map((action) => action.label)).toEqual([
      'Отхвърли',
      'Продължи редакцията',
    ]);
    expect(discardActionsOf(EN).map((action) => action.label)).toEqual([
      'Discard',
      'Keep Editing',
    ]);
    expect(discardActionsOf(BG)[0]?.role).toBe('destructive');
    expect(discardActionsOf(BG)[1]?.preferred).toBe(true);
  });

  it('words the zone notice’s one way out', () => {
    expect(zoneActionsOf(BG)[0]?.label).toBe('Затвори');
    expect(zoneActionsOf(EN)[0]?.label).toBe('Close');
  });
});

describe('the pill and the region', () => {
  it('names nothing before there is a day', () => {
    expect(periodLabelOf([], 'bg')).toBe('');
  });

  it('leads a day with its weekday', () => {
    expect(periodLabelOf([MONDAY], 'en')).toBe('Mon, Sep 28');
  });

  it('writes a period in the pill’s own grammar', () => {
    const days = [MONDAY, LocalDate.addDays(MONDAY, 2)];
    expect(periodLabelOf(days, 'bg')).toBe(
      `28 – ${periodLabelOf([days[1] as LocalDate], 'bg').split(', ')[1]}`,
    );
    expect(EN.gridRegion('Sep 28 – 30')).toBe('Schedule: Sep 28 – 30');
    expect(BG.gridRegion('28 – 30.09')).toBe('График: 28 – 30.09');
  });

  it('names the zone in en-GB, nothing while it is not known', () => {
    expect(zoneLabelOf(utcMs('2026-09-28T06:00:00Z'), null)).toBe('');
    expect(zoneLabelOf(utcMs('2026-09-28T06:00:00Z'), FIXTURE_TIME_ZONE)).toBe(
      'EEST',
    );
    expect(zoneLabelOf(utcMs('2026-12-28T06:00:00Z'), FIXTURE_TIME_ZONE)).toBe(
      'EET',
    );
  });
});

describe('a column’s head', () => {
  it('names a chair at three widths', () => {
    const head = chairColumnHead(IVAN, 'Иван Колев', true, 'a.jpg');
    expect(head).toMatchObject({
      id: IVAN,
      title: 'Иван Колев',
      shortTitle: 'Иван',
      initial: null,
      fullTitle: 'Иван Колев',
      dayNumber: null,
      isToday: true,
      avatarSrc: 'a.jpg',
    });
  });

  it('names a date three letters off the long weekday, with a title-case month', () => {
    const bg = dateColumnHead(MONDAY, false, 'bg');
    expect(bg.title).toBe('Пон');
    expect(bg.shortTitle).toBe('Пон');
    expect(bg.fullTitle).toBe('понеделник, 28 Септември');
    expect(bg.dayNumber).toBe(28);
    expect(bg.avatarSrc).toBeNull();
    const en = dateColumnHead(MONDAY, true, 'en');
    expect(en.title).toBe('Mon');
    expect(en.initial).toBe('M');
    expect(en.isToday).toBe(true);
  });

  it('abbreviates by slicing, not by Intl’s two-letter short', () => {
    expect(abbreviateWeekday('петък', 'bg')).toBe('Пет');
    expect(abbreviateWeekday('friday', 'en')).toBe('Fri');
  });
});

describe('the week strip’s cells', () => {
  it('builds nothing before the zone gives a today', () => {
    expect(weekCalendarOf(null, 'bg')).toEqual([]);
  });

  it('runs thirteen whole weeks and marks today once', () => {
    const weeks = weekCalendarOf(MONDAY, 'en');
    expect(weeks).toHaveLength(13);
    expect(weeks.every((week) => week.days.length === 7)).toBe(true);
    const todays = weeks.flatMap((week) =>
      week.days.filter((day) => day.today),
    );
    expect(todays.map((day) => day.key)).toEqual([MONDAY]);
    expect(todays[0]).toMatchObject({ initial: 'M', number: '28' });
  });
});

describe('the sheets’ catalogue options', () => {
  const names = {
    findService: () => serviceFixture(),
    text: (localized: { readonly bg: string }) => localized.bg,
    price: ({ amountCents }: { readonly amountCents: number }) =>
      `${amountCents} ц`,
  };

  it('cuts an address to its street line', () => {
    expect(streetOf('бул. Витоша 1, София')).toBe('бул. Витоша 1');
    expect(streetOf('София')).toBe('София');
    expect(streetOf(', София')).toBe(', София');
  });

  it('names a shop, with its street as the second line', () => {
    const [shop] = shopOptionsOf([locationFixture()], names);
    expect(shop).toMatchObject({
      label: 'Център',
      address: 'бул. Витоша 1',
    });
  });

  it('offers a bare service once, at the chair’s terms', () => {
    const vm = serviceFixture();
    const [option, ...rest] = serviceOptionsOf([vm], IVAN, names);
    expect(rest).toEqual([]);
    expect(option).toMatchObject({
      id: vm.id,
      variantId: null,
      label: 'Класическо подстригване',
      serviceLabel: 'Класическо подстригване',
    });
    expect(option?.priceLabel).toBe(`${option?.priceCents} ц`);
  });

  it('offers a service with variants per variant, named both ways', () => {
    const short = ServiceVariantId.of('short');
    const service = serviceFixture({
      ...termsFixture(1500, 30),
      variants: [{ variantId: short, name: textFixture('Short', 'Къса') }],
    });
    const options = serviceOptionsOf([service], IVAN, {
      ...names,
      findService: () => service,
    });
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      id: `${service.id}:${short}`,
      variantId: short,
      label: 'Класическо подстригване · Къса',
      serviceLabel: 'Класическо подстригване',
      variantLabel: 'Къса',
    });
  });

  it('offers nothing for a service the list no longer holds', () => {
    expect(
      serviceOptionsOf([serviceFixture()], IVAN, {
        ...names,
        findService: () => undefined,
      }),
    ).toEqual([]);
  });
});
