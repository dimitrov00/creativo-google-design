import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { AppointmentId, Result, UserId } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import type { AppointmentNote } from '@core/entities';
import { utcMs } from '@core/testing';
import { FakeFirestore } from '../testing/fake-firestore';

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);

const { appointmentNotePorts } = await import('./appointment-notes.adapter');

/*
 * `updateAppointmentNote` — the team note's append as ONE transaction
 * (edge hardening, D-6): read `appointmentNotes/{id}` on the server, hand it
 * to the caller's pure decision, `Set` the answer. The fake's
 * `runTransaction` is optimistic like the SDK's, so a write that lands
 * between the read and the commit re-runs read → decide, and a transaction
 * that cannot reach the store answers its failure with nothing written.
 */

const VISIT = AppointmentId.of('appointment-1');
const PATH = 'appointmentNotes/appointment-1';
const IVAN = UserId.of('dev-staff-ivan');
const BEFORE = utcMs('2026-08-05T08:00:00.000+03:00');
const NOW = utcMs('2026-08-05T12:00:00.000+03:00');

const asDb = (fake: FakeFirestore) => fake as unknown as Firestore;

/** The note the append writes: `line` below whatever `stored` said, Ivan's, now. */
function appending(line: string) {
  return (stored: AppointmentNote | null): AppointmentNote => ({
    id: VISIT,
    text: stored === null ? line : `${stored.text}\n${line}`,
    authorUserId: IVAN,
    writtenAtUtcMs: NOW,
  });
}

/** The stored body of a note: the entity minus its id. */
const body = (text: string, writtenAtUtcMs = BEFORE) => ({
  text,
  authorUserId: null,
  writtenAtUtcMs,
});

