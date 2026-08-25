import { describe, expect, it } from 'vitest';
import type { Result } from '@creativo/domain/kernel';
import { BarberId, LocationId } from '@creativo/domain/catalog';
import {
  CalendarDay,
  LocalTimeRange,
  ScheduleException,
  ScheduleExceptionId,
  type ScheduleExceptionKind,
} from '@creativo/domain/scheduling';
import {
  exceptionFromDocument,
  exceptionToDocument,
} from './schedule-exception-document';

const ZONE = 'Europe/Sofia';

function value<T, E>(result: Result<T, E>): T {
  if (!result.isSuccess()) throw new Error('bad fixture');
  return result.value;
}

function exception(detail: ScheduleExceptionKind): ScheduleException {
  const day = value(CalendarDay.create('2026-08-05', ZONE));
  return value(
    ScheduleException.create({
      id: ScheduleExceptionId.of('ivan__2026-08-05'),
      day,
      barberId: value(BarberId.create('ivan')),
      locationId: value(LocationId.create('loc-center')),
      detail,
    }),
  );
}

function range(from: string, to: string): LocalTimeRange {
  return value(LocalTimeRange.create(from, to));
}

describe('exceptionToDocument — the GDPR boundary', () => {
  // The whole point of the sanitizer: four different reasons, ONE public
  // document. If any of these ever diverge, a sick day becomes derivable
  // from a collection `/book` reads anonymously.
  const unavailable: readonly ScheduleExceptionKind[] = [
    { kind: 'time_off' },
    { kind: 'sick', paid: true },
    { kind: 'training', topic: 'Fades masterclass' },
    { kind: 'travel', toLocationId: value(LocationId.create('loc-sea')) },
  ];

  it('renders every whole-day reason as the SAME closed effect', () => {
    const documents = unavailable.map((detail) =>
      exceptionToDocument(exception(detail)),
    );
    for (const document of documents) {
      expect(document['effect']).toEqual({ kind: 'closed' });
    }
    // Byte-for-byte identical, not merely same-shaped.
    const [first] = documents;
    for (const document of documents) {
      expect(JSON.stringify(document)).toBe(JSON.stringify(first));
    }
  });

  it('lets no reason vocabulary reach the document at all', () => {
    const serialized = JSON.stringify(
      unavailable.map((detail) => exceptionToDocument(exception(detail))),
    );
    for (const leak of [
      'sick',
      'paid',
      'training',
      'topic',
      'Fades',
      'travel',
      'loc-sea',
      'time_off',
    ]) {
      expect(serialized).not.toContain(leak);
    }
  });

  it('carves a partial block down to its ranges', () => {
    const document = exceptionToDocument(
      exception({
        kind: 'admin',
        ranges: [range('12:00', '13:00')],
        // A note is staff-only data and must not survive the trip.
        note: 'dentist appointment',
      }),
    );
    expect(document['effect']).toEqual({
      kind: 'blocked',
      ranges: [{ from: '12:00', to: '13:00' }],
    });
    expect(JSON.stringify(document)).not.toContain('dentist');
  });

  it('keeps a one-off shift as sellable hours', () => {
    const document = exceptionToDocument(
      exception({ kind: 'hours', ranges: [range('11:00', '16:00')] }),
    );
    expect(document['effect']).toEqual({
      kind: 'hours',
      ranges: [{ from: '11:00', to: '16:00' }],
    });
  });

  it('round-trips through the reader the availability engine uses', () => {
    const document = exceptionToDocument(
      exception({ kind: 'admin', ranges: [range('12:00', '13:00')], note: '' }),
    );
    const parsed = exceptionFromDocument(document);
    expect(parsed).not.toBeNull();
    // `blocked` reads back as the reason-free `admin` arm — the reader's own
    // documented mapping, and the proof the write is engine-legible.
    expect(parsed?.detail.kind).toBe('admin');
  });

  it('keys the document the way the rebuild trigger indexes it', () => {
    const document = exceptionToDocument(exception({ kind: 'time_off' }));
    expect(document['barberId']).toBe('ivan');
    expect(document['dayKey']).toBe('2026-08-05');
    expect(document['zone']).toBe(ZONE);
  });
});
