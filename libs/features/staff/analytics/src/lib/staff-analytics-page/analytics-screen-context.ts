import { type Signal, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { PipelineErrorCode } from '@core/errors';
import {
  DEFAULT_LOCALE,
  loadedLanguage,
  wordPipelineError,
} from '@creativo/infrastructure/i18n';
import {
  CatalogContentService,
  CatalogWording,
} from '@creativo/features/shared/catalog';
import type {
  AnalyticsNames,
  AnalyticsScreenInput,
} from '../analytics.presenter';
import { type AnalyticsWords, analyticsWordsOf } from '../analytics.words';
import type { StaffAnalyticsStore } from '../staff-analytics.store';

/** What every «Анализи» screen words its store with. */
export type AnalyticsScreenContext = {
  /** The screen's words in the loaded language; `null` until it has loaded. */
  readonly words: Signal<AnalyticsWords | null>;
  /** Services and barbers in the reader's language, read when asked. */
  readonly names: AnalyticsNames;
  /**
   * The v2 presenter's input for the store's period and report — `null`
   * until the words, the shop's clock and the period are known. A late
   * catalogue re-words it.
   */
  readonly input: Signal<AnalyticsScreenInput | null>;
};

/**
 * The words, the catalogue's names and the refusal's wording one store's
 * screen is built from — the home (`StaffAnalyticsPage`) and a card's
 * screen (`AnalyticsCardPage`) alike, each with its own store. Call in an
 * injection context.
 */
export function injectAnalyticsScreen(
  store: StaffAnalyticsStore,
): AnalyticsScreenContext {
  const transloco = inject(TranslocoService);
  const catalog = inject(CatalogContentService);
  const wording = inject(CatalogWording);
  const loadedLang = toSignal(loadedLanguage(transloco), {
    initialValue: null,
  });

  const words = computed(() => {
    const lang = loadedLang();
    if (lang === null) return null;
    return analyticsWordsOf(
      (key, params) => transloco.translate(key, params, lang),
      lang,
    );
  });

  const names: AnalyticsNames = {
    serviceName: (id) => {
      const service = catalog.findService(id);
      return service === undefined ? null : wording.text(service.name);
    },
    barberName: (id) => {
      const barber = catalog.barbers().find((entry) => entry.id === id);
      return barber === undefined ? null : wording.text(barber.name);
    },
    barberAvatarSrc: (id) =>
      catalog.barberVms().find((vm) => vm.id === id)?.avatarSrc ?? null,
    locationName: (id) => {
      const location = catalog.locations().find((entry) => entry.id === id);
      return location === undefined ? null : wording.text(location.name);
    },
  };

  /** A refusal of the account, in the catalogue's words (`errors.<code>`). */
  const refusal = computed(() => {
    const error = store.refusal();
    const lang = loadedLang() ?? DEFAULT_LOCALE;
    if (error === null) return null;
    return wordPipelineError(
      error,
      (code, params) => {
        const key = `errors.${code}`;
        const worded = transloco.translate(key, params, lang);
        return worded === key ? code : worded;
      },
      PipelineErrorCode.Unknown,
    );
  });

  const input = computed<AnalyticsScreenInput | null>(() => {
    const w = words();
    const zone = store.zone();
    const today = store.today();
    const period = store.period();
    if (w === null || zone === null || today === null || period === null) {
      return null;
    }
    // Read here so a late catalogue re-words the names.
    catalog.barbers();
    catalog.services();
    // Locations not read yet word as one shop, never as «all».
    const shopCount = catalog.locations().length || 1;
    return {
      words: w,
      zone,
      today,
      now: store.now(),
      period,
      analyticsLoad: store.analyticsLoad(),
      report: store.report(),
      refusal: refusal(),
      scopeMenu: store.scopeMenu(),
      scopeBarberIds: store.scopeBarberIds(),
      scopeBarberId: store.scopeBarberId(),
      scopeLocationIds: store.scopeLocationIds(),
      shopCount,
      linkedBarberId: store.linkedBarberId(),
      scopeGone: store.scopeGone(),
      scheduleBarberId: store.scheduleBarberId(),
      rangeCheck: store.rangeCheck(),
      goalCheck: store.goalCheck(),
      goalSave: store.goalSave(),
      names,
    };
  });

  return { words, names, input };
}
