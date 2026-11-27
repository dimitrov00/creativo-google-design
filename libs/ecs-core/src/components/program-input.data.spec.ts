import { describe, expect, it } from 'vitest';
import { EnrollmentStatus } from './enrollment-status.data';
import { ProgramInput } from './program-input.data';
import { PositionStatus } from './program-status.data';

describe('ProgramInput — the admin form’s reset values (today’s)', () => {
  it('opens an empty role: open, no location, no contact, sort 0', () => {
    expect(ProgramInput.blankPosition()).toEqual({
      title: { bg: '', en: '' },
      summary: { bg: '', en: '' },
      workplaceMode: 'ON_SITE',
      locationIds: [],
      positionStatus: PositionStatus.Open,
      contacts: [],
      sortOrder: 0,
    });
  });

  it('opens an empty course: open, both starts-label locales blank, sort 0', () => {
    expect(ProgramInput.blankCourse()).toEqual({
      title: { bg: '', en: '' },
      description: { bg: '', en: '' },
      enrollmentStatus: EnrollmentStatus.Open,
      startsLabel: { bg: '', en: '' },
      contacts: [],
      sortOrder: 0,
    });
  });

  it('opens an empty event: no start, no location, no contact, sort 0', () => {
    expect(ProgramInput.blankShopEvent()).toEqual({
      title: { bg: '', en: '' },
      description: { bg: '', en: '' },
      startsAt: '',
      locationId: '',
      contacts: [],
      sortOrder: 0,
    });
  });

  it('answers a fresh struct per call — a form edit never leaks into the next reset', () => {
    const first = ProgramInput.blankCourse();
    const second = ProgramInput.blankCourse();
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second.title).not.toBe(first.title);
    expect(second.startsLabel).not.toBe(first.startsLabel);
  });
});
