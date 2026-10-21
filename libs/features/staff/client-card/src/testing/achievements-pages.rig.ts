/**
 * TEST SUPPORT for the «Постижения» pages' specs (`lib-client-achievements`,
 * `lib-achievement-category`, `lib-achievement-detail`) — never part of the
 * lib's build (`tsconfig.lib.json` excludes `src/testing/**`).
 *
 * A page is mounted over the REAL `ClientCardStore`, opened on a person
 * the way the visit editor opens it, with every port bound to its
 * in-memory reader and the app's own catalogue for words: what a spec
 * renders is what the store and the presenters make of Георги's and
 * Мартин's books — the A0 loyalty fixtures, parsed by the production
 * mappers — never a hand-written VM.
 */
import {
  type EnvironmentProviders,
  Injectable,
  type Provider,
  type Type,
} from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import {
  type Translation,
  type TranslocoLoader,
  TranslocoService,
  provideTransloco,
} from '@jsverse/transloco';
import { type Observable, firstValueFrom, of } from 'rxjs';
import {
  AVATAR_UPLOADER,
  type AvatarUploader,
  ZonedDateTime,
} from '@creativo/application/accounts';
import type { Result } from '@creativo/application/booking';
import type {
  AppointmentPhotoPorts,
  AppointmentReadPorts,
  ClientStatsReadPorts,
  CouponVoucherPorts,
  CustomerPorts,
  ProfilePorts,
  WaitlistReadPorts,
} from '@core/ports';
import {
  APPOINTMENT_PHOTO_PORTS,
  APPOINTMENT_READ_PORTS,
  CLIENT_STATS_READ_PORTS,
  COUPON_VOUCHER_PORTS,
  CUSTOMER_PORTS,
  PROFILE_PORTS,
  WAITLIST_READ_PORTS,
} from '@creativo/infrastructure/firebase-app';
import {
  LOYALTY_ACTIVITY_READER,
  LOYALTY_CATALOG_READER,
  LOYALTY_READER,
  type LoyaltyActivityReader,
  type LoyaltyCatalog,
  type LoyaltyCatalogReader,
  type LoyaltyReader,
} from '@creativo/application/engagement';
import {
  InMemoryLoyaltyCatalogReader,
  InMemoryLoyaltyReader,
} from '@creativo/application/engagement/testing';
import {
  CLOCK,
  type RepositoryError,
  provideFeatureFlags,
} from '@creativo/application/shared';
import type {
  ClientCardContext,
  ClientCardSubject,
} from '../lib/client-card.contracts';
import { ClientCardStore } from '../lib/client-card.store';
import {
  GEORGI,
  GEORGI_MONEY,
  InMemoryAvatars,
  MARTIN,
  NOW_MS,
  catalogueOf,
  customerPortsOf,
  georgiHistory,
  georgiPhotos,
  historyPortsOf,
  martinHistory,
  martinWaitlist,
  photoPortsOf,
  profilePortsOf,
  statsOf,
  statsPortsOf,
  waitlistPortsOf,
} from './client-card.fixtures';

/** The id the visit editor labels its page container by. */
export const PAGE_TITLE_ID = 'staff-visit-page-title';

/** Every loyalty flag on — the development configuration. */
export const ALL_LOYALTY_FLAGS: Readonly<Record<string, boolean>> = {
  'client.profile': true,
  'loyalty.points': true,
  'loyalty.streaks': true,
  'loyalty.achievements': true,
  'loyalty.tiers': true,
};

@Injectable()
class CatalogueLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(catalogueOf(lang === 'en' ? 'en' : 'bg'));
  }
}

/** A catalogue reader that answers only when the spec says so: the pages' loading state. */
export class HeldCatalogReader implements LoyaltyCatalogReader {
  private release: (() => void) | null = null;
  private readonly gate = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  constructor(
    private readonly inner: LoyaltyCatalogReader = new InMemoryLoyaltyCatalogReader(),
  ) {}

  async getCatalog(): Promise<Result<LoyaltyCatalog, RepositoryError>> {
    await this.gate;
    return this.inner.getCatalog();
  }

  /** Lets the held read answer. */
  answer(): void {
    this.release?.();
  }
}

