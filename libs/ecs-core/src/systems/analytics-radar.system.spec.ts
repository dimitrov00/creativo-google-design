import { describe, expect, it } from 'vitest';
import { type AnalyticsReport, RadarBase } from '@core/components';
import { BarberId, type MinuteCount, type PriceCents } from '@core/primitives';
import { deepFreeze, shopReportFixture } from '@core/testing';
import { AnalyticsRadarSystem, type RadarBest } from './analytics-radar.system';

const R = AnalyticsRadarSystem;
const ivan = BarberId.of('ivan');
const niko = BarberId.of('niko');
const maria = BarberId.of('maria');
const m = (raw: number): MinuteCount => raw as MinuteCount;
const cents = (raw: number): PriceCents => raw as PriceCents;

/** A barber clearing every floor: 24 seats over 240 service minutes for 28,00 €, 8 rostered days, 20 in each base. */
function figuresOf(
  barberId: BarberId,
  overrides: Partial<AnalyticsReport.BarberFigures> = {},
): AnalyticsReport.BarberFigures {
  return {
    barberId,
    rosteredMinutes: m(540),
    workedMinutes: m(240),
    noShowMinutes: m(30),
    unmarkedMinutes: m(0),
    blockedMinutes: m(60),
    unsoldMinutes: m(100),
    openMinutes: m(25),
    takingsCents: cents(2800),
    tipsCents: cents(250),
    rebookedCount: 12,
    rebookedBase: 20,
    rebookedRate: 0.6,
    noShowCount: 1,
    noShowBase: 25,
    noShowRate: 0.04,
    lateCancellationCount: 0,
    serviceMinutes: m(240),
    workedSeatCount: 24,
    rosteredDayCount: 8,
    ...overrides,
  };
}

const NO_BEST: RadarBest = {
  takingsPerHour: null,
  fill: null,
  rebooking: null,
  tipsRate: null,
};

describe('AnalyticsRadarSystem.axisValuesOf — the raw axes with their floors', () => {
  it('derives the five values from the figures', () => {
    expect(R.axisValuesOf(figuresOf(ivan))).toEqual({
      takingsPerHour: 700, // 2800 ÷ 240 × 60
      fill: 240 / 540,
      rebooking: 0.6,
      tipsRate: 250 / 2800,
      reliability: 96, // (1 − 0.04) × 100
    });
  });

  it('answers null under each base: 19 worked seats, 6 rostered days, a rate under 20', () => {
    const values = R.axisValuesOf(
      figuresOf(ivan, {
        workedSeatCount: 19,
        rosteredDayCount: 6,
        rebookedBase: 19,
        rebookedRate: null,
        noShowBase: 19,
        noShowRate: null,
      }),
    );
    expect(values).toEqual({
      takingsPerHour: null,
      fill: null,
      rebooking: null,
      tipsRate: null,
      reliability: null,
    });
    // Exactly at the base, every axis has a value.
    expect(
      R.axisValuesOf(
        figuresOf(ivan, { workedSeatCount: 20, rosteredDayCount: 7 }),
      ),
    ).not.toMatchObject({ takingsPerHour: null, fill: null, tipsRate: null });
  });

  it('answers null with nothing to divide by: no service minutes, no rostered minutes, no takings', () => {
    expect(
      R.axisValuesOf(
        figuresOf(ivan, {
          serviceMinutes: m(0),
          rosteredMinutes: m(0),
          takingsCents: cents(0),
        }),
      ),
    ).toMatchObject({ takingsPerHour: null, fill: null, tipsRate: null });
  });
});

