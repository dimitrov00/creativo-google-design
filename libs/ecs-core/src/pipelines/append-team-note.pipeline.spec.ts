import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import {
  AppointmentId,
  Result,
  UserId,
  type UtcEpochMs,
} from '@core/primitives';
import { RepositoryError } from '@core/errors';
import type { AppointmentNote } from '@core/entities';
import type { AppointmentNotePorts, UpdateAppointmentNote } from '@core/ports';
import { VisitSidesSystem } from '@core/systems';
import { deepFreeze, memoryClockPorts, utcMs } from '@core/testing';
import {
  appendTeamNote,
  type AppendTeamNoteCommand,
  saveTeamNote,
  type SaveTeamNoteCommand,
} from './append-team-note.pipeline';

/*
 * The `appendTeamNote` cases of libs/features/staff/dashboard/src/lib/
 * staff-dashboard/staff-dashboard.spec.ts (the «Друго…» block — the words
 * filed as the visit's note with the session's author, appended below a
 * note already there, blank words file nothing, a note that did not save is
 * the failure), restated on the pipeline moved out of `staff-day.store.ts`
 * (Law 8.4) — the store keeps the session; the read → decide → write is
 * here, and since edge hardening it is ONE transaction
 * (`updateAppointmentNote`, Law 4: the transaction IS the sandwich). The
 * double below runs the pipeline's decision the way the adapter's
 * `runTransaction` does — over the note as stored, more than once when a
 * concurrent writer moved it.
 */

const VISIT = AppointmentId.of('appointment-1');
const IVAN = UserId.of('dev-staff-ivan');
const NOW = utcMs('2026-08-05T12:00:00.000+03:00');
const WRITTEN_BEFORE = utcMs('2026-08-05T08:00:00.000+03:00');

type Timeline = string[];

/** A note as the notes collection would hold it, written before the append. */
function heldNote(text: string): AppointmentNote {
  return {
    id: VISIT,
    text,
    authorUserId: null,
    writtenAtUtcMs: WRITTEN_BEFORE,
  };
}

/**
 * The note bundle over one stored note, recording every call in order:
 * `observe` (the live read the append must never use), `read` and `write`
 * (the transaction's halves) and `write` for a straight-through save.
 */
function noteWorld(
  stored: string | null,
  options: {
    readonly update?: UpdateAppointmentNote;
    readonly save?: Result<void, RepositoryError>;
  } = {},
) {
  const timeline: Timeline = [];
  const saved: (AppointmentNote | null)[] = [];
  let current: AppointmentNote | null =
    stored === null ? null : heldNote(stored);
  const ports: AppointmentNotePorts = {
    observeAppointmentNote: () => {
      timeline.push('observe');
      return of(Result.ok(current));
    },
    saveAppointmentNote: async (_appointmentId, note) => {
      timeline.push('write');
      saved.push(note);
      return options.save ?? Result.ok(undefined);
    },
    updateAppointmentNote:
      options.update ??
      (async (_appointmentId, decide) => {
        timeline.push('read');
        const next = decide(current);
        if (next === null) return Result.ok(null);
        timeline.push('write');
        saved.push(next);
        current = next;
        return Result.ok(next);
      }),
  };
  return { ports, timeline, saved };
}

function clockReading(timeline: Timeline, at: UtcEpochMs = NOW) {
  const clock = memoryClockPorts(at);
  return {
    nowUtcMs: () => {
      timeline.push('clock');
      return clock.nowUtcMs();
    },
  };
}

const command = (line: string): AppendTeamNoteCommand => ({
  appointmentId: VISIT,
  line,
  authorUserId: IVAN,
});

/** The decision the pipeline handed the transaction, caught for a case to run by hand. */
function caughtDecision() {
  const decisions: Parameters<UpdateAppointmentNote>[1][] = [];
  const update: UpdateAppointmentNote = async (_appointmentId, decide) => {
    decisions.push(decide);
    return Result.ok(null);
  };
  return { decisions, update };
}