/**
 * What a spec changes about the card's world; everything else is the dev
 * seed's. The glance and the history pages mount through the same rig, so
 * each port can be swapped for a failing, held or empty one.
 */
export interface AchievementsRig {
  readonly loyalty?: LoyaltyReader;
  readonly catalog?: LoyaltyCatalogReader;
  readonly flags?: Readonly<Record<string, boolean>>;
  /** «Now» for the shop's clock (Monday 28 September 2026, 12:40 by default). */
  readonly nowMs?: number;
  readonly profiles?: ProfilePorts;
  readonly stats?: ClientStatsReadPorts;
  readonly history?: AppointmentReadPorts;
  readonly photos?: AppointmentPhotoPorts;
  readonly waitlist?: WaitlistReadPorts;
  /** The client records the card resolves its person by (D29) — Георги's and Мартин's by default. */
  readonly customers?: CustomerPorts;
  readonly avatars?: AvatarUploader;
  /**
   * The wallet's two readers (revision 3 §4.5, §4.7). Bound ONLY when a
   * spec hands them (B2-6): the glance pages' world stays the one without
   * them, so no holdings line or feed appears where a case never asked.
   */
  readonly vouchers?: CouponVoucherPorts;
  readonly activity?: LoyaltyActivityReader;
}

/** The store, its ports and the words, bound as the visit editor's injector binds them. */
export function achievementsPageProviders(
  rig: AchievementsRig = {},
): (Provider | EnvironmentProviders)[] {
  return [
    ClientCardStore,
    provideFeatureFlags(rig.flags ?? ALL_LOYALTY_FLAGS),
    ...provideTransloco({
      config: {
        availableLangs: ['bg', 'en'],
        defaultLang: 'bg',
        fallbackLang: 'bg',
        missingHandler: { logMissingKey: false },
      },
      loader: CatalogueLoader,
    }),
    {
      provide: CLOCK,
      useValue: {
        now: (zone: string) =>
          ZonedDateTime.fromMillis(rig.nowMs ?? NOW_MS, zone),
      },
    },
    {
      provide: PROFILE_PORTS,
      useValue: rig.profiles ?? profilePortsOf(),
    },
    {
      provide: CUSTOMER_PORTS,
      useValue: rig.customers ?? customerPortsOf(),
    },
    {
      provide: CLIENT_STATS_READ_PORTS,
      useValue:
        rig.stats ??
        statsPortsOf(
          [statsOf(GEORGI, georgiHistory()), statsOf(MARTIN, martinHistory())],
          [GEORGI_MONEY],
        ),
    },
    {
      provide: APPOINTMENT_READ_PORTS,
      useValue:
        rig.history ?? historyPortsOf([...georgiHistory(), ...martinHistory()]),
    },
    {
      provide: APPOINTMENT_PHOTO_PORTS,
      useValue: rig.photos ?? photoPortsOf(georgiPhotos()),
    },
    {
      provide: LOYALTY_READER,
      useValue: rig.loyalty ?? InMemoryLoyaltyReader.seeded(),
    },
    {
      provide: LOYALTY_CATALOG_READER,
      useValue: rig.catalog ?? new InMemoryLoyaltyCatalogReader(),
    },
    {
      provide: WAITLIST_READ_PORTS,
      useValue: rig.waitlist ?? waitlistPortsOf([martinWaitlist()]),
    },
    {
      provide: AVATAR_UPLOADER,
      useValue:
        rig.avatars ??
        new InMemoryAvatars(
          new Map([[GEORGI, 'https://example.test/avatars/georgi.jpg']]),
        ),
    },
    ...(rig.vouchers === undefined
      ? []
      : [{ provide: COUPON_VOUCHER_PORTS, useValue: rig.vouchers }]),
    ...(rig.activity === undefined
      ? []
      : [{ provide: LOYALTY_ACTIVITY_READER, useValue: rig.activity }]),
  ];
}

/** A stand-in `ResizeObserver` the spec drives (jsdom has none, and lays nothing out). */
export interface ResizeObserverStub {
  /** Every element observed and not yet let go. */
  observed(): readonly Element[];
  /** Reports `width` as the content width of everything observed. */
  resize(width: number): void;
  /** Takes the stub away again. */
  restore(): void;
}

