import { Injectable, computed, inject, signal } from '@angular/core';
import {
  type PermissionChange,
  type StaffLevel,
  StaffPermissions,
} from '@core/components';
import type { PipelineError } from '@core/errors';
import type { AccessScope, StaffCapability } from '@core/primitives';
import { StaffPermissionsEditSystem } from '@core/systems';
import { StaffAccessService } from '@creativo/features/client/account-state';
import { TEAM_ADMIN_PORTS } from '@creativo/infrastructure/firebase-app';

/** A save that landed, until the live cells say so themselves. */
type Landed = {
  /** The live cells as they stood when the save was sent. */
  readonly before: StaffPermissions;
  /** The cells the save wrote. */
  readonly after: StaffPermissions;
};

/**
 * «ПРАВА», AS THE OWNER IS EDITING IT (staff permissions P10): the saved
 * cells are the session's one live copy (`StaffAccessService.permissions`),
 * and the draft is the list of cells the owner has touched, each with the
 * scope they want. What the page shows (`next`) and what a save would change
 * (`changes`) are `StaffPermissionsEditSystem.plan` over the two — the
 * server's own rule, so the page can never offer a save the server would
 * count differently.
 *
 * One draft for the three level pages: «Запази» sends every touched cell
 * in ONE call, which files one audit row for the act. Root-provided, so
 * the draft survives a walk between «Права» and a level's page; it is the
 * session's and is gone with a reload.
 *
 * A draft is kept as WANTED SCOPES, not as a copy of the cells: when the
 * live cells move under it (another owner's save), the untouched cells
 * follow at once and the touched ones still say what this owner asked for.
 */
@Injectable({ providedIn: 'root' })
export class PermissionsStore {
  private readonly access = inject(StaffAccessService);
  private readonly ports = inject(TEAM_ADMIN_PORTS);

  /** The cells the owner has touched, one entry per cell. */
  private readonly wanted = signal<readonly PermissionChange[]>([]);
  private readonly landed = signal<Landed | null>(null);
  private readonly _saving = signal(false);
  private readonly _refusal = signal<PipelineError | null>(null);
  private readonly _receipt = signal(false);

  /**
   * The saved cells: the live copy — or, for the beat between a save's
   * answer and the listener's, the cells that save wrote, so a saved row
   * never flickers back to what it was.
   */
  private readonly saved = computed(() => {
    const live = this.access.permissions();
    const landed = this.landed();
    return landed !== null && landed.before === live ? landed.after : live;
  });

  /** The draft over the saved cells, as the server would plan it. */
  private readonly plan = computed(() =>
    StaffPermissionsEditSystem.plan(this.saved(), this.wanted()),
  );

  /** The cells as the page shows them: saved, with the touched ones as wanted. */
  readonly next = computed(() => {
    const plan = this.plan();
    return plan.ok ? plan.value.permissions : this.saved();
  });

  /** The cells a save would change, each with its scope before and after. */
  readonly changes = computed(() => {
    const plan = this.plan();
    return plan.ok ? plan.value.changes : [];
  });

  /** The draft differs from what is saved: the dock holds «Запази». */
  readonly dirty = computed(() => this.changes().length > 0);

  /** The levels a save would change. */
  readonly unsaved = computed<ReadonlySet<StaffLevel>>(
    () => new Set(this.changes().map((change) => change.role)),
  );

  readonly saving = this._saving.asReadonly();

  /** Why the last save was refused; `null` when it was not. */
  readonly refusal = this._refusal.asReadonly();

  /** The last save landed and nothing has been touched since. */
  readonly receipt = this._receipt.asReadonly();

  /** The owner answers one row. A scope the cell does not offer is not an answer. */
  set(
    level: StaffLevel,
    staffCapability: StaffCapability,
    accessScope: AccessScope,
  ): void {
    if (!StaffPermissions.offers(level, staffCapability, accessScope)) return;
    this.touch([{ staffCapability, role: level, accessScope }]);
  }

  /** «Върни стандартните»: every row of the level back to its standard. */
  restore(level: StaffLevel): void {
    this.touch(
      StaffPermissions.CAPABILITIES.map((staffCapability) => ({
        staffCapability,
        role: level,
        accessScope: StaffPermissions.standardOf(level, staffCapability),
      })),
    );
  }

  /** The receipt is read: it goes. */
  dismissReceipt(): void {
    this._receipt.set(false);
  }

  /**
   * «Запази»: the cells that would change, in one call. On a refusal the
   * draft stays as it is, with the reason beside it.
   */
  async save(): Promise<void> {
    const changes = this.changes();
    if (changes.length === 0 || this._saving()) return;
    const before = this.access.permissions();
    const after = this.next();
    this._saving.set(true);
    this._refusal.set(null);
    const answer = await this.ports.setStaffPermissions({
      changes: changes.map((change) => ({
        staffCapability: change.staffCapability,
        role: change.role,
        accessScope: change.accessScopeTo,
      })),
    });
    this._saving.set(false);
    if (!answer.ok) {
      this._refusal.set(answer.error);
      return;
    }
    this.landed.set({ before, after });
    this.wanted.set([]);
    this._receipt.set(true);
  }

  /** Replaces the wanted scope of each named cell; every other touched cell stays. */
  private touch(cells: readonly PermissionChange[]): void {
    this._receipt.set(false);
    this._refusal.set(null);
    this.wanted.update((wanted) => [
      ...wanted.filter(
        (entry) =>
          !cells.some(
            (cell) =>
              cell.role === entry.role &&
              cell.staffCapability === entry.staffCapability,
          ),
      ),
      ...cells,
    ]);
  }
}
