import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { AccessScope, BarberId, StaffCapability } from '@core/primitives';
import { type StaffAccess, StaffAccessSystem } from '@core/systems';
import { StaffAccessService } from '@creativo/features/client/account-state';
import { ScheduleAccess } from './schedule-access';

/*
 * `ScheduleAccess` (staff permissions P8): whose time the person may change
 * on the schedule. The answers are `StaffAccessService`'s; this spec holds
 * which capability each entry point asks, and what an id is read as.
 */

const IVAN = BarberId.of('ivan');
const NIKO = BarberId.of('niko');
const DAY = '2026-08-05';
const { None, Own, All } = AccessScope;

/** A session whose reach for each capability is given; the record that is its own is Ivan's. */
function gates(reach: {
  readonly timeOff: AccessScope;
  readonly hours: AccessScope;
}): ScheduleAccess {
  const accessOf = (staffCapability: StaffCapability): StaffAccess => ({
    accessScope:
      staffCapability === StaffCapability.TimeOff
        ? reach.timeOff
        : staffCapability === StaffCapability.Hours
          ? reach.hours
          : None,
    linkedBarberId: IVAN,
  });
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      {
        provide: StaffAccessService,
        useValue: {
          mayFor: (staffCapability: StaffCapability, barberId: BarberId) =>
            StaffAccessSystem.reaches(accessOf(staffCapability), barberId),
        },
      },
    ],
  });
  return TestBed.inject(ScheduleAccess);
}

const chairs = [{ id: IVAN }, { id: NIKO }];

describe('ScheduleAccess — which capability each entry point asks', () => {
  it('blocked time asks TIME_OFF, weekly hours ask HOURS — each on the chair it is for', () => {
    const own = gates({ timeOff: Own, hours: None });
    expect(own.blocks(IVAN)).toBe(true);
    expect(own.blocks(NIKO)).toBe(false);
    expect(own.hours(IVAN)).toBe(false);

    const desk = gates({ timeOff: None, hours: All });
    expect(desk.blocks(IVAN)).toBe(false);
    expect(desk.hours(IVAN)).toBe(true);
    expect(desk.hours(NIKO)).toBe(true);
  });

  it('a barber on the standard changes their own chair and reads a colleague’s', () => {
    const barber = gates({ timeOff: Own, hours: Own });
    expect(barber.blockable(chairs)).toEqual([{ id: IVAN }]);
    expect(barber.hourable(chairs)).toEqual([{ id: IVAN }]);
  });

  it('the front desk on the standard changes every chair; with the row cut, none', () => {
    const desk = gates({ timeOff: All, hours: All });
    expect(desk.blockable(chairs)).toEqual(chairs);
    expect(desk.hourable(chairs)).toEqual(chairs);

    const cut = gates({ timeOff: All, hours: None });
    expect(cut.hourable(chairs)).toEqual([]);
    expect(cut.blockable(chairs)).toEqual(chairs);
  });
});

describe('ScheduleAccess.edits — what a drawn thing’s id is read as', () => {
  it('a block is its chair’s TIME_OFF', () => {
    const barber = gates({ timeOff: Own, hours: All });
    expect(barber.edits(`block:ivan:${DAY}:600`)).toBe(true);
    // Hours on every chair do not open a colleague's blocked time.
    expect(barber.edits(`block:niko:${DAY}:600`)).toBe(false);
  });

  it('a break opens on either: the day’s own is TIME_OFF, the roster’s is HOURS', () => {
    expect(
      gates({ timeOff: Own, hours: None }).edits(`break:ivan:${DAY}:780`),
    ).toBe(true);
    expect(
      gates({ timeOff: None, hours: Own }).edits(`break:ivan:${DAY}:780`),
    ).toBe(true);
    expect(
      gates({ timeOff: Own, hours: Own }).edits(`break:niko:${DAY}:780`),
    ).toBe(false);
    expect(
      gates({ timeOff: None, hours: None }).edits(`break:ivan:${DAY}:780`),
    ).toBe(false);
  });

  it('a chair’s id is taken whole, colons and all', () => {
    const barber = gates({ timeOff: Own, hours: None });
    expect(barber.edits(`block:ivan:${DAY}:600`)).toBe(true);
    expect(barber.edits(`block:iv:an:${DAY}:600`)).toBe(false);
  });

  it('a visit is not this gate’s to refuse', () => {
    const nobody = gates({ timeOff: None, hours: None });
    expect(nobody.edits('appt-1')).toBe(true);
    expect(nobody.edits('appt-1:seat-1')).toBe(true);
  });
});

describe('ScheduleAccess.allDayShut — which all-day doors are shut', () => {
  const dates = [{ id: '2026-08-05' }, { id: '2026-08-06' }];

  it('shuts every chair the person may not block: its band in the day view, its chip in every view', () => {
    const barber = gates({ timeOff: Own, hours: Own });
    // The day view's columns are the chairs.
    expect([...barber.allDayShut(chairs, chairs)]).toEqual(['niko']);
    // A date view's columns are days: their bands stay doors (they open on
    // the person's own chair), the colleague's chip does not.
    expect([...barber.allDayShut(chairs, dates)]).toEqual(['niko']);
  });

  it('shuts nothing for someone who may block every chair', () => {
    const desk = gates({ timeOff: All, hours: None });
    expect([...desk.allDayShut(chairs, chairs)]).toEqual([]);
    expect([...desk.allDayShut(chairs, dates)]).toEqual([]);
  });

  it('shuts every column’s band too for someone who may block nobody', () => {
    const nobody = gates({ timeOff: None, hours: All });
    expect([...nobody.allDayShut(chairs, dates)].sort()).toEqual(
      ['2026-08-05', '2026-08-06', 'ivan', 'niko'].sort(),
    );
  });
});

describe('ScheduleAccess.aimed — the chair an act lands on', () => {
  it('keeps the chair wanted when it is allowed', () => {
    const desk = gates({ timeOff: All, hours: All });
    expect(desk.aimed(NIKO, chairs)).toBe(NIKO);
  });

  it('falls to the first allowed chair: a barber looking at the shop blocks their own time', () => {
    const barber = gates({ timeOff: Own, hours: Own });
    expect(barber.aimed(NIKO, barber.blockable(chairs))).toBe(IVAN);
    expect(barber.aimed(null, barber.blockable(chairs))).toBe(IVAN);
  });

  it('answers nobody when no chair is allowed', () => {
    const nobody = gates({ timeOff: None, hours: None });
    expect(nobody.aimed(IVAN, nobody.blockable(chairs))).toBeNull();
  });
});
