import { Injectable, inject, signal } from '@angular/core';
import { BarberStatus, OfferingsEdit } from '@core/components';
import { PipelineError, PipelineErrorCode } from '@core/errors';
import {
  type BarberId,
  ClientOperationId,
  type LocalDate,
} from '@core/primitives';
import {
  ID_PORTS,
  TEAM_ADMIN_PORTS,
} from '@creativo/infrastructure/firebase-app';
import { TeamStore } from './team.store';

/** What the add sheet asks for. */
export type TeamAddAnswers = {
  readonly name: string;
  readonly barberStartsLocalDate: LocalDate;
  /** The colleague whose prices are copied; `null` for nobody. */
  readonly copyFromBarberId: BarberId | null;
};

/**
 * «ДОБАВИ» — a new barber record (team onboarding D8): `addBarber` writes
 * it as a `DRAFT`, then, when a colleague was picked, `setBarberOfferings`
 * copies that colleague's terms onto it. The record's defaults are a
 * barber's: every shop, bookable by everyone once it goes live, in the
 * «Който и да е» pool — each can be changed on the member's page.
 *
 * Provided by the add sheet: one act per opening. The two calls are two
 * acts, each under its own minted name, and the first is never repeated
 * once it has landed: a copy that fails leaves the record there, says so,
 * and «Добави» then retries the copy alone.
 */
@Injectable()
export class TeamAddStore {
  private readonly ports = inject(TEAM_ADMIN_PORTS);
  private readonly ids = inject(ID_PORTS);
  private readonly team = inject(TeamStore);

  private readonly _pending = signal(false);
  private readonly _refusal = signal<PipelineError | null>(null);
  private readonly _added = signal<BarberId | null>(null);

  /** A call is on its way. */
  readonly pending = this._pending.asReadonly();

  /** Why the last call was refused; `null` when it was not. */
  readonly refusal = this._refusal.asReadonly();

  /** The record this opening has already created; its answers are final. */
  readonly added = this._added.asReadonly();

  /** Adds the record and copies the prices. The new record's id once both landed, else `null`. */
  async add(answers: TeamAddAnswers): Promise<BarberId | null> {
    if (this._pending()) return null;
    this._pending.set(true);
    this._refusal.set(null);
    const barberId = this._added() ?? (await this.create(answers));
    const done =
      barberId !== null &&
      (answers.copyFromBarberId === null ||
        (await this.copy(barberId, answers.copyFromBarberId)));
    this._pending.set(false);
    if (barberId !== null) void this.team.load();
    return done ? barberId : null;
  }

  /** `addBarber`: the act's name IS the new record's id. */
  private async create(answers: TeamAddAnswers): Promise<BarberId | null> {
    const operationId = this.mint();
    if (operationId === null) return null;
    const answer = await this.ports.addBarber({
      name: { bg: answers.name, en: null },
      locationIds: [],
      barberStartsLocalDate: answers.barberStartsLocalDate,
      barberLastWorkingLocalDate: null,
      barberDraftTargetStatus: BarberStatus.Public,
      barberJoinsAnyPool: true,
      operationId,
    });
    if (!answer.ok) {
      this._refusal.set(answer.error);
      return null;
    }
    this._added.set(answer.value.barberId);
    return answer.value.barberId;
  }

  /** `setBarberOfferings`, `COPY`: a one-time snapshot of a colleague's terms. */
  private async copy(
    barberId: BarberId,
    copyFromBarberId: BarberId,
  ): Promise<boolean> {
    const operationId = this.mint();
    if (operationId === null) return false;
    const answer = await this.ports.setBarberOfferings({
      offeringsEdit: OfferingsEdit.Copy,
      copyFromBarberId,
      barberId,
      operationId,
    });
    if (!answer.ok) this._refusal.set(answer.error);
    return answer.ok;
  }

  /** A fresh name for one act; a name the wire cannot carry is refused before anything goes out. */
  private mint(): ClientOperationId | null {
    const operationId = ClientOperationId.parse(this.ids.nextId());
    if (operationId.ok) return operationId.value;
    this._refusal.set(PipelineError.bare(PipelineErrorCode.InvalidRequest));
    return null;
  }
}
