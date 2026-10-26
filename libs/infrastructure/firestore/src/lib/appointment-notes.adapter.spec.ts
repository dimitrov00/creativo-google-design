import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import { AppointmentId, Result, UserId } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import type { AppointmentNote } from '@core/entities';
import { recordingTelemetry, utcMs } from '@core/testing';
import { FakeFirestore } from '../testing/fake-firestore';
import { UNGUARDED } from '../testing/unguarded';

vi.mock('firebase/firestore', async () =>
  (await import('../testing/fake-firestore')).fakeFirestoreModule(),
);

const { appointmentNotePorts } = await import('./appointment-notes.adapter');
const { guardedReads } = await import('./observe');

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

    const answer = await appointmentNotePorts(
      asDb(fake),
      UNGUARDED,
    ).updateAppointmentNote(VISIT, decide);

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

    const answer = await appointmentNotePorts(
      asDb(fake),
      UNGUARDED,
    ).updateAppointmentNote(VISIT, decide);

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

    const answer = await appointmentNotePorts(
      asDb(fake),
      UNGUARDED,
    ).updateAppointmentNote(VISIT, () => null);

    expect(answer).toEqual(Result.ok(null));
    expect(fake.writes).toEqual([]);
    expect(fake.documentAt(PATH)).toEqual(body('алергия към ментол'));
  });

  it('keeps a concurrent edit: the write that landed mid-transaction re-runs the decision on it', async () => {
    const fake = new FakeFirestore({ [PATH]: body('алергия към ментол') });
    const seen: (string | null)[] = [];
    const append = appending('наводнение');
    let colleagueWrote = false;

    const answer = await appointmentNotePorts(
      asDb(fake),
      UNGUARDED,
    ).updateAppointmentNote(VISIT, (stored) => {
      seen.push(stored?.text ?? null);
      if (!colleagueWrote) {
        // A colleague's save lands between this attempt's read and its
        // commit: the note's version moves under the transaction.
        colleagueWrote = true;
        fake.set(PATH, body('алергия към ментол\nколега: идва с дете', NOW));
      }
      return append(stored);
    });

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

    const answer = await appointmentNotePorts(
      asDb(fake),
      UNGUARDED,
    ).updateAppointmentNote(VISIT, decide);

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

    const answer = await appointmentNotePorts(
      asDb(fake),
      UNGUARDED,
    ).updateAppointmentNote(VISIT, appending('наводнение'));

    expect(answer).toEqual(
      Result.err(RepositoryError.writeFailed(PATH, 'deadline-exceeded')),
    );
    expect(fake.writes).toEqual([]);
  });

  it('answers aborted once contention outlasts the store’s attempts — nothing written', async () => {
    const fake = new FakeFirestore({ [PATH]: body('алергия към ментол') });
    let attempts = 0;
    const append = appending('наводнение');

    const answer = await appointmentNotePorts(
      asDb(fake),
      UNGUARDED,
    ).updateAppointmentNote(VISIT, (stored) => {
      attempts += 1;
      // Somebody writes the note under every attempt.
      fake.set(PATH, body(`правка ${attempts}`, NOW));
      return append(stored);
    });

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
      appointmentNotePorts(asDb(fake), UNGUARDED).updateAppointmentNote(
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

/*
 * The read-time guard (pass E, E-2 / DEP-2): built with `guardedReads`, as
 * the composition root builds it, a stored note that is not its entity is
 * refused — live as an emitted value (the listener stays), in the append's
 * transaction BEFORE the decision (nothing decided, nothing written). The
 * mechanics cases above pass the test support's `UNGUARDED` explicitly —
 * the guard has no default since OR-33 — and keep today's behaviour.
 */
describe('appointmentNotePorts, guarded — a malformed note is refused (pass E, E-2)', () => {
  /** Every answer a stream gave, in order. */
  function recorded<T>(stream: {
    subscribe: (next: (value: T) => void) => { unsubscribe(): void };
  }) {
    const seen: T[] = [];
    const subscription = stream.subscribe((value) => seen.push(value));
    return { seen, stop: () => subscription.unsubscribe() };
  }

  /**
   * The guarded bundle over `fake`, and the lines its refusals were
   * reported as. `onFirstReport` runs once, inside the attempt that first
   * reports a refusal — after that attempt's read, before its commit: a
   * write landing there moves the note under the transaction, so the
   * store re-runs it.
   */
  function guarded(
    fake: FakeFirestore,
    onFirstReport: () => void = () => undefined,
  ) {
    const telemetry = recordingTelemetry();
    let first = true;
    return {
      ports: appointmentNotePorts(
        asDb(fake),
        guardedReads({
          log: (level, msg, fields) => {
            telemetry.log(level, msg, fields);
            if (first) {
              first = false;
              onFirstReport();
            }
          },
        }),
      ),
      lines: telemetry.lines,
    };
  }

  /** The one report line of a refused note. */
  const refusedLine = (field: string) => ({
    level: 'error',
    msg: 'malformed document refused',
    fields: { path: PATH, field },
  });

  it('observe emits a malformed note’s refusal, keeps listening, and emits the note once it is fixed — reported once', () => {
    const fake = new FakeFirestore({
      [PATH]: { ...body('алергия към ментол'), text: '   ' },
    });
    const { ports, lines } = guarded(fake);
    const live = recorded(ports.observeAppointmentNote(VISIT));

    fake.set(PATH, { ...body('алергия към ментол'), text: '' });
    fake.set(PATH, body('алергия към ментол'));

    expect(live.seen).toEqual([
      Result.err(RepositoryError.malformed(PATH, 'text')),
      Result.err(RepositoryError.malformed(PATH, 'text')),
      Result.ok({ id: VISIT, ...body('алергия към ментол') }),
    ]);
    expect(lines).toEqual([refusedLine('text')]);
    expect(fake.listening).toBe(1);
    live.stop();
  });

  it('observe answers a well-formed note, and no note, exactly as before — nothing reported', () => {
    const fake = new FakeFirestore({ [PATH]: body('алергия към ментол') });
    const { ports, lines } = guarded(fake);
    const live = recorded(ports.observeAppointmentNote(VISIT));

    fake.delete(PATH);

    expect(live.seen).toEqual([
      Result.ok({ id: VISIT, ...body('алергия към ментол') }),
      Result.ok(null),
    ]);
    expect(lines).toEqual([]);
    live.stop();
  });

  it.each([
    ['text', 3],
    ['text', ' \n '],
    ['authorUserId', ''],
    ['writtenAtUtcMs', 'вчера'],
  ] as const)(
    'update refuses a stored note whose %s = %j — REPOSITORY_MALFORMED, no decision, nothing written, reported once',
    async (field, value) => {
      const stored = { ...body('алергия към ментол'), [field]: value };
      const fake = new FakeFirestore({ [PATH]: stored });
      const { ports, lines } = guarded(fake);
      const decide = vi.fn(appending('наводнение'));

      const answer = await ports.updateAppointmentNote(VISIT, decide);

      expect(answer).toEqual(
        Result.err(RepositoryError.malformed(PATH, field)),
      );
      expect(decide).not.toHaveBeenCalled();
      expect(fake.writes).toEqual([]);
      expect(fake.documentAt(PATH)).toEqual(stored);
      expect(lines).toEqual([refusedLine(field)]);
    },
  );

  it('update reports a refusal once however often the transaction re-runs on it', async () => {
    const fake = new FakeFirestore({
      [PATH]: { ...body('алергия към ментол'), text: '' },
    });
    // A hand edit lands mid-attempt — still no text: the store re-runs.
    const { ports, lines } = guarded(fake, () =>
      fake.set(PATH, { ...body('алергия към ментол', NOW), text: ' ' }),
    );
    const decide = vi.fn(appending('наводнение'));

    const answer = await ports.updateAppointmentNote(VISIT, decide);

    expect(fake.reads.map((read) => read.path)).toEqual([PATH, PATH]);
    expect(answer).toEqual(Result.err(RepositoryError.malformed(PATH, 'text')));
    expect(decide).not.toHaveBeenCalled();
    expect(fake.writes).toEqual([]);
    expect(lines).toEqual([refusedLine('text')]);
  });

  it('update decides on the note a re-run reads — a refusal is the ATTEMPT’s, not the call’s', async () => {
    const fake = new FakeFirestore({
      [PATH]: { ...body('алергия към ментол'), authorUserId: 7 },
    });
    // A colleague's save repairs the note mid-attempt: the re-run reads it.
    const { ports, lines } = guarded(fake, () =>
      fake.set(PATH, body('алергия към ментол', NOW)),
    );
    const decide = vi.fn(appending('наводнение'));

    const answer = await ports.updateAppointmentNote(VISIT, decide);

    expect(decide).toHaveBeenCalledExactlyOnceWith({
      id: VISIT,
      ...body('алергия към ментол', NOW),
    });
    expect(answer.ok && answer.value?.text).toBe(
      'алергия към ментол\nнаводнение',
    );
    expect(fake.writes.map((write) => write.data)).toEqual([
      {
        text: 'алергия към ментол\nнаводнение',
        authorUserId: IVAN,
        writtenAtUtcMs: NOW,
      },
    ]);
    // The first attempt did meet a malformed note: it was reported.
    expect(lines).toEqual([refusedLine('authorUserId')]);
  });

  it('update appends to a well-formed note, and decides on no note, exactly as unguarded — nothing reported', async () => {
    const fake = new FakeFirestore({ [PATH]: body('алергия към ментол') });
    const { ports, lines } = guarded(fake);
    const decide = vi.fn(appending('наводнение'));

    const answer = await ports.updateAppointmentNote(VISIT, decide);

    expect(decide).toHaveBeenCalledExactlyOnceWith({
      id: VISIT,
      ...body('алергия към ментол'),
    });
    expect(answer.ok && answer.value?.text).toBe(
      'алергия към ментол\nнаводнение',
    );

    const empty = new FakeFirestore();
    const fresh = guarded(empty);
    const first = vi.fn(appending('наводнение'));
    expect((await fresh.ports.updateAppointmentNote(VISIT, first)).ok).toBe(
      true,
    );
    expect(first).toHaveBeenCalledExactlyOnceWith(null);
    expect(lines).toEqual([]);
    expect(fresh.lines).toEqual([]);
  });

  it('UNGUARDED — the test support’s, passed explicitly (OR-33) — keeps today’s behaviour: a malformed note is read and decided on as stored', async () => {
    const stored = { ...body('алергия към ментол'), text: 3 };
    const fake = new FakeFirestore({ [PATH]: stored });
    const ports = appointmentNotePorts(asDb(fake), UNGUARDED);
    const live = recorded(ports.observeAppointmentNote(VISIT));
    const decide = vi.fn(() => null);

    const answer = await ports.updateAppointmentNote(VISIT, decide);

    expect(live.seen).toEqual([Result.ok({ id: VISIT, ...stored })]);
    expect(decide).toHaveBeenCalledExactlyOnceWith({ id: VISIT, ...stored });
    expect(answer).toEqual(Result.ok(null));
    expect(fake.writes).toEqual([]);
    live.stop();
  });
});
