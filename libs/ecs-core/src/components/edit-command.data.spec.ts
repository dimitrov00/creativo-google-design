import { describe, expect, it } from 'vitest';
import { EditCommand, ResizeEdge } from './edit-command.data';

/*
 * The staff edit's dictionaries, moved from `appointment-edit.system.ts`
 * (Law 8, Phase 4a 4A-6): values unchanged.
 */
describe('EditCommand and ResizeEdge', () => {
  it('keep the staff edit commands verbatim', () => {
    expect(Object.values(EditCommand)).toEqual([
      'MOVE',
      'RESIZE',
      'REPRICE',
      'REDURATE',
      'RESTAFF',
      'ADD_SEAT',
      'REMOVE_SEAT',
      'RELOCATE',
      'DISCOUNTS',
      'VOUCHERS',
    ]);
  });

  it('keep the two resize handles verbatim', () => {
    expect(ResizeEdge).toEqual({ Start: 'START', End: 'END' });
  });
});
