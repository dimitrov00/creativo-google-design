import { describe, expect, it } from 'vitest';
import { buildVisitIcs } from './visit-ics';

const EVENT = {
  uid: 'appt_1',
  title: 'Фейд',
  startMs: Date.UTC(2026, 7, 21, 11, 30),
  endMs: Date.UTC(2026, 7, 21, 12, 0),
  location: 'бул. „Цар Симеон Велики“ 120, Стара Загора',
  description: 'с Иван Колев',
} as const;

const STAMP = Date.UTC(2026, 7, 5, 9, 0);

describe('buildVisitIcs', () => {
  it('writes a single event a calendar can read', () => {
    const ics = buildVisitIcs(EVENT, STAMP);

    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('UID:appt_1');
    expect(ics).toContain('DTSTART:20260821T113000Z');
    expect(ics).toContain('DTEND:20260821T120000Z');
    expect(ics).toContain('DTSTAMP:20260805T090000Z');
  });

  it('carries a reminder — a calendar entry nobody is told about is a note', () => {
    const ics = buildVisitIcs(EVENT, STAMP);
    expect(ics).toContain('BEGIN:VALARM');
    expect(ics).toContain('TRIGGER:-PT2H');
  });

  it('escapes the characters iCalendar reads as structure', () => {
    const ics = buildVisitIcs(
      {
        ...EVENT,
        title: 'Фейд; брада, и',
        description: 'ред\nвтори ред \\ край',
      },
      STAMP,
    );

    expect(ics).toContain('SUMMARY:Фейд\\; брада\\, и');
    expect(ics).toContain('DESCRIPTION:ред\\nвтори ред \\\\ край');
  });

  it('folds a long line, so an import does not silently break', () => {
    const ics = buildVisitIcs({ ...EVENT, location: 'x'.repeat(200) }, STAMP);

    const overlong = ics.split('\r\n').filter((line) => line.length > 75);
    expect(overlong).toEqual([]);
    // Continuations begin with a single space — that is what makes them
    // continuations rather than unknown properties.
    expect(ics).toContain('\r\n x');
  });

  it('is stable for one appointment — re-adding UPDATES, never duplicates', () => {
    expect(buildVisitIcs(EVENT, STAMP)).toContain('UID:appt_1');
    expect(buildVisitIcs(EVENT, STAMP + 5_000)).toContain('UID:appt_1');
  });
});