/** Installs a {@link ResizeObserverStub} as the global `ResizeObserver`. */
export function stubResizeObserver(): ResizeObserverStub {
  interface Live {
    readonly callback: ResizeObserverCallback;
    readonly targets: Set<Element>;
    readonly observer: ResizeObserver;
  }
  const live = new Set<Live>();
  class StubResizeObserver implements ResizeObserver {
    private readonly entry: Live;
    constructor(callback: ResizeObserverCallback) {
      this.entry = { callback, targets: new Set(), observer: this };
      live.add(this.entry);
    }
    observe(target: Element): void {
      this.entry.targets.add(target);
    }
    unobserve(target: Element): void {
      this.entry.targets.delete(target);
    }
    disconnect(): void {
      this.entry.targets.clear();
      live.delete(this.entry);
    }
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: StubResizeObserver,
  });
  return {
    observed: () => [...live].flatMap((entry) => [...entry.targets]),
    resize(width) {
      for (const entry of [...live]) {
        const entries = [...entry.targets].map(
          (target) =>
            ({
              target,
              contentRect: { width, height: 0 } as DOMRectReadOnly,
            }) as ResizeObserverEntry,
        );
        if (entries.length > 0) entry.callback(entries, entry.observer);
      }
    },
    restore() {
      live.clear();
      Reflect.deleteProperty(globalThis, 'ResizeObserver');
    },
  };
}

/** Lets every pending read answer (real timers). */
export async function settle(): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export interface MountedPage<T> {
  readonly fixture: ComponentFixture<T>;
  readonly store: ClientCardStore;
  readonly host: HTMLElement;
  /** Change detection, then the reads that are due, then change detection again. */
  render(): Promise<void>;
  byId<E extends HTMLElement = HTMLElement>(testId: string): E | null;
  all<E extends HTMLElement = HTMLElement>(selector: string): E[];
  /** An element's text, whitespace folded. */
  text(element: Element | null | undefined): string | null;
}

export interface MountOptions {
  readonly subject: ClientCardSubject;
  readonly context: ClientCardContext;
  /** The page's inputs besides `titleId`. */
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly rig?: AchievementsRig;
  /** The card's language (the catalogue's `bg` by default). */
  readonly lang?: 'bg' | 'en';
  /** `false` renders before any read has answered. */
  readonly settle?: boolean;
}

/**
 * Mounts one page as the editor does: the store opened on the person, the
 * page given its `titleId` and its own inputs, strict about unknown
 * elements and properties (templates are proven here, not only by `ngc`).
 */
export async function mountAchievementsPage<T>(
  page: Type<T>,
  options: MountOptions,
): Promise<MountedPage<T>> {
  await TestBed.configureTestingModule({
    imports: [page],
    providers: achievementsPageProviders(options.rig),
    errorOnUnknownElements: true,
    errorOnUnknownProperties: true,
  }).compileComponents();
  const transloco = TestBed.inject(TranslocoService);
  const lang = options.lang ?? 'bg';
  transloco.setActiveLang(lang);
  await firstValueFrom(transloco.selectTranslation(lang));
  const store = TestBed.inject(ClientCardStore);
  store.open(options.subject, options.context);
  const fixture = TestBed.createComponent(page);
  fixture.componentRef.setInput('titleId', PAGE_TITLE_ID);
  for (const [name, value] of Object.entries(options.inputs ?? {})) {
    fixture.componentRef.setInput(name, value);
  }
  const host = fixture.nativeElement as HTMLElement;
  const render = async () => {
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
    await fixture.whenStable();
  };
  if (options.settle === false) fixture.detectChanges();
  else await render();
  return {
    fixture,
    store,
    host,
    render,
    byId: <E extends HTMLElement = HTMLElement>(testId: string) =>
      host.querySelector<E>(`[data-testid="${testId}"]`),
    all: <E extends HTMLElement = HTMLElement>(selector: string) => [
      ...host.querySelectorAll<E>(selector),
    ],
    text: (element) =>
      element?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
  };
}