describe('appendTeamNote — a line below the visit’s note, in one transaction', () => {
  it('files the words as the visit’s note, trimmed, stamped with the author and the clock', async () => {
    const world = noteWorld(null);
    const append = appendTeamNote({
      ...world.ports,
      ...clockReading(world.timeline),
    });

    const result = await append(command('  наводнение в салона '));

    const note: AppointmentNote = {
      id: VISIT,
      text: 'наводнение в салона',
      authorUserId: IVAN,
      writtenAtUtcMs: NOW,
    };
    expect(result).toEqual(Result.ok(note));
    expect(world.saved).toEqual([note]);
    // The clock once, before the transaction; the transaction reads, then
    // writes — and the live stream is never asked.
    expect(world.timeline).toEqual(['clock', 'read', 'write']);
  });

  it('appends below a note the visit already has, never over it', async () => {
    const world = noteWorld('алергия към ментол');
    const append = appendTeamNote({
      ...world.ports,
      ...clockReading(world.timeline),
    });

    const result = await append(command('наводнение'));

    expect(world.saved.map((note) => note?.text)).toEqual([
      'алергия към ментол\nнаводнение',
    ]);
    expect(result.ok && result.value?.text).toBe(
      'алергия към ментол\nнаводнение',
    );
  });

  it('reads nothing and writes nothing for words that say nothing — no decision, no clock', async () => {
    const caught = caughtDecision();
    const world = noteWorld('алергия към ментол', { update: caught.update });
    const append = appendTeamNote({
      ...world.ports,
      ...clockReading(world.timeline),
    });

    expect(await append(command('   '))).toEqual(Result.ok(null));
    expect(await append(command(''))).toEqual(Result.ok(null));
    expect(caught.decisions).toEqual([]);
    expect(world.timeline).toEqual([]);
    expect(world.saved).toEqual([]);
  });

  it('keeps a concurrent edit: a re-run decides on the fresher note, and its words stay above the line', async () => {
    const before = heldNote('алергия към ментол');
    const concurrent = heldNote('алергия към ментол\nколега: идва с дете');
    const decided: (AppointmentNote | null)[] = [];
    const world = noteWorld(null, {
      // The transaction's first pass read `before`; a colleague's write
      // moved the note, so the store re-ran read → decide on `concurrent`
      // and committed only the second answer.
      update: async (_appointmentId, decide) => {
        decided.push(decide(before));
        const next = decide(concurrent);
        decided.push(next);
        return Result.ok(next);
      },
    });
    const append = appendTeamNote({
      ...world.ports,
      ...clockReading(world.timeline),
    });

    const result = await append(command('наводнение'));

    const written = VisitSidesSystem.appendedNote(
      concurrent.text,
      'наводнение',
    );
    expect(written).toBe('алергия към ментол\nколега: идва с дете\nнаводнение');
    expect(result.ok && result.value?.text).toBe(written);
    expect(result.ok && result.value?.text).not.toBe(
      VisitSidesSystem.appendedNote(before.text, 'наводнение'),
    );
    // One stamp for every pass: the clock was read once, before them all.
    expect(decided.map((note) => note?.writtenAtUtcMs)).toEqual([NOW, NOW]);
    expect(world.timeline).toEqual(['clock']);
  });

  it('refuses offline — the transaction’s failure is the answer, nothing decided, nothing written', async () => {
    const offline = RepositoryError.writeFailed(
      'appointmentNotes/appointment-1',
      'unavailable',
    );
    // The transaction could not reach the server: it answers its failure
    // and never runs the decision.
    const world = noteWorld('алергия към ментол', {
      update: async () => Result.err(offline),
    });
    const append = appendTeamNote({
      ...world.ports,
      ...clockReading(world.timeline),
    });

    expect(await append(command('наводнение'))).toEqual(Result.err(offline));
    expect(world.saved).toEqual([]);
    // No fallback read, no straight-through write over the server's copy.
    expect(world.timeline).toEqual(['clock']);
  });

  it('decides purely — the same stored note gives the same record, and the stored note is untouched', async () => {
    const caught = caughtDecision();
    const world = noteWorld(null, { update: caught.update });
    await appendTeamNote({
      ...world.ports,
      ...clockReading(world.timeline),
    })(command('наводнение'));
    const decide = caught.decisions[0];
    expect(decide).toBeDefined();
    if (decide === undefined) return;

    const stored = deepFreeze(heldNote('алергия към ментол'));
    const first = decide(stored);
    const second = decide(stored);

    expect(first).toEqual(second);
    expect(first).toEqual({
      id: VISIT,
      text: 'алергия към ментол\nнаводнение',
      authorUserId: IVAN,
      writtenAtUtcMs: NOW,
    });
    expect(stored).toEqual(heldNote('алергия към ментол'));
    expect(decide(null)).toEqual(decide(null));
    // Deciding reads no clock: the one reading came before the transaction.
    expect(world.timeline).toEqual(['clock']);
  });

  it('reads the clock once per append, before the transaction', async () => {
    const world = noteWorld(null);
    const append = appendTeamNote({
      ...world.ports,
      ...clockReading(world.timeline),
    });

    await append(command('първо'));
    await append(command('второ'));

    expect(world.timeline).toEqual([
      'clock',
      'read',
      'write',
      'clock',
      'read',
      'write',
    ]);
    expect(world.saved.map((note) => note?.text)).toEqual([
      'първо',
      'първо\nвторо',
    ]);
  });

  it('names no author before the session is an onboarded one', async () => {
    const world = noteWorld(null);
    const append = appendTeamNote({
      ...world.ports,
      ...clockReading(world.timeline),
    });

    await append({ ...command('наводнение'), authorUserId: null });

    expect(world.saved[0]?.authorUserId).toBeNull();
  });

  it('reads the ports at call time — a bundle re-wired after the factory ran is the one used', async () => {
    const first = noteWorld(null);
    const ports = { ...first.ports, ...clockReading(first.timeline) };
    const append = appendTeamNote(ports);
    const second = noteWorld('по-късна бележка');
    Object.assign(ports, {
      updateAppointmentNote: second.ports.updateAppointmentNote,
    });

    await append(command('наводнение'));

    expect(first.saved).toEqual([]);
    expect(second.saved.map((note) => note?.text)).toEqual([
      'по-късна бележка\nнаводнение',
    ]);
  });

  it('writes the one record — the key order saveTeamNote writes too', async () => {
    const appended = noteWorld(null);
    await appendTeamNote({
      ...appended.ports,
      ...clockReading(appended.timeline),
    })(command('наводнение'));
    const savedStraight = noteWorld(null);
    await saveTeamNote({
      ...savedStraight.ports,
      ...clockReading(savedStraight.timeline),
    })({ appointmentId: VISIT, text: 'наводнение', authorUserId: IVAN });

    const keys = ['id', 'text', 'authorUserId', 'writtenAtUtcMs'];
    expect(Object.keys(appended.saved[0] ?? {})).toEqual(keys);
    expect(Object.keys(savedStraight.saved[0] ?? {})).toEqual(keys);
    expect(appended.saved).toEqual(savedStraight.saved);
  });
});

