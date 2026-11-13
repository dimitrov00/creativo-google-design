import { describe, expect, it } from 'vitest';
import { BarberActivation } from './barber-activation.data';
import { StaffSetupItem } from './staff-setup-item.data';

// Pinned: the tags the Team page, the setup card and the go-live answer carry.
describe('StaffSetupItem / BarberActivation', () => {
  it('pins the setup items — the five bookings need, then the optional profile details', () => {
    expect(Object.values(StaffSetupItem)).toEqual([
      'NAME',
      'START_DAY',
      'SHOPS',
      'SERVICES',
      'HOURS',
      'PHOTO',
      'TITLE',
      'BIO',
      'INSTAGRAM',
      'EXPERIENCE',
    ]);
  });

  it('pins what the go-live step answers', () => {
    expect(BarberActivation).toEqual({
      Activated: 'ACTIVATED',
      NotReady: 'NOT_READY',
      Unchanged: 'UNCHANGED',
    });
  });
});
