import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { UtcEpochMs } from '@core/primitives';
import {
  AUTH_SESSION_PORTS,
  CLOCK_PORTS,
  READ_AS_CALL_PORTS,
  READ_AS_SESSION_PORTS,
  ShopZoneService,
} from '@creativo/infrastructure/firebase-app';
import { intlLocaleOf, loadedLanguage } from '@creativo/infrastructure/i18n';
import { UiButton } from '@creativo/ui/controls';
import { readAsBannerVm } from './read-as-banner.presenter';
import { readAsBannerWordsOf } from './read-as.words';

/**
 * THE SUPPORT READ-AS BANNER (OR-24, docs/designs/support-read-as.md): on
 * every page while the session is a read-as, a pill at the top that says
 * whose eyes these are and until when, with «Край». It reads the ID token
 * alone — no Firestore read — and draws nothing on a plain session. Mounted
 * once in the app root, loaded when the app is idle.
 *
 * «Край» ends the session on the server (`endImpersonation`, admitted for
 * its own session), then signs out and opens the sign-in: the support
 * account signs in again as itself. At `impExp` the app signs out on its
 * own — the rules and the server already refuse the session by then.
 */
@Component({
  selector: 'cr-read-as-banner',
  imports: [UiButton],
  template: `
    @if (vm(); as v) {
      <div
        class="cr-read-as"
        role="status"
        [attr.aria-label]="v.label"
        data-testid="read-as-banner"
      >
        <span class="cr-read-as__dot" aria-hidden="true"></span>
        <span class="cr-read-as__text">
          <span class="cr-read-as__title" data-testid="read-as-title">{{
            v.title
          }}</span>
          @if (v.until) {
            <span class="cr-read-as__until" data-testid="read-as-until">{{
              v.until
            }}</span>
          }
        </span>
        <button
          type="button"
          uiButton
          uiButtonStyle="bordered"
          uiTint="neutral"
          uiControlSize="small"
          [uiLoading]="ending()"
          data-testid="read-as-end"
          (click)="end()"
        >
          {{ v.end }}
        </button>
      </div>
    }
  `,
  styleUrl: './read-as-banner.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReadAsBannerComponent {
  private readonly session = inject(READ_AS_SESSION_PORTS);
  private readonly calls = inject(READ_AS_CALL_PORTS);
  private readonly auth = inject(AUTH_SESSION_PORTS);
  private readonly clock = inject(CLOCK_PORTS);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly zone = inject(ShopZoneService).defaultZone();

  private readonly lang = toSignal(loadedLanguage(this.transloco), {
    initialValue: null,
  });
  private readonly readAs = toSignal(this.session.observeReadAs(), {
    initialValue: null,
  });
  protected readonly ending = signal(false);

  protected readonly vm = computed(() => {
    const lang = this.lang();
    if (lang === null) return null;
    return readAsBannerVm({
      readAs: this.readAs(),
      name: this.auth.currentDisplayName(),
      zone: this.zone(),
      locale: intlLocaleOf(lang),
      words: readAsBannerWordsOf((key, params) =>
        this.transloco.translate(key, { ...params }, lang),
      ),
    });
  });

  constructor() {
    // The window's end, on the device: sign out the moment it passes.
    effect((onCleanup) => {
      const readAs = this.readAs();
      if (readAs === null) return;
      const left = UtcEpochMs.elapsedMs(
        this.clock.nowUtcMs(),
        readAs.readAsExpiresAtUtcMs,
      );
      const timer = setTimeout(() => void this.leave(), Math.max(0, left));
      onCleanup(() => clearTimeout(timer));
    });
    inject(DestroyRef).onDestroy(() => this.ending.set(false));
  }

  protected async end(): Promise<void> {
    const readAs = this.readAs();
    if (readAs === null || this.ending()) return;
    this.ending.set(true);
    // Ended or not on the server, the device leaves the session: a failed
    // end only means the row expires by itself.
    await this.calls.endReadAs({ sessionId: readAs.readAsSessionId });
    await this.leave();
  }

  private async leave(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/auth');
  }
}
