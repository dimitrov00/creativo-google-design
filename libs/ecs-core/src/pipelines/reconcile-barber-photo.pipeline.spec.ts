import { describe, expect, it } from 'vitest';
import { Actor, Role, type StoredObjectFacts } from '@core/components';
import { LogEvent, Result, UserId } from '@core/primitives';
import { RepositoryError } from '@core/errors';
import { type Barber, Collections } from '@core/entities';
import type { CommitPlan } from '@core/ports';
import {
  auditRowsOf,
  barberFixture,
  bodyOf,
  FIXTURE_IDS,
  FIXTURE_NOW_UTC_MS,
  memoryStore,
  memoryTxPorts,
} from '@core/testing';
import {
  type BarberPhotoLink,
  reconcileBarberPhoto,
} from './reconcile-barber-photo.pipeline';

/*
 * `reconcileBarberPhoto` — one photo for a barber and the account just
 * linked to their record (decision F6): what can go wrong on the way, and
 * that none of it is the link's to answer for. The paths that land are
 * `setRoles`' own cases.
 */

const IVAN = FIXTURE_IDS.barber;
const LINKED = UserId.of('u-ivan');
const AVATAR = `avatars/${LINKED}/original`;
const PORTRAIT = `media/barbers/${IVAN}/operation-photo-0123456`;
/** The copy's path: the first id the rig mints is the taking's name. */
const COPY = `media/barbers/${IVAN}/id-1`;
const MEASURED: StoredObjectFacts = {
  sizeBytes: 90_000,
  contentType: 'image/jpeg',
  pixelWidth: 800,
  pixelHeight: 1000,
};

function rig(
  options: {
    readonly barber?: Barber | null;
    readonly objects?: Readonly<Record<string, StoredObjectFacts>>;
    /** The calls that fail, as they are recorded: `stat:<path>`, `copy:<to>`, `delete:<path>`. */
    readonly failing?: readonly string[];
    readonly commit?: (commit: CommitPlan) => CommitPlan;
  } = {},
) {
  const barber =
    options.barber === undefined ? barberFixture() : options.barber;
  const store = memoryStore(
    barber === null
      ? []
      : [{ path: [Collections.Barbers, barber.id], body: bodyOf(barber) }],
  );
  const objects = new Map<string, StoredObjectFacts>(
    Object.entries(options.objects ?? { [AVATAR]: MEASURED }),
  );
  const failing = options.failing ?? [];
  const storage: string[] = [];
  const logged: { level: string; msg: string }[] = [];
  const tx = memoryTxPorts(store);
  const failed = (path: string) =>
    Result.err(RepositoryError.writeFailed(path, 'storage/internal'));
  return {
    store,
    tx,
    objects,
    storage,
    logged,
    run: reconcileBarberPhoto({
      ...tx,
      commit: options.commit ? options.commit(tx.commit) : tx.commit,
      statStoredObject: async (path) => {
        storage.push(`stat:${path}`);
        return failing.includes(`stat:${path}`)
          ? failed(path)
          : Result.ok(objects.get(path) ?? null);
      },
      copyStoredObject: async (fromPath, toPath) => {
        storage.push(`copy:${fromPath}→${toPath}`);
        const source = objects.get(fromPath);
        if (source === undefined || failing.includes(`copy:${toPath}`)) {
          return failed(toPath);
        }
        objects.set(toPath, source);
        return Result.ok(undefined);
      },
      deleteStoredObject: async (path) => {
        storage.push(`delete:${path}`);
        if (failing.includes(`delete:${path}`)) return failed(path);
        objects.delete(path);
        return Result.ok(undefined);
      },
      log: (level, msg) => logged.push({ level, msg }),
    }),
  };
}

const link = (over: Partial<BarberPhotoLink> = {}): BarberPhotoLink => ({
  barberId: IVAN,
  linkedUserId: LINKED,
  recordPhotoPath: null,
  actor: Actor.forCaller(UserId.of('u-admin'), [Role.Admin]),
  nowUtcMs: FIXTURE_NOW_UTC_MS,
  ...over,
});