/*
 * `saveTeamNote` — the note the visit sheet's «Запази» writes straight
 * through, moved from `staff-day.store.ts` `saveTeamNote` (pass D, D-10.2):
 * the record is the one `appendTeamNote` writes (`{ id, text, authorUserId,
 * writtenAtUtcMs }`, key order unchanged), built by the one shared builder.
 */
const saved = (text: string | null): SaveTeamNoteCommand => ({
  appointmentId: VISIT,
  text,
  authorUserId: IVAN,
});

describe('saveTeamNote — the visit’s note, written straight through', () => {
  it('writes the note in its stored form, stamped with the author and the clock — no read', async () => {
    const world = noteWorld('алергия към ментол');
    const save = saveTeamNote({
      ...world.ports,
      ...clockReading(world.timeline),
    });

    const result = await save(saved('  къса отстрани  '));

    const note: AppointmentNote = {
      id: VISIT,
      text: 'къса отстрани',
      authorUserId: IVAN,
      writtenAtUtcMs: NOW,
    };
    expect(result).toEqual(Result.ok(note));
    expect(world.saved).toEqual([note]);
    // Written over, never appended: nothing is read; the clock, then the write.
    expect(world.timeline).toEqual(['clock', 'write']);
  });

  it('keeps the record’s key order — the one builder appendTeamNote writes through', async () => {
    const world = noteWorld(null);
    const save = saveTeamNote({
      ...world.ports,
      ...clockReading(world.timeline),
    });

    await save(saved('къса отстрани'));

    expect(Object.keys(world.saved[0] ?? {})).toEqual([
      'id',
      'text',
      'authorUserId',
      'writtenAtUtcMs',
    ]);
  });

  it('deletes the stored note for a blank or absent text — the port is handed null, the clock never read', async () => {
    const world = noteWorld('алергия към ментол');
    const save = saveTeamNote({
      ...world.ports,
      ...clockReading(world.timeline),
    });

    expect(await save(saved('   '))).toEqual(Result.ok(null));
    expect(await save(saved(null))).toEqual(Result.ok(null));
    expect(world.saved).toEqual([null, null]);
    expect(world.timeline).toEqual(['write', 'write']);
  });

  it('answers the write’s failure when the note did not save', async () => {
    const failure = RepositoryError.writeFailed(
      'appointmentNotes/appointment-1',
      null,
    );
    const world = noteWorld(null, { save: Result.err(failure) });
    const save = saveTeamNote({
      ...world.ports,
      ...clockReading(world.timeline),
    });

    expect(await save(saved('къса отстрани'))).toEqual(Result.err(failure));
    expect(await save(saved(null))).toEqual(Result.err(failure));
  });

  it('names no author before the session is an onboarded one', async () => {
    const world = noteWorld(null);
    const save = saveTeamNote({
      ...world.ports,
      ...clockReading(world.timeline),
    });

    await save({ ...saved('къса отстрани'), authorUserId: null });

    expect(world.saved[0]?.authorUserId).toBeNull();
  });
});