describe('AnalyticsRadarSystem.bestOf — the shop’s best of each axis', () => {
  it('takes the maximum of each axis among the barbers meeting its floor', () => {
    const best = R.bestOf([
      figuresOf(ivan),
      figuresOf(niko, {
        takingsCents: cents(1750),
        serviceMinutes: m(210), // 500 an hour
        workedMinutes: m(300), // fill 300 ÷ 540
        rebookedRate: 0.4,
        tipsCents: cents(250), // 250 ÷ 1750 — the higher tips rate
      }),
      // Under every floor: never the best, however high the figure.
      figuresOf(maria, {
        takingsCents: cents(99_000),
        workedSeatCount: 3,
        rosteredDayCount: 2,
        rebookedBase: 2,
        rebookedRate: null,
      }),
    ]);
    expect(best).toEqual({
      takingsPerHour: 700,
      fill: 300 / 540,
      rebooking: 0.6,
      tipsRate: 250 / 1750,
    });
  });

  it('is null on an axis no barber meets the floor of, and for no barbers at all', () => {
    expect(
      R.bestOf([
        figuresOf(ivan, { rosteredDayCount: 3 }),
        figuresOf(niko, { rosteredDayCount: 1 }),
      ]).fill,
    ).toBeNull();
    expect(R.bestOf([])).toEqual(NO_BEST);
  });
});

describe('AnalyticsRadarSystem.axes — one barber against the best', () => {
  const best: RadarBest = {
    takingsPerHour: 700,
    fill: 240 / 540,
    rebooking: 0.6,
    tipsRate: 250 / 1750,
  };

  it('normalises the four axes to value ÷ best × 100 and keeps reliability absolute', () => {
    expect(R.axes(figuresOf(ivan), best)).toEqual({
      takingsPerHour: 100,
      fill: 100,
      rebooking: 100,
      tipsRate: 62.5, // (250 ÷ 2800) ÷ (250 ÷ 1750) × 100
      reliability: 96,
    });
    const half = R.axes(
      figuresOf(niko, { takingsCents: cents(1400), rebookedRate: 0.3 }),
      best,
    );
    expect(half.takingsPerHour).toBe(50);
    expect(half.rebooking).toBe(50);
  });

  it('answers null under the base, and when the best is null or 0', () => {
    expect(R.axes(figuresOf(ivan, { workedSeatCount: 5 }), best)).toMatchObject(
      { takingsPerHour: null, tipsRate: null, fill: 100 },
    );
    expect(R.axes(figuresOf(ivan), NO_BEST)).toEqual({
      takingsPerHour: null,
      fill: null,
      rebooking: null,
      tipsRate: null,
      reliability: 96,
    });
    expect(
      R.axes(figuresOf(ivan, { rebookedRate: 0 }), { ...best, rebooking: 0 })
        .rebooking,
    ).toBeNull();
  });

  it('keeps reliability even when every normalised axis is missing', () => {
    expect(
      R.axes(figuresOf(ivan, { workedSeatCount: 0 }), NO_BEST).reliability,
    ).toBe(96);
    expect(
      R.axes(figuresOf(ivan, { noShowRate: null }), best).reliability,
    ).toBeNull();
  });
});

