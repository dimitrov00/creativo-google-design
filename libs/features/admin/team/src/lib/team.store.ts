import { Injectable, computed, inject, signal } from '@angular/core';
import { BarberEdit, type TeamMember } from '@core/components';
import { PipelineError, PipelineErrorCode } from '@core/errors';
import { type BarberId, ClientOperationId } from '@core/primitives';
import { TeamRosterSystem } from '@core/systems';
import {
  ID_PORTS,
  TEAM_ADMIN_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { LoadState } from '@creativo/shared/view-state';

/**
 * THE TEAM, AS `listTeam` ANSWERED IT (team onboarding D8): every barber
 * record and every staff account the caller's permissions reach, read once
 * per visit to a Team screen and again on demand. The rows are the server's
 * (`TeamRosterSystem.membersOf`); the page's runs are a `computed()` over
 * them (`sectionsOf`), never a second read.
 *
 * Root-provided, so «Права» names who holds each level from the same rows
 * the Team page drew, and a way back to the list paints at once from what
 * it last held while the fresh read is on its way.
 */
@Injectable({ providedIn: 'root' })
export class TeamStore {
  private readonly ports = inject(TEAM_ADMIN_PORTS);
  private readonly ids = inject(ID_PORTS);

  private readonly _members = signal<readonly TeamMember[] | null>(null);
  private readonly _refusal = signal<PipelineError | null>(null);
  private readonly _loading = signal(false);
  /** The newest read's number: an older one that lands late is dropped. */
  private reads = 0;

  /** The rows last answered; `null` before the first answer. */
  readonly members = this._members.asReadonly();

  /** Why the last read failed; `null` when it did not. */
  readonly refusal = this._refusal.asReadonly();

  /**
   * Where the list stands: rows on screen win over a read in flight and
   * over a failed one (dated rows beat a blank page; the refusal is said
   * beside them).
   */
  readonly loadState = computed<LoadState>(() => {
    const members = this._members();
    if (members !== null) {
      return members.length === 0 ? LoadState.Empty : LoadState.Ready;
    }
    return this._refusal() !== null ? LoadState.Failed : LoadState.Loading;
  });

  /** A read is in flight. */
  readonly loading = this._loading.asReadonly();

  /** The page's three runs (`TeamRosterSystem.sectionsOf`). */
  readonly sections = computed(() =>
    TeamRosterSystem.sectionsOf(this._members() ?? []),
  );

  private readonly _ending = signal<BarberId | null>(null);
  /** The leaver whose sessions «Опитай пак» is ending now; `null` while none is. */
  readonly ending = this._ending.asReadonly();

  private readonly _endRefusal = signal<{
    readonly barberId: BarberId;
    readonly error: PipelineError;
  } | null>(null);
  /** Why the last «Опитай пак» was refused, and for whom; `null` when it was not. */
  readonly endRefusal = this._endRefusal.asReadonly();

  /**
   * «Опитай пак» (team onboarding D10): the sessions a leaver's close still
   * owes, ended now (`editBarber` `END_SESSIONS`, credited to the caller).
   * Landed, the list is read again — the row's note goes with the debt;
   * refused, the refusal is kept beside the leaver's notice.
   */
  async endSessions(barberId: BarberId): Promise<void> {
    if (this._ending() !== null) return;
    const operationId = ClientOperationId.parse(this.ids.nextId());
    if (!operationId.ok) {
      this._endRefusal.set({
        barberId,
        error: PipelineError.bare(PipelineErrorCode.InvalidRequest),
      });
      return;
    }
    this._ending.set(barberId);
    this._endRefusal.set(null);
    const answer = await this.ports.editBarber({
      barberEdit: BarberEdit.EndSessions,
      barberId,
      operationId: operationId.value,
    });
    this._ending.set(null);
    if (!answer.ok) {
      this._endRefusal.set({ barberId, error: answer.error });
      return;
    }
    await this.load();
  }

  /** Reads the team again. The rows on screen stay until the answer lands. */
  async load(): Promise<void> {
    const read = ++this.reads;
    this._loading.set(true);
    const answer = await this.ports.listTeam({});
    if (read !== this.reads) return;
    this._loading.set(false);
    if (answer.ok) {
      this._members.set(answer.value.members);
      this._refusal.set(null);
    } else {
      this._refusal.set(answer.error);
    }
  }
}
