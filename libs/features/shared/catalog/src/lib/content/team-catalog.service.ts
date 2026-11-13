import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TEAM_BARBER_PORTS } from '@creativo/infrastructure/firebase-app';
import { BarberLifecycle, BarberStatus } from '@core/components';
import type { BarberId, Result } from '@core/primitives';
import type { RepositoryError } from '@core/errors';
import type { Barber } from '@core/entities';
import { CatalogContentService } from './catalog-content.service';
import type { BarberVm } from './catalog.vm';

/**
 * The barbers OFF the public list (team onboarding D3): the whole team
 * for the staff surfaces — a draft, a staff-only barber, a leaver — and,
 * for a client's past visits, a barber read by id.
 *
 * Its own service, not part of `CatalogContentService`: that one stays
 * what the PUBLIC sees, and only a staff surface and the client's visit
 * list inject this one. The view models and avatar URLs still come from
 * the catalogue's one cache (`barberVmOf`, `alsoResolveAvatars`).
 *
 * The ports are optional: a host that provides none (a spec, a narrow
 * shell) sees the public list wherever the team would stand.
 */
@Injectable({ providedIn: 'root' })
export class TeamCatalogService {
  private readonly catalog = inject(CatalogContentService);
  private readonly ports = inject(TEAM_BARBER_PORTS, { optional: true });
  private readonly destroyRef = inject(DestroyRef);

  private readonly teamResult = signal<Result<
    readonly Barber[],
    RepositoryError
  > | null>(null);
  private teamWatched = false;

  private readonly looked = signal<ReadonlyMap<BarberId, Barber>>(new Map());
  private readonly asked = new Set<BarberId>();

  constructor() {
    // The avatars of everyone off the public list resolve through the
    // catalogue's cache.
    this.catalog.alsoResolveAvatars(
      computed(() => {
        const team = this.teamResult();
        return [...(team?.ok ? team.value : []), ...this.looked().values()];
      }),
    );
  }

  /**
   * Starts the live read of EVERY barber record. Staff only (the read rule
   * refuses a client a `DRAFT`), so a staff surface calls it once, from
   * its constructor; a second call is a no-op.
   */
  watchTeam(): void {
    if (this.teamWatched || this.ports === null) return;
    this.teamWatched = true;
    this.ports
      .observeTeamBarbers()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => this.teamResult.set(result));
  }

  /**
   * Every barber record, whatever its status, by `sortOrder` — the names,
   * faces and tones of the staff surfaces. The public list stands until
   * the team read answers (or where there is none).
   */
  readonly teamBarbers = computed<readonly Barber[]>(() => {
    const result = this.teamResult();
    return result?.ok ? result.value : this.catalog.barbers();
  });

  /**
   * Whether the team read has answered successfully — with no team read,
   * whether the public one has.
   */
  readonly teamKnown = computed(() =>
    this.ports === null
      ? this.catalog.barbersKnown()
      : this.teamResult()?.ok === true,
  );

  /**
   * The barbers who WORK — `STAFF_ONLY` or `PUBLIC`: the schedule's lanes,
   * its scope menu and legend, the chair pickers.
   */
  readonly liveBarbers = computed<readonly Barber[]>(() =>
    this.teamBarbers().filter(BarberLifecycle.isLive),
  );

  /** Every barber record but a leaver's — who an account can be linked to. */
  readonly currentBarbers = computed<readonly Barber[]>(() =>
    this.teamBarbers().filter(
      (barber) => barber.barberStatus !== BarberStatus.Departed,
    ),
  );

  /** Every barber record that has ever worked — a draft never has figures. */
  readonly workedBarbers = computed<readonly Barber[]>(() =>
    this.teamBarbers().filter(
      (barber) => barber.barberStatus !== BarberStatus.Draft,
    ),
  );

  readonly teamBarberVms = computed<readonly BarberVm[]>(() =>
    this.teamBarbers().map((barber) => this.catalog.barberVmOf(barber)),
  );

  readonly liveBarberVms = computed<readonly BarberVm[]>(() =>
    this.liveBarbers().map((barber) => this.catalog.barberVmOf(barber)),
  );

  /** A barber record on the team, by id — a name for a staff surface. */
  findTeamBarber(barberId: BarberId): Barber | undefined {
    return this.teamBarbers().find((barber) => barber.id === barberId);
  }

  /** The same barber's view model — their face. */
  findTeamBarberVm(barberId: BarberId): BarberVm | undefined {
    return this.teamBarberVms().find((vm) => vm.id === barberId);
  }

  /**
   * Loads, once each, the records of barbers on no list this viewer holds
   * — a past visit with a barber who left or now works staff-only. A
   * record the viewer may not read (a `DRAFT`, for a client) stays
   * unnamed.
   */
  rememberBarbers(ids: readonly BarberId[]): void {
    if (this.ports === null) return;
    const known = new Set(this.teamBarbers().map((barber) => barber.id));
    const missing: BarberId[] = [];
    for (const id of ids) {
      if (known.has(id) || this.asked.has(id)) continue;
      this.asked.add(id);
      missing.push(id);
    }
    if (missing.length === 0) return;
    void this.ports.loadBarbers(missing).then((result) => {
      if (!result.ok || result.value.length === 0) return;
      this.looked.update((before) => {
        const next = new Map(before);
        for (const barber of result.value) next.set(barber.id, barber);
        return next;
      });
    });
  }

  /**
   * Every barber this viewer can name — the team (or public) list, then the
   * ones looked up by id ({@link rememberBarbers}).
   */
  readonly namedBarberVms = computed<readonly BarberVm[]>(() => {
    const listed = this.teamBarbers();
    const ids = new Set(listed.map((barber) => barber.id));
    const extra = [...this.looked().values()].filter(
      (barber) => !ids.has(barber.id),
    );
    return [...listed, ...extra].map((barber) =>
      this.catalog.barberVmOf(barber),
    );
  });
}