/** The object the record took, by the path it holds. */
const takenPath = (store: Map<string, unknown>): string | null => {
  const body = store.get(`${Collections.Barbers}/${IVAN}`) as
    Record<string, unknown> | undefined;
  const path = body?.['avatarMediaPath'];
  return typeof path === 'string' ? path : null;
};

describe('reconcileBarberPhoto — what can go wrong on the way', () => {
  it('an avatar that could not be rewritten with the record’s photo is logged, and nothing else happens', async () => {
    const { logged, tx, run } = rig({
      objects: { [PORTRAIT]: MEASURED },
      failing: [`copy:${AVATAR}`],
    });

    await run(link({ recordPhotoPath: PORTRAIT }));

    expect(logged).toEqual([
      { level: 'error', msg: LogEvent.TeamPhotoMirrorFailed },
    ]);
    expect(tx.plans).toEqual([]);
  });

  it('an avatar that could not be read, or copied into the barber’s folder, is logged, and the record stays without a photo', async () => {
    const unread = rig({ failing: [`stat:${AVATAR}`] });
    await unread.run(link());
    expect(unread.logged.map((line) => line.msg)).toEqual([
      LogEvent.TeamPhotoMirrorFailed,
    ]);
    expect(takenPath(unread.store)).toBeNull();

    const uncopied = rig({ failing: [`copy:${COPY}`] });
    await uncopied.run(link());
    expect(uncopied.logged.map((line) => line.msg)).toEqual([
      LogEvent.TeamPhotoMirrorFailed,
    ]);
    expect(uncopied.tx.plans).toEqual([]);
    expect(takenPath(uncopied.store)).toBeNull();
  });

  it('a record that took a photo of its own in the meantime keeps it, and the copy is deleted', async () => {
    const { store, objects, storage, tx, run } = rig({
      commit: (commit) => (read, decide) => {
        // Someone set the record's photo between the copy and the write.
        store.set(
          `${Collections.Barbers}/${IVAN}`,
          bodyOf(barberFixture({ avatarMediaPath: PORTRAIT })),
        );
        return commit(read, decide);
      },
    });

    await run(link());

    expect(takenPath(store)).toBe(PORTRAIT);
    const copy = storage.find((call) => call.startsWith('copy:'));
    const copied = copy?.split('→')[1] ?? '';
    expect(storage).toContain(`delete:${copied}`);
    expect(objects.has(copied)).toBe(false);
    expect(auditRowsOf(tx.plans)).toEqual([]);
  });

  it('a record that is gone, or has left, takes nothing — and the copy is deleted', async () => {
    const gone = rig({
      commit: (commit) => (read, decide) => {
        gone.store.delete(`${Collections.Barbers}/${IVAN}`);
        return commit(read, decide);
      },
    });
    await gone.run(link());
    expect(gone.storage.some((call) => call.startsWith('delete:'))).toBe(true);
    expect(auditRowsOf(gone.tx.plans)).toEqual([]);

    const departed = rig({
      barber: barberFixture(
        {},
        {
          barberStatus: 'DEPARTED',
          barberStatusChangedAtUtcMs: FIXTURE_NOW_UTC_MS,
          barberDepartedUserId: null,
          barberSessionsRevokedAtUtcMs: null,
          barberKeptAccessUserId: null,
          barberRehireStatus: 'PUBLIC',
        },
      ),
    });
    await departed.run(link());
    expect(takenPath(departed.store)).toBeNull();
    expect(departed.storage.some((call) => call.startsWith('delete:'))).toBe(
      true,
    );
  });

  it('a copy that could not be deleted is logged as a leftover, never as the link’s failure', async () => {
    const { store, logged, run } = rig({
      failing: [`delete:${COPY}`],
      commit: (commit) => (read, decide) => {
        store.delete(`${Collections.Barbers}/${IVAN}`);
        return commit(read, decide);
      },
    });

    await run(link());

    expect(logged).toEqual([
      { level: 'warn', msg: LogEvent.TeamPhotoCleanupFailed },
    ]);
  });
});