describe('AnalyticsRadarSystem.radarsOf — the report’s rows', () => {
  const current = [
    figuresOf(ivan),
    figuresOf(niko, {
      takingsCents: cents(1750),
      serviceMinutes: m(210),
      rebookedCount: 8,
      rebookedRate: 0.4,
      noShowCount: 3,
      noShowBase: 24,
      noShowRate: 0.125,
      workedSeatCount: 21,
      rosteredDayCount: 7,
    }),
  ];

  it('normalises each barber against the shop’s best, in the barbers’ order, with the base BEST_OF_SHOP', () => {
    const { reportRadars, reportRadarBase } = R.radarsOf(current, []);
    expect(reportRadarBase).toBe(RadarBase.BestOfShop);
    expect(reportRadars.map((row) => row.barberId)).toEqual([ivan, niko]);
    expect(reportRadars[0]).toEqual({
      barberId: ivan,
      takingsPerHour: 100,
      fill: 100,
      rebooking: 100,
      tipsRate: 62.5,
      reliability: 96,
      comparisonTakingsPerHour: null,
      comparisonFill: null,
      comparisonRebooking: null,
      comparisonTipsRate: null,
      comparisonReliability: null,
    });
    const second = reportRadars[1] as AnalyticsReport.RadarRow;
    expect(second).toMatchObject({
      barberId: niko,
      fill: 100,
      tipsRate: 100,
      reliability: 87.5,
    });
    expect(second.takingsPerHour).toBeCloseTo((500 / 700) * 100, 10);
    expect(second.rebooking).toBeCloseTo((0.4 / 0.6) * 100, 10);
  });

  it('normalises the comparison period against THIS period’s best, matched by barber — null where a barber has none', () => {
    const { reportRadars } = R.radarsOf(current, [
      // Last month Ivan made 700 an hour too, filled 300 of 540, rebooked 9 of 20, took fewer tips.
      figuresOf(ivan, {
        takingsCents: cents(3500),
        serviceMinutes: m(300),
        workedMinutes: m(300),
        rebookedCount: 9,
        rebookedRate: 0.45,
        tipsCents: cents(200),
        noShowCount: 5,
        noShowRate: 0.2,
      }),
      // A barber of last month who is not in scope now: ignored.
      figuresOf(maria),
    ]);
    const first = reportRadars[0] as AnalyticsReport.RadarRow;
    expect(first).toMatchObject({
      comparisonTakingsPerHour: 100,
      comparisonRebooking: 75,
      comparisonReliability: 80,
    });
    // On this period's best a comparison axis may pass 100.
    expect(first.comparisonFill).toBeCloseTo(125, 10);
    expect(first.comparisonTipsRate).toBeCloseTo(40, 10);
    expect(reportRadars[1]).toMatchObject({
      comparisonTakingsPerHour: null,
      comparisonFill: null,
      comparisonRebooking: null,
      comparisonTipsRate: null,
      comparisonReliability: null,
    });
    expect(reportRadars).toHaveLength(2);
  });

  it('answers no rows and TOO_FEW_BARBERS with one barber or none — nothing to compare against', () => {
    expect(R.radarsOf([figuresOf(ivan)], [figuresOf(ivan)])).toEqual({
      reportRadars: [],
      reportRadarBase: RadarBase.TooFewBarbers,
    });
    expect(R.radarsOf([], [])).toEqual({
      reportRadars: [],
      reportRadarBase: RadarBase.TooFewBarbers,
    });
  });

  it('draws two barbers under every floor as rows of null axes, reliability included', () => {
    const { reportRadars, reportRadarBase } = R.radarsOf(
      [
        figuresOf(ivan, {
          workedSeatCount: 2,
          rosteredDayCount: 1,
          rebookedRate: null,
          noShowRate: null,
        }),
        figuresOf(niko, {
          workedSeatCount: 1,
          rosteredDayCount: 1,
          rebookedRate: null,
          noShowRate: null,
        }),
      ],
      [],
    );
    expect(reportRadarBase).toBe(RadarBase.BestOfShop);
    expect(reportRadars).toHaveLength(2);
    for (const row of reportRadars) {
      expect(row).toMatchObject({
        takingsPerHour: null,
        fill: null,
        rebooking: null,
        tipsRate: null,
        reliability: null,
      });
    }
  });

  it('is what the shop report fixture carries', () => {
    const report = shopReportFixture();
    expect(
      R.radarsOf(report.reportBarbers, report.reportComparisonBarbers),
    ).toEqual({
      reportRadars: report.reportRadars,
      reportRadarBase: report.reportRadarBase,
    });
    const ivanRow = report.reportRadars[0] as AnalyticsReport.RadarRow;
    expect(ivanRow).toMatchObject({
      takingsPerHour: 100,
      fill: 100,
      rebooking: 100,
      tipsRate: 62.5,
      reliability: 96,
      comparisonTakingsPerHour: 100,
    });
    expect(ivanRow.comparisonFill).toBeCloseTo(90, 10);
    expect(ivanRow.comparisonTipsRate).toBeCloseTo(60, 10);
  });

  it('is pure: same input → same output, inputs untouched', () => {
    const barbers = deepFreeze(current);
    const comparison = deepFreeze([figuresOf(ivan, { tipsCents: cents(100) })]);
    const once = R.radarsOf(barbers, comparison);
    const twice = R.radarsOf(barbers, comparison);
    expect(twice).toEqual(once);
    expect(R.bestOf(barbers)).toEqual(R.bestOf(barbers));
  });
});