describe('appointmentNotePorts.updateAppointmentNote — read → decide → write, one transaction', () => {
  it('decides on no note when the visit has none, and sets the record minus its id', async () => {
    const fake = new FakeFirestore();
    const decide = vi.fn(appending('наводнение'));

    const answer = await appointmentNotePorts(asDb(fake)).updateAppointmentNote(
      VISIT,
      decide,
    );

    expect(decide).toHaveBeenCalledExactlyOnceWith(null);
    const note: AppointmentNote = {
      id: VISIT,
      text: 'наводнение',
      authorUserId: IVAN,
      writtenAtUtcMs: NOW,
    };
    expect(answer).toEqual(Result.ok(note));
    expect(fake.reads.map((read) => [read.kind, read.path])).toEqual([
      ['document', PATH],
    ]);
    expect(fake.writes).toEqual([
      {
        kind: 'set',
        path: PATH,
        data: { text: 'наводнение', authorUserId: IVAN, writtenAtUtcMs: NOW },
      },
    ]);
  });

  it('hands the decision the stored note as its entity — the body beside its id', async () => {
    const fake = new FakeFirestore({ [PATH]: body('алергия към ментол') });
    const decide = vi.fn(appending('наводнение'));

    const answer = await appointmentNotePorts(asDb(fake)).updateAppointmentNote(
      VISIT,
      decide,
    );

    expect(decide).toHaveBeenCalledExactlyOnceWith({
      id: VISIT,
      ...body('алергия към ментол'),
    });
    expect(answer.ok && answer.value?.text).toBe(
      'алергия към ментол\nнаводнение',
    );
    expect(fake.documentAt(PATH)).toEqual({
      text: 'алергия към ментол\nнаводнение',
      authorUserId: IVAN,
      writtenAtUtcMs: NOW,
    });
  });

  it('writes nothing when the decision answers null — and never deletes', async () => {
    const fake = new FakeFirestore({ [PATH]: body('алергия към ментол') });

    const answer = await appointmentNotePorts(asDb(fake)).updateAppointmentNote(
      VISIT,
      () => null,
    );

    expect(answer).toEqual(Result.ok(null));
    expect(fake.writes).toEqual([]);
    expect(fake.documentAt(PATH)).toEqual(body('алергия към ментол'));
  });

  it('keeps a concurrent edit: the write that landed mid-transaction re-runs the decision on it', async () => {
    const fake = new FakeFirestore({ [PATH]: body('алергия към ментол') });
    const seen: (string | null)[] = [];
    const append = appending('наводнение');
    let colleagueWrote = false;

    const answer = await appointmentNotePorts(asDb(fake)).updateAppointmentNote(
      VISIT,
      (stored) => {
        seen.push(stored?.text ?? null);
        if (!colleagueWrote) {
          // A colleague's save lands between this attempt's read and its
          // commit: the note's version moves under the transaction.
          colleagueWrote = true;
          fake.set(PATH, body('алергия към ментол\nколега: идва с дете', NOW));
        }
        return append(stored);
      },
    );

    expect(seen).toEqual([
      'алергия към ментол',
      'алергия към ментол\nколега: идва с дете',
    ]);
    const both = 'алергия към ментол\nколега: идва с дете\nнаводнение';
    expect(answer.ok && answer.value?.text).toBe(both);
    // Only the second attempt committed; the colleague's words survive.
    expect(fake.writes.map((write) => write.data)).toEqual([
      { text: both, authorUserId: IVAN, writtenAtUtcMs: NOW },
    ]);
    expect(fake.documentAt(PATH)).toEqual({
      text: both,
      authorUserId: IVAN,
      writtenAtUtcMs: NOW,
    });
  });

  it('refuses offline — REPOSITORY_WRITE_FAILED with the store’s code, nothing written over the server’s note', async () => {
    const fake = new FakeFirestore({ [PATH]: body('алергия към ментол') });
    fake.failWith({ code: 'unavailable' });
    const decide = vi.fn(appending('наводнение'));

    const answer = await appointmentNotePorts(asDb(fake)).updateAppointmentNote(
      VISIT,
      decide,
    );

    expect(answer).toEqual(
      Result.err(RepositoryError.writeFailed(PATH, 'unavailable')),
    );
    expect(decide).not.toHaveBeenCalled();
    expect(fake.writes).toEqual([]);
    expect(fake.documentAt(PATH)).toEqual(body('алергия към ментол'));
  });

  it('maps any rejection the same way — no code is special-cased', async () => {
    const fake = new FakeFirestore({ [PATH]: body('алергия към ментол') });
    fake.failWith({ code: 'deadline-exceeded' });

    const answer = await appointmentNotePorts(asDb(fake)).updateAppointmentNote(
      VISIT,
      appending('наводнение'),
    );

    expect(answer).toEqual(
      Result.err(RepositoryError.writeFailed(PATH, 'deadline-exceeded')),
    );
    expect(fake.writes).toEqual([]);
  });

  it('answers aborted once contention outlasts the store’s attempts — nothing written', async () => {
    const fake = new FakeFirestore({ [PATH]: body('алергия към ментол') });
    let attempts = 0;
    const append = appending('наводнение');

    const answer = await appointmentNotePorts(asDb(fake)).updateAppointmentNote(
      VISIT,
      (stored) => {
        attempts += 1;
        // Somebody writes the note under every attempt.
        fake.set(PATH, body(`правка ${attempts}`, NOW));
        return append(stored);
      },
    );

    expect(answer).toEqual(
      Result.err(RepositoryError.writeFailed(PATH, 'aborted')),
    );
    expect(attempts).toBe(5);
    expect(fake.writes).toEqual([]);
    expect(fake.documentAt(PATH)).toEqual(body('правка 5', NOW));
  });

  it('raises a decision naming another visit as a defect — nothing written', async () => {
    const fake = new FakeFirestore();

    await expect(
      appointmentNotePorts(asDb(fake)).updateAppointmentNote(
        VISIT,
        (stored) => ({
          ...appending('наводнение')(stored),
          id: AppointmentId.of('appointment-2'),
        }),
      ),
    ).rejects.toThrow(/defect: updateAppointmentNote/);
    expect(fake.writes).toEqual([]);
    expect(fake.documentAt(PATH)).toBeUndefined();
  });
});
