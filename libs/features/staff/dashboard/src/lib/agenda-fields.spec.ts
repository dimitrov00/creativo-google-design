import { describe, expect, it } from 'vitest';
import { AGENDA_FIELDS, AgendaField } from './agenda-fields';

/*
 * The agenda card's fields are a CONTRACT-SPELLED dictionary (pass D, G-10):
 * the values are the keys of the `staff-agenda-fields` JSON every device has
 * stored, the `staff.day.field.<id>` i18n segments and the `staff-field-<id>`
 * test ids — so they keep their spelling, and the picker keeps its order.
 */
describe('AgendaField', () => {
  it('keeps the stored spellings, in the picker’s order', () => {
    expect(AGENDA_FIELDS).toEqual([
      'avatar',
      'barberAvatar',
      'email',
      'phone',
      'service',
      'note',
      'timeStart',
      'timeEnd',
      'timeRelative',
      'price',
      'party',
      'freeTime',
    ]);
  });

  it('lists every field once — the dictionary is the list', () => {
    expect(new Set(AGENDA_FIELDS).size).toBe(AGENDA_FIELDS.length);
    expect([...AGENDA_FIELDS].sort()).toEqual(
      Object.values(AgendaField).sort(),
    );
  });
});
