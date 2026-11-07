import { describe, expect, it } from 'vitest';
import { ServiceId, ServiceVariantId } from '@core/primitives';
import {
  optionKeyOf,
  pickDiffOf,
  picksOf,
  withoutPicks,
} from './service-picks';

const CUT = ServiceId.of('cut');
const FADE = ServiceId.of('fade');
const SHORT = ServiceVariantId.of('short');
const leg = (
  id: string,
  serviceId: ServiceId,
  clientId: string,
  variantId: ServiceVariantId | null = null,
) => ({ id, serviceId, variantId, clientId });

describe('the service page’s picks', () => {
  const legs = [
    leg('a', CUT, 'martin', SHORT),
    leg('b', FADE, 'petar'),
    leg('c', CUT, 'martin', SHORT),
  ];

  it('keys a seat by its catalogue option', () => {
    expect(optionKeyOf(legs[0] as (typeof legs)[number])).toBe('cut:short');
    expect(optionKeyOf(legs[1] as (typeof legs)[number])).toBe('fade');
  });

  it('opens a person’s page on their own seats, counted', () => {
    expect([...picksOf(legs, 'martin')]).toEqual([['cut:short', 2]]);
    expect([...picksOf(legs, 'nobody')]).toEqual([]);
  });

  it('reads ticks against the seats as what to add and what to take off', () => {
    const diff = pickDiffOf(
      new Map([['cut:short', 2]]),
      new Map([
        ['cut:short', 1],
        ['fade', 1],
      ]),
    );
    expect([...diff.add]).toEqual([['fade', 1]]);
    expect([...diff.remove]).toEqual([['cut:short', 1]]);
    expect([diff.added, diff.removed]).toEqual([1, 1]);
  });

  it('takes seats off one person only, the newest first', () => {
    const left = withoutPicks(legs, 'martin', new Map([['cut:short', 1]]));
    expect(left.map((l) => l.id)).toEqual(['a', 'b']);
  });
});
