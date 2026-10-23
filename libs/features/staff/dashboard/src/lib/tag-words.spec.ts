import { describe, expect, it } from 'vitest';
import { ClientQueryShape, GridEvent } from '@core/systems';
import { clientQueryShapeWords, gridEventWords } from './tag-words';

/*
 * ONE table per tag family read by the staff day (UI residue cleanup §2.2):
 * total over its ecs-core dictionary, and the very words the DOM prints
 * today — the grid's `data-kind` (visit/gap/block) and the omnibox's kind
 * (empty/name/phone/email).
 */
describe('gridEventWords', () => {
  it('words every GridEvent as today’s data-kind value', () => {
    expect(gridEventWords).toEqual({
      VISIT: 'visit',
      GAP: 'gap',
      BLOCK: 'block',
    });
    expect(Object.keys(gridEventWords).sort()).toEqual(
      Object.values(GridEvent).sort(),
    );
  });
});

describe('clientQueryShapeWords', () => {
  it('words every ClientQueryShape as today’s icon kind and test-id suffix', () => {
    expect(clientQueryShapeWords).toEqual({
      EMPTY: 'empty',
      NAME: 'name',
      PHONE: 'phone',
      EMAIL: 'email',
    });
    expect(Object.keys(clientQueryShapeWords).sort()).toEqual(
      Object.values(ClientQueryShape).sort(),
    );
  });
});
