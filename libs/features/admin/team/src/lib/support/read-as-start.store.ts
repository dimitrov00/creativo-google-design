import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ImpersonationScope } from '@core/components';
import type { PipelineError } from '@core/errors';
import { type UserId, UtcEpochMs } from '@core/primitives';
import { ImpersonationSystem } from '@core/systems';
import {
  CLOCK_PORTS,
  READ_AS_CALL_PORTS,
  READ_AS_SESSION_PORTS,
} from '@creativo/infrastructure/firebase-app';

/**
 * The window asked for: a minute under the server's cap, so a device clock
 * a little ahead of the server's never has the start refused as too long
 * (`GOVERNANCE_IMPERSONATION_WINDOW_TOO_LONG`).
 */
const ASKED_WINDOW_MS = (ImpersonationSystem.MAX_WINDOW_MINUTES - 1) * 60_000;

/**
 * STARTING A SUPPORT READ-AS (OR-24, docs/designs/support-read-as.md): the
 * session opened on the server with the reason support gave, then the
 * browser's one session swapped for the read-as token it answered, then the
 * target's own home. A refusal stays on the sheet, worded by its code.
 */
@Injectable()
export class ReadAsStartStore {
  private readonly calls = inject(READ_AS_CALL_PORTS);
  private readonly session = inject(READ_AS_SESSION_PORTS);
  private readonly clock = inject(CLOCK_PORTS);
  private readonly router = inject(Router);

  private readonly _pending = signal(false);
  private readonly _refusal = signal<PipelineError | null>(null);
  readonly pending = this._pending.asReadonly();
  readonly refusal = this._refusal.asReadonly();

  async start(targetUserId: UserId, reason: string): Promise<void> {
    if (this._pending()) return;
    this._pending.set(true);
    this._refusal.set(null);
    const started = await this.calls.startReadAs({
      targetUserId,
      impersonationScope: ImpersonationScope.Read,
      reason,
      expiresAtUtcMs: UtcEpochMs.plusMs(this.clock.nowUtcMs(), ASKED_WINDOW_MS),
    });
    if (!started.ok) {
      this._refusal.set(started.error);
      this._pending.set(false);
      return;
    }
    const signed = await this.session.signInWithReadAsToken(
      started.value.customToken,
    );
    if (!signed.ok) {
      this._refusal.set(signed.error);
      this._pending.set(false);
      return;
    }
    await this.router.navigateByUrl('/account');
  }
}
