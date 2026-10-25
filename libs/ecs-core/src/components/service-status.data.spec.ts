import { describe, expect, it } from 'vitest';
import { ServiceStatus } from './service-status.data';

// The tags are pinned: they are the stored strings composite indexes #1–#5
// filter by (the legacy shims mapped them to lowercase until the booking-core
// flip), so a renamed value would empty every public catalogue query read
// through them.
describe('ServiceStatus', () => {
  it('pins the service status tags', () => {
    expect(ServiceStatus).toEqual({ Active: 'ACTIVE', Archived: 'ARCHIVED' });
  });
});
