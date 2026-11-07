import { describe, expect, it } from 'vitest';
import { BarberId, BusyKey, LocalDate } from '@core/primitives';
import { appointmentFixture } from './appointment.fixtures';
import { memoryAnalyticsReadPorts } from './analytics-doubles';
import { localDate, unwrapOk } from './test-support';

describe('memoryAnalyticsReadPorts — answers as the Firestore adapter does', () => {
  it('splits keys into queries of 30 and concatenates their rows, a visit of two chunks twice', async () => {
    const ivan = BarberId.of('ivan');
    const niko = BarberId.of('niko');
    const day = localDate('2026-09-15');
    const party = appointmentFixture({
      localDate: day,
      busyKeys: [BusyKey.of(ivan, day), BusyKey.of(niko, day)],
    });
    const { ports, log } = memoryAnalyticsReadPorts({ visits: [party] });
    const days = LocalDate.range(
      localDate('2026-09-01'),
      localDate('2026-09-30'),
    );
    const keys = [
      ...days.map((d) => BusyKey.of(ivan, d)),
      ...days.map((d) => BusyKey.of(niko, d)),
    ];
    const rows = unwrapOk(await ports.loadVisitsByBusyKeys(keys));
    expect(log.visitQueries.map((chunk) => chunk.length)).toEqual([30, 30]);
    expect(rows).toEqual([party, party]);
  });
});
