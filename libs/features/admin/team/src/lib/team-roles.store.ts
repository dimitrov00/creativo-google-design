import { Injectable, computed, inject, signal } from '@angular/core';
import type { RolesCall } from '@core/components';
import {
  GovernanceErrorCode,
  PipelineError,
  PipelineErrorCode,
} from '@core/errors';
import { ClientOperationId } from '@core/primitives';
import {
  ID_PORTS,
  ROLES_ADMIN_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { TeamStore } from './team.store';

/**
 * THE TEAM SCREENS' ROLE CHANGES (security hardening S-WS-E; team
 * onboarding D8): one `setRoles` call at a time, each a named act, for the
 * pages that change whose account holds what — a barber record's link and
 * a staff account's roles.
 *
 * A change the server WROTE without ending that person's sessions
 * (`GOVERNANCE_ROLES_SESSIONS_NOT_REVOKED`) is no refusal of the change: it
 * counts as written and is kept, so the page can send it again as it is —
 * the server then writes nothing and ends them (S-RU-10, the client card's
 * own retry). The Team list is read again whatever the answer.
 *
 * Provided by the page that uses it: what is pending is that page's.
 */
@Injectable()
export class TeamRolesStore {
  private readonly ports = inject(ROLES_ADMIN_PORTS);
  private readonly ids = inject(ID_PORTS);
  private readonly team = inject(TeamStore);

  private readonly _pending = signal(false);
  private readonly _refusal = signal<PipelineError | null>(null);
  private readonly _unrevoked = signal<RolesCall | null>(null);

  /** A roles change is on its way. */
  readonly pending = this._pending.asReadonly();

  /** Why the last roles change was refused; `null` when it was not. */
  readonly refusal = this._refusal.asReadonly();

  /** A change landed, but that person's sessions were not ended: the page offers the retry. */
  readonly sessionsPending = computed(() => this._unrevoked() !== null);

  /** One roles change. `true` once it is WRITTEN, whether or not the sessions were ended. */
  async send(call: RolesCall): Promise<boolean> {
    if (this._pending()) return false;
    const operationId = ClientOperationId.parse(this.ids.nextId());
    if (!operationId.ok) {
      this._refusal.set(PipelineError.bare(PipelineErrorCode.InvalidRequest));
      return false;
    }
    this._pending.set(true);
    this._refusal.set(null);
    // The act's name rides the payload beside the call.
    const named: RolesCall & { readonly operationId: ClientOperationId } = {
      ...call,
      operationId: operationId.value,
    };
    const answer = await this.ports.setRoles(named);
    this._pending.set(false);
    void this.team.load();
    if (answer.ok) {
      this._unrevoked.set(null);
      return true;
    }
    if (
      answer.error.serverErrorCode !==
      GovernanceErrorCode.RolesSessionsNotRevoked
    ) {
      this._refusal.set(answer.error);
      return false;
    }
    this._unrevoked.set(call);
    return true;
  }

  /**
   * «Опитай пак» after a change whose sessions were not ended: the same
   * change again. Nothing is written twice; the server ends them.
   */
  endSessions(): Promise<boolean> {
    const call = this._unrevoked();
    return call === null ? Promise.resolve(false) : this.send(call);
  }

  /** The refusal was read, or the sheet it belonged to closed. */
  clearRefusal(): void {
    this._refusal.set(null);
  }

  /** The page moved to someone else: what was pending is theirs no more. */
  reset(): void {
    this._refusal.set(null);
    this._unrevoked.set(null);
  }
}
