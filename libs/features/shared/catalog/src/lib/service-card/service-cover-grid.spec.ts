import { describe, expect, it } from 'vitest';
import { ServiceId } from '@core/primitives';
import { coverRowsOf } from './service-cover-grid';

const tile = (service: string, variant: boolean) => ({
  serviceId: ServiceId.of(service),
  variant,
});

describe('coverRowsOf — service tiles as grids', () => {
  it('flows plain services together, gives a service with variants its own grid, and starts again after it', () => {
    const rows = coverRowsOf(
      [
        tile('fade', false),
        tile('beard', false),
        tile('cut', true),
        tile('cut', true),
        tile('wash', false),
      ],
      (t) => t.serviceId,
      (t) => t.variant,
    );
    expect(rows.map((row) => [row.id, row.tiles.length])).toEqual([
      ['PLAIN:0', 2],
      ['cut', 2],
      ['PLAIN:2', 1],
    ]);
  });
});
