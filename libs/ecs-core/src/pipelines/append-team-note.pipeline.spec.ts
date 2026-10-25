import { EMPTY, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import {
  AppointmentId,
  Result,
  UserId,
  type UtcEpochMs,
} from '@core/primitives';
import { RepositoryError } from '@core/errors';
import type { AppointmentNote } from '@core/entities';
import type { AppointmentNotePorts, ObserveAppointmentNote } from '@core/ports';
import { memoryClockPorts, utcMs } from '@core/testing';
import {
  appendTeamNote,
  type AppendTeamNoteCommand,
  saveTeamNote,
  type SaveTeamNoteCommand,
} from './append-team-note.pipeline';

/*
 * The `appendTeamNote` cases of libs/features/staff/dashboard/src/lib/
 * staff-dashboard/staff-dashboard.spec.ts (the «Друго…» block — :2550 the
 * words filed as the visit's note with the session's author, :2567 appended
 * below a note already there, :2576 blank words file nothing, :2614 a note
 * write that failed is the failure; :5326, :5339, :5409), restated on the
 * pipeline moved out of `staff-day.store.ts` (Law 8.4) — the store keeps
 * the noteError signal and the session; the read → decide → write is here.
 */

const VISIT = AppointmentId.of('appointment-1');
const IVAN = UserId.of('dev-staff-ivan');
const NOW = utcMs('2026-08-05T12:00:00.000+03:00');
const WRITTEN_BEFORE = utcMs('2026-08-05T08:00:00.000+03:00');

type Timeline = string[];

/** The note bundle over one stored note, recording every call in order. */
function noteWorld(
  stored: string | null,
  options: {
    readonly read?: ObserveAppointmentNote;
    readonly save?: Result<void, RepositoryError>;
  } = {},
) {
  const timeline: Timeline = [];
  const saved: (AppointmentNote | null)[] = [];
  const ports: AppointmentNotePorts = {
    observeAppointmentNote:
      options.read ??
      ((appointmentId) => {
        timeline.push('read');
        return of(
          Result.ok<AppointmentNote | null>(
            stored === null
              ? null
              : {
                  id: appointmentId,
                  text: stored,
                  authorUserId: null,
                  writtenAtUtcMs: WRITTEN_BEFORE,
                },
          ),
        );
      }),
    saveAppointmentNote: async (_appointmentId, note) => {
      timeline.push('write');
      saved.push(note);
      return options.save ?? Result.ok(undefined);
    },
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

describe('appendTeamNote — a line below the visit’s note', () => {
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
    // The note is read first, the clock after it, the write last.
    expect(world.timeline).toEqual(['read', 'clock', 'write']);
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

  it('reads nothing and writes nothing for words that say nothing', async () => {
    const world = noteWorld('алергия към ментол');
    const append = appendTeamNote({
      ...world.ports,
      ...clockReading(world.timeline),
    });

    expect(await append(command('   '))).toEqual(Result.ok(null));
    expect(await append(command(''))).toEqual(Result.ok(null));
    expect(world.timeline).toEqual([]);
    expect(world.saved).toEqual([]);
  });

  it('writes nothing over a note it could not read — the read’s failure is the answer', async () => {
    const failure = RepositoryError.readFailed(
      'appointmentNotes/appointment-1',
      'permission-denied',
    );
    const world = noteWorld(null, {
      read: () => of(Result.err(failure)),
    });
    const append = appendTeamNote({
      ...world.ports,
      ...clockReading(world.timeline),
    });

    expect(await append(command('наводнение'))).toEqual(Result.err(failure));
    expect(world.saved).toEqual([]);
    expect(world.timeline).toEqual([]);
  });

  it('writes nothing when the note stream closes without answering', async () => {
    const world = noteWorld(null, { read: () => EMPTY });
    const append = appendTeamNote({
      ...world.ports,
      ...clockReading(world.timeline),
    });

    expect(await append(command('наводнение'))).toEqual(
      Result.err(RepositoryError.readFailed(null, null)),
    );
    expect(world.saved).toEqual([]);
  });

  it('answers the write’s failure when the note did not save', async () => {
    const failure = RepositoryError.writeFailed(
      'appointmentNotes/appointment-1',
      null,
    );
    const world = noteWorld(null, { save: Result.err(failure) });
    const append = appendTeamNote({
      ...world.ports,
      ...clockReading(world.timeline),
    });

    expect(await append(command('наводнение'))).toEqual(Result.err(failure));
    expect(world.timeline).toEqual(['read', 'clock', 'write']);
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
      observeAppointmentNote: second.ports.observeAppointmentNote,
      saveAppointmentNote: second.ports.saveAppointmentNote,
    });

    await append(command('наводнение'));

    expect(first.saved).toEqual([]);
    expect(second.saved.map((note) => note?.text)).toEqual([
      'по-късна бележка\nнаводнение',
    ]);
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
