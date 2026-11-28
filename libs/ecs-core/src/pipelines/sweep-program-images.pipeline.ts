import type { LocalizedText, ProgramId } from '@core/components';
import { LogEvent, Result } from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import type {
  ClockPorts,
  LogPorts,
  StoredObjectDeletePorts,
  StoredObjectListPorts,
} from '@core/ports';
import { ProgramImageSystem } from '@core/systems';

/**
 * `sweepProgramImages` — the pictures a saved description no longer names,
 * removed
 * (`docs/architecture/decisions/2026-11-27-rich-text-for-programs-and-posts.md`,
 * step 4). Run by the trigger on a description's document, after every
 * write and after its removal:
 *
 * 1. **Impure read** — the folder's listing.
 * 2. **Pure compute** — `ProgramImageSystem.namedIn` reads the pictures the
 *    description names across its languages; `staleOf` answers the objects
 *    it does not name that are older than an hour (a younger one may be
 *    held by an editor that has not saved yet).
 * 3. **Impure write** — each deleted. One that could not be is logged
 *    (`program.image_cleanup_failed`) and left for the next save: the sweep
 *    answers how many it removed, never a failure for one object.
 *
 * Idempotent: a second run finds nothing to remove.
 */
export type SweepProgramImagesCommand = {
  readonly programId: ProgramId;
  /** The description as saved; `null` when its document was removed. */
  readonly body: LocalizedText | null;
};

export type SweepProgramImagesPorts = StoredObjectListPorts &
  StoredObjectDeletePorts &
  ClockPorts &
  LogPorts;

export const sweepProgramImages =
  (ports: SweepProgramImagesPorts) =>
  async (
    cmd: SweepProgramImagesCommand,
  ): Promise<Result<{ readonly removed: number }, RepositoryError>> => {
    const listed = await ports.listStoredObjects(
      ProgramImageSystem.folderOf(cmd.programId),
    );
    if (!listed.ok) return listed;
    const stale = ProgramImageSystem.staleOf(
      cmd.programId,
      listed.value,
      ProgramImageSystem.namedIn(cmd.body),
      ports.nowUtcMs(),
    );
    let removed = 0;
    for (const path of stale) {
      const deleted = await ports.deleteStoredObject(path);
      if (deleted.ok) {
        removed++;
      } else {
        ports.log('warn', LogEvent.ProgramImageCleanupFailed, {
          path,
          errorCode: deleted.error.errorCode,
        });
      }
    }
    return Result.ok({ removed });
  };
